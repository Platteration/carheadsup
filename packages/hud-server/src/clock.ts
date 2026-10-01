import type { Clock } from '@carheadsup/obd/runtime';

/**
 * Time bases that survive wall-clock steps. The HUD runs on a system clock that network time may
 * step: far forwards on a Pi without a real-time clock once it syncs (possibly mid-drive, when the
 * phone's hotspot comes up), and backwards on a clock that ran fast. Anything measured with the
 * raw clock goes wrong for the length of such a step — a rate limit keeps waiting, a deadline is
 * never reached or passes at once, "fresh" data never ages or expires at once.
 */

/** A monotonic millisecond counter (arbitrary origin) that no clock step affects. */
export const SYSTEM_MONOTONIC: Clock = () => performance.now();

/**
 * A view of `clock` that never runs backwards: it follows the clock's forward progress and
 * ignores backward steps, so intervals measured with it keep running across such a step (only
 * the moment spanning the step is not counted). Forward steps pass through. Non-finite readings
 * are ignored.
 */
export function monotonicView(clock: Clock): Clock {
  let lastWall: number | null = null;
  let value = 0;
  return () => {
    const wall = clock();
    if (!Number.isFinite(wall)) return value;
    if (lastWall === null) value = wall;
    else if (wall > lastWall) value += wall - lastWall;
    lastWall = wall;
    return value;
  };
}

/**
 * The engine's time base. Engine time is epoch milliseconds that start at the wall clock when the
 * engine is created and from then on only count elapsed time on a monotonic clock: it never
 * steps, never goes backwards and never stalls, whatever the wall clock does. Everything the core
 * measures — staleness, timers, trip durations — uses it.
 *
 * The wall clock is tracked separately as an offset (`wallOffset()` = wall clock − engine time),
 * which the engine hands to the core (`clock/sync`) for what needs the real time: the clock
 * widget, the sun, service dates, trip records. Non-finite readings of either clock are ignored.
 */
export class EngineClock {
  private readonly wallClock: Clock;
  private readonly monotonic: Clock;
  private readonly origin: number;
  private monotonicOrigin: number | null;
  private at: number;

  /**
   * @param wall the system (wall) clock, epoch ms.
   * @param monotonic a monotonic ms counter; default {@link SYSTEM_MONOTONIC}.
   */
  constructor(wall: Clock, monotonic: Clock = SYSTEM_MONOTONIC) {
    this.wallClock = wall;
    this.monotonic = monotonic;
    const start = wall();
    this.origin = Number.isFinite(start) ? start : 0;
    const mono = monotonic();
    this.monotonicOrigin = Number.isFinite(mono) ? mono : null;
    this.at = this.origin;
  }

  /** The engine time last returned by {@link read} (or the start time). */
  get current(): number {
    return this.at;
  }

  /** Engine time when the clock was created. */
  get startedAt(): number {
    return this.origin;
  }

  /** Read the monotonic clock and return the (never decreasing) engine time. */
  read(): number {
    const mono = this.monotonic();
    if (!Number.isFinite(mono)) return this.at;
    // Without a first reading, count from the first finite one.
    this.monotonicOrigin ??= mono - (this.at - this.origin);
    const next = this.origin + (mono - this.monotonicOrigin);
    if (next > this.at) this.at = next;
    return this.at;
  }

  /** The wall clock now, or null when it reads non-finite. */
  wall(): number | null {
    const wall = this.wallClock();
    return Number.isFinite(wall) ? wall : null;
  }

  /**
   * Wall clock − engine time, whole ms, measured now (null when the wall clock reads
   * non-finite). 0 at the start; changes by the size of every step of the wall clock.
   */
  wallOffset(): number | null {
    const wall = this.wall();
    return wall === null ? null : Math.round(wall - this.read());
  }
}

/** Where {@link WallClock} takes the time from. */
export type WallClockSource =
  /** The system clock, which gave no reason for doubt (it has not gone back). */
  | 'system'
  /** The system clock had gone back: counting on from the time the HUD last saved. */
  | 'saved'
  /** The paired phone's clock (the system clock is not synchronised to network time). */
  | 'phone'
  /** The system clock, synchronised to network time. */
  | 'network';

/** One reading of the phone's clock (`hello.time`, `ping.time`) as it arrived. */
export interface PhoneTimeSample {
  /** The phone's clock when it sent the message, epoch ms. */
  phoneMs: number;
  /** Estimated time the message took to arrive (half the round trip), ms. */
  delayMs: number;
}

/** What {@link WallClock.phoneTime} did with a sample. */
export type PhoneTimeResult =
  /** Not used: network time rules, the sample is implausible, or its delay too uncertain. */
  | 'ignored'
  /** The wall clock already agreed (within the tolerance); now trusted, if it was not. */
  | 'confirmed'
  /** The wall clock was set from it. */
  | 'set';

/** A phone clock before this is not set (or the message is garbage): never used. */
export const PHONE_TIME_MIN_MS = Date.UTC(2024, 0, 1);
/** Phone samples within this of the wall clock (or of their own delay, if larger) change nothing. */
export const PHONE_TIME_TOLERANCE_MS = 2000;
/** Samples whose estimated delay is longer than this are too uncertain to use. */
export const PHONE_TIME_MAX_DELAY_MS = 10_000;
/**
 * The system clock moving against the monotonic clock by more than this between two readings
 * was set (stepped), not jitter: see {@link WallClock}.
 */
export const SYSTEM_STEP_TOLERANCE_MS = 1000;

