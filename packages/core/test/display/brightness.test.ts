import { describe, expect, it } from 'vitest';
import {
  createBrightnessState,
  luxToLevel,
  updateBrightness,
} from '../../src/display/brightness.ts';
import type { BrightnessInput, BrightnessState } from '../../src/display/brightness.ts';
import type { BrightnessConfig } from '../../src/types/config.ts';

const CONFIG: BrightnessConfig = {
  mode: 'auto',
  manualLevel: 0.8,
  minLevel: 0.08,
  maxLevel: 1,
  curve: [
    [1, 0.08],
    [10, 0.15],
    [100, 0.3],
    [1000, 0.55],
    [10_000, 0.85],
    [100_000, 1],
  ],
  riseTimeMs: 3000,
  fallTimeMs: 400,
  nightMode: 'sensor',
  nightEnterLux: 50,
  nightExitLux: 150,
  nightSunElevationDeg: -4,
};

const sample = (
  at: number,
  lux: number | null,
  sunElevationDeg: number | null = null,
): BrightnessInput => ({
  at,
  lux,
  sunElevationDeg,
});

function feed(
  state: BrightnessState,
  inputs: BrightnessInput[],
  config = CONFIG,
): BrightnessState[] {
  const out: BrightnessState[] = [];
  let s = state;
  for (const i of inputs) {
    s = updateBrightness(s, i, config);
    out.push(s);
  }
  return out;
}

/** State that has settled at `lux` at time 0. */
const settled = (lux: number, config = CONFIG): BrightnessState =>
  updateBrightness(createBrightnessState(config), sample(0, lux), config);

describe('luxToLevel', () => {
  it('returns the curve level exactly at each point', () => {
    for (const [lux, level] of CONFIG.curve)
      expect(luxToLevel(lux, CONFIG.curve)).toBeCloseTo(level, 12);
  });

  it('interpolates linearly on log10(lux)', () => {
    // √10·10 ≈ 31.6 lux is halfway between 10 and 100 on a log scale.
    expect(luxToLevel(Math.sqrt(10) * 10, CONFIG.curve)).toBeCloseTo((0.15 + 0.3) / 2, 12);
    expect(luxToLevel(10 ** 3.25, CONFIG.curve)).toBeCloseTo(0.55 + 0.25 * 0.3, 12);
  });

  it('holds the end levels outside the curve, including 0 and negative lux', () => {
    expect(luxToLevel(0.2, CONFIG.curve)).toBe(0.08);
    expect(luxToLevel(0, CONFIG.curve)).toBe(0.08);
    expect(luxToLevel(-5, CONFIG.curve)).toBe(0.08);
    expect(luxToLevel(1e7, CONFIG.curve)).toBe(1);
  });

  it('handles single-point and empty curves', () => {
    expect(luxToLevel(1, [[100, 0.4]])).toBe(0.4);
    expect(luxToLevel(1e6, [[100, 0.4]])).toBe(0.4);
    expect(luxToLevel(50, [])).toBe(1);
  });
});

describe('createBrightnessState', () => {
  it('starts auto mode at the daytime fallback level, not night', () => {
    expect(createBrightnessState(CONFIG)).toEqual({
      level: 0.8,
      night: false,
      updatedAt: null,
      target: null,
    });
  });

  it('starts manual mode at the manual level', () => {
    expect(createBrightnessState({ ...CONFIG, mode: 'manual', manualLevel: 0.3 }).level).toBe(0.3);
  });

  it('starts at night only when night mode is forced', () => {
    expect(createBrightnessState({ ...CONFIG, nightMode: 'always' }).night).toBe(true);
    expect(createBrightnessState({ ...CONFIG, nightMode: 'sun' }).night).toBe(false);
  });
});

