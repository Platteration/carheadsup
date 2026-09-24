import { describe, expect, it } from 'vitest';
import { EngineClock, monotonicView } from '../src/clock.ts';

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
