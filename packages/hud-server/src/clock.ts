import type { Clock } from '@carheadsup/obd';

/**
 * Time bases that survive wall-clock steps. The HUD runs on the system clock, which NTP may
 * step: far forwards on a Pi without an RTC once it syncs, and backwards on a clock that ran
 * fast. Anything measured with the raw clock stalls for the length of a backward step — a
 * rate limit keeps waiting, a deadline is never reached, "fresh" data never ages.
 */

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
 * While {@link HudTime} is ahead of the wall clock (after a backward step) it runs at this rate
 * until the wall clock has caught up: durations stay right within 1 %, and a 1-minute step is
 * absorbed in 100 minutes.
 */
export const CATCH_UP_RATE = 0.99;

/**
 * The engine's time base: epoch milliseconds that follow the wall clock but never go backwards
 * and never stall. A forward step is followed at once (the displayed time and trip records need
 * the real time); after a backward step the time keeps counting and converges on the wall clock
 * by running {@link CATCH_UP_RATE} slow. Non-finite clock readings are ignored.
 */
export class HudTime {
  private readonly clock: Clock;
  private at: number;
  private lastWall: number | null;

  constructor(clock: Clock) {
    this.clock = clock;
    const start = clock();
    this.at = Number.isFinite(start) ? start : 0;
    this.lastWall = Number.isFinite(start) ? start : null;
  }

  /** The time last returned by {@link read} (or the start time). */
  get current(): number {
    return this.at;
  }

  /** Read the clock and return the advanced time. */
  read(): number {
    const wall = this.clock();
    if (!Number.isFinite(wall)) return this.at;
    const last = this.lastWall;
    this.lastWall = wall;
    if (last === null) {
      this.at = Math.max(this.at, wall);
      return this.at;
    }
    const elapsed = wall - last;
    if (elapsed <= 0) return this.at; // a backward step (or no progress): keep the time
    const next = this.at + elapsed;
    this.at = next <= wall ? wall : Math.max(wall, this.at + elapsed * CATCH_UP_RATE);
    return this.at;
  }
}
