/**
 * ObdService owns the OBD link for the HUD server: it opens the configured transport, brings
 * up the ELM327, discovers supported PIDs, runs the poller, and turns everything into
 * `HudEvent`s. Link state goes connecting → initializing → connected; on any failure it emits
 * 'error' with a readable message, closes the link and reconnects after `reconnectDelayMs`,
 * doubling the delay after each consecutive failure up to 30 s (reset once connected).
 *
 * With `transport: 'simulator'` the link is an {@link Elm327Emulator} in front of a
 * {@link VehicleSimulator}. Pass `deps.simulator` to supply (and step) your own simulator, or
 * call {@link ObdService.getSimulator} to obtain the one the service creates — the service
 * then also steps it in real time while running.
 */
import type { HudEvent, ObdConfig, ObdLinkState, ObdLinkStatus, SignalId } from '@carheadsup/core';
import { Elm327, type Elm327Options } from './elm327.ts';
import { ElmError } from './errors.ts';
import { ObdPoller, type PollerTuning } from './poller.ts';
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
}

export interface ClearDtcsOutcome {
  ok: boolean;
  message: string;
}

/** Longest reconnect delay. */
export const MAX_RECONNECT_DELAY_MS = 30_000;
/** Samples older than this are not trusted for the clear-codes safety check. */
const SAFETY_SAMPLE_MAX_AGE_MS = 5000;

const CONNECTION_KEYS = [
  'transport',
  'serialPath',
  'baudRate',
  'tcpHost',
  'tcpPort',
  'protocol',
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
   * Clear trouble codes (service 04). Refused unless connected, and — as a second line of
   * defence behind the server's parked check — while recent samples show the vehicle moving
   * or the engine running.
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
    if ((fresh('speed') ?? 0) > 0) {
      return { ok: false, message: 'Trouble codes can only be cleared while parked' };
    }
    if ((fresh('rpm') ?? 0) > 0) {
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
    const info = await driver.initialize({ protocol: config.protocol });
    if (!this.running || this.restartRequested) return;

    phase.current = 'discover';
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
      },
      (event) => this.dispatch(event),
    );
    this.poller = poller;
    await poller.discover();
    if (!this.running || this.restartRequested) return;

    phase.current = 'poll';
    this.setState('connected', null, { adapter: info.adapter, protocol: info.protocol });
    onConnected();
    await poller.run();
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

  private async teardownSession(): Promise<void> {
    const poller = this.poller;
    const driver = this.driver;
    const transport = this.transport;
    this.poller = null;
    this.driver = null;
    this.transport = null;
    poller?.stop();
    try {
      if (driver) await driver.close();
      else if (transport) await transport.close();
    } catch (err) {
      this.logger.debug(`OBD: error while closing the link: ${errorMessage(err)}`);
    }
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
