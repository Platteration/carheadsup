import { describe, expect, it } from 'vitest';
import {
  LEARN_BIN_COUNT,
  LEARN_BIN_WIDTH,
  LEARN_MAX_RATIO,
  LEARN_MIN_RATIO,
  createGearLearner,
  findGearClusters,
  firstGearHint,
  mergeLearnedRatios,
  normaliseLearnedRatios,
  observeGearSample,
  ratioBin,
  type GearCluster,
  type GearLearnerState,
  type LearnSample,
} from '../../src/vehicle/gear-learner.ts';

const T0 = 1_700_000_000_000;
const LIMITS = { idleRpm: 800, redlineRpm: 6500 };

/** Add a triangular bump of `count` samples centred on `ratio`, ±`spread` (fraction). */
function addPeak(hist: number[], ratio: number, count: number, spread = 0.02): void {
  const center = Math.log(ratio);
  const half = Math.max(1, Math.round(spread / LEARN_BIN_WIDTH));
  const weights: number[] = [];
  for (let k = -half; k <= half; k++) weights.push(half + 1 - Math.abs(k));
  const sum = weights.reduce((a, b) => a + b, 0);
  weights.forEach((w, i) => {
    const bin = ratioBin(center + (i - half) * LEARN_BIN_WIDTH);
    hist[bin] = (hist[bin] ?? 0) + (count * w) / sum;
  });
}

function histogramOf(peaks: Array<[ratio: number, count: number, spread?: number]>): {
  hist: number[];
  total: number;
} {
  const hist = new Array<number>(LEARN_BIN_COUNT).fill(0);
  for (const [ratio, count, spread] of peaks) addPeak(hist, ratio, count, spread);
  return { hist, total: hist.reduce((a, b) => a + b, 0) };
}

const clusters = (...ratios: number[]): GearCluster[] =>
  ratios.map((ratio) => ({ ratio, samples: 100 }));

function feed(samples: readonly LearnSample[], state = createGearLearner()): GearLearnerState {
  return samples.reduce((s, x) => observeGearSample(s, x, LIMITS), state);
}

function steady(
  from: number,
  ms: number,
  stepMs: number,
  kph: number,
  ratio: number,
  throttlePct: number | null = 20,
): LearnSample[] {
  const n = Math.floor(ms / stepMs);
  return Array.from({ length: n }, (_, i) => ({
    at: from + i * stepMs,
    speedKph: kph,
    rpm: kph * ratio,
    throttlePct,
  }));
}

describe('histogram geometry', () => {
  it('covers the configured ratio range in ≈ 1 % bins', () => {
    expect(ratioBin(Math.log(LEARN_MIN_RATIO))).toBe(0);
    expect(ratioBin(Math.log(LEARN_MAX_RATIO) - 1e-9)).toBe(LEARN_BIN_COUNT - 1);
    expect(ratioBin(-100)).toBe(0);
    expect(ratioBin(100)).toBe(LEARN_BIN_COUNT - 1);
  });
});

describe('findGearClusters', () => {
  it('finds separated peaks, highest ratio first, with refined centres', () => {
    const { hist, total } = histogramOf([
      [46, 300],
      [118, 200],
      [68, 250],
    ]);
    const found = findGearClusters(hist, total);
    expect(found.map((c) => c.ratio)).toHaveLength(3);
    [118, 68, 46].forEach((expected, i) => {
      expect(Math.abs((found[i]?.ratio ?? 0) / expected - 1)).toBeLessThan(0.006);
    });
    expect(found[0]?.samples).toBeCloseTo(200, 0);
  });

  it('merges peaks closer than the tolerance', () => {
    const { hist, total } = histogramOf([
      [40, 200, 0.01],
      [41.6, 200, 0.01],
    ]);
    const found = findGearClusters(hist, total);
    expect(found).toHaveLength(1);
    expect(found[0]?.ratio).toBeGreaterThan(40);
    expect(found[0]?.ratio).toBeLessThan(41.6);
  });

  it('merges peaks that are not separated by a clear valley', () => {
    // 10 % apart but joined by a plateau at 70 % of their height.
    const { hist } = histogramOf([
      [40, 200, 0.01],
      [44, 200, 0.01],
    ]);
    const peak = Math.max(...hist);
    for (let b = ratioBin(Math.log(40)); b <= ratioBin(Math.log(44)); b++) {
      hist[b] = Math.max(hist[b] ?? 0, 0.7 * peak);
    }
    const total = hist.reduce((a, b) => a + b, 0);
    expect(findGearClusters(hist, total)).toHaveLength(1);
    // The same peaks with an empty valley stay separate.
    const apart = histogramOf([
      [40, 200, 0.01],
      [44, 200, 0.01],
    ]);
    expect(findGearClusters(apart.hist, apart.total)).toHaveLength(2);
  });

  it('drops clusters with too few samples, absolutely and relative to the total', () => {
    const small = histogramOf([
      [46, 15],
      [28, 25],
    ]);
    expect(findGearClusters(small.hist, small.total).map((c) => Math.round(c.ratio))).toEqual([28]);
    const dominated = histogramOf([
      [23, 10_000],
      [46, 30],
    ]); // 30 < 0.5 % of 10 030
    expect(findGearClusters(dominated.hist, dominated.total)).toHaveLength(1);
  });

  it('returns nothing for an empty histogram', () => {
    expect(findGearClusters(new Array<number>(LEARN_BIN_COUNT).fill(0), 0)).toEqual([]);
  });
});

