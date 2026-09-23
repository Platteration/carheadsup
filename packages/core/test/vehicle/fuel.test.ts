import { describe, expect, it } from 'vitest';
import type { VehicleConfig } from '../../src/types/config.ts';
import {
  MAX_L_PER_100KM,
  createFuelState,
  estimateFuelRate,
  fuelProperties,
  speedDensityAirGps,
  updateFuel,
  type FuelInput,
  type FuelState,
} from '../../src/vehicle/fuel.ts';
import { testVehicle } from './fixtures.ts';

const T0 = 1_700_000_000_000;
const CAR = testVehicle();

function input(overrides: Partial<FuelInput> = {}): FuelInput {
  return {
    at: T0,
    speedKph: null,
    rpm: 2000,
    fuelRateLph: null,
    mafGps: null,
    mapKpa: null,
    intakeAirTempC: null,
    commandedLambda: null,
    fuelLevelPct: null,
    ethanolPct: null,
    ...overrides,
  };
}

/** Feed `count` samples `stepMs` apart, each built from its index and timestamp. */
function drive(
  state: FuelState,
  from: number,
  count: number,
  stepMs: number,
  build: (i: number, at: number) => Partial<FuelInput>,
  vehicle: VehicleConfig = CAR,
): FuelState {
  let s = state;
  for (let i = 0; i < count; i++) {
    const at = from + i * stepMs;
    s = updateFuel(s, input({ at, ...build(i, at) }), vehicle);
  }
  return s;
}

/** Constant-speed, constant-consumption driving: `km` at `kph` using `lPer100km`. */
function cruise(
  state: FuelState,
  from: number,
  km: number,
  kph: number,
  lPer100km: number,
  extra: Partial<FuelInput> = {},
): FuelState {
  const stepMs = 1000;
  const count = Math.round((km / kph) * 3600) + 1;
  const lph = (lPer100km * kph) / 100;
  return drive(state, from, count, stepMs, () => ({ speedKph: kph, fuelRateLph: lph, ...extra }));
}

