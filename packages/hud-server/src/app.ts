import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mergeConfig } from '@carheadsup/core';
import type { ApiConfigResult, HudConfig, HudFrame, HudToPhone } from '@carheadsup/core';
import { SILENT_LOGGER, SYSTEM_CLOCK, SYSTEM_TIMERS } from '@carheadsup/obd';
import type { Clock, Logger, Timers } from '@carheadsup/obd';
import { advertiseHud as defaultAdvertiseHud } from './discovery/mdns.ts';
import { HudEngine, maintenanceDueMessage } from './engine.ts';
import { createApiRouter } from './http/api.ts';
import type { ConfigChange } from './http/api.ts';
import { hudHostNames, isAllowedHost, isAuthorized } from './http/auth.ts';
import { limitConnections } from './http/connections.ts';
import { HttpError } from './http/respond.ts';
import { createRequestHandler } from './http/server.ts';
import { createStaticServer } from './http/static.ts';
import { DEFAULT_RENDERER_DIR, HUD_VERSION } from './meta.ts';
import { ObdLink } from './obd/obd-link.ts';
import type { ObdServiceFactory } from './obd/obd-link.ts';
import { createFrameSinks as defaultCreateFrameSinks } from './outputs/index.ts';
import type { FrameSinkOptions } from './outputs/index.ts';
import { effectiveConfig } from './runtime-config.ts';
import type { RuntimeOverrides } from './runtime-config.ts';
import { createSensorSources as defaultCreateSensorSources } from './sensors/index.ts';
import { createSimulation as defaultCreateSimulation } from './sim/index.ts';
import type {
  EventSource,
  FrameSink,
  RuntimeDeps,
  Service,
  Simulation,
  SourceContext,
} from './sources/types.ts';
import { SerialQueue, ensureDirectory } from './store/atomic.ts';
import { ConfigStore, ConfigUnavailableError, serializeConfig } from './store/config-store.ts';
import { PersistStore } from './store/persist-store.ts';
import { TripStore } from './store/trip-store.ts';
import { PhoneChannel } from './ws/phone-channel.ts';
import { RendererChannel } from './ws/renderer-channel.ts';
import { WebSocketRouter } from './ws/upgrade.ts';

/** Default time allowed for each component to stop before shutdown moves on. */
export const STOP_STEP_TIMEOUT_MS = 5000;
/** Grace period for in-flight HTTP requests on shutdown before connections are cut. */
const HTTP_CLOSE_GRACE_MS = 1000;
/** Refused connections (over the per-device limits) are logged at most this often. */
const REFUSAL_LOG_INTERVAL_MS = 60_000;

export const CONFIG_FILE = 'config.json';
export const STATE_FILE = 'state.json';
export const TRIPS_FILE = 'trips.jsonl';

/** Knobs for tests; production uses the defaults. */
export interface HudServerTuning {
  tickIntervalMs?: number;
  persistDelayMs?: number;
  odometerPersistIntervalMs?: number;
  heartbeatIntervalMs?: number;
  helloTimeoutMs?: number;
  phoneRatePerSecond?: number;
  phoneRateBurst?: number;
  maxTrips?: number;
  stopTimeoutMs?: number;
}

export interface HudServerOptions {
  /** Directory for config.json (by default), state.json and trips.jsonl. Created if missing. */
  dataDir: string;
  /** Config file; default `<dataDir>/config.json`. */
  configPath?: string;
  /** Run against the simulator (`--sim`). */
  sim?: boolean;
  /** Override `server.port` (0 = any free port). Never written to the config file. */
  port?: number;
  /** Override `server.host`. Never written to the config file. */
  host?: string;
  /** Built renderer directory; default `packages/hud-renderer/dist`. */
  rendererDir?: string;
  /** Backlight device directory; null = auto-detect, false = disabled. Default null. */
  backlight?: string | null | false;
  /**
   * Extra host names the HUD may be reached by (e.g. one the home router's DNS gives it).
   * IP addresses, localhost, the machine's host name and `<hostname>.local` always work; any
   * other `Host` is refused (DNS-rebinding protection).
   */
  allowedHosts?: readonly string[];
  now?: Clock;
  timers?: Timers;
  logger?: Logger;
  // Injection seams for the pluggable modules (tests pass fakes).
  createSimulation?: (config: HudConfig, deps: RuntimeDeps) => Simulation;
  createSensorSources?: (config: HudConfig) => EventSource[];
  createFrameSinks?: (options: FrameSinkOptions, deps: RuntimeDeps) => FrameSink[];
  advertiseHud?: (config: HudConfig, deps: RuntimeDeps) => Service | null;
  createObdService?: ObdServiceFactory;
  tuning?: HudServerTuning;
}

