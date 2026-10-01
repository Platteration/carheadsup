/**
 * ObdService owns the OBD link for the HUD server: it opens the configured transport, brings
 * up the ELM327, discovers supported PIDs, runs the poller, and turns everything into
 * `HudEvent`s. Link state goes connecting → initializing → connected; on any failure it emits
 * 'error' with a readable message, closes the link and reconnects after `reconnectDelayMs`,
 * doubling the delay after each consecutive failure up to 30 s (reset once connected).
 *
 * Except when only the vehicle is silent (the adapter answers, the ECU does not: the HUD came
 * up before the ignition, or restarted while it was off): then the link stays open and the
 * vehicle is tried again every 3 s — `0100` only, no adapter reset, no growing delay (a failed
 * search that took longer is followed at once) — so data flows within seconds of the ECU
 * waking up. Those tries use the protocol the vehicle spoke last time (remembered through
 * `deps.protocolCache`) with `AT TP`, which answers at once instead of searching every protocol
 * for several seconds; every fifth is a full search in case the adapter now sits in another
 * car. That protocol also starts the search on connecting (`AT SP A<n>`), and a reconnect
 * within the process reuses the PIDs discovered before when the vehicle gives the same `0100`
 * answer.
 *
 * With `transport: 'simulator'` the link is an {@link Elm327Emulator} in front of a
 * {@link VehicleSimulator}. Pass `deps.simulator` to supply (and step) your own simulator, or
 * call {@link ObdService.getSimulator} to obtain the one the service creates — the service
 * then also steps it in real time while running.
 */
import type { HudEvent, ObdConfig, ObdLinkState, ObdLinkStatus, SignalId } from '@carheadsup/core';
import { Elm327, type Elm327Info, type Elm327Options } from './elm327.ts';
import { ElmError, isElmError, isVehicleSilence } from './errors.ts';
import { ObdPoller, type PollerDiscovery, type PollerTuning } from './poller.ts';
import { getProtocol, normalizeProtocolSetting } from './protocols.ts';
import {
  SILENT_LOGGER,
  SYSTEM_CLOCK,
  SYSTEM_TIMERS,
  Sleeper,
  errorMessage,
  type Clock,
  type Logger,
  type Timers,
} from './runtime.ts';
import { SimulationClock, type SimulationClockOptions } from './sim/clock.ts';
import { Elm327Emulator, type Elm327EmulatorOptions } from './sim/elm327-emulator.ts';
import { VehicleSimulator } from './sim/vehicle-sim.ts';
import { createTransport, type Transport } from './transport.ts';

export interface ObdServiceDeps {
  /** Hardware transport factory (tests inject failing or scripted transports). */
  createTransport?: (config: ObdConfig) => Transport;
  now?: Clock;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  logger?: Logger;
  /**
   * Simulator behind the 'simulator' transport. When supplied, the caller steps it; when
   * omitted, the service creates one on demand and steps it in real time while running.
   */
  simulator?: VehicleSimulator;
  /** Options for the emulator used by the 'simulator' transport. */
  emulator?: Elm327EmulatorOptions;
  /** Real-time stepping of a service-owned simulator. */
  simulationClock?: Omit<SimulationClockOptions, 'timers'>;
  /** Driver tuning (reset/search timeouts); the per-command timeout comes from the config. */
  driver?: Omit<Elm327Options, 'timers' | 'logger' | 'timeoutMs'>;
  poller?: Partial<PollerTuning>;
  /** Remembers the vehicle's protocol across restarts (the HUD server keeps it in a file). */
  protocolCache?: ObdProtocolCache;
  /** How often a silent vehicle is tried again on the open link. Default 3000 ms. */
  vehicleRetryMs?: number;
}

/** Where the protocol each connection's vehicle spoke is remembered. */
export interface ObdProtocolCache {
  /** The protocol ("1"–"C") last negotiated over `connection`, or null. */
  get(connection: string): string | null;
  /** Remember it; called whenever a session connects. */
  set(connection: string, protocolId: string): void;
}

export interface ClearDtcsOutcome {
  ok: boolean;
  message: string;
}