describe('estimateFuelRate', () => {
  it('prefers the fuel-rate PID', () => {
    expect(
      estimateFuelRate(
        input({ fuelRateLph: 3.2, mafGps: 10, mapKpa: 50, intakeAirTempC: 25 }),
        CAR,
      ),
    ).toEqual({
      lph: 3.2,
      source: 'pid',
    });
  });

  it('derives gasoline flow from MAF: g/s ÷ 14.7 × 3600 ÷ 745 g/L', () => {
    // 10 / 14.7 = 0.680 g/s fuel → 2449 g/h → 3.287 L/h
    const r = estimateFuelRate(input({ mafGps: 10, mapKpa: 50, intakeAirTempC: 25 }), CAR);
    expect(r?.source).toBe('maf');
    expect(r?.lph).toBeCloseTo(3.28722, 4);
  });

  it('applies commanded lambda (rich mixture burns more fuel)', () => {
    // 10 / (14.7 × 0.9) × 3600 / 745
    expect(estimateFuelRate(input({ mafGps: 10, commandedLambda: 0.9 }), CAR)?.lph).toBeCloseTo(
      3.65247,
      4,
    );
  });

  it.each([0, 0.3, 2.5, Number.NaN])('ignores an implausible lambda of %s', (lambda) => {
    expect(estimateFuelRate(input({ mafGps: 10, commandedLambda: lambda }), CAR)?.lph).toBeCloseTo(
      3.28722,
      4,
    );
  });

  it('uses E85 properties: AFR 9.8, 785 g/L', () => {
    const e85 = testVehicle({ fuelType: 'e85' });
    // 10 / 9.8 × 3600 / 785
    expect(estimateFuelRate(input({ mafGps: 10 }), e85)?.lph).toBeCloseTo(4.67958, 4);
  });

  it('blends AFR and density from the ethanol sensor', () => {
    // E10: AFR 14.7 × 0.9 + 9.0 × 0.1 = 14.13; density 745 × 0.9 + 789 × 0.1 = 749.4 g/L
    expect(fuelProperties('gasoline', 10)).toEqual({
      stoichAfr: expect.closeTo(14.13, 9),
      densityGPerL: expect.closeTo(749.4, 9),
    });
    expect(estimateFuelRate(input({ mafGps: 10, ethanolPct: 10 }), CAR)?.lph).toBeCloseTo(
      3.39975,
      4,
    );
    // Out-of-range sensor values are clamped to 0–100 %.
    expect(fuelProperties('e85', 150).stoichAfr).toBeCloseTo(9.0, 9);
    expect(fuelProperties('gasoline', -5).stoichAfr).toBeCloseTo(14.7, 9);
  });

  it('uses LPG properties regardless of the ethanol reading: AFR 15.5, 540 g/L', () => {
    const lpg = testVehicle({ fuelType: 'lpg' });
    // 10 / 15.5 × 3600 / 540
    expect(estimateFuelRate(input({ mafGps: 10, ethanolPct: 50 }), lpg)?.lph).toBeCloseTo(
      4.30108,
      4,
    );
  });

  it('falls back to speed-density from MAP, IAT and rpm', () => {
    // 50 kPa, 25 °C, 2000 rpm, 2.0 L, VE 0.85:
    // 50 000 Pa × 0.002 m³ × 0.85 × (2000/120) / (287.05 × 298.15 K) × 1000 = 16.553 g/s air
    expect(speedDensityAirGps(50, 25, 2000, 2.0, 0.85)).toBeCloseTo(16.55295, 4);
    const r = estimateFuelRate(input({ mapKpa: 50, intakeAirTempC: 25, rpm: 2000 }), CAR);
    expect(r?.source).toBe('speed-density');
    // 16.553 / 14.7 × 3600 / 745
    expect(r?.lph).toBeCloseTo(5.44132, 4);
  });

  it('scales speed-density with displacement and volumetric efficiency', () => {
    const big = testVehicle({ displacementL: 4.0, volumetricEfficiency: 0.85 });
    const small = testVehicle({ displacementL: 2.0, volumetricEfficiency: 0.85 });
    const i = input({ mapKpa: 50, intakeAirTempC: 25, rpm: 2000 });
    expect(estimateFuelRate(i, big)?.lph).toBeCloseTo(
      2 * (estimateFuelRate(i, small)?.lph ?? 0),
      9,
    );
  });

  it('needs rpm, MAP and IAT for speed-density', () => {
    expect(estimateFuelRate(input({ mapKpa: 50, intakeAirTempC: 25, rpm: null }), CAR)).toBeNull();
    expect(estimateFuelRate(input({ mapKpa: 50, intakeAirTempC: null }), CAR)).toBeNull();
    expect(estimateFuelRate(input({ mapKpa: 0, intakeAirTempC: 25 }), CAR)).toBeNull();
  });

  it('only trusts the PID on diesels (air mass does not determine diesel fuel)', () => {
    const diesel = testVehicle({ fuelType: 'diesel' });
    expect(
      estimateFuelRate(input({ mafGps: 30, mapKpa: 150, intakeAirTempC: 30 }), diesel),
    ).toBeNull();
    expect(estimateFuelRate(input({ fuelRateLph: 4.5, mafGps: 30 }), diesel)).toEqual({
      lph: 4.5,
      source: 'pid',
    });
  });

  it('reports 0 L/h with the engine stopped, whatever the source', () => {
    expect(estimateFuelRate(input({ rpm: 0, fuelRateLph: 0.4 }), CAR)).toEqual({
      lph: 0,
      source: 'pid',
    });
    expect(estimateFuelRate(input({ rpm: 0, mafGps: 1.2 }), CAR)).toEqual({
      lph: 0,
      source: 'maf',
    });
    expect(estimateFuelRate(input({ rpm: 0, mapKpa: 98, intakeAirTempC: 20 }), CAR)).toEqual({
      lph: 0,
      source: 'speed-density',
    });
  });

  it('skips invalid readings and returns null when nothing is usable', () => {
    expect(estimateFuelRate(input({ fuelRateLph: -1, mafGps: 10 }), CAR)?.source).toBe('maf');
    expect(
      estimateFuelRate(input({ fuelRateLph: Number.NaN, mafGps: Number.NaN }), CAR),
    ).toBeNull();
    expect(estimateFuelRate(input(), CAR)).toBeNull();
  });

  it('uses MAF without rpm', () => {
    expect(estimateFuelRate(input({ mafGps: 10, rpm: null }), CAR)?.lph).toBeCloseTo(3.28722, 4);
  });
});