export interface HudServer {
  /** Load state, start every component and listen. Resolves with the bound port. */
  start(): Promise<{ port: number }>;
  /** Graceful shutdown in reverse start order, flushing persistence. Idempotent. */
  stop(): Promise<void>;
  /** The engine (available once `start()` has begun loading; throws before). */
  readonly engine: HudEngine;
  /** The bound port once listening, else null. */
  readonly port: number | null;
  /** The simulation when running with `sim`, else null. */
  readonly simulation: Simulation | null;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Compose the on-car service: config/state/trip stores in the data directory, the engine, the
 * OBD link (to the simulator with `sim`), simulated and hardware event sources, frame sinks,
 * mDNS advertisement, and the HTTP server with the REST API, the renderer files and the two
 * WebSockets.
 *
 * Config changes through the API are validated, saved, and applied to every component: the
 * engine, the OBD service, the sources, the renderer (`display`), the phone (pairing token) and
 * mDNS. Runtime overrides (`sim`, `port`, `host`) are applied on top and never saved.
 */
export function createHudServer(options: HudServerOptions): HudServer {
  const logger = options.logger ?? SILENT_LOGGER;
  const now = options.now ?? SYSTEM_CLOCK;
  const timers = options.timers ?? SYSTEM_TIMERS;
  const deps: RuntimeDeps = { now, timers, logger };
  const tuning = options.tuning ?? {};
  const simulated = options.sim ?? false;
  const overrides: RuntimeOverrides = {
    sim: simulated,
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.host !== undefined ? { host: options.host } : {}),
  };
  const dataDir = resolve(options.dataDir);
  const configPath = resolve(options.configPath ?? join(dataDir, CONFIG_FILE));
  const rendererDir = resolve(options.rendererDir ?? DEFAULT_RENDERER_DIR);
  const stopTimeoutMs = tuning.stopTimeoutMs ?? STOP_STEP_TIMEOUT_MS;

  const configStore = new ConfigStore(configPath, logger);
  const persistStore = new PersistStore(join(dataDir, STATE_FILE), logger);
  const tripStore = new TripStore({
    path: join(dataDir, TRIPS_FILE),
    logger,
    ...(tuning.maxTrips !== undefined ? { maxTrips: tuning.maxTrips } : {}),
  });
  const configQueue = new SerialQueue();
  const mdnsQueue = new SerialQueue();

  let stored: HudConfig | null = null;
  let effective: HudConfig | null = null;
  let engine: HudEngine | null = null;
  let simulation: Simulation | null = null;
  let obd: ObdLink | null = null;
  let phone: PhoneChannel | null = null;
  let renderer: RendererChannel | null = null;
  let wsRouter: WebSocketRouter | null = null;
  let httpServer: Server | null = null;
  let boundPort: number | null = null;
  let mdns: Service | null = null;
  let sources: EventSource[] = [];
  const startedSources: EventSource[] = [];
  /** Per source: its config updates run one at a time; `next` is the latest not yet applied. */
  const sourceUpdates = new Map<EventSource, { queue: SerialQueue; next: HudConfig | null }>();
  let sinks: FrameSink[] = [];
  let unsubscribeSinks: (() => void) | null = null;
  const unsubscribeBrightness: Array<() => void> = [];
  /** The raw start attempt (awaited by shutdown) and its public, cleanup-on-failure wrapper. */
  let startAttempt: Promise<{ port: number }> | null = null;
  let starting: Promise<{ port: number }> | null = null;
  let stopping: Promise<void> | null = null;

