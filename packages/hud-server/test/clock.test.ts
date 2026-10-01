import { describe, expect, it } from 'vitest';
import { EngineClock, PHONE_TIME_MAX_DELAY_MS, WallClock, monotonicView } from '../src/clock.ts';

const T0 = Date.UTC(2026, 8, 23, 8, 0, 0);

/** A wall clock that can be stepped and a monotonic counter that cannot. */
function clocks(start = T0) {
  const c = { mono: 1000, step: 0 };
  return {
    c,
    wall: () => start + (c.mono - 1000) + c.step,
    monotonic: () => c.mono,
  };
}

describe('EngineClock', () => {
  it('starts at the wall clock and then counts monotonic time only', () => {
    const { c, wall, monotonic } = clocks();
    const clock = new EngineClock(wall, monotonic);
    expect(clock.startedAt).toBe(T0);
    expect(clock.read()).toBe(T0);
    c.mono += 1500;
    expect(clock.read()).toBe(T0 + 1500);
    expect(clock.wallOffset()).toBe(0);
    // Network time steps the wall clock: engine time does not move, the offset does.
    c.step = 3 * 86_400_000;
    expect(clock.read()).toBe(T0 + 1500);
    expect(clock.wallOffset()).toBe(3 * 86_400_000);
    c.step = -60_000;
    c.mono += 500;
    expect(clock.read()).toBe(T0 + 2000);
    expect(clock.current).toBe(T0 + 2000);
    expect(clock.wallOffset()).toBe(-60_000);
  });

  it('never goes backwards and ignores non-finite readings', () => {
    const { c, wall, monotonic } = clocks();
    const clock = new EngineClock(wall, monotonic);
    c.mono += 800;
    expect(clock.read()).toBe(T0 + 800);
    c.mono -= 300; // a misbehaving counter
    expect(clock.read()).toBe(T0 + 800);
    c.mono = Number.NaN;
    expect(clock.read()).toBe(T0 + 800);
    expect(
      new EngineClock(
        () => Number.NaN,
        () => 5,
      ).wall(),
    ).toBeNull();
    expect(
      new EngineClock(
        () => Number.NaN,
        () => 5,
      ).wallOffset(),
    ).toBeNull();
  });

  it('counts from the first finite monotonic reading when the first one was not', () => {
    let mono = Number.NaN;
    const clock = new EngineClock(
      () => T0,
      () => mono,
    );
    expect(clock.read()).toBe(T0);
    mono = 40;
    expect(clock.read()).toBe(T0);
    mono = 140;
    expect(clock.read()).toBe(T0 + 100);
  });
});

describe('monotonicView', () => {
  it('follows forward progress and ignores backward steps', () => {
    let wall = 1000;
    const view = monotonicView(() => wall);
    expect(view()).toBe(1000);
    wall = 1500;
    expect(view()).toBe(1500);
    wall = 900; // stepped back
    expect(view()).toBe(1500);
    wall = 1000;
    expect(view()).toBe(1600);
    wall = Number.NaN;
    expect(view()).toBe(1600);
  });
});

