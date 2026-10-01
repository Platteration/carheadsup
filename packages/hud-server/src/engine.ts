/**
 * The HUD engine (`@carheadsup/hud-server/engine`). Browser-safe — it depends only on core and
 * the injected runtime seams — so the in-browser demo runs the same engine as the car; keep
 * Node.js built-ins out of this module and of `clock.ts`.
 */
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
  PersistedStateWithTrip,
  TripRecord,
} from '@carheadsup/core';
import { SILENT_LOGGER, SYSTEM_CLOCK, SYSTEM_TIMERS } from '@carheadsup/obd/runtime';
import type { Clock, Logger, Timers } from '@carheadsup/obd/runtime';
import { EngineClock, SYSTEM_MONOTONIC, monotonicView } from './clock.ts';

/** Clock tick period (drives toast fades, staleness, trip end, brightness smoothing). */
export const TICK_INTERVAL_MS = 100;
/** A requested persist is written this long after the first request (coalescing bursts). */
export const PERSIST_DELAY_MS = 2000;
/**
 * While the odometer or the trip in progress keeps changing, they are written at most this
 * often (besides whole-km steps and trip ends).
 */
export const ODOMETER_PERSIST_INTERVAL_MS = 60_000;
/** Repeated identical errors (e.g. a failing composer) are logged at most this often. */
const ERROR_LOG_INTERVAL_MS = 10_000;
/**
 * The core is told the wall clock's offset from engine time again (`clock/sync`) once it has
 * moved by more than this — a step of the system clock, or slow drift adding up.
 */
export const CLOCK_SYNC_TOLERANCE_MS = 2000;

/** Where the engine's side effects go. Implemented by the app (phone link, stores). */
export interface EngineOutputs {
  /** Deliver a message to the connected phone (and the simulated phone, when simulating). */
  sendToPhone(message: HudToPhone): void;
  /** Persist a completed trip. */
  saveTrip(trip: TripRecord): Promise<void>;
  /**
   * Write the persisted state (odometer, learned ratios, service records, trip in progress,
   * trip sequence number, and the wall time of the write: `lastWallMs`).
   */
  savePersisted(state: PersistedState): Promise<void>;
}