describe('updateBrightness', () => {
  describe('auto level', () => {
    it('snaps to the target on the first sample', () => {
      const s = updateBrightness(createBrightnessState(CONFIG), sample(1000, 100), CONFIG);
      expect(s.level).toBeCloseTo(0.3, 12);
      expect(s.target).toBeCloseTo(0.3, 12);
      expect(s.updatedAt).toBe(1000);
    });

    it('brightens with the rise time constant', () => {
      // 0.3 → 1.0; after exactly τ the remaining gap is e^-1.
      const s = updateBrightness(settled(100), sample(3000, 100_000), CONFIG);
      expect(s.level).toBeCloseTo(1 - 0.7 * Math.exp(-1), 12);
      expect(s.target).toBe(1);
    });

    it('darkens with the (faster) fall time constant', () => {
      const s = updateBrightness(settled(100_000), sample(400, 1), CONFIG);
      expect(s.level).toBeCloseTo(0.08 + 0.92 * Math.exp(-1), 12);
      const later = updateBrightness(settled(100_000), sample(4000, 1), CONFIG);
      expect(later.level).toBeCloseTo(0.08 + 0.92 * Math.exp(-10), 12);
    });

    it('derives Δt from timestamps, so sample rate does not change the result', () => {
      const coarse = feed(settled(100), [sample(3000, 100_000)]);
      const fine = feed(
        settled(100),
        Array.from({ length: 30 }, (_, i) => sample((i + 1) * 100, 100_000)),
      );
      expect(fine.at(-1)?.level).toBeCloseTo(coarse.at(-1)?.level ?? Number.NaN, 12);
    });

    it('does not move when time stands still or runs backwards', () => {
      const start = settled(100);
      expect(updateBrightness(start, sample(0, 100_000), CONFIG).level).toBeCloseTo(0.3, 12);
      expect(updateBrightness(start, sample(-5000, 100_000), CONFIG).level).toBeCloseTo(0.3, 12);
    });

    it('jumps instantly with zero time constants', () => {
      const config = { ...CONFIG, riseTimeMs: 0, fallTimeMs: 0 };
      expect(updateBrightness(settled(1, config), sample(10, 100_000), config).level).toBe(1);
      expect(updateBrightness(settled(100_000, config), sample(10, 1), config).level).toBe(0.08);
    });

    it('clamps the target to [minLevel, maxLevel]', () => {
      const config = { ...CONFIG, minLevel: 0.2, maxLevel: 0.7 };
      expect(settled(0.5, config).level).toBe(0.2);
      expect(settled(1e6, config).level).toBe(0.7);
      expect(settled(1e6, config).target).toBe(0.7);
    });

    it('prefers lux over the sun', () => {
      expect(updateBrightness(createBrightnessState(CONFIG), sample(0, 1, 40), CONFIG).level).toBe(
        0.08,
      );
    });

    it('falls back to the sun without a lux reading', () => {
      const day = updateBrightness(createBrightnessState(CONFIG), sample(0, null, 30), CONFIG);
      expect(day.level).toBeCloseTo(0.8, 12);
      const night = updateBrightness(createBrightnessState(CONFIG), sample(0, null, -10), CONFIG);
      expect(night.level).toBeCloseTo(0.16, 12);
    });

    it('clamps the sun fallback levels too', () => {
      const config = { ...CONFIG, minLevel: 0.5, maxLevel: 0.55 };
      expect(
        updateBrightness(createBrightnessState(config), sample(0, null, -10), config).level,
      ).toBe(0.55);
    });

    it('holds the last level with neither lux nor sun, but respects a narrowed range', () => {
      const s = settled(100_000);
      const held = updateBrightness(s, sample(10_000, null, null), CONFIG);
      expect(held.level).toBe(s.level);
      expect(held.updatedAt).toBe(s.updatedAt);
      const narrowed = updateBrightness(s, sample(10_000, null, null), {
        ...CONFIG,
        maxLevel: 0.6,
      });
      expect(narrowed.level).toBe(0.6);
    });

    it('snaps on the first real sample even after holding', () => {
      const held = updateBrightness(createBrightnessState(CONFIG), sample(0, null, null), CONFIG);
      expect(held.updatedAt).toBeNull();
      expect(updateBrightness(held, sample(100, 1), CONFIG).level).toBe(0.08);
    });

    it('treats non-finite readings as missing', () => {
      const s = settled(100);
      expect(
        updateBrightness(s, sample(1000, Number.NaN, Number.POSITIVE_INFINITY), CONFIG).level,
      ).toBe(s.level);
    });
  });

  describe('manual mode', () => {
    const manual = { ...CONFIG, mode: 'manual' as const, manualLevel: 0.42 };

    it('returns manualLevel regardless of light', () => {
      for (const lux of [0, 50, 100_000, null]) {
        expect(updateBrightness(settled(100), sample(1000, lux), manual).level).toBe(0.42);
      }
    });

    it('ignores min/max and still tracks night mode', () => {
      const s = updateBrightness(createBrightnessState(manual), sample(0, 10), {
        ...manual,
        minLevel: 0.5,
      });
      expect(s.level).toBe(0.42);
      expect(s.night).toBe(true);
    });

    it('smooths from the manual level after switching back to auto', () => {
      const m = updateBrightness(settled(100), sample(1000, 100), manual);
      const auto = updateBrightness(m, sample(1400, 1), CONFIG);
      expect(auto.level).toBeCloseTo(0.08 + (0.42 - 0.08) * Math.exp(-1), 12);
    });
  });

  describe('night mode', () => {
    it("'sensor' uses lux with hysteresis", () => {
      const states = feed(createBrightnessState(CONFIG), [
        sample(0, 100),
        sample(1, 50),
        sample(2, 49),
        sample(3, 100),
        sample(4, 150),
        sample(5, 151),
        sample(6, 100),
      ]);
      expect(states.map((s) => s.night)).toEqual([false, false, true, true, true, false, false]);
    });

    it("'sensor' falls back to the sun, then holds, without lux", () => {
      const states = feed(createBrightnessState(CONFIG), [
        sample(0, null, -10),
        sample(1, null, null),
        sample(2, null, 5),
        sample(3, null, null),
      ]);
      expect(states.map((s) => s.night)).toEqual([true, true, false, false]);
    });

    it("'sun' switches at nightSunElevationDeg and holds when unknown", () => {
      const config = { ...CONFIG, nightMode: 'sun' as const };
      const states = feed(
        createBrightnessState(config),
        [
          sample(0, 5, 10),
          sample(1, 5, -3.9),
          sample(2, 5, -4.1),
          sample(3, 100_000, null),
          sample(4, 5, -3),
        ],
        config,
      );
      expect(states.map((s) => s.night)).toEqual([false, false, true, true, false]);
    });

    it("'always' and 'never' ignore light and sun", () => {
      const always = { ...CONFIG, nightMode: 'always' as const };
      const never = { ...CONFIG, nightMode: 'never' as const };
      expect(updateBrightness(settled(1), sample(1, 100_000, 60), always).night).toBe(true);
      expect(updateBrightness(settled(1), sample(1, 0, -30), never).night).toBe(false);
    });
  });

  it('is JSON-serialisable and resumes identically after a round trip', () => {
    const inputs = [sample(0, 100), sample(500, 20), sample(1500, 5000), sample(2500, null, -10)];
    const direct = feed(createBrightnessState(CONFIG), inputs).at(-1);
    let s = createBrightnessState(CONFIG);
    for (const i of inputs)
      s = JSON.parse(JSON.stringify(updateBrightness(s, i, CONFIG))) as BrightnessState;
    expect(s).toEqual(direct);
  });
});