describe('WallClock', () => {
  const DAY = 86_400_000;
  /** A system clock that reads `system.at`. */
  const systemClock = (at = T0) => {
    const system = { at };
    return { system, clock: new WallClock(() => system.at) };
  };

  it('is the system clock, trusted, until something says otherwise', () => {
    const { system, clock } = systemClock();
    expect(clock.now()).toBe(T0);
    system.at += 500;
    expect(clock.now()).toBe(T0 + 500);
    expect(clock.trusted).toBe(true);
    expect(clock.source).toBe('system');
    // A saved time it is not behind changes nothing.
    expect(clock.startFrom(T0 - DAY)).toBe(false);
    expect(clock.startFrom(null)).toBe(false);
    expect(clock.startFrom(Number.NaN)).toBe(false);
    expect(clock.trusted).toBe(true);
  });

  it('starts from the saved time when the system clock went back, untrusted', () => {
    const { system, clock } = systemClock();
    const saved = T0 + 40 * DAY;
    expect(clock.startFrom(saved)).toBe(true);
    expect(clock.now()).toBe(saved);
    system.at += 1000;
    expect(clock.now()).toBe(saved + 1000);
    expect(clock).toMatchObject({ trusted: false, source: 'saved', correctionMs: 40 * DAY });
  });

  it('follows the phone while there is no network time', () => {
    const { system, clock } = systemClock();
    clock.startFrom(T0 + 40 * DAY);
    const real = T0 + 200 * DAY;
    // Sent 30 ms before it arrived.
    expect(clock.phoneTime({ phoneMs: real - 30, delayMs: 30 })).toBe('set');
    expect(clock.now()).toBe(real);
    expect(clock).toMatchObject({ trusted: true, source: 'phone' });
    // Readings within the tolerance (or their own uncertainty) change nothing.
    system.at += 5000;
    expect(clock.phoneTime({ phoneMs: real + 5000 + 1500, delayMs: 0 })).toBe('confirmed');
    expect(clock.now()).toBe(real + 5000);
    // Sent 5 s before it arrived by a clock 4 s ahead: within its own uncertainty.
    expect(clock.phoneTime({ phoneMs: real + 4000, delayMs: 5000 })).toBe('confirmed');
    // The phone's clock was corrected: follow it.
    expect(clock.phoneTime({ phoneMs: real + 5000 - 60_000, delayMs: 0 })).toBe('set');
    expect(clock.now()).toBe(real + 5000 - 60_000);
  });

  it('is confirmed by a phone that agrees with the saved time', () => {
    const { clock } = systemClock();
    clock.startFrom(T0 + DAY);
    expect(clock.phoneTime({ phoneMs: T0 + DAY + 500, delayMs: 10 })).toBe('confirmed');
    expect(clock).toMatchObject({ trusted: true, source: 'phone', correctionMs: DAY });
  });

  it('corrects a system clock that gave no reason for doubt when the phone disagrees', () => {
    const { clock } = systemClock();
    expect(clock.phoneTime({ phoneMs: T0 + 1000, delayMs: 0 })).toBe('confirmed');
    expect(clock.source).toBe('system');
    expect(clock.phoneTime({ phoneMs: T0 + 3 * 3_600_000, delayMs: 0 })).toBe('set');
    expect(clock.now()).toBe(T0 + 3 * 3_600_000);
  });

  it.each<[string, { phoneMs: number; delayMs: number }]>([
    ['a phone clock that is not set', { phoneMs: Date.UTC(1970, 0, 2), delayMs: 0 }],
    ['a non-finite reading', { phoneMs: Number.NaN, delayMs: 0 }],
    ['a reading beyond any date', { phoneMs: 9e15, delayMs: 0 }],
    ['a reading that took too long', { phoneMs: T0 + DAY, delayMs: PHONE_TIME_MAX_DELAY_MS + 1 }],
    ['a negative delay', { phoneMs: T0 + DAY, delayMs: -1 }],
  ])('ignores %s', (_, sample) => {
    const { clock } = systemClock();
    clock.startFrom(T0 + 1000);
    expect(clock.phoneTime(sample)).toBe('ignored');
    expect(clock).toMatchObject({ trusted: false, correctionMs: 1000 });
  });

  it('defers to network time: no correction, no phone, no saved time', () => {
    const { clock } = systemClock();
    clock.startFrom(T0 + DAY);
    clock.phoneTime({ phoneMs: T0 + 2 * DAY, delayMs: 0 });
    expect(clock.setSynchronized(false)).toBe(false);
    expect(clock.setSynchronized(true)).toBe(true);
    expect(clock).toMatchObject({ trusted: true, source: 'network', correctionMs: 0 });
    expect(clock.now()).toBe(T0);
    expect(clock.setSynchronized(true)).toBe(false);
    expect(clock.phoneTime({ phoneMs: T0 + 2 * DAY, delayMs: 0 })).toBe('ignored');
    expect(clock.startFrom(T0 + DAY)).toBe(false);
    // Losing the network later does not undo it: the clock keeps running right.
    expect(clock.setSynchronized(false)).toBe(false);
    expect(clock.source).toBe('network');
  });
});
