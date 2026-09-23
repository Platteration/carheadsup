import {
  composeFrame,
  createInitialState,
  deriveEffects,
  extractPersisted,
  reduce,
} from '@carheadsup/core';
import type {
  HudConfig,
  HudEffect,
  HudEvent,
  HudFrame,
  HudMaintenanceDue,
  HudState,
  HudToPhone,
  MaintenanceItemStatus,
  PersistedState,
  TripRecord,
} from '@carheadsup/core';
import { SILENT_LOGGER, SYSTEM_CLOCK, SYSTEM_TIMERS } from '@carheadsup/obd';
import type { Clock, Logger, Timers } from '@carheadsup/obd';

/** Clock tick period (drives toast fades, staleness, trip end, brightness smoothing). */
export const TICK_INTERVAL_MS = 100;
/** A requested persist is written this long after the first request (coalescing bursts). */
export const PERSIST_DELAY_MS = 2000;
/** While the odometer keeps changing, it is written at most this often (besides whole-km steps). */
export const ODOMETER_PERSIST_INTERVAL_MS = 60_000;
/** Repeated identical errors (e.g. a failing composer) are logged at most this often. */
const ERROR_LOG_INTERVAL_MS = 10_000;

/** Where the engine's side effects go. Implemented by the app (phone link, stores). */
export interface EngineOutputs {
  /** Deliver a message to the connected phone (and the simulated phone, when simulating). */
  sendToPhone(message: HudToPhone): void;
  /** Persist a completed trip. */
  saveTrip(trip: TripRecord): Promise<void>;
  /** Write the persisted state (odometer, learned ratios, service records). */
  savePersisted(state: PersistedState): Promise<void>;
}

export interface HudEngineOptions {
  /** The effective (runtime) config. */
  config: HudConfig;
  persisted: PersistedState;
  simulated?: boolean;
  outputs: EngineOutputs;
  now?: Clock;
  timers?: Timers;
  logger?: Logger;
  tickIntervalMs?: number;
  persistDelayMs?: number;
  odometerPersistIntervalMs?: number;
}

export type FrameListener = (frame: HudFrame) => void;

/**
 * The phone-protocol form of the maintenance items that are due soon or overdue, or null when
 * none are.
 */
export function maintenanceDueMessage(
  items: readonly MaintenanceItemStatus[],
): HudMaintenanceDue | null {
  const due: HudMaintenanceDue['items'] = [];
  for (const item of items) {
    if (item.status !== 'due-soon' && item.status !== 'overdue') continue;
    due.push({
      itemId: item.itemId,
      label: item.label,
      status: item.status,
      remainingKm: item.remainingKm,
      remainingDays: item.remainingDays,
    });
  }
  return due.length === 0 ? null : { t: 'maintenance-due', items: due };
}

/**
 * The HUD's heart: owns the config and the `HudState`, feeds every event through the pure
 * reducer and performs the effects the core derives from each transition.
 *
 *  - `dispatch(event)` re-stamps `event.at` with the engine clock, never earlier than the
 *    previous event (the clock may step backwards, e.g. NTP on a Pi without RTC). Events
 *    dispatched from inside an effect handler are queued and processed in order.
 *  - A tick event is dispatched every {@link TICK_INTERVAL_MS}; frames are composed on their
 *    own timer at `server.frameRate` (not per event) and published to frame listeners.
 *  - Effects: call actions and trip/maintenance notifications go to the phone; completed trips
 *    are saved; `persist` requests are coalesced into one write {@link PERSIST_DELAY_MS} later.
 *    The odometer is also written at most every {@link ODOMETER_PERSIST_INTERVAL_MS} while it
 *    changes, and once more on `stop()`.
 */
export class HudEngine {
  readonly simulated: boolean;
  private cfg: HudConfig;
  private current: HudState;
  private latestFrame: HudFrame | null = null;
  private readonly outputs: EngineOutputs;
  private readonly now: Clock;
  private readonly timers: Timers;
  private readonly logger: Logger;
  private readonly tickIntervalMs: number;
  private readonly persistDelayMs: number;
  private readonly odometerPersistIntervalMs: number;

  private readonly frameListeners = new Set<FrameListener>();
  private readonly queue: HudEvent[] = [];
  private draining = false;
  private lastAt: number;

  private running = false;
  private stopped = false;
  private stopping: Promise<void> | null = null;
  private tickTimer: unknown = null;
  private frameTimer: unknown = null;
  private persistTimer: unknown = null;