export interface HudEngineOptions {
  /** The effective (runtime) config. */
  config: HudConfig;
  /** What was saved last time, including the trip that was in progress then. */
  persisted: PersistedStateWithTrip;
  simulated?: boolean;
  outputs: EngineOutputs;
  /** The wall (system) clock, epoch ms. Default `Date.now`. */
  now?: Clock;
  /**
   * Whether the wall clock `now` is known to be right (`ClockState.trusted`; see `WallClock`).
   * Read at start-up and before every event; a change is passed on with a `clock/sync`. Default:
   * always.
   */
  clockTrusted?: () => boolean;
  /**
   * A monotonic ms counter that engine time follows. Default: `performance.now()`, or — when only
   * `now` is given (tests with a fake clock) — `now` without its backward steps.
   */
  monotonic?: Clock;
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
 *  - `dispatch(event)` re-stamps `event.at` with the engine time ({@link EngineClock}): it starts
 *    at the wall clock and then only counts elapsed monotonic time, so a stepped system clock
 *    (network time on a Pi without a real-time clock, possibly hours or days mid-drive) neither
 *    expires live data nor splits the trip in progress. The wall clock reaches the core as an
 *    offset: a `clock/sync` event on `start()` and before any event once the offset has moved
 *    by more than {@link CLOCK_SYNC_TOLERANCE_MS} or its trust changed (`clockTrusted`; a
 *    `clock/sync` dispatched from outside just asks for a fresh measurement). The wall time of
 *    every write of the persisted state goes with it (`lastWallMs`, the next start's floor).
 *    Events dispatched from inside an effect handler are queued
 *    and processed in order. (A `phone/link` from a different phone clears the previous phone's
 *    route, road, call, media and hazards in the reducer.)
 *  - A tick event is dispatched every {@link TICK_INTERVAL_MS}; frames are composed on their
 *    own timer at `server.frameRate` (not per event) and published to frame listeners.
 *  - Effects: call actions and trip/maintenance notifications go to the phone; completed trips
 *    are saved; `persist` requests are coalesced into one write {@link PERSIST_DELAY_MS} later.
 *    The odometer and the trip in progress are also written at most every
 *    {@link ODOMETER_PERSIST_INTERVAL_MS} while they change, promptly when the trip ends, and
 *    once more on `stop()`; a trip that starts is written promptly too. The HUD is powered down
 *    seconds after the ignition, long before a trip would end by itself; the trip saved then is
 *    completed (or, after a short blip, continued) when the HUD starts again.
 */
export class HudEngine {
  readonly simulated: boolean;
  private cfg: HudConfig;
  private current: HudState;
  private latestFrame: HudFrame | null = null;
  private readonly outputs: EngineOutputs;
  private readonly timers: Timers;
  private readonly logger: Logger;
  private readonly tickIntervalMs: number;
  private readonly persistDelayMs: number;
  private readonly odometerPersistIntervalMs: number;

  private readonly frameListeners = new Set<FrameListener>();
  private readonly queue: HudEvent[] = [];
  private draining = false;
  private readonly time: EngineClock;
  private readonly clockTrusted: () => boolean;
  /** The wall-clock offset the core was last told (`clock/sync`). */
  private syncedOffset = 0;
  /** Whether the core was last told the wall clock is trusted. */
  private syncedTrusted: boolean;

  private running = false;
  private stopped = false;
  private stopping: Promise<void> | null = null;
  private tickTimer: unknown = null;
  private frameTimer: unknown = null;
  private persistTimer: unknown = null;

  private lastPersistAt: number;
  private lastSavedJson: string;
  private lastSavedOdometerKm: number | null;
  /** `state.trip.active` when the state was last written. */
  private lastSavedTrip: HudState['trip']['active'];
  private readonly pending = new Set<Promise<void>>();
  private readonly lastErrorLog = new Map<string, number>();

  constructor(options: HudEngineOptions) {
    this.outputs = options.outputs;
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

    const wall = options.now ?? SYSTEM_CLOCK;
    const monotonic =
      options.monotonic ?? (options.now === undefined ? SYSTEM_MONOTONIC : monotonicView(wall));
    this.time = new EngineClock(wall, monotonic);
    this.clockTrusted = options.clockTrusted ?? (() => true);
    this.syncedTrusted = this.clockTrusted();
    // Engine time starts at the wall clock: the initial state's offset of 0 is right.
    this.current = createInitialState(this.cfg, options.persisted, this.lastAt, {
      simulated: this.simulated,
      clockTrusted: this.syncedTrusted,
    });
    this.lastSavedJson = JSON.stringify(this.snapshot());
    this.lastSavedOdometerKm = this.current.odometer.km;
    this.lastSavedTrip = this.current.trip.active;
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

  /** Engine time now (monotonic epoch ms, see {@link EngineClock}); reads the clock. */
  now(): number {
    return this.time.read();
  }

  /** Engine time when the engine was created. */
  get startedAt(): number {
    return this.time.startedAt;
  }

  /** Subscribe to composed frames. Returns the unsubscribe function. */
  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  /**
   * Tell the core where the wall clock stands (`clock/sync`), then start the tick and frame
   * timers (and publish a first frame immediately). Idempotent.
   */
  start(): void {
    if (this.running || this.stopped) return;
    this.running = true;
    this.dispatch({ type: 'clock/sync', wallOffsetMs: 0, at: this.lastAt });
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

  /**
   * Feed an event through the reducer. `event.at` is replaced by the engine clock; a
   * `clock/sync` event's offset by the one measured now.
   */
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

  /** Engine time of the latest event. */
  private get lastAt(): number {
    return this.time.current;
  }

  /** Engine time for the next event (see {@link EngineClock}). */
  private stamp(): number {
    return this.time.read();
  }

  private process(event: HudEvent): void {
    const at = this.stamp();
    if (event.type === 'clock/sync') {
      this.syncClock(at, true);
      return;
    }
    this.syncClock(at, false);
    this.apply({ ...event, at });
  }

  /**
   * Measure the wall clock's offset from engine time and pass it to the core, with its trust,
   * when it moved by more than {@link CLOCK_SYNC_TOLERANCE_MS} since the last sync, when the
   * trust changed, or when `force`d.
   */
  private syncClock(at: number, force: boolean): void {
    const wall = this.time.wall();
    if (wall === null) return;
    const offset = Math.round(wall - at);
    const moved = offset - this.syncedOffset;
    const trusted = this.clockTrusted();
    const trustChanged = trusted !== this.syncedTrusted;
    if (!force && !trustChanged && Math.abs(moved) <= CLOCK_SYNC_TOLERANCE_MS) return;
    if (Math.abs(moved) > CLOCK_SYNC_TOLERANCE_MS) {
      this.logger.info(
        `Engine: the wall clock moved ${moved > 0 ? 'forward' : 'back'} by ${describeDuration(Math.abs(moved))}; timing is unaffected, the displayed time follows`,
      );
    }
    this.syncedOffset = offset;
    this.syncedTrusted = trusted;
    this.apply({ type: 'clock/sync', wallOffsetMs: offset, trusted, at });
  }

  private apply(stamped: HudEvent): void {
    const prev = this.current;
    let next: HudState;
    try {
      next = reduce(prev, stamped, this.cfg);
    } catch (err) {
      const { type } = stamped;
      this.logThrottled(`reduce:${type}`, `Engine: ${type} failed: ${describe(err)}`);
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
    this.checkPeriodicPersist();
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
        // Soon, also when the next trip goes on at once (a resumed trip split at the restart):
        // until then a power cut brings the completed trip back at the next start.
        this.requestPersist();
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

  /**
   * Persist sub-kilometre odometer progress and the trip in progress at most every
   * `odometerPersistIntervalMs`, and the start and end of a trip promptly (a trip is then on
   * disk from its first seconds, and a finished one is not restored again).
   */
  private checkPeriodicPersist(): void {
    if (this.persistTimer !== null) return;
    const km = this.current.odometer.km;
    const trip = this.current.trip.active;
    const odometerMoved = km !== null && km !== this.lastSavedOdometerKm;
    const tripChanged = trip !== this.lastSavedTrip;
    if (!odometerMoved && !tripChanged) return;
    const tripStartedOrEnded = (trip === null) !== (this.lastSavedTrip === null);
    if (tripStartedOrEnded || this.lastAt - this.lastPersistAt >= this.odometerPersistIntervalMs) {
      this.requestPersist();
    }
  }

  /** What is written to disk: the persisted state, including the trip in progress. */
  private snapshot(): PersistedState {
    return extractPersisted(this.current);
  }

  /** Write the persisted state unless it equals what was last written successfully. */
  private writePersisted(): Promise<void> {
    const snapshot = this.snapshot();
    const json = JSON.stringify(snapshot);
    this.lastPersistAt = this.lastAt;
    this.lastSavedOdometerKm = this.current.odometer.km;
    this.lastSavedTrip = this.current.trip.active;
    if (json === this.lastSavedJson) return Promise.resolve();
    let write: Promise<void>;
    try {
      // The write's wall time, for the next start's floor; it alone never asks for a write.
      const wall = this.time.wall();
      const lastWallMs = wall === null ? null : Math.round(wall);
      write = Promise.resolve(this.outputs.savePersisted({ ...snapshot, lastWallMs }));
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

/** 3 d 4 h, 2 h 5 min, 12 min 3 s, 4.2 s. */
export function describeDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s % 60} s`;
  return `${(ms / 1000).toFixed(1)} s`;
}