/** Longest reconnect delay. */
export const MAX_RECONNECT_DELAY_MS = 30_000;
/** A silent vehicle is tried again this often on the open link. */
export const VEHICLE_RETRY_MS = 3000;
/** Of the tries with the remembered protocol, every this many is a full search instead. */
export const FULL_SEARCH_EVERY = 5;
/** Samples older than this are not trusted for the clear-codes safety check. */
const SAFETY_SAMPLE_MAX_AGE_MS = 5000;
/**
 * Longest wait for a link to finish closing before the next session opens the device anyway
 * (closing a Linux tty waits up to 30 s for unsent output to drain).
 */
const CLOSE_WAIT_MS = 30_000;

const CONNECTION_KEYS = [
  'transport',
  'serialPath',
  'baudRate',
  'tcpHost',
  'tcpPort',
  'protocol',
  // A transcript starts with the adapter's initialisation, so recording starts a new session.
  'recordTranscript',
] as const;

type Phase = 'open' | 'init' | 'discover' | 'poll';

export class ObdService {
  private config: ObdConfig;
  private readonly deps: ObdServiceDeps;
  private readonly now: Clock;
  private readonly timers: Timers;
  private readonly logger: Logger;
  private readonly listeners = new Set<(event: HudEvent) => void>();
  private readonly sleeper: Sleeper;

  private sim: VehicleSimulator | null;
  private readonly ownsSimulator: boolean;
  private simClock: SimulationClock | null = null;

  private running = false;
  private loopDone: Promise<void> | null = null;
  private restartRequested = false;
  private transport: Transport | null = null;
  private driver: Elm327 | null = null;
  private poller: ObdPoller | null = null;
  /** PIDs discovered in an earlier session, and which link and vehicle they belong to. */
  private discovery: { key: string; found: PollerDiscovery } | null = null;
  /** Settles once every link closed so far has finished closing. */
  private closing: Promise<void> = Promise.resolve();
  private _status: ObdLinkStatus;

  constructor(config: ObdConfig, deps: ObdServiceDeps = {}) {
    this.config = config;
    this.deps = deps;
    this.now = deps.now ?? SYSTEM_CLOCK;
    this.timers = {
      setTimeout: deps.setTimeout ?? SYSTEM_TIMERS.setTimeout,
      clearTimeout: deps.clearTimeout ?? SYSTEM_TIMERS.clearTimeout,
    };
    this.logger = deps.logger ?? SILENT_LOGGER;
    this.sleeper = new Sleeper(this.timers);
    this.sim = deps.simulator ?? null;
    this.ownsSimulator = deps.simulator === undefined;
    this._status = {
      state: 'disconnected',
      adapter: null,
      protocol: null,
      message: null,
      since: this.now(),
    };
  }

  /** Current link status (mirrors the last `obd/link` event). */
  get status(): ObdLinkStatus {
    return { ...this._status };
  }

  /** The emulator of the current simulator session, if any (tests use it for fault injection). */
  get emulator(): Elm327Emulator | null {
    return this.transport instanceof Elm327Emulator ? this.transport : null;
  }

  /** The simulator behind the 'simulator' transport, created on first use unless supplied. */
  getSimulator(): VehicleSimulator {
    this.sim ??= new VehicleSimulator();
    return this.sim;
  }