describe('updateFuel — instantaneous consumption', () => {
  it('divides flow by speed', () => {
    const s = updateFuel(createFuelState(null), input({ speedKph: 60, fuelRateLph: 6 }), CAR);
    expect(s.readings).toMatchObject({ rateLph: 6, rateSource: 'pid', instantLPer100km: 10 });
  });

  it('is null when (nearly) stationary or without flow', () => {
    expect(
      updateFuel(createFuelState(null), input({ speedKph: 4, fuelRateLph: 1 }), CAR).readings
        .instantLPer100km,
    ).toBeNull();
    expect(
      updateFuel(createFuelState(null), input({ speedKph: null, fuelRateLph: 1 }), CAR).readings
        .instantLPer100km,
    ).toBeNull();
    expect(updateFuel(createFuelState(null), input({ speedKph: 60 }), CAR).readings).toMatchObject({
      rateLph: null,
      rateSource: null,
      instantLPer100km: null,
    });
  });

  it('caps absurd values', () => {
    const s = updateFuel(createFuelState(null), input({ speedKph: 5, fuelRateLph: 12 }), CAR);
    expect(s.readings.instantLPer100km).toBe(MAX_L_PER_100KM);
  });

  it('reads 0 during fuel cut-off', () => {
    const s = updateFuel(createFuelState(null), input({ speedKph: 80, fuelRateLph: 0 }), CAR);
    expect(s.readings.instantLPer100km).toBe(0);
  });
});

