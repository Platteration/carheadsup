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
