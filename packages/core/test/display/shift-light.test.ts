import { describe, expect, it } from 'vitest';
import { computeShiftLight } from '../../src/display/shift-light.ts';
import type { ShiftLightConfig } from '../../src/types/config.ts';

const CONFIG: ShiftLightConfig = { enabled: true, startRpm: 4500, shiftRpm: 6000, flashRpm: 6300 };

describe('computeShiftLight', () => {
  it('is null when disabled', () => {
    expect(computeShiftLight(6500, { ...CONFIG, enabled: false })).toBeNull();
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])('is null for unknown rpm %s', (rpm) => {
    expect(computeShiftLight(rpm, CONFIG)).toBeNull();
  });

  it('is null below startRpm', () => {
    expect(computeShiftLight(0, CONFIG)).toBeNull();
    expect(computeShiftLight(4499.9, CONFIG)).toBeNull();
  });

  it.each([
    [4500, 0, false],
    [5250, 0.5, false],
    [5625, 0.75, false],
    [6000, 1, false],
    [6299, 1, false],
    [6300, 1, true],
    [9000, 1, true],
  ])('at %i rpm: level %f, flash %s', (rpm, level, flash) => {
    const frame = computeShiftLight(rpm, CONFIG);
    expect(frame?.level).toBeCloseTo(level, 12);
    expect(frame?.flash).toBe(flash);
  });

  it('flashes at shiftRpm when flashRpm equals it', () => {
    expect(computeShiftLight(6000, { ...CONFIG, flashRpm: 6000 })).toEqual({
      level: 1,
      flash: true,
    });
  });

  it('shows a full bar for a degenerate start == shift window', () => {
    expect(computeShiftLight(5000, { ...CONFIG, startRpm: 5000, shiftRpm: 5000 })).toEqual({
      level: 1,
      flash: false,
    });
  });
});