describe('updateFuel — rolling average', () => {
  it('has no average without a seed until a kilometre has been driven', () => {
    let s = cruise(createFuelState(null), T0, 0.9, 90, 7);
    expect(s.readings.averageLPer100km).toBeNull();
    s = cruise(s, T0 + 36_001, 0.2, 90, 7);
    expect(s.readings.averageLPer100km).toBeCloseTo(7, 6);
  });

  it('integrates trapezoidally from event timestamps', () => {
    // Accelerating 0 → 100 km/h over 10 s at 1 → 11 L/h: 0.1389 km, 0.01667 L.
    let s = createFuelState(null);
    s = drive(s, T0, 11, 1000, (i) => ({ speedKph: i * 10, fuelRateLph: 1 + i }));
    const km = s.buckets.reduce((a, b) => a + b.km, 0);
    const litres = s.buckets.reduce((a, b) => a + b.litres, 0);
    expect(km).toBeCloseTo((50 * 10) / 3600, 9);
    expect(litres).toBeCloseTo((6 * 10) / 3600, 9);
  });

  it('starts from the persisted seed so range works at startup', () => {
    const s = createFuelState(8);
    expect(s.readings.averageLPer100km).toBe(8);
    const withLevel = updateFuel(s, input({ fuelLevelPct: 50, speedKph: 0, rpm: 800 }), CAR);
    // 50 % of 50 L at 8 L/100 km
    expect(withLevel.readings.rangeKm).toBeCloseTo(312.5, 6);
  });

  it('lets the seed fade as real data covers the 20 km window', () => {
    let s = cruise(createFuelState(8), T0, 5, 100, 6);
    // (5 km × 6 + 15 km × 8) / 20 km
    expect(s.readings.averageLPer100km).toBeCloseTo(7.5, 2);
    s = cruise(s, T0 + 180_001, 16, 100, 6);
    expect(s.readings.averageLPer100km).toBeCloseTo(6, 6);
  });

  it('only remembers roughly the last 20 km', () => {
    let s = cruise(createFuelState(null), T0, 25, 100, 10);
    expect(s.readings.averageLPer100km).toBeCloseTo(10, 6);
    s = cruise(s, T0 + 901_000, 22, 100, 5);
    expect(s.readings.averageLPer100km).toBeCloseTo(5, 6);
    expect(s.buckets.length).toBeLessThanOrEqual(21);
  });

  it('counts idle fuel (fuel the remaining range will not have)', () => {
    let s = cruise(createFuelState(null), T0, 10, 100, 6);
    const moving = s.readings.averageLPer100km ?? 0;
    // Idle 10 minutes at 0.8 L/h: +0.133 L over the same 10 km.
    s = drive(s, T0 + 400_000, 601, 1000, () => ({ speedKph: 0, fuelRateLph: 0.8 }));
    expect(s.readings.averageLPer100km).toBeCloseTo(moving + (0.8 / 6) * 10, 1);
  });

  it('does not bridge gaps longer than 5 s', () => {
    let s = updateFuel(
      createFuelState(null),
      input({ at: T0, speedKph: 100, fuelRateLph: 7 }),
      CAR,
    );
    s = updateFuel(s, input({ at: T0 + 6000, speedKph: 100, fuelRateLph: 7 }), CAR);
    expect(s.buckets).toEqual([]);
    s = updateFuel(s, input({ at: T0 + 11_000, speedKph: 100, fuelRateLph: 7 }), CAR);
    expect(s.buckets[0]?.km).toBeCloseTo(100 * (5 / 3600), 9);
  });

  it('ignores out-of-order and duplicate timestamps for integration', () => {
    let s = updateFuel(
      createFuelState(null),
      input({ at: T0 + 1000, speedKph: 100, fuelRateLph: 7 }),
      CAR,
    );
    s = updateFuel(s, input({ at: T0, speedKph: 100, fuelRateLph: 7 }), CAR);
    s = updateFuel(s, input({ at: T0 + 1000, speedKph: 100, fuelRateLph: 7 }), CAR);
    expect(s.buckets).toEqual([]);
    expect(s.last?.at).toBe(T0 + 1000);
  });

  it('ignores a non-positive seed', () => {
    expect(createFuelState(0).readings.averageLPer100km).toBeNull();
    expect(createFuelState(Number.NaN).seedLPer100km).toBeNull();
  });
});