  /** Subscribe to HUD events (obd/link, obd/samples, obd/supported, obd/dtcs, obd/vin). */
  onEvent(cb: (event: HudEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Start connecting (and keep reconnecting) until {@link stop}. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopDone = this.loop().catch((err: unknown) => {
      this.logger.error(`OBD: service loop crashed: ${errorMessage(err)}`);
    });
  }

  /** Stop polling, close the link and emit 'disconnected'. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.sleeper.wake();
    await this.teardownSession();
    await this.loopDone;
    this.loopDone = null;
    this.simClock?.stop();
    this.setState('disconnected', null);
  }

  /**
   * Apply a new OBD config. Connection settings (transport, device, host, protocol) restart
   * the session immediately; the rest (timeouts, DTC interval, custom PIDs) apply in place.
   */
  updateConfig(config: ObdConfig): void {
    const previous = this.config;
    this.config = config;
    if (CONNECTION_KEYS.some((key) => previous[key] !== config[key])) {
      if (this.running) {
        this.logger.info('OBD: connection settings changed; reconnecting');
        this.restartRequested = true;
        this.sleeper.wake();
        void this.teardownSession();
      }
      return;
    }
    this.driver?.setTimeoutMs(config.timeoutMs);
    this.poller?.updateOptions({
      customPids: config.customPids,
      dtcIntervalMs: config.dtcIntervalMs,
    });
  }

  /**
   * Read the trouble codes at the start of the next polling cycle instead of waiting up to
   * `dtcIntervalMs` (e.g. right after the simulator's injected codes changed). A no-op while
   * no session is polling: a new session reads them as soon as it connects anyway.
   */
  requestDtcRead(): void {
    this.poller?.requestDtcRead();
  }

  /**
   * Clear trouble codes (service 04). Refused unless connected, and — as a second line of
   * defence behind the server's parked check — unless recent samples show the vehicle
   * standing still with the engine off. Missing or stale speed or rpm refuses too: without
   * recent evidence the car may be moving.
   */
  async clearDtcs(): Promise<ClearDtcsOutcome> {
    const driver = this.driver;
    const poller = this.poller;
    if (this._status.state !== 'connected' || !driver || !poller) {
      return { ok: false, message: 'The OBD adapter is not connected' };
    }
    const now = this.now();
    const fresh = (signal: SignalId): number | null => {
      const sample = poller.latest(signal);
      return sample && now - sample.at <= SAFETY_SAMPLE_MAX_AGE_MS ? sample.value : null;
    };
    const speed = fresh('speed');
    const rpm = fresh('rpm');
    if (speed === null || rpm === null) {
      return {
        ok: false,
        message: 'Vehicle data unavailable: cannot confirm the car is parked with the engine off',
      };
    }
    if (speed > 0) {
      return { ok: false, message: 'Trouble codes can only be cleared while parked' };
    }
    if (rpm > 0) {
      return {
        ok: false,
        message: 'Switch the engine off (ignition on) before clearing trouble codes',
      };
    }
    try {
      const result = await driver.clearDtcs();
      poller.requestDtcRead();
      this.logger.info(`OBD: clear trouble codes: ${result.message}`);
      return result;
    } catch (err) {
      return { ok: false, message: `Clearing trouble codes failed: ${errorMessage(err)}` };
    }
  }

  // -------------------------------------------------------------------------------------------
  // Connection loop
  // -------------------------------------------------------------------------------------------

  private async loop(): Promise<void> {
    let failures = 0;
    while (this.running) {
      this.restartRequested = false;
      const phase: { current: Phase } = { current: 'open' };
      try {
        await this.runSession(phase, () => {
          failures = 0;
        });
        if (this.running && !this.restartRequested) {
          throw new ElmError('CLOSED', 'The OBD session ended unexpectedly');
        }
      } catch (err) {
        if (this.running && !this.restartRequested) {
          failures += 1;
          const message = describeFailure(err, phase.current, this.transport?.description);
          this.logger.warn(`OBD: ${message}`);
          this.setState('error', message);
        }
      } finally {
        await this.teardownSession();
      }
      if (!this.running) break;
      if (this.restartRequested) {
        failures = 0;
        continue;
      }
      const delay = Math.min(
        MAX_RECONNECT_DELAY_MS,
        Math.max(0, this.config.reconnectDelayMs) * 2 ** Math.max(0, failures - 1),
      );
      await this.sleeper.sleep(delay);
    }
  }

  private async runSession(phase: { current: Phase }, onConnected: () => void): Promise<void> {
    const config = this.config;
    const transport = this.makeTransport(config);
    this.transport = transport;
    this.setState('connecting', `Opening ${transport.description}`);
    await transport.open();
    if (!this.running || this.restartRequested) {
      // Stopped while opening: teardown may have run before the link existed.
      await transport.close();
      return;
    }

    phase.current = 'init';
    this.setState('initializing', 'Initialising the adapter');
    const driver = new Elm327(transport, {
      ...this.deps.driver,
      timeoutMs: config.timeoutMs,
      timers: this.timers,
      logger: this.logger,
    });
    this.driver = driver;
    const connection = connectionKey(config);
    const preferred = this.preferredProtocol(config, connection);
    let info: Elm327Info | null;
    try {
      info = await driver.initialize({ protocol: config.protocol, preferredProtocol: preferred });
    } catch (err) {
      if (!isVehicleSilence(err) || driver.closed) throw err;
      info = await this.waitForVehicle(driver, err, preferred);
    }
    if (info === null || !this.running || this.restartRequested) return;
    if (getProtocol(info.protocolId) !== undefined) {
      this.deps.protocolCache?.set(connection, info.protocolId);
    }

    phase.current = 'discover';
    const discoveryKey = `${connection}|${info.protocolId}|${info.vehicleSignature}`;
    const poller = new ObdPoller(
      driver,
      {
        maxPidsPerRequest: info.maxPidsPerRequest,
        voltageSupported: info.voltageSupported,
        customPids: config.customPids,
        dtcIntervalMs: config.dtcIntervalMs,
        link: { adapter: info.adapter, protocol: info.protocol },
        now: this.now,
        timers: this.timers,
        logger: this.logger,
        tuning: this.deps.poller,
        ...(this.discovery?.key === discoveryKey ? { discovered: this.discovery.found } : {}),
      },
      (event) => this.dispatch(event),
    );
    this.poller = poller;
    await poller.discover();
    this.rememberDiscovery(discoveryKey, poller);
    if (!this.running || this.restartRequested) return;

    phase.current = 'poll';
    this.setState('connected', null, { adapter: info.adapter, protocol: info.protocol });
    onConnected();
    try {
      await poller.run();
    } finally {
      // The VIN may have been read meanwhile: a reconnect need not read it again.
      this.rememberDiscovery(discoveryKey, poller);
    }
  }

  /**
   * The protocol to start the automatic search with: the one this link's vehicle spoke last
   * time. Null when the protocol is configured (or "A<n>": the driver chose already).
   */
  private preferredProtocol(config: ObdConfig, connection: string): string | null {
    let setting: string;
    try {
      setting = normalizeProtocolSetting(config.protocol);
    } catch {
      return null; // initialize() reports the invalid setting
    }
    if (setting !== '0') return null;
    const cached = this.deps.protocolCache?.get(connection) ?? null;
    return cached !== null && getProtocol(cached) !== undefined ? cached : null;
  }

  /**
   * The adapter answers but the vehicle does not (ignition off): keep the link and try the
   * vehicle again every `vehicleRetryMs` until it answers (see the module comment). Resolves
   * with the connection, or null when stopped or restarted meanwhile; rejects when something
   * else goes wrong.
   */
  private async waitForVehicle(
    driver: Elm327,
    first: unknown,
    preferred: string | null,
  ): Promise<Elm327Info | null> {
    this.setState('error', describeFailure(first, 'init', this.transport?.description));
    this.logger.info('OBD: waiting for the vehicle to answer');
    let quickTries = preferred !== null;
    const retryMs = this.deps.vehicleRetryMs ?? VEHICLE_RETRY_MS;
    let tried = this.now();
    for (let attempt = 1; ; attempt++) {
      // Tries start every `retryMs`; a full search that failed slowly is followed at once.
      await this.sleeper.sleep(Math.max(0, tried + retryMs - this.now()));
      if (!this.running || this.restartRequested) return null;
      tried = this.now();
      const quick = quickTries && attempt % FULL_SEARCH_EVERY !== 0;
      try {
        return await driver.connectVehicle(
          quick && preferred !== null ? { protocol: preferred, tryOnly: true } : {},
        );
      } catch (err) {
        if (quick && isElmError(err, 'UNSUPPORTED') && !driver.closed) {
          this.logger.debug('OBD: the adapter does not know AT TP; searching instead');
          quickTries = false;
          continue;
        }
        if (!isVehicleSilence(err) || driver.closed) throw err;
        this.logger.debug(`OBD: the vehicle still does not answer (${errorMessage(err)})`);
      }
    }
  }

  private rememberDiscovery(key: string, poller: ObdPoller): void {
    const found = poller.discovery;
    if (found !== null) this.discovery = { key, found };
  }

  private makeTransport(config: ObdConfig): Transport {
    if (config.transport === 'simulator') {
      const sim = this.getSimulator();
      if (this.ownsSimulator) {
        this.simClock ??= new SimulationClock(sim, {
          ...this.deps.simulationClock,
          timers: this.timers,
        });
        this.simClock.start();
      }
      return new Elm327Emulator(sim, { timers: this.timers, ...this.deps.emulator });
    }
    this.simClock?.stop();
    return (this.deps.createTransport ?? createTransport)(config);
  }

  /**
   * Stop the session and close its link. Resolves once every link closed so far has finished
   * closing — also one whose close an earlier call started (e.g. {@link updateConfig}) — so the
   * next session never opens the device while the old handle is still open (a serial port is
   * opened with an exclusive lock).
   */
  private teardownSession(): Promise<void> {
    const poller = this.poller;
    const driver = this.driver;
    const transport = this.transport;
    this.poller = null;
    this.driver = null;
    this.transport = null;
    poller?.stop();
    const closing =
      driver || transport
        ? new Promise<void>((resolve) => {
            const timer = this.timers.setTimeout(() => {
              this.logger.warn('OBD: the link is slow to close; carrying on');
              resolve();
            }, CLOSE_WAIT_MS);
            void (async () => {
              try {
                if (driver) await driver.close();
                else if (transport) await transport.close();
              } catch (err) {
                this.logger.debug(`OBD: error while closing the link: ${errorMessage(err)}`);
              } finally {
                this.timers.clearTimeout(timer);
                resolve();
              }
            })();
          })
        : Promise.resolve();
    const previous = this.closing;
    this.closing = Promise.all([previous, closing]).then(() => undefined);
    return this.closing;
  }

  // -------------------------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------------------------

  private setState(
    state: ObdLinkState,
    message: string | null,
    labels: { adapter: string | null; protocol: string | null } = { adapter: null, protocol: null },
  ): void {
    const at = this.now();
    this._status = {
      state,
      adapter: labels.adapter,
      protocol: labels.protocol,
      message,
      since: at,
    };
    this.broadcast({
      type: 'obd/link',
      state,
      adapter: labels.adapter,
      protocol: labels.protocol,
      message,
      at,
    });
  }

  /** Events from the poller. */
  private dispatch(event: HudEvent): void {
    if (event.type === 'obd/link' && event.state === this._status.state) {
      // Poller status updates (e.g. "vehicle not answering") keep the state but change the message.
      this._status = { ...this._status, message: event.message ?? null };
    }
    this.broadcast(event);
  }

  private broadcast(event: HudEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (err) {
        this.logger.error(`OBD: event listener failed: ${errorMessage(err)}`);
      }
    }
  }
}

/** Identifies the adapter link (not the protocol or timing settings). */
function connectionKey(config: ObdConfig): string {
  switch (config.transport) {
    case 'serial':
      return `serial:${config.serialPath}`;
    case 'tcp':
      return `tcp:${config.tcpHost}:${config.tcpPort}`;
    default:
      return config.transport;
  }
}

function describeFailure(err: unknown, phase: Phase, transport: string | undefined): string {
  if (err instanceof ElmError) {
    switch (err.code) {
      case 'UNABLE_TO_CONNECT':
      case 'NO_RESPONSE':
      case 'BUS_INIT_ERROR':
      case 'CAN_ERROR': {
        const said = err.response.join(' ') || err.code;
        return `The adapter is connected but the vehicle did not answer — is the ignition on? (${said})`;
      }
      case 'CLOSED':
        return phase === 'poll' ? `Connection to the adapter lost: ${err.message}` : err.message;
      default:
        return phase === 'init' ? `Adapter initialisation failed: ${err.message}` : err.message;
    }
  }
  const detail = errorMessage(err);
  if (phase === 'open') return `Cannot open ${transport ?? 'the OBD adapter'}: ${detail}`;
  return detail;
}