  const requireEngine = (): HudEngine => {
    if (engine === null) throw new Error('The HUD server has not been started');
    return engine;
  };
  const currentEffective = (): HudConfig => {
    if (effective === null) throw new Error('The HUD server has not been started');
    return effective;
  };

  function sendToPhone(message: HudToPhone): void {
    phone?.send(message);
    if (simulation !== null) {
      try {
        simulation.deliverToPhone(message);
      } catch (err) {
        logger.warn(
          `Simulation: delivering ${message.t} to the simulated phone failed: ${describe(err)}`,
        );
      }
    }
  }

  function advertise(config: HudConfig): void {
    if (stopping !== null) return;
    const advertiseHud = options.advertiseHud ?? defaultAdvertiseHud;
    try {
      const port = boundPort ?? config.server.port;
      mdns = advertiseHud({ ...config, server: { ...config.server, port } }, deps);
    } catch (err) {
      mdns = null;
      logger.warn(`mDNS: advertising failed: ${describe(err)}`);
    }
  }

  /** Re-advertise with a new config; serialised so rapid changes never orphan an advertisement. */
  function restartMdns(config: HudConfig): Promise<void> {
    return mdnsQueue.run(async () => {
      const previous = mdns;
      mdns = null;
      if (previous !== null) {
        try {
          await previous.stop();
        } catch (err) {
          logger.warn(`mDNS: stopping failed: ${describe(err)}`);
        }
      }
      advertise(config);
    });
  }

  /**
   * Hand a new config to a source. Updates of one source never overlap (a source restarting its
   * driver would otherwise launch two), and a burst of changes is applied as its latest.
   */
  function updateSource(source: EventSource, config: HudConfig): void {
    if (source.updateConfig === undefined) return;
    let slot = sourceUpdates.get(source);
    if (slot === undefined) {
      slot = { queue: new SerialQueue(), next: null };
      sourceUpdates.set(source, slot);
    }
    const queued = slot.next !== null;
    slot.next = config;
    if (queued) return; // the queued update picks up this config
    const current = slot;
    current.queue
      .run(async () => {
        const latest = current.next;
        current.next = null;
        if (latest === null || stopping !== null) return;
        await source.updateConfig?.(latest);
      })
      .catch((err: unknown) => {
        logger.warn(`${source.name}: applying the new config failed: ${describe(err)}`);
      });
  }

  /** Push a new effective config to every running component. */
  function applyEffective(next: HudConfig): void {
    const previous = effective;
    effective = next;
    engine?.setConfig(next);
    obd?.updateConfig(next);
    renderer?.updateConfig(next);
    phone?.updateConfig(next);
    for (const source of startedSources) updateSource(source, next);
    if (previous === null) return;
    if (previous.server.port !== next.server.port || previous.server.host !== next.server.host) {
      logger.warn('Config: the new server address takes effect after a restart');
    }
    if (previous.server.mdns !== next.server.mdns || previous.vehicle.name !== next.vehicle.name) {
      void restartMdns(next);
    }
  }

  /** Whether the grid was switched off (or tried to be) during the current moving stretch. */
  let gridOffWhileMoving = false;

  /**
   * The calibration grid is for standing still: once the car moves, switch it off in the stored
   * config, so it does not come back at the next red light. (The renderer never draws it over a
   * moving car's HUD anyway.) Tried once per moving stretch.
   */
  function switchGridOffWhenMoving(frame: HudFrame): void {
    const moving = frame.context === 'city' || frame.context === 'highway';
    if (!moving) {
      gridOffWhileMoving = false;
      return;
    }
    if (gridOffWhileMoving || stored?.display.projection.showGrid !== true) return;
    gridOffWhileMoving = true;
    logger.info('Config: the car is moving; switching the calibration grid off');
    updateConfig((current) =>
      mergeConfig(current, { display: { projection: { showGrid: false } } }),
    ).catch((err: unknown) => {
      logger.warn(`Config: could not switch the calibration grid off: ${describe(err)}`);
    });
  }