describe('normaliseLearnedRatios', () => {
  it('sorts descending, drops invalid values and near-duplicates', () => {
    expect(normaliseLearnedRatios([23, 118, Number.NaN, 68, 67, -5, 0, Infinity])).toEqual([
      118, 68, 23,
    ]);
  });

  it('returns null for nothing usable', () => {
    expect(normaliseLearnedRatios(null)).toBeNull();
    expect(normaliseLearnedRatios([])).toBeNull();
    expect(normaliseLearnedRatios([Number.NaN, -1])).toBeNull();
  });
});

describe('mergeLearnedRatios', () => {
  it('needs three clusters before publishing from scratch', () => {
    expect(mergeLearnedRatios(null, clusters(68, 46))).toBeNull();
    expect(mergeLearnedRatios(null, clusters(46, 118.004, 68))).toEqual([118, 68, 46]);
  });

  it('keeps unseen gears, replaces matched ones and adds new ones', () => {
    const existing = [118, 68, 44, 35];
    expect(mergeLearnedRatios(existing, clusters(46, 28))).toEqual([118, 68, 46, 35, 28]);
  });

  it('returns the same array when nothing moved by more than ≈ 0.5 %', () => {
    const existing = [118, 68, 46];
    expect(mergeLearnedRatios(existing, clusters(118.3, 67.9, 46.1))).toBe(existing);
    expect(mergeLearnedRatios(existing, [])).toBe(existing);
    expect(mergeLearnedRatios(existing, clusters(118, 68, 47))).not.toBe(existing);
  });

  it('prepends a 1st-gear hint that lies clearly above every known ratio', () => {
    expect(mergeLearnedRatios(null, clusters(68, 46, 35), 117)).toEqual([117, 68, 46, 35]);
    expect(mergeLearnedRatios([68, 46, 35], [], 117)).toEqual([117, 68, 46, 35]);
  });

  it('ignores a hint within the tolerance of (or below) the top ratio', () => {
    expect(mergeLearnedRatios(null, clusters(118, 68, 46), 115)).toEqual([118, 68, 46]);
    expect(mergeLearnedRatios(null, clusters(118, 68, 46), 90)).toEqual([118, 68, 46]);
    expect(mergeLearnedRatios(null, clusters(118, 68, 46), Number.NaN)).toEqual([118, 68, 46]);
  });

  it('replaces an earlier hint once 1st gear has its own cluster', () => {
    expect(mergeLearnedRatios([121, 68, 46], clusters(118, 68, 46), 121)).toEqual([118, 68, 46]);
  });
});

