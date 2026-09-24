import { describe, expect, it } from 'vitest';
import type { VehicleConfig } from '../../src/types/config.ts';
import {
  createGearState,
  gaplessPrefix,
  learnedNumbering,
  matchGearRatio,
  updateGear,
  type GearEstimate,
  type GearInput,
  type GearState,
} from '../../src/vehicle/gear.ts';
import { LEARN_BIN_COUNT, createGearLearner } from '../../src/vehicle/gear-learner.ts';
import { Drive, SIX_SPEED, cityDrive, highwayDrive, type DriveSample } from './drive-sim.ts';
import { testVehicle } from './fixtures.ts';

const T0 = 1_700_000_000_000;
const MANUAL = testVehicle({ transmission: 'manual', gearRatiosRpmPerKph: [...SIX_SPEED] });
const LEARNING = testVehicle({ transmission: 'manual', gearRatiosRpmPerKph: null });

function input(
  at: number,
  speedKph: number | null,
  rpm: number | null,
  extra: Partial<GearInput> = {},
): GearInput {
  return { at, speedKph, rpm, throttlePct: 20, reportedGear: null, ...extra };
}

/** Samples at a constant speed and ratio. */
function steady(
  from: number,
  count: number,
  stepMs: number,
  kph: number,
  ratio: number,
): GearInput[] {
  return Array.from({ length: count }, (_, i) => input(from + i * stepMs, kph, kph * ratio));
}

function run(
  inputs: readonly GearInput[],
  vehicle: VehicleConfig,
  state: GearState = createGearState(null),
): { state: GearState; estimates: GearEstimate[] } {
  const estimates: GearEstimate[] = [];
  let s = state;
  for (const i of inputs) {
    s = updateGear(s, i, vehicle);
    estimates.push(s.estimate);
  }
  return { state: s, estimates };
}

const fromDrive = (x: DriveSample): GearInput =>
  input(x.at, x.speedKph, x.rpm, { throttlePct: x.throttlePct });

function runDrive(
  drive: Drive,
  vehicle: VehicleConfig,
  state: GearState = createGearState(null),
): { state: GearState; estimates: GearEstimate[] } {
  return run(drive.samples.map(fromDrive), vehicle, state);
}

const gears = (estimates: readonly GearEstimate[]): Array<GearEstimate['gear']> =>
  estimates.map((e) => e.gear);

function expectRatiosNear(
  actual: readonly number[] | null,
  expected: readonly number[],
  tol = 0.03,
): void {
  expect(actual).not.toBeNull();
  expect(actual).toHaveLength(expected.length);
  actual?.forEach((r, i) => {
    expect(
      Math.abs(r / (expected[i] ?? NaN) - 1),
      `gear ${i + 1}: ${r} vs ${expected[i]}`,
    ).toBeLessThanOrEqual(tol);
  });
}

describe('matchGearRatio', () => {
  it('matches each ratio exactly to its gear', () => {
    SIX_SPEED.forEach((r, i) => {
      expect(matchGearRatio(r, 80, SIX_SPEED, 'manual')).toEqual({
        index: i,
        deviation: 0,
        score: 0,
      });
    });
  });

  it('accepts about ±7 % at road speed and rejects more', () => {
    expect(matchGearRatio(46 * 1.06, 80, SIX_SPEED, 'manual')?.index).toBe(2);
    expect(matchGearRatio(46 / 1.06, 80, SIX_SPEED, 'manual')?.index).toBe(2);
    expect(matchGearRatio(46 * 1.09, 80, SIX_SPEED, 'manual')).toBeNull();
    expect(matchGearRatio(46 / 1.09, 80, SIX_SPEED, 'manual')).toBeNull();
  });

  it('never lets adjacent windows overlap, even on a close-ratio 8-speed', () => {
    const eight = [60, 40, 29, 23, 19.5, 17, 15.2, 14];
    const logs = eight.map(Math.log);
    for (let ln = Math.log(12); ln <= Math.log(70); ln += 0.001) {
      const m = matchGearRatio(Math.exp(ln), 60, eight, 'manual');
      if (m === null) continue;
      const nearest = logs.reduce(
        (best, l, i) => (Math.abs(l - ln) < Math.abs((logs[best] ?? 0) - ln) ? i : best),
        0,
      );
      expect(m.index).toBe(nearest);
    }
    // The geometric midpoint between 7th and 8th belongs to neither.
    expect(matchGearRatio(Math.sqrt(15.2 * 14), 60, eight, 'manual')).toBeNull();
  });

  it('widens the window at low speed for the 1 km/h speed resolution', () => {
    expect(matchGearRatio(118 * 1.12, 6, SIX_SPEED, 'manual')?.index).toBe(0);
    expect(matchGearRatio(118 * 1.12, 60, SIX_SPEED, 'manual')).toBeNull();
  });

  it('allows torque-converter slip upwards on automatics only, shrinking with speed', () => {
    expect(matchGearRatio(68 * 1.15, 20, SIX_SPEED, 'automatic')?.index).toBe(1);
    expect(matchGearRatio(68 * 1.15, 20, SIX_SPEED, 'manual')).toBeNull();
    expect(matchGearRatio(68 / 1.15, 20, SIX_SPEED, 'automatic')).toBeNull();
    expect(matchGearRatio(68 * 1.15, 60, SIX_SPEED, 'automatic')).toBeNull();
  });

  it('skips invalid ratios without renumbering the others', () => {
    const ratios = [118, Number.NaN, 46, 0, 28];
    expect(matchGearRatio(46, 50, ratios, 'manual')?.index).toBe(2);
    expect(matchGearRatio(28, 50, ratios, 'manual')?.index).toBe(4);
  });

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])('rejects a measured ratio of %s', (r) => {
    expect(matchGearRatio(r, 50, SIX_SPEED, 'manual')).toBeNull();
  });
});