  /** Validate, save and apply a config change (serialised, so concurrent PATCHes never race). */
  function updateConfig(change: ConfigChange): Promise<ApiConfigResult> {
    return configQueue.run(async () => {
      const current = stored;
      if (current === null) throw new HttpError(503, 'The HUD is starting');
      const result = change(current);
      if (serializeConfig(result.config) !== serializeConfig(current)) {
        try {
          await configStore.save(result.config);
        } catch (err) {
          logger.error(`Config: saving ${configPath} failed: ${describe(err)}`);
          if (err instanceof ConfigUnavailableError) throw new HttpError(503, err.message);
          throw new HttpError(500, `The configuration could not be saved: ${describe(err)}`);
        }
        stored = result.config;
        logger.info(
          `Config: updated${result.errors.length > 0 ? ` (${result.errors.length} field(s) rejected)` : ''}`,
        );
        applyEffective(effectiveConfig(result.config, overrides));
      }
      return { config: result.config, errors: result.errors };
    });
  }

  async function listen(server: Server, config: HudConfig): Promise<number> {
    await new Promise<void>((resolveListen, rejectListen) => {
      const onError = (err: Error): void => {
        server.off('listening', onListening);
        rejectListen(
          new Error(
            `Cannot listen on ${config.server.host}:${config.server.port}: ${describe(err)}`,
            { cause: err },
          ),
        );
      };
      const onListening = (): void => {
        server.off('error', onError);
        resolveListen();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(config.server.port, config.server.host);
    });
    server.on('error', (err) => logger.error(`HTTP: server error: ${describe(err)}`));
    return (server.address() as AddressInfo).port;
  }

  async function closeHttp(server: Server): Promise<void> {
    if (!server.listening) return;
    await new Promise<void>((resolveClose) => {
      const force = timers.setTimeout(() => server.closeAllConnections(), HTTP_CLOSE_GRACE_MS);
      server.close(() => {
        timers.clearTimeout(force);
        resolveClose();
      });
      server.closeIdleConnections();
    });
  }

  async function doStart(): Promise<{ port: number }> {
    await ensureDirectory(dataDir);
    await ensureDirectory(dirname(configPath));
    const [loaded, persisted] = await Promise.all([
      configStore.load(),
      persistStore.load(),
      tripStore.load(),
    ]);
    stored = loaded.config;
    effective = effectiveConfig(loaded.config, overrides);
    const config = effective;

    if (simulated) {
      simulation = (options.createSimulation ?? defaultCreateSimulation)(config, deps);
    }

    const hudEngine = new HudEngine({
      config,
      persisted,
      simulated,
      now,
      timers,
      logger,
      outputs: {
        sendToPhone,
        saveTrip: (trip) => tripStore.append(trip),
        savePersisted: (state) => persistStore.save(state),
      },
      ...(tuning.tickIntervalMs !== undefined ? { tickIntervalMs: tuning.tickIntervalMs } : {}),
      ...(tuning.persistDelayMs !== undefined ? { persistDelayMs: tuning.persistDelayMs } : {}),
      ...(tuning.odometerPersistIntervalMs !== undefined
        ? { odometerPersistIntervalMs: tuning.odometerPersistIntervalMs }
        : {}),
    });
    engine = hudEngine;

    obd = new ObdLink({
      config,
      simulator: simulation?.vehicle ?? null,
      deps,
      onEvent: (event) => hudEngine.dispatch(event),
      ...(options.createObdService ? { factory: options.createObdService } : {}),
    });

    let sensorSources: EventSource[] = [];
    try {
      sensorSources = (options.createSensorSources ?? defaultCreateSensorSources)(config);
    } catch (err) {
      logger.error(`Sensors: cannot create the sensor sources: ${describe(err)}`);
    }
    sources = [...(simulation?.sources ?? []), ...sensorSources];

    try {
      sinks = (options.createFrameSinks ?? defaultCreateFrameSinks)(
        { backlight: options.backlight ?? null },
        deps,
      );
    } catch (err) {
      logger.error(`Outputs: cannot create the frame sinks: ${describe(err)}`);
      sinks = [];
    }

    phone = new PhoneChannel({
      dispatch: (event) => hudEngine.dispatch(event),
      getConfig: currentEffective,
      tripsEndedAfter: (since, limit) => tripStore.endedAfter(since, limit),
      dueMaintenance: () => maintenanceDueMessage(hudEngine.state.maintenance.status),
      // With the simulator, a real phone takes precedence over the simulated one.
      onPhoneChange: (connected) => simulation?.setRealPhoneConnected(connected),
      version: HUD_VERSION,
      now,
      timers,
      logger,
      ...(tuning.helloTimeoutMs !== undefined ? { helloTimeoutMs: tuning.helloTimeoutMs } : {}),
      ...(tuning.phoneRatePerSecond !== undefined
        ? { ratePerSecond: tuning.phoneRatePerSecond }
        : {}),
      ...(tuning.phoneRateBurst !== undefined ? { rateBurst: tuning.phoneRateBurst } : {}),
    });
    const rendererChannel = new RendererChannel({
      engine: hudEngine,
      getConfig: currentEffective,
      simulated,
      // The kiosk leaves dimming to the backlight while a sink drives one (no double dimming).
      hardwareBrightness: () => sinks.some((sink) => sink.drivesBrightness === true),
      authorize: (auth, cfg) =>
        isAuthorized({
          remoteAddress: auth.remoteAddress,
          token: auth.token,
          apiToken: cfg.server.apiToken,
        }),
      now,
      timers,
      logger,
    });
    renderer = rendererChannel;
    for (const sink of sinks) {
      const unsubscribe = sink.onDrivesBrightnessChange?.(() => rendererChannel.refreshDisplay());
      if (unsubscribe !== undefined) unsubscribeBrightness.push(unsubscribe);
    }
    const apiToken = (): string => currentEffective().server.apiToken;
    const hostNames = hudHostNames(hostname(), [
      ...(options.allowedHosts ?? []),
      config.server.host,
    ]);
    const allowedHost = (host: string | undefined): boolean => isAllowedHost(host, hostNames);
    wsRouter = new WebSocketRouter({
      renderer,
      phone,
      apiToken,
      allowedHost,
      timers,
      logger,
      ...(tuning.heartbeatIntervalMs !== undefined
        ? { heartbeatIntervalMs: tuning.heartbeatIntervalMs }
        : {}),
    });

    const sim = simulation;
    const startedAt = now();
    const api = createApiRouter({
      version: HUD_VERSION,
      simulated,
      now,
      startedAt,
      engine: hudEngine,
      getConfig: () => stored ?? config,
      updateConfig,
      clearDtcs: () => {
        if (obd === null) return Promise.resolve({ ok: false, message: 'OBD is not running' });
        return obd.clearDtcs();
      },
      trips: tripStore,
      simulation:
        sim === null
          ? null
          : {
              status: () => sim.status(),
              control: (control) => {
                const status = sim.control(control);
                // Injected trouble codes show up within a polling cycle rather than after the
                // next scheduled DTC read (up to `obd.dtcIntervalMs`, 30 s by default).
                if (control.dtcs !== undefined) obd?.requestDtcRead();
                return status;
              },
            },
    });
    const server = createServer(
      createRequestHandler({
        api,
        static: createStaticServer(rendererDir),
        apiToken,
        allowedHost,
        logger,
      }),
    );
    let lastRefusalLog = Number.NEGATIVE_INFINITY;
    limitConnections(server, {
      onRefused: (address) => {
        const at = now();
        if (Math.abs(at - lastRefusalLog) < REFUSAL_LOG_INTERVAL_MS) return;
        lastRefusalLog = at;
        logger.warn(`HTTP: refusing connections from ${address || '?'} (too many open)`);
      },
    });
    server.on('upgrade', wsRouter.handleUpgrade);
    httpServer = server;
    boundPort = await listen(server, config);

    hudEngine.start();
    obd.start();
    if (sim !== null) sim.start();
    const ctx: SourceContext = { ...deps, emit: (event) => hudEngine.dispatch(event) };
    for (const source of sources) {
      try {
        await source.start(ctx);
        startedSources.push(source);
      } catch (err) {
        logger.error(`${source.name}: failed to start: ${describe(err)}`);
      }
    }
    unsubscribeSinks = hudEngine.onFrame((frame) => {
      switchGridOffWhenMoving(frame);
      for (const sink of sinks) {
        try {
          sink.onFrame(frame);
        } catch (err) {
          logger.warn(`${sink.name}: frame handling failed: ${describe(err)}`);
        }
      }
    });
    advertise(config);

    logger.info(
      `HUD server ${HUD_VERSION} listening on ${config.server.host}:${boundPort}${simulated ? ' (simulator)' : ''}`,
    );
    return { port: boundPort };
  }

  /** Run one shutdown step with a time limit; failures are logged and never stop the others. */
  async function step(name: string, action: () => Promise<void> | void): Promise<void> {
    let timer: unknown = null;
    try {
      await Promise.race([
        Promise.resolve().then(action),
        new Promise<void>((resolveTimeout) => {
          timer = timers.setTimeout(() => {
            logger.warn(`Shutdown: ${name} did not stop within ${stopTimeoutMs} ms`);
            resolveTimeout();
          }, stopTimeoutMs);
        }),
      ]);
    } catch (err) {
      logger.error(`Shutdown: stopping ${name} failed: ${describe(err)}`);
    } finally {
      if (timer !== null) timers.clearTimeout(timer);
    }
  }

  async function doStop(): Promise<void> {
    // Let a start in progress reach a consistent point first (never the wrapper: it awaits us).
    if (startAttempt !== null) await startAttempt.catch(() => {});
    logger.info('HUD server stopping');
    if (engine !== null) {
      // Save the odometer, service records and trip in progress first: the steps below may take
      // seconds each, and a supercap / UPS HAT may not last until the end. (engine.stop() writes
      // once more at the end if anything changed meanwhile.)
      const hudEngine = engine;
      await step('saving state', () => hudEngine.flushPersistence());
    }
    await step('mDNS restart', () => mdnsQueue.idle());
    if (mdns !== null) {
      const service = mdns;
      mdns = null;
      await step('mDNS', () => service.stop());
    }
    if (wsRouter !== null) {
      const router = wsRouter;
      await step('WebSockets', () => router.close());
    }
    if (httpServer !== null) {
      const server = httpServer;
      await step('HTTP server', () => closeHttp(server));
    }
    for (const source of [...startedSources].reverse()) {
      await step(source.name, async () => {
        // After its config update in progress, if any (queued ones are skipped when stopping).
        await sourceUpdates.get(source)?.queue.idle();
        await source.stop();
      });
    }
    if (simulation !== null) {
      const sim = simulation;
      await step('simulation', () => sim.stop());
    }
    if (obd !== null) {
      const link = obd;
      await step('OBD', () => link.stop());
    }
    if (engine !== null) {
      const hudEngine = engine;
      await step('engine', () => hudEngine.stop());
    }
    unsubscribeSinks?.();
    for (const unsubscribe of unsubscribeBrightness.splice(0)) unsubscribe();
    for (const sink of [...sinks].reverse()) {
      await step(sink.name, () => sink.stop());
    }
    await step('trip store', () => tripStore.flush());
    logger.info('HUD server stopped');
  }

  function stopOnce(): Promise<void> {
    stopping ??= doStop();
    return stopping;
  }

  return {
    start() {
      if (stopping !== null) return Promise.reject(new Error('The HUD server has been stopped'));
      if (starting === null) {
        const attempt = doStart();
        startAttempt = attempt;
        starting = attempt.catch(async (err: unknown) => {
          // Undo whatever did start, then report the original failure.
          await stopOnce();
          throw err;
        });
      }
      return starting;
    },
    stop: stopOnce,
    get engine() {
      return requireEngine();
    },
    get port() {
      return boundPort;
    },
    get simulation() {
      return simulation;
    },
  };
}