describe('updateFuel — tank level and range', () => {
  it('rejects slosh with a median and a slow average', () => {
    // ±8 % swings every sample around a true 40 % while cornering.
    const s = drive(createFuelState(7), T0, 600, 1000, (i) => ({
      speedKph: 60,
      fuelRateLph: 4,
      fuelLevelPct: 40 + (i % 3 === 0 ? 8 : i % 3 === 1 ? -8 : 0) + (i % 7 === 0 ? 15 : 0),
    }));
    expect(s.readings.levelPct).toBeGreaterThan(38.5);
    expect(s.readings.levelPct).toBeLessThan(41.5);
  });

  it('follows real consumption with a small lag', () => {
    // 50 % → 45 % over 20 minutes.
    const s = drive(createFuelState(7), T0, 1201, 1000, (i) => ({
      speedKph: 100,
      fuelRateLph: 7,
      fuelLevelPct: 50 - (5 * i) / 1200,
    }));
    expect(s.readings.levelPct).toBeGreaterThan(45);
    expect(s.readings.levelPct).toBeLessThan(45.5);
  });

  it('snaps to a refuel once a ≥ 10 % rise has held for 5 s while stationary', () => {
    let s = drive(createFuelState(7), T0, 120, 1000, () => ({
      speedKph: 50,
      fuelRateLph: 4,
      fuelLevelPct: 20,
    }));
    s = drive(s, T0 + 120_000, 4, 1000, () => ({
      speedKph: 0,
      rpm: 800,
      fuelRateLph: 0.8,
      fuelLevelPct: 75,
    }));
    expect(s.readings.levelPct).toBeLessThan(30);
    s = drive(s, T0 + 124_000, 2, 1000, () => ({
      speedKph: 0,
      rpm: 800,
      fuelRateLph: 0.8,
      fuelLevelPct: 75,
    }));
    expect(s.readings.levelPct).toBe(75);
  });

  it('treats a short surge when stopping as slosh, not a refuel', () => {
    let s = drive(createFuelState(7), T0, 120, 1000, () => ({
      speedKph: 50,
      fuelRateLph: 4,
      fuelLevelPct: 30,
    }));
    s = drive(s, T0 + 120_000, 3, 1000, () => ({
      speedKph: 0,
      rpm: 800,
      fuelRateLph: 0.8,
      fuelLevelPct: 45,
    }));
    s = drive(s, T0 + 123_000, 20, 1000, () => ({
      speedKph: 0,
      rpm: 800,
      fuelRateLph: 0.8,
      fuelLevelPct: 30,
    }));
    expect(s.readings.levelPct).toBeCloseTo(30, 0);
  });

  it('does not treat a jump while moving as a refuel', () => {
    let s = drive(createFuelState(7), T0, 120, 1000, () => ({
      speedKph: 50,
      fuelRateLph: 4,
      fuelLevelPct: 20,
    }));
    s = drive(s, T0 + 120_000, 20, 1000, () => ({
      speedKph: 50,
      fuelRateLph: 4,
      fuelLevelPct: 75,
    }));
    expect(s.readings.levelPct).toBeLessThan(40);
  });

  it('starts from the median of the first readings', () => {
    const s = drive(createFuelState(7), T0, 5, 1000, (i) => ({
      speedKph: 30,
      fuelLevelPct: [60, 62, 90, 61, 20][i],
    }));
    expect(s.readings.levelPct).toBe(61);
  });

  it('restarts smoothing after five minutes without readings', () => {
    let s = drive(createFuelState(7), T0, 60, 1000, () => ({ speedKph: 50, fuelLevelPct: 60 }));
    s = updateFuel(s, input({ at: T0 + 60_000 + 6 * 60_000, speedKph: 50, fuelLevelPct: 35 }), CAR);
    expect(s.readings.levelPct).toBe(35);
  });

  it('clamps readings to 0–100 %', () => {
    expect(
      updateFuel(createFuelState(7), input({ fuelLevelPct: 104 }), CAR).readings.levelPct,
    ).toBe(100);
    expect(updateFuel(createFuelState(7), input({ fuelLevelPct: -3 }), CAR).readings.levelPct).toBe(
      0,
    );
  });

  it('shows no level or range while the level reading is stale, then resumes smoothing', () => {
    let s = drive(createFuelState(7), T0, 60, 1000, () => ({ speedKph: 50, fuelLevelPct: 60 }));
    s = updateFuel(s, input({ at: T0 + 60_000, speedKph: 50 }), CAR);
    expect(s.readings.levelPct).toBeNull();
    expect(s.readings.rangeKm).toBeNull();
    s = updateFuel(s, input({ at: T0 + 61_000, speedKph: 50, fuelLevelPct: 59 }), CAR);
    expect(s.readings.levelPct).toBeGreaterThan(59.5);
  });

  it('computes range from level, tank size and average', () => {
    const s = drive(createFuelState(null), T0, 50, 1000, () => ({
      speedKph: 100,
      fuelRateLph: 8,
      fuelLevelPct: 40,
    }));
    expect(s.readings.averageLPer100km).toBeCloseTo(8, 9);
    // 40 % × 50 L / 8 L/100 km
    expect(s.readings.rangeKm).toBeCloseTo(250, 6);
  });

  it('has no range without an average', () => {
    const s = updateFuel(createFuelState(null), input({ fuelLevelPct: 40 }), CAR);
    expect(s.readings.levelPct).toBe(40);
    expect(s.readings.rangeKm).toBeNull();
  });
});

describe('fuel state', () => {
  it('is JSON-serialisable and deterministic', () => {
    const build = (s: FuelState): FuelState =>
      drive(s, T0, 300, 500, (i) => ({
        speedKph: 40 + (i % 20),
        mafGps: 8 + (i % 5),
        fuelLevelPct: 55 + (i % 4),
      }));
    const a = build(createFuelState(6.5));
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(build(createFuelState(6.5))).toEqual(a);
  });
});