describe('updateGear with configured ratios', () => {
  it('starts unknown', () => {
    expect(createGearState(null).estimate).toEqual({ gear: null, inferred: false, confidence: 0 });
  });

  it('confirms a new gear after 2 samples spanning 300 ms', () => {
    const { estimates } = run(steady(T0, 6, 100, 50, 46), MANUAL);
    expect(gears(estimates)).toEqual([null, null, null, 3, 3, 3]);
    expect(estimates[3]).toMatchObject({ gear: 3, inferred: true });
    expect(estimates[3]?.confidence).toBeCloseTo(1, 5);
  });

  it('needs only two samples when polling slowly', () => {
    expect(gears(run(steady(T0, 3, 1000, 50, 46), MANUAL).estimates)).toEqual([null, 3, 3]);
  });

  it('goes unknown immediately below 5 km/h, without speed or rpm, or with the engine stopped', () => {
    const { state } = run(steady(T0, 5, 100, 50, 46), MANUAL);
    expect(state.estimate.gear).toBe(3);
    const at = T0 + 500;
    for (const next of [
      input(at, 4, 4 * 118),
      input(at, null, 2300),
      input(at, 50, null),
      input(at, 50, 0),
      input(at, Number.NaN, 2300),
    ]) {
      expect(updateGear(state, next, MANUAL).estimate).toEqual({
        gear: null,
        inferred: false,
        confidence: 0,
      });
    }
  });

  it('ignores a single-sample glitch', () => {
    const inputs = [
      ...steady(T0, 5, 100, 80, 35),
      input(T0 + 500, 80, 80 * 46),
      ...steady(T0 + 600, 5, 100, 80, 35),
    ];
    expect(gears(run(inputs, MANUAL).estimates).slice(3)).toEqual(Array(8).fill(4));
  });

  /** Alternating between two other gears, which never confirms either. */
  const flicker = (from: number): GearInput[] =>
    Array.from({ length: 12 }, (_, i) => input(from + i * 100, 80, 80 * (i % 2 === 0 ? 46 : 28)));

  it('reads an unsettled, changing ratio as N on a manual (clutch in, rpm falling)', () => {
    const { estimates } = run([...steady(T0, 5, 100, 80, 35), ...flicker(T0 + 500)], MANUAL);
    expect(gears(estimates.slice(3, 8))).toEqual([4, 4, 4, 4, 4]);
    expect(gears(estimates.slice(8))).toEqual(Array(9).fill('N'));
  });

  it('drops an automatic gear it cannot confirm within a second rather than freezing it', () => {
    const auto = testVehicle({ transmission: 'automatic', gearRatiosRpmPerKph: [...SIX_SPEED] });
    const { estimates } = run([...steady(T0, 7, 100, 80, 35), ...flicker(T0 + 700)], auto);
    expect(estimates[6]?.gear).toBe(4);
    expect(estimates[7 + 8]?.gear).toBe(4);
    expect(estimates[7 + 10]?.gear).toBeNull();
  });

  it('shows N while the clutch is in and the next gear once engaged', () => {
    const drive = new Drive({ ratios: SIX_SPEED, seed: 2 })
      .launch(24)
      .shift(2)
      .inGear(2, 45, 5)
      .cruise(2, 2);
    const clutchFrom = drive.samples.length;
    drive.clutchIn(1500);
    const engageFrom = drive.samples.length;
    drive.shift(3).cruise(3, 2);
    const { estimates } = runDrive(drive, MANUAL);
    expect(estimates[clutchFrom - 1]?.gear).toBe(2);
    expect(gears(estimates.slice(clutchFrom + 4, engageFrom))).toEqual(
      Array(engageFrom - clutchFrom - 4).fill('N'),
    );
    expect(estimates[estimates.length - 1]?.gear).toBe(3);
  });

  it('coasting in neutral at idle shows N rather than the gears idle rpm sweeps through', () => {
    const drive = new Drive({ ratios: SIX_SPEED, seed: 3 })
      .launch(24)
      .shift(2)
      .inGear(2, 45, 5)
      .shift(3)
      .inGear(3, 60, 4);
    const coastFrom = drive.samples.length;
    drive.coast(16, -1.5); // 60 → 16 km/h passes idle/speed = 6th, 5th, 4th and 3rd ratios
    const { estimates } = runDrive(drive, MANUAL);
    const coasting = gears(estimates.slice(coastFrom + 6));
    expect(coasting.length).toBeGreaterThan(200);
    expect(new Set(coasting)).toEqual(new Set(['N']));
  });

  it('braking to a stop with the clutch in never shows a wrong gear', () => {
    for (const rate of [-2, -4, -8]) {
      const drive = new Drive({ ratios: SIX_SPEED, seed: 4 })
        .launch(24)
        .shift(2)
        .inGear(2, 45, 5)
        .shift(3)
        .cruise(3, 2);
      const stopFrom = drive.samples.length;
      drive.stop(3, rate);
      const { estimates } = runDrive(drive, MANUAL);
      const clutchIn = drive.samples.findIndex((x, i) => i >= stopFrom && x.truth === 'N');
      expect(clutchIn).toBeGreaterThan(stopFrom);
      expect(estimates[clutchIn - 1]?.gear).toBe(3);
      // The old gear may linger ≤ 600 ms while rpm leaves its window and N confirms.
      const after = gears(estimates.slice(clutchIn + 6));
      for (const g of after) expect(['N', null], `braking at ${rate} km/h/s`).toContain(g);
    }
  });

  it('keeps the gear when braking hard in gear after a downshift', () => {
    const drive = new Drive({ ratios: SIX_SPEED, seed: 4 }).launch(24).shift(2).inGear(2, 45, 5);
    drive
      .shift(3)
      .inGear(3, 65, 4)
      .shift(4)
      .inGear(4, 70, 3)
      .cruise(4, 2)
      .inGear(4, 60, -3)
      .shift(3);
    const downshifted = drive.samples.length;
    drive.inGear(3, 30, -6);
    const { estimates } = runDrive(drive, MANUAL);
    expect(gears(estimates.slice(downshifted + 4))).toEqual(
      Array(drive.samples.length - downshifted - 4).fill(3),
    );
  });

  it('shows 2nd when creeping along at idle in traffic', () => {
    const creep = Array.from({ length: 20 }, (_, i) => input(T0 + i * 250, 12, 800 + (i % 3) * 5));
    expect(run(creep, MANUAL).state.estimate.gear).toBe(2);
  });

  it('agrees with ground truth on whole drives once each state has lasted 500 ms', () => {
    for (const stepMs of [100, 250, 500]) {
      const drive = new Drive({ ratios: SIX_SPEED, seed: 11, stepMs });
      highwayDrive(cityDrive(drive, 4));
      const { estimates } = runDrive(drive, MANUAL);
      let since = 0;
      let checked = 0;
      drive.samples.forEach((x, i) => {
        if (i === 0 || x.truth !== drive.samples[i - 1]?.truth) since = x.at;
        if (x.at - since < 500) return;
        checked++;
        expect(estimates[i]?.gear, `${stepMs} ms step, sample ${i}`).toBe(x.truth);
      });
      expect(checked).toBeGreaterThan(500);
    }
  });

  it('keeps confidence within 0–1', () => {
    const drive = highwayDrive(cityDrive(new Drive({ ratios: SIX_SPEED, seed: 5 }), 2));
    for (const e of runDrive(drive, MANUAL).estimates) {
      expect(e.confidence).toBeGreaterThanOrEqual(0);
      expect(e.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('reported gear (PID 0xA4)', () => {
  it('wins over inference and applies immediately', () => {
    const { estimates } = run([input(T0, 50, 50 * 46, { reportedGear: 4 })], MANUAL);
    expect(estimates[0]).toEqual({ gear: 4, inferred: false, confidence: 1 });
  });

  it('reports 0 as neutral and is shown even when stationary', () => {
    expect(run([input(T0, 50, 2300, { reportedGear: 0 })], MANUAL).state.estimate.gear).toBe('N');
    expect(run([input(T0, 0, 800, { reportedGear: 1 })], MANUAL).state.estimate.gear).toBe(1);
  });

  it.each([-1, 2.5, 13, Number.NaN])('ignores %s and falls back to inference', (reportedGear) => {
    const inputs = steady(T0, 5, 100, 50, 46).map((i) => ({ ...i, reportedGear }));
    expect(run(inputs, MANUAL).state.estimate).toMatchObject({ gear: 3, inferred: true });
  });
});

describe('automatic transmissions', () => {
  const AUTO = testVehicle({ transmission: 'automatic', gearRatiosRpmPerKph: [...SIX_SPEED] });

  it('accepts torque-converter slip, with lower confidence', () => {
    const slipping = steady(T0, 8, 100, 25, 68 * 1.1);
    const auto = run(slipping, AUTO).state.estimate;
    expect(auto.gear).toBe(2);
    expect(auto.confidence).toBeLessThan(0.7);
    expect(run(slipping, MANUAL).state.estimate.gear).toBe('N');
  });

  it('needs 3 samples spanning 600 ms to confirm a change', () => {
    expect(gears(run(steady(T0, 8, 100, 80, 35), AUTO).estimates)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      4,
      4,
    ]);
  });

  it('gains confidence as speed rises and the converter locks up', () => {
    const slow = run(steady(T0, 8, 100, 25, 68), AUTO).state.estimate;
    const fast = run(steady(T0, 8, 100, 90, 28), AUTO).state.estimate;
    expect(slow.gear).toBe(2);
    expect(fast.gear).toBe(5);
    expect(fast.confidence).toBeGreaterThan(slow.confidence);
    expect(fast.confidence).toBeLessThan(1);
  });

  it('agrees with ground truth on a drive with converter slip once each gear has held 800 ms', () => {
    const slip = (kph: number): number => (kph >= 60 ? 0 : 0.02 + 0.1 * (1 - kph / 60));
    const drive = highwayDrive(
      cityDrive(new Drive({ ratios: SIX_SPEED, seed: 5, converterSlip: slip }), 3),
    );
    const { estimates } = runDrive(drive, AUTO);
    let since = 0;
    drive.samples.forEach((x, i) => {
      if (i === 0 || x.truth !== drive.samples[i - 1]?.truth) since = x.at;
      if (typeof x.truth === 'number' && x.at - since >= 800)
        expect(estimates[i]?.gear).toBe(x.truth);
    });
  });
});

describe('CVT', () => {
  it('never reports a gear and never learns', () => {
    const cvt = testVehicle({ transmission: 'cvt', gearRatiosRpmPerKph: null });
    const inputs = [
      ...steady(T0, 30, 100, 50, 46),
      input(T0 + 3000, 50, 2300, { reportedGear: 3 }),
    ];
    const { state, estimates } = run(inputs, cvt);
    expect(new Set(gears(estimates))).toEqual(new Set([null]));
    expect(state.learner.histogram).toBeNull();
    const configured = testVehicle({ transmission: 'cvt', gearRatiosRpmPerKph: [...SIX_SPEED] });
    expect(new Set(gears(run(inputs, configured).estimates))).toEqual(new Set([null]));
  });
});

describe('gear learning', () => {
  const fullDrive = (seed: number, stepMs = 100): Drive =>
    highwayDrive(cityDrive(new Drive({ ratios: SIX_SPEED, seed, stepMs }), 4));

  it('learns a 6-speed manual within 3 % from a realistic drive with noise and shifts', () => {
    for (const seed of [1, 2, 3]) {
      const { state } = runDrive(fullDrive(seed), LEARNING);
      expectRatiosNear(state.learnedRatios, SIX_SPEED);
    }
  });

  it('learns at slow poll rates too', () => {
    for (const stepMs of [250, 500]) {
      expectRatiosNear(runDrive(fullDrive(9, stepMs), LEARNING).state.learnedRatios, SIX_SPEED);
    }
  });

  it('numbers gears correctly from the very first publication (1st gear anchored by launches)', () => {
    let s = createGearState(null);
    const published: number[][] = [];
    for (const x of fullDrive(6).samples) {
      const before = s.learnedRatios;
      s = updateGear(s, fromDrive(x), LEARNING);
      if (s.learnedRatios !== null && s.learnedRatios !== before) published.push(s.learnedRatios);
    }
    expect(published.length).toBeGreaterThan(0);
    for (const list of published) {
      expect(list.length).toBeGreaterThanOrEqual(3);
      expectRatiosNear(list, SIX_SPEED.slice(0, list.length));
    }
  });

  it('infers gears from learned ratios, with somewhat lower confidence', () => {
    const { state } = runDrive(fullDrive(1), LEARNING);
    const learned = run(steady(T0 + 10_000_000, 8, 100, 90, 28), LEARNING, state).state.estimate;
    const configured = run(steady(T0, 8, 100, 90, 28), MANUAL).state.estimate;
    expect(learned.gear).toBe(5);
    expect(learned.confidence).toBeLessThan(configured.confidence);
  });

  it('publishes nothing until three distinct gears have been seen', () => {
    const drive = new Drive({ ratios: SIX_SPEED, seed: 3 })
      .launch(24)
      .shift(2)
      .inGear(2, 40, 5)
      .cruise(2, 60);
    drive.shift(3).cruise(3, 60);
    const { state } = runDrive(drive, LEARNING);
    expect(state.learner.total).toBeGreaterThan(500);
    expect(state.learnedRatios).toBeNull();
  });

  it('does not learn from idling, coasting with the clutch in, a closed throttle or above redline', () => {
    const cases: GearInput[][] = [
      steady(T0, 50, 100, 50, 800 / 50), // idle rpm while rolling
      steady(T0, 50, 100, 12, 118), // below 15 km/h
      steady(T0, 50, 100, 50, 46).map((i) => ({ ...i, throttlePct: 0 })),
      steady(T0, 50, 100, 60, 118), // 7080 rpm, above redline
    ];
    for (const inputs of cases) expect(run(inputs, LEARNING).state.learner.histogram).toBeNull();
    // A closed-throttle sample is excluded, but an unknown throttle is not.
    const unknownThrottle = steady(T0, 50, 100, 50, 46).map((i) => ({ ...i, throttlePct: null }));
    expect(run(unknownThrottle, LEARNING).state.learner.total).toBeGreaterThan(0);
  });

  it('does not learn when ratios are configured', () => {
    expect(runDrive(fullDrive(1), MANUAL).state.learner.histogram).toBeNull();
  });

  it('keeps persisted ratios for gears not used this session and refines the ones that are', () => {
    const persisted = [118, 68, 44, 35, 28.3, 23.2]; // 3rd is 4 % off
    const drive = cityDrive(new Drive({ ratios: SIX_SPEED, seed: 8 }), 4); // never above 4th
    const { state } = runDrive(drive, LEARNING, createGearState(persisted));
    const learned = state.learnedRatios ?? [];
    expect(learned).toHaveLength(6);
    expect(Math.abs((learned[2] ?? 0) / 46 - 1)).toBeLessThan(0.01);
    expect(learned.slice(4)).toEqual([28.3, 23.2]);
  });

  it('adds a missing 1st gear to persisted ratios from launches', () => {
    const drive = cityDrive(new Drive({ ratios: SIX_SPEED, seed: 8 }), 2);
    const { state } = runDrive(drive, LEARNING, createGearState([68, 46, 35, 28, 23]));
    expectRatiosNear(state.learnedRatios, SIX_SPEED);
  });

  it('leaves learnedRatios referentially unchanged while nothing moves (no persistence churn)', () => {
    const { state } = runDrive(fullDrive(1), LEARNING);
    const before = state.learnedRatios;
    let s = state;
    for (const i of steady(T0 + 10_000_000, 600, 100, 118, 23)) {
      s = updateGear(s, i, LEARNING);
      expect(s.learnedRatios).toBe(before);
    }
  });

  it('automatics publish from the histogram alone (no launch anchor)', () => {
    const auto = testVehicle({ transmission: 'automatic', gearRatiosRpmPerKph: null });
    const slip = (kph: number): number => (kph >= 60 ? 0 : 0.02 + 0.1 * (1 - kph / 60));
    const drive = highwayDrive(
      cityDrive(new Drive({ ratios: SIX_SPEED, seed: 5, converterSlip: slip }), 6),
    );
    const { state } = runDrive(drive, auto);
    // Converter slip biases the low gears high, but within the matcher's slip allowance.
    expectRatiosNear(state.learnedRatios, SIX_SPEED, 0.07);
  });

  it('creates state from persisted ratios defensively', () => {
    expect(createGearState([23, 118, Number.NaN, 68, 67, -5]).learnedRatios).toEqual([118, 68, 23]);
    expect(createGearState([]).learnedRatios).toBeNull();
    expect(createGearState(null).learnedRatios).toBeNull();
  });

  it('is JSON-serialisable and replays deterministically across a round trip', () => {
    const samples = fullDrive(4).samples.map(fromDrive);
    const half = Math.floor(samples.length / 2);
    const straight = run(samples, LEARNING).state;

    const first = run(samples.slice(0, half), LEARNING).state;
    const revived = JSON.parse(JSON.stringify(first)) as GearState;
    expect(revived).toEqual(first);
    const resumed = run(samples.slice(half), LEARNING, revived).state;
    expect(resumed).toEqual(straight);
    expect(run(samples, LEARNING).state).toEqual(straight);
  });

  it('keeps memory bounded on a very long drive', () => {
    const drive = new Drive({ ratios: SIX_SPEED, seed: 12 }).launch(24).shift(2).inGear(2, 45, 5);
    drive.shift(3).inGear(3, 65, 4).shift(4).inGear(4, 85, 3).shift(5).inGear(5, 100, 2).shift(6);
    drive.inGear(6, 115, 1.5).cruise(6, 2400); // 40 minutes in 6th
    cityDrive(drive, 10);
    const { state } = runDrive(drive, LEARNING);
    expect(state.learner.histogram).toHaveLength(LEARN_BIN_COUNT);
    expect(state.learner.total).toBeLessThanOrEqual(20_000);
    expect(state.learner.window.length).toBeLessThanOrEqual(64);
    expect(state.recent.length).toBeLessThanOrEqual(32);
    expect(state.learner.launchRatios.length).toBeLessThanOrEqual(7);
    expectRatiosNear(state.learnedRatios, SIX_SPEED);
  });
});

describe('gear numbering of learned ratios (regression: core-3)', () => {
  const AUTO_LEARNING = testVehicle({ transmission: 'automatic', gearRatiosRpmPerKph: null });
  const slip = (kph: number): number => (kph >= 60 ? 0 : 0.02 + 0.1 * (1 - kph / 60));

  /** Automatic city laps: pull away in 1st (converter slipping), change up through the box. */
  function autoCityDrive(drive: Drive, laps: number): Drive {
    for (let i = 0; i < laps; i++) {
      drive
        .autoLaunch(17 + (i % 3))
        .inGear(2, 32, 5)
        .inGear(3, 48, 3)
        .cruise(3, 10);
      if (i % 2 === 0) drive.inGear(4, 60, 2).cruise(4, 10).inGear(3, 45, -3);
      drive.stop(3);
    }
    return drive;
  }

  function autoHighwayDrive(drive: Drive): Drive {
    return drive
      .autoLaunch(18)
      .inGear(2, 35, 5)
      .inGear(3, 55, 4)
      .inGear(4, 75, 3)
      .inGear(5, 95, 2)
      .cruise(5, 15)
      .inGear(6, 118, 1.5)
      .cruise(6, 60)
      .inGear(5, 80, -3)
      .cruise(5, 10)
      .inGear(4, 60, -3)
      .inGear(3, 40, -3)
      .stop(3);
  }

  /** Numeric gears shown once a state has lasted 800 ms: right, wrong, and hidden counts. */
  function score(drive: Drive, estimates: readonly GearEstimate[]) {
    const tally = { right: 0, wrong: [] as string[], hidden: 0 };
    let since = 0;
    drive.samples.forEach((x, i) => {
      if (i === 0 || x.truth !== drive.samples[i - 1]?.truth) since = x.at;
      if (typeof x.truth !== 'number' || x.at - since < 800) return;
      const shown = estimates[i]?.gear;
      if (shown === null || shown === undefined) tally.hidden++;
      else if (shown === x.truth) tally.right++;
      else tally.wrong.push(`${x.truth} shown as ${shown} at ${x.speedKph} km/h`);
    });
    return tally;
  }

  it('numbers an automatic from 2nd when 1st never forms a cluster', () => {
    const drive = autoHighwayDrive(
      autoCityDrive(new Drive({ ratios: SIX_SPEED, seed: 5, converterSlip: slip }), 6),
    );
    const { state, estimates } = runDrive(drive, AUTO_LEARNING);
    // The converter keeps 1st out of the histogram: the highest learned ratio is 2nd gear.
    expectRatiosNear(state.learnedRatios, SIX_SPEED.slice(1), 0.07);
    const { right, wrong, hidden } = score(drive, estimates);
    expect(wrong).toEqual([]);
    expect(right).toBeGreaterThan(2 * hidden);
  });

  it('shows nothing on an automatic until an upshift has anchored the numbering', () => {
    // Persisted from an earlier drive: 2nd…6th. Nothing this session proves which is which.
    const state = createGearState([72, 48, 35.5, 28, 23]);
    const { estimates } = run(steady(T0, 20, 100, 50, 35.5), AUTO_LEARNING, state);
    expect(new Set(gears(estimates))).toEqual(new Set([null]));
  });

  it('numbers an automatic right away from a persisted anchor', () => {
    const anchor = { transmission: 'automatic' as const, secondGearRpmPerKph: 73.2 };
    const state = createGearState([72, 48, 35.5, 28, 23], anchor, 'automatic');
    expect(state.anchor).toEqual(anchor);
    const { estimates } = run(steady(T0, 20, 100, 50, 35.5), AUTO_LEARNING, state);
    expect(gears(estimates).at(-1)).toBe(4);
    // An anchor matching the second-highest ratio numbers the ladder from 1st.
    const fromFirst = createGearState([118, 72, 48, 35.5, 28, 23], anchor, 'automatic');
    expect(
      gears(run(steady(T0, 20, 100, 50, 35.5), AUTO_LEARNING, fromFirst).estimates).at(-1),
    ).toBe(4);
  });

  it('learns the anchor from this session’s upshifts, for the next start', () => {
    const drive = autoCityDrive(new Drive({ ratios: SIX_SPEED, seed: 5, converterSlip: slip }), 6);
    const { state } = runDrive(drive, AUTO_LEARNING);
    expect(state.learnedRatios).not.toBeNull();
    expect(state.anchor?.transmission).toBe('automatic');
    // 2nd gear (68 rpm per km/h) plus some converter slip.
    expect(state.anchor?.secondGearRpmPerKph).toBeGreaterThan(66);
    expect(state.anchor?.secondGearRpmPerKph).toBeLessThan(76);
    // A manual never learns one (its launches anchor it every session).
    const manual = runDrive(
      new Drive({ ratios: SIX_SPEED, seed: 3 }).launch(20).shift(2).inGear(2, 40, 4).stop(2),
      LEARNING,
      createGearState([118, 68, 46, 35, 28, 23]),
    );
    expect(manual.state.anchor).toBeNull();
  });

  it('keeps a persisted anchor only with ratios and for the transmission it was learned on', () => {
    const anchor = { transmission: 'automatic' as const, secondGearRpmPerKph: 73.2 };
    expect(createGearState(null, anchor, 'automatic').anchor).toBeNull();
    expect(createGearState([72, 48], anchor, 'dct').anchor).toBeNull();
    expect(createGearState([72, 48], anchor).anchor).toEqual(anchor);
    for (const junk of [
      null,
      'fast',
      { transmission: 'automatic', secondGearRpmPerKph: -3 },
      { transmission: 'automatic', secondGearRpmPerKph: Number.NaN },
      { transmission: 'steam', secondGearRpmPerKph: 70 },
      { transmission: 'automatic' },
    ]) {
      expect(createGearState([72, 48], junk).anchor).toBeNull();
    }
  });

  it('never numbers learned gears above a gap', () => {
    // An automatic's first publication with 3rd missing: 2nd, 4th, 5th, 6th.
    const upshifts: Array<[number, number]> = [
      [128, 72.6],
      [128, 72.9],
    ];
    const learner = { ...createGearLearner(), upshifts };
    const state: GearState = { ...createGearState([72.3, 35.4, 28, 23]), learner };
    expect(gears(run(steady(T0, 10, 100, 30, 72.3), AUTO_LEARNING, state).estimates)).toContain(2);
    const inFourth = gears(run(steady(T0, 20, 100, 50, 35.4), AUTO_LEARNING, state).estimates);
    expect(new Set(inFourth)).toEqual(new Set([null]));
  });

  it('never shows a skipped gear’s neighbours with shifted numbers (manual 1 → 2 → 4)', () => {
    const drive = new Drive({ ratios: SIX_SPEED, seed: 11 });
    for (let i = 0; i < 4; i++) {
      drive.launch(24).shift(2).inGear(2, 45, 5).shift(4).inGear(4, 70, 2).cruise(4, 30);
      drive.shift(5).inGear(5, 90, 2).cruise(5, 20).shift(6).inGear(6, 110, 1.5).cruise(6, 30);
      drive.shift(4).inGear(4, 50, -3).stop(4);
    }
    const { state, estimates } = runDrive(drive, LEARNING);
    expectRatiosNear(state.learnedRatios, [118, 68, 35, 28, 23]);
    const { right, wrong } = score(drive, estimates);
    expect(wrong).toEqual([]);
    expect(right).toBeGreaterThan(0); // 1st and 2nd are still shown
  });

  it('never shows an inferred N on an automatic', () => {
    const auto = testVehicle({ transmission: 'automatic', gearRatiosRpmPerKph: [...SIX_SPEED] });
    // Between 1st and 2nd: converter slip or a shift in progress, never neutral in D.
    const between = steady(T0, 10, 100, 30, 92);
    expect(new Set(gears(run(between, auto).estimates))).toEqual(new Set([null]));
    expect(run(between, MANUAL).state.estimate.gear).toBe('N');
  });

  describe('gaplessPrefix', () => {
    const GEARBOXES: Record<string, number[]> = {
      'ZF 8HP': [4.714, 3.143, 2.106, 1.667, 1.285, 1.0, 0.839, 0.667],
      'Ford 10R80': [4.696, 2.985, 2.146, 1.769, 1.52, 1.275, 1.0, 0.854, 0.689, 0.636],
      'GM 4L60E': [3.059, 1.625, 1.0, 0.696],
      'Toyota R150': [3.83, 2.06, 1.39, 1.0, 0.85],
      'Mazda MX-5 ND': [5.087, 2.991, 2.035, 1.594, 1.286, 1.0],
      'test six-speed': [...SIX_SPEED],
    };

    it.each(Object.entries(GEARBOXES))('accepts a complete %s', (_, ratios) => {
      expect(gaplessPrefix(ratios)).toBe(ratios.length);
    });

    it('stops before a missing low gear, with or without 1st', () => {
      const withoutThird = SIX_SPEED.filter((r) => r !== 46);
      expect(gaplessPrefix(withoutThird)).toBe(2);
      expect(gaplessPrefix(withoutThird.slice(1))).toBe(1);
      expect(gaplessPrefix([72.3, 35.4, 28, 23])).toBe(1);
      const eightSpeed = GEARBOXES['ZF 8HP'] ?? [];
      expect(gaplessPrefix(eightSpeed.filter((_, i) => i !== 2).slice(1))).toBe(1);
    });
  });

  describe('learnedNumbering', () => {
    const ladder = [118, 68, 46, 35, 28, 23];
    const withUpshifts = (after: number) => ({
      ...createGearLearner(),
      upshifts: [
        [128, after],
        [128, after],
      ] as Array<[number, number]>,
    });

    it('anchors an automatic by the ratio after the first upshift (2nd gear)', () => {
      expect(learnedNumbering(ladder, 'automatic', withUpshifts(70))).toEqual({
        firstGear: 1,
        proven: 6,
      });
      expect(learnedNumbering(ladder.slice(1), 'automatic', withUpshifts(70))).toEqual({
        firstGear: 2,
        proven: 5,
      });
      // No upshift seen, or one that matches neither of the two highest ratios: unproven.
      expect(learnedNumbering(ladder, 'automatic', createGearLearner()).proven).toBe(0);
      expect(learnedNumbering(ladder.slice(2), 'automatic', withUpshifts(70)).proven).toBe(0);
      expect(learnedNumbering(ladder, 'automatic', withUpshifts(47)).proven).toBe(0);
    });

    it('falls back to a persisted anchor on an automatic, this session’s upshifts first', () => {
      const anchor = { transmission: 'automatic' as const, secondGearRpmPerKph: 70 };
      expect(learnedNumbering(ladder, 'automatic', createGearLearner(), anchor)).toEqual({
        firstGear: 1,
        proven: 6,
      });
      expect(learnedNumbering(ladder.slice(1), 'automatic', createGearLearner(), anchor)).toEqual({
        firstGear: 2,
        proven: 5,
      });
      // This session saw upshifts into a ratio that is not 2nd of this ladder: unproven.
      expect(learnedNumbering(ladder, 'automatic', withUpshifts(47), anchor).proven).toBe(0);
      // An anchor from another transmission proves nothing.
      const dct = { ...anchor, transmission: 'dct' as const };
      expect(learnedNumbering(ladder, 'automatic', createGearLearner(), dct).proven).toBe(0);
    });

    it('anchors a manual by its launch ratio (1st gear), trusting the ladder until then', () => {
      const launched = { ...createGearLearner(), launchRatios: [117] };
      expect(learnedNumbering(ladder, 'manual', launched)).toEqual({ firstGear: 1, proven: 6 });
      expect(learnedNumbering(ladder, 'manual', createGearLearner())).toEqual({
        firstGear: 1,
        proven: 6,
      });
      // A ratio above the launch ratio (e.g. learned as an automatic) makes it unproven.
      expect(learnedNumbering([150, ...ladder], 'dct', launched).proven).toBe(0);
    });
  });
});
