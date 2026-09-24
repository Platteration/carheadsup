import { describe, expect, it } from 'vitest';
import {
  computeShiftLight,
  shiftFlashHysteresisRpm,
  updateShiftFlash,
} from '../../src/display/shift-light.ts';
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

describe('updateShiftFlash', () => {
  it('turns on at flashRpm and off only below flashRpm − max(100, 2 %)', () => {
    expect(shiftFlashHysteresisRpm(6300)).toBe(126);
    expect(shiftFlashHysteresisRpm(4000)).toBe(100);
    expect(updateShiftFlash(false, 6299, CONFIG)).toBe(false);
    expect(updateShiftFlash(false, 6300, CONFIG)).toBe(true);
    // Hovering just below the threshold keeps it flashing…
    expect(updateShiftFlash(true, 6299, CONFIG)).toBe(true);
    expect(updateShiftFlash(true, 6174, CONFIG)).toBe(true);
    // …until the engine speed has clearly dropped.
    expect(updateShiftFlash(true, 6173.9, CONFIG)).toBe(false);
    expect(updateShiftFlash(false, 6200, CONFIG)).toBe(false);
  });

  it('uses the 100 rpm floor for low flash points', () => {
    const low = { ...CONFIG, startRpm: 3000, shiftRpm: 3800, flashRpm: 4000 };
    expect(updateShiftFlash(true, 3900, low)).toBe(true);
    expect(updateShiftFlash(true, 3899, low)).toBe(false);
  });

  it('is off when disabled or rpm is unknown', () => {
    expect(updateShiftFlash(true, 7000, { ...CONFIG, enabled: false })).toBe(false);
    expect(updateShiftFlash(true, null, CONFIG)).toBe(false);
    expect(updateShiftFlash(true, Number.NaN, CONFIG)).toBe(false);
  });

  it('is what computeShiftLight shows when given', () => {
    expect(computeShiftLight(6200, CONFIG, true)).toEqual({ level: 1, flash: true });
    expect(computeShiftLight(6400, CONFIG, false)).toEqual({ level: 1, flash: false });
  });
});