  private lastPersistAt: number;
  private lastSavedJson: string;
  private lastSavedOdometerKm: number | null;
  private readonly pending = new Set<Promise<void>>();
  private readonly lastErrorLog = new Map<string, number>();

  constructor(options: HudEngineOptions) {
    this.outputs = options.outputs;
    this.now = options.now ?? SYSTEM_CLOCK;
    this.timers = options.timers ?? SYSTEM_TIMERS;
    this.logger = options.logger ?? SILENT_LOGGER;
    this.tickIntervalMs = Math.max(1, options.tickIntervalMs ?? TICK_INTERVAL_MS);
    this.persistDelayMs = Math.max(0, options.persistDelayMs ?? PERSIST_DELAY_MS);
    this.odometerPersistIntervalMs = Math.max(
      0,
      options.odometerPersistIntervalMs ?? ODOMETER_PERSIST_INTERVAL_MS,
    );
    this.simulated = options.simulated ?? false;
    this.cfg = options.config;

    const start = this.now();
    this.lastAt = Number.isFinite(start) ? start : 0;
    this.current = createInitialState(this.cfg, options.persisted, this.lastAt, {
      simulated: this.simulated,
    });
    const persisted = extractPersisted(this.current);
    this.lastSavedJson = JSON.stringify(persisted);
    this.lastSavedOdometerKm = this.current.odometer.km;
    this.lastPersistAt = this.lastAt;
  }

  /** The effective config the reducer runs with. */
  get config(): HudConfig {
    return this.cfg;
  }

  get state(): HudState {
    return this.current;
  }

  /** The most recently published frame (composed on demand before the first publication). */
  get frame(): HudFrame {
    this.latestFrame ??= composeFrame(this.current, this.cfg);
    return this.latestFrame;
  }

  /** Subscribe to composed frames. Returns the unsubscribe function. */
  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  /** Start the tick and frame timers (and publish a first frame immediately). Idempotent. */
  start(): void {
    if (this.running || this.stopped) return;
    this.running = true;
    this.publishFrame();
    this.scheduleTick();
    this.scheduleFrame();
  }