/**
 * The HUD's wall clock: the system clock, corrected where it is known to be wrong. The HUD never
 * sets the system clock; it keeps a correction instead, which {@link EngineClock} sees as an
 * ordinary step of the wall clock.
 *
 * - Synchronised to network time ({@link setSynchronized}), the system clock is right: no
 *   correction, trusted.
 * - Otherwise a system clock that reads earlier than the time the HUD last saved at start-up
 *   ({@link startFrom}) has gone back — a Pi without a real-time clock or network time, whose
 *   read-only root restores the same time at every boot. The wall clock then counts on from the
 *   saved time, which is only a lower bound: untrusted.
 * - The paired phone's clock ({@link phoneTime}) is right whenever the system clock is not
 *   synchronised: the phone has network time. Its readings set the correction (trusted) when
 *   they disagree by more than {@link PHONE_TIME_TOLERANCE_MS}, and confirm it otherwise.
 * - While it follows the saved time or the phone, a step of the system clock (measured against
 *   the monotonic clock: network time arriving before {@link setSynchronized} is told, or someone
 *   setting the clock) does not move the wall clock — adding it to the correction would put the
 *   wall clock off by the whole step, years on a Pi that restored an old time. The correction
 *   absorbs it instead; and a system clock set at or past the saved time is taken as it is,
 *   trusted, as at start-up. Following the system clock, the wall clock follows its steps.
 *
 * Pure (no I/O, browser-safe): the server tells it about network time and the phone.
 */
export class WallClock {
  private readonly systemClock: Clock;
  private readonly monotonic: Clock;
  private correction = 0;
  private trustedNow = true;
  private synchronised = false;
  private sourceNow: WallClockSource = 'system';
  /** System clock − monotonic clock at the last reading (null before the first). */
  private systemBase: number | null = null;

  /**
   * @param system the system clock, epoch ms.
   * @param monotonic a monotonic ms counter to tell steps of the system clock by; default
   *   `system` without its backward steps (only backward steps are told then).
   */
  constructor(system: Clock, monotonic: Clock = monotonicView(system)) {
    this.systemClock = system;
    this.monotonic = monotonic;
  }

  /** The wall clock now, epoch ms (non-finite when the system clock reads non-finite). */
  now(): number {
    return this.system() + this.correction;
  }

  /** Whether the wall clock is known to be right (see the class): `ClockState.trusted`. */
  get trusted(): boolean {
    return this.trustedNow;
  }

  get source(): WallClockSource {
    return this.sourceNow;
  }

  /** Wall clock − system clock, ms. */
  get correctionMs(): number {
    return this.correction;
  }

  /**
   * At start-up: the wall time the HUD last saved (`PersistedState.lastWallMs`). When the system
   * clock reads earlier (and is not synchronised), count on from there, untrusted; returns
   * whether it did.
   */
  startFrom(savedWallMs: number | null | undefined): boolean {
    if (this.synchronised || typeof savedWallMs !== 'number' || !Number.isFinite(savedWallMs)) {
      return false;
    }
    const system = this.system();
    if (!Number.isFinite(system) || system >= savedWallMs) return false;
    this.correction = Math.round(savedWallMs - system);
    this.trustedNow = false;
    this.sourceNow = 'saved';
    return true;
  }

  /**
   * Whether the system clock is synchronised to network time. Once it is, the correction is
   * dropped and the clock is trusted; returns whether that changed anything. (It is not undone
   * when synchronisation is lost: the clock keeps running right.)
   */
  setSynchronized(synchronised: boolean): boolean {
    if (!synchronised || this.synchronised) return false;
    this.synchronised = true;
    this.correction = 0;
    this.trustedNow = true;
    this.sourceNow = 'network';
    return true;
  }

  /** A reading of the phone's clock as it arrived (see the class). */
  phoneTime(sample: PhoneTimeSample): PhoneTimeResult {
    if (this.synchronised) return 'ignored';
    const { phoneMs, delayMs } = sample;
    if (!Number.isFinite(phoneMs) || phoneMs < PHONE_TIME_MIN_MS || phoneMs > 8.64e15) {
      return 'ignored';
    }
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > PHONE_TIME_MAX_DELAY_MS) {
      return 'ignored';
    }
    const system = this.system();
    if (!Number.isFinite(system)) return 'ignored';
    const correction = Math.round(phoneMs + delayMs - system);
    const tolerance = Math.max(PHONE_TIME_TOLERANCE_MS, delayMs);
    if (Math.abs(correction - this.correction) <= tolerance) {
      if (!this.trustedNow) {
        this.trustedNow = true;
        this.sourceNow = 'phone';
      }
      return 'confirmed';
    }
    this.correction = correction;
    this.trustedNow = true;
    this.sourceNow = 'phone';
    return 'set';
  }

  /**
   * Read the system clock. While the wall clock follows the saved time or the phone, a step of
   * the system clock since the last reading is taken out of the correction (see the class).
   */
  private system(): number {
    const system = this.systemClock();
    const mono = this.monotonic();
    if (!Number.isFinite(system) || !Number.isFinite(mono)) return system;
    const base = system - mono;
    const previous = this.systemBase;
    this.systemBase = base;
    if (previous === null || (this.sourceNow !== 'saved' && this.sourceNow !== 'phone')) {
      return system;
    }
    const step = Math.round(base - previous);
    if (Math.abs(step) <= SYSTEM_STEP_TOLERANCE_MS) return system;
    this.correction -= step;
    if (this.sourceNow === 'saved' && this.correction <= 0) {
      // Set at or past the time the HUD last saved: no reason for doubt, as at start-up.
      this.correction = 0;
      this.trustedNow = true;
      this.sourceNow = 'system';
    }
    return system;
  }
}