describe('observeGearSample', () => {
  it('accepts samples only once the ratio has been stable for a second', () => {
    const inputs = steady(T0, 1500, 100, 50, 46);
    const before = feed(inputs.slice(0, 10)); // 0 … 900 ms
    expect(before.total).toBe(0);
    const after = feed(inputs.slice(10, 11), before); // 1000 ms
    expect(after.total).toBe(1);
    expect(after.lastAcceptedAt).toBe(T0 + 1000);
  });

  it('counts at most one sample per 100 ms, whatever the poll rate', () => {
    const state = feed(steady(T0, 3000, 25, 50, 46)); // 40 Hz
    expect(state.total).toBeGreaterThanOrEqual(19);
    expect(state.total).toBeLessThanOrEqual(21);
  });

  it('restarts the stability window after a gap longer than 1.5 s', () => {
    const first = feed(steady(T0, 2000, 100, 50, 46));
    const total = first.total;
    const resumed = feed(steady(T0 + 4000, 900, 100, 50, 46), first);
    expect(resumed.total).toBe(total);
    expect(resumed.window.length).toBeLessThanOrEqual(10);
  });

  it('rejects a wandering ratio (shifting, slipping clutch)', () => {
    const wandering: LearnSample[] = Array.from({ length: 40 }, (_, i) => ({
      at: T0 + i * 100,
      speedKph: 50,
      rpm: 50 * 46 * (1 + 0.1 * Math.sin(i / 2)),
      throttlePct: 20,
    }));
    expect(feed(wandering).total).toBe(0);
  });

  it.each([
    ['below 15 km/h', steady(T0, 3000, 100, 12, 118)],
    ['near idle', steady(T0, 3000, 100, 50, 1000 / 50)],
    ['above redline', steady(T0, 3000, 100, 60, 118)],
    ['on a closed throttle', steady(T0, 3000, 100, 50, 46, 0)],
    ['outside the ratio range', steady(T0, 3000, 100, 20, 450)],
  ])('ignores samples %s', (_label, samples) => {
    expect(feed(samples).histogram).toBeNull();
  });

  it('ignores missing or non-finite data and duplicate timestamps', () => {
    let s = feed(steady(T0, 1500, 100, 50, 46));
    const total = s.total;
    for (const bad of [
      { at: T0 + 1500, speedKph: null, rpm: 2300, throttlePct: 20 },
      { at: T0 + 1500, speedKph: 50, rpm: null, throttlePct: 20 },
      { at: T0 + 1500, speedKph: Number.NaN, rpm: 2300, throttlePct: 20 },
    ]) {
      expect(observeGearSample(s, bad, LIMITS).total).toBe(total);
    }
    s = observeGearSample(s, { at: T0 + 1400, speedKph: 50, rpm: 2300, throttlePct: 20 }, LIMITS);
    expect(s.total).toBe(total);
  });

  it('halves the histogram when it exceeds its cap', () => {
    const state = feed(steady(T0, 2_100_000, 100, 100, 23)); // 35 minutes steady
    expect(state.total).toBeGreaterThan(10_000);
    expect(state.total).toBeLessThanOrEqual(20_000);
    const sum = (state.histogram ?? []).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(state.total, 6);
  });
});

describe('launch tracking', () => {
  function launch(slipUntilKph: number, shiftAtKph: number | null, stepMs = 100): LearnSample[] {
    const out: LearnSample[] = [{ at: T0, speedKph: 0, rpm: 800, throttlePct: 0 }];
    let kph = 0;
    let at = T0;
    let gearRatio = 118;
    while (kph < 30) {
      at += stepMs;
      kph += 0.6 * (stepMs / 100);
      if (shiftAtKph !== null && kph >= shiftAtKph) gearRatio = 68;
      const rpm = kph < slipUntilKph ? 1500 : gearRatio * kph;
      out.push({ at, speedKph: Math.round(kph), rpm, throttlePct: 30 });
    }
    return out;
  }

  it('records the steady ratio after pulling away as 1st gear', () => {
    const state = feed(launch(8, null));
    expect(state.launchRatios).toHaveLength(1);
    expect(Math.abs((state.launchRatios[0] ?? 0) / 118 - 1)).toBeLessThan(0.02);
    expect(firstGearHint(state)).toBe(state.launchRatios[0]);
  });

  it('restarts while the clutch is still slipping', () => {
    const state = feed(launch(12.7, null, 250));
    expect(state.launchRatios).toHaveLength(1);
    expect(Math.abs((state.launchRatios[0] ?? 0) / 118 - 1)).toBeLessThan(0.02);
  });

  it('gives up when the driver shifts before the ratio has settled', () => {
    const state = feed(launch(8, 14));
    expect(state.launchRatios).toEqual([]);
    expect(firstGearHint(state)).toBeNull();
  });

  it('needs a standstill first', () => {
    expect(feed(steady(T0, 5000, 100, 30, 68)).launchRatios).toEqual([]);
  });

  it('keeps the last 7 launches and uses their median', () => {
    let state = createGearLearner();
    for (let i = 0; i < 9; i++) {
      state = feed(
        launch(8, null).map((x) => ({ ...x, at: x.at + i * 100_000 })),
        state,
      );
    }
    expect(state.launchRatios).toHaveLength(7);
    const hint = firstGearHint(state) ?? 0;
    expect(Math.abs(hint / 118 - 1)).toBeLessThan(0.02);
  });
});