  /**
   * Stop the timers, write the persisted state one last time and wait for pending trip/state
   * writes. Events dispatched afterwards are ignored. Idempotent.
   */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.running = false;
    this.clearTimer('tickTimer');
    this.clearTimer('frameTimer');
    this.clearTimer('persistTimer');
    this.stopping = (async () => {
      await this.writePersisted();
      await this.idle();
    })();
    return this.stopping;
  }

  /** Feed an event through the reducer. `event.at` is replaced by the engine clock. */
  dispatch(event: HudEvent): void {
    if (this.stopped) {
      this.logger.debug(`Engine: ignoring ${event.type} after stop`);
      return;
    }
    this.queue.push(event);
    if (this.draining) return;
    this.draining = true;
    try {
      for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift()) {
        this.process(next);
      }
    } finally {
      this.draining = false;
    }
  }

  /** Apply a new effective config (dispatches a `config` event). */
  setConfig(config: HudConfig): void {
    this.dispatch({ type: 'config', config, at: this.lastAt });
  }

  /** Ask for the persisted state to be written soon (coalesced). */
  requestPersist(): void {
    if (this.stopped || this.persistTimer !== null) return;
    this.persistTimer = this.timers.setTimeout(() => {
      this.persistTimer = null;
      void this.writePersisted();
    }, this.persistDelayMs);
  }

  /** Write the persisted state now (cancelling a pending delayed write) and wait for it. */
  async flushPersistence(): Promise<void> {
    this.clearTimer('persistTimer');
    await this.writePersisted();
  }

  /** Resolves when every trip/state write started so far has settled. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  // -------------------------------------------------------------------------------------------

  /** Engine time for the next event: the clock, but never earlier than the previous event. */
  private stamp(): number {
    const t = this.now();
    if (Number.isFinite(t) && t > this.lastAt) this.lastAt = t;
    return this.lastAt;
  }

  private process(event: HudEvent): void {
    const stamped: HudEvent = { ...event, at: this.stamp() };
    const prev = this.current;
    let next: HudState;
    try {
      next = reduce(prev, stamped, this.cfg);
    } catch (err) {
      this.logThrottled(`reduce:${event.type}`, `Engine: ${event.type} failed: ${describe(err)}`);
      return;
    }
    this.current = next;
    if (stamped.type === 'config') this.cfg = stamped.config;

    let effects: HudEffect[] = [];
    try {
      effects = deriveEffects(prev, next, stamped, this.cfg);
    } catch (err) {
      this.logThrottled('effects', `Engine: deriving effects failed: ${describe(err)}`);
    }
    for (const effect of effects) this.perform(effect);
    this.checkOdometer();
  }

  private perform(effect: HudEffect): void {
    switch (effect.type) {
      case 'phone/call-action':
        this.logger.info(`Engine: ${effect.action} call ${effect.callId}`);
        this.sendToPhone({ t: 'call-action', callId: effect.callId, action: effect.action });
        return;
      case 'trip/completed': {
        const { trip } = effect;
        this.logger.info(
          `Engine: trip ${trip.id} completed (${trip.distanceKm} km, ${Math.round(trip.durationS / 60)} min)`,
        );
        this.track(this.outputs.saveTrip(trip), `saving trip ${trip.id}`);
        this.sendToPhone({ t: 'trip-completed', trip });
        return;
      }
      case 'maintenance/due': {
        const message = maintenanceDueMessage(effect.items);
        if (message !== null) this.sendToPhone(message);
        return;
      }
      case 'persist':
        this.requestPersist();
        return;
      default: {
        const unknown: never = effect;
        void unknown;
      }
    }
  }

  private sendToPhone(message: HudToPhone): void {
    try {
      this.outputs.sendToPhone(message);
    } catch (err) {
      this.logger.warn(`Engine: sending ${message.t} to the phone failed: ${describe(err)}`);
    }
  }

  /** Persist sub-kilometre odometer progress at most every `odometerPersistIntervalMs`. */
  private checkOdometer(): void {
    const km = this.current.odometer.km;
    if (km === null || km === this.lastSavedOdometerKm || this.persistTimer !== null) return;
    if (this.lastAt - this.lastPersistAt >= this.odometerPersistIntervalMs) this.requestPersist();
  }

  /** Write the persisted state unless it equals what was last written successfully. */
  private writePersisted(): Promise<void> {
    const snapshot = extractPersisted(this.current);
    const json = JSON.stringify(snapshot);
    this.lastPersistAt = this.lastAt;
    this.lastSavedOdometerKm = this.current.odometer.km;
    if (json === this.lastSavedJson) return Promise.resolve();
    let write: Promise<void>;
    try {
      write = Promise.resolve(this.outputs.savePersisted(snapshot));
    } catch (err) {
      write = Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    return this.track(
      write.then(() => {
        this.lastSavedJson = json;
      }),
      'saving the persisted state',
    );
  }

  /** Remember an async side effect until it settles; failures are logged, never thrown. */
  private track(promise: Promise<void>, what: string): Promise<void> {
    const tracked = promise.catch((err: unknown) => {
      this.logger.error(`Engine: ${what} failed: ${describe(err)}`);
    });
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
    return tracked;
  }

  private scheduleTick(): void {
    this.tickTimer = this.timers.setTimeout(() => {
      this.tickTimer = null;
      if (!this.running) return;
      this.dispatch({ type: 'tick', at: this.lastAt });
      this.scheduleTick();
    }, this.tickIntervalMs);
  }

  private scheduleFrame(): void {
    const fps = Math.min(60, Math.max(1, this.cfg.server.frameRate || 1));
    this.frameTimer = this.timers.setTimeout(() => {
      this.frameTimer = null;
      if (!this.running) return;
      this.publishFrame();
      this.scheduleFrame();
    }, 1000 / fps);
  }

  private publishFrame(): void {
    let frame: HudFrame;
    try {
      frame = composeFrame(this.current, this.cfg);
    } catch (err) {
      this.logThrottled('compose', `Engine: composing a frame failed: ${describe(err)}`);
      return;
    }
    this.latestFrame = frame;
    for (const listener of [...this.frameListeners]) {
      try {
        listener(frame);
      } catch (err) {
        this.logThrottled('frame-listener', `Engine: frame listener failed: ${describe(err)}`);
      }
    }
  }

  private clearTimer(key: 'tickTimer' | 'frameTimer' | 'persistTimer'): void {
    const handle = this[key];
    if (handle !== null) this.timers.clearTimeout(handle);
    this[key] = null;
  }

  private logThrottled(key: string, message: string): void {
    const at = this.lastAt;
    const last = this.lastErrorLog.get(key);
    if (last !== undefined && at - last < ERROR_LOG_INTERVAL_MS && at >= last) return;
    this.lastErrorLog.set(key, at);
    this.logger.error(message);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
