import { describe, expect, it } from 'vitest';
import type { TripConfig } from '../../src/types/config.ts';
import {
  createTripState,
  tripId,
  updateTrip,
  type TripInput,
  type TripPricing,
  type TripState,
} from '../../src/trip/trip.ts';

const T0 = 1_700_000_000_000;
const CONFIG: TripConfig = { endAfterEngineOffMs: 300_000, minDistanceKm: 0.2 };
const PRICING: TripPricing = { fuelPricePerL: 1.8, currency: 'EUR' };

function input(at: number, overrides: Partial<TripInput> = {}): TripInput {
  return {
    at,
    speedKph: 0,
    engineRunning: true,
    fuelRateLph: 0.8,
    odometerKm: null,
    linkUp: true,
    ...overrides,
  };
}

function feed(
  state: TripState,
  inputs: readonly TripInput[],
  config: TripConfig = CONFIG,
  pricing: TripPricing = PRICING,
): TripState {
  return inputs.reduce((s, i) => updateTrip(s, i, config, pricing), state);
}

/** One sample per second from `from` for `seconds` (inclusive of both ends). */
function seconds(
  from: number,
  count: number,
  build: (i: number) => Partial<TripInput>,
): TripInput[] {
  return Array.from({ length: count + 1 }, (_, i) => input(from + i * 1000, build(i)));
}

/** Engine off with ticks every 10 s for `ms`. */
function parked(from: number, ms: number, overrides: Partial<TripInput> = {}): TripInput[] {
  return Array.from({ length: Math.floor(ms / 10_000) + 1 }, (_, i) =>
    input(from + i * 10_000, { engineRunning: false, speedKph: 0, fuelRateLph: 0, ...overrides }),
  );
}

describe('trip start', () => {
  it('does nothing while parked with the engine off', () => {
    const initial = createTripState();
    const s = feed(initial, parked(T0, 60_000));
    expect(s).toBe(initial);
    expect(s.current).toBeNull();
  });

  it('starts when the engine starts', () => {
    const s = updateTrip(createTripState(), input(T0), CONFIG, PRICING);
    expect(s.current).toEqual({
      startedAt: T0,
      distanceKm: 0,
      durationS: 0,
      movingS: 0,
      fuelUsedL: null,
      avgLPer100km: null,
      cost: null,
      currency: 'EUR',
    });
  });

  it('starts when the vehicle moves, even with the engine off', () => {
    const s = updateTrip(
      createTripState(),
      input(T0, { engineRunning: false, speedKph: 12 }),
      CONFIG,
      PRICING,
    );
    expect(s.current?.startedAt).toBe(T0);
  });

  it('does not start while the OBD link is down', () => {
    const s = updateTrip(
      createTripState(),
      input(T0, { linkUp: false, speedKph: 50 }),
      CONFIG,
      PRICING,
    );
    expect(s.current).toBeNull();
  });
});

describe('trip accumulation', () => {
  it('integrates distance trapezoidally', () => {
    // 0 → 100 km/h in 10 s: mean 50 km/h for 10 s = 0.13889 km.
    const s = feed(
      createTripState(),
      seconds(T0, 10, (i) => ({ speedKph: i * 10 })),
    );
    expect(s.current?.distanceKm).toBeCloseTo(0.139, 3);
  });

  it('does not bridge gaps longer than 5 s', () => {
    const s = feed(createTripState(), [
      input(T0, { speedKph: 100 }),
      input(T0 + 1000, { speedKph: 100 }),
      input(T0 + 7000, { speedKph: 100 }), // 6 s gap: not integrated
      input(T0 + 8000, { speedKph: 100 }),
    ]);
    expect(s.current?.distanceKm).toBeCloseTo((2 * 100) / 3600, 3);
    expect(s.current?.movingS).toBe(2);
    expect(s.current?.durationS).toBe(8);
  });

  it('splits moving and idle time; engine-off stops count only towards duration', () => {
    const s = feed(createTripState(), [
      ...seconds(T0, 60, () => ({ speedKph: 0 })), // idle 60 s
      ...seconds(T0 + 61_000, 120, () => ({ speedKph: 50, fuelRateLph: 4 })), // drive 120 s (+1 s ramp)
      ...parked(T0 + 182_000, 120_000), // engine off 2 min
      ...seconds(T0 + 312_000, 30, () => ({ speedKph: 50, fuelRateLph: 4 })), // drive on
    ]);
    // 120 s + 30 s, plus the 1 s segments pulling away (0 → 50) and stopping (50 → 0); the
    // 10 s gap between the last engine-off tick and driving on is not bridged.
    expect(s.current?.movingS).toBe(152);
    expect(s.current?.durationS).toBe(342);
    expect(s.active?.idleMs).toBe(60_000);
  });

  it('integrates fuel, and derives economy and cost', () => {
    // 36 s at 100 km/h = 1 km, at 6 L/h = 0.06 L → 6 L/100 km, 0.108 EUR.
    const s = feed(
      createTripState(),
      seconds(T0, 36, () => ({ speedKph: 100, fuelRateLph: 6 })),
    );
    expect(s.current).toMatchObject({
      distanceKm: 1,
      fuelUsedL: 0.06,
      avgLPer100km: 6,
      cost: 0.11,
    });
  });

  it('reports unknown fuel, economy and cost when the vehicle gives no fuel rate', () => {
    const s = feed(
      createTripState(),
      seconds(T0, 60, () => ({ speedKph: 80, fuelRateLph: null })),
    );
    expect(s.current).toMatchObject({ fuelUsedL: null, avgLPer100km: null, cost: null });
    expect(s.current?.distanceKm).toBeGreaterThan(1);
  });

  it('bases economy on the distance where fuel flow was known', () => {
    const s = feed(createTripState(), [
      ...seconds(T0, 36, () => ({ speedKph: 100, fuelRateLph: null })),
      ...seconds(T0 + 37_000, 36, () => ({ speedKph: 100, fuelRateLph: 5 })),
    ]);
    expect(s.current?.avgLPer100km).toBeCloseTo(5, 6);
  });

  it('has no economy until 100 m have been covered', () => {
    const s = feed(
      createTripState(),
      seconds(T0, 3, () => ({ speedKph: 50, fuelRateLph: 3 })),
    );
    expect(s.current?.avgLPer100km).toBeNull();
    expect(s.current?.fuelUsedL).not.toBeNull();
  });

  it('ignores invalid numbers and out-of-order samples', () => {
    let s = feed(
      createTripState(),
      seconds(T0, 10, () => ({ speedKph: 36, fuelRateLph: 2 })),
    );
    const before = s.current;
    s = feed(s, [
      input(T0 + 5000, { speedKph: 200 }), // out of order
      input(T0 + 11_000, { speedKph: Number.NaN, fuelRateLph: -3, odometerKm: Number.NaN }),
    ]);
    expect(s.current?.distanceKm).toBe(before?.distanceKm);
    expect(s.active?.maxSpeedKph).toBe(36);
    expect(s.active?.fuelL).toBeCloseTo((2 * 10) / 3600, 9);
  });
});

describe('trip end', () => {
  function drivenTrip(): TripInput[] {
    // Idle 30 s, drive 6 minutes at 100 km/h (10 km) at 7 L/h, then park.
    return [
      ...seconds(T0, 30, () => ({ speedKph: 0, fuelRateLph: 0.8, odometerKm: 12_345.6 })),
      ...seconds(T0 + 31_000, 360, (i) => ({
        speedKph: i === 0 ? 50 : i === 360 ? 0 : 100,
        fuelRateLph: 7,
        odometerKm: 12_345.6 + Math.floor(i / 36) * 1,
      })),
    ];
  }

  it('ends after endAfterEngineOffMs of engine-off, timed from the last activity', () => {
    const lastActive = T0 + 391_000;
    let s = feed(createTripState(), drivenTrip());
    s = feed(s, parked(lastActive + 10_000, 280_000)); // up to +290 s: still open
    expect(s.current).not.toBeNull();
    expect(s.completedCount).toBe(0);
    s = feed(s, [
      input(lastActive + 300_000, { engineRunning: false, speedKph: 0, fuelRateLph: 0 }),
    ]);
    expect(s.current).toBeNull();
    expect(s.active).toBeNull();
    expect(s.completedCount).toBe(1);
    // Distance: 0→50 (1 s), 50→100 (1 s), 358 s at 100, 100→0 (1 s) = 35 950 km·s/h.
    const km = (25 + 75 + 358 * 100 + 50) / 3600;
    // Fuel: 30 s idle at 0.8 L/h, 1 s ramp at 3.9 L/h, 360 s at 7 L/h.
    const litres = (30 * 0.8 + 3.9 + 360 * 7) / 3600;
    expect(s.lastCompleted).toEqual({
      id: tripId(T0),
      startedAt: T0,
      endedAt: lastActive,
      distanceKm: 9.986,
      durationS: 391,
      movingS: 361,
      idleS: 30,
      fuelUsedL: 0.708,
      avgLPer100km: Math.round((litres / km) * 10_000) / 100,
      maxSpeedKph: 100,
      avgMovingSpeedKph: Math.round((km / (361 / 3600)) * 10) / 10,
      cost: 1.27,
      currency: 'EUR',
      startOdometerKm: 12_345.6,
      endOdometerKm: 12_355.6,
    });
  });

  it('treats a lost OBD link like engine-off', () => {
    let s = feed(createTripState(), drivenTrip());
    s = feed(
      s,
      parked(T0 + 400_000, 300_000, { linkUp: false, engineRunning: true, speedKph: null }),
    );
    expect(s.completedCount).toBe(1);
    expect(s.lastCompleted?.endedAt).toBe(T0 + 391_000);
  });

  it('continues the same trip when the engine restarts within the timeout', () => {
    let s = feed(createTripState(), drivenTrip());
    s = feed(s, parked(T0 + 400_000, 200_000));
    s = feed(
      s,
      seconds(T0 + 610_000, 60, () => ({ speedKph: 60, fuelRateLph: 5 })),
    );
    expect(s.completedCount).toBe(0);
    expect(s.current?.startedAt).toBe(T0);
    expect(s.current?.durationS).toBe(670);
  });

  it('discards trips shorter than minDistanceKm', () => {
    let s = feed(
      createTripState(),
      seconds(T0, 120, () => ({ speedKph: 0 })),
    ); // warm-up idle only
    s = feed(s, parked(T0 + 121_000, 400_000));
    expect(s.current).toBeNull();
    expect(s.active).toBeNull();
    expect(s.completedCount).toBe(0);
    expect(s.lastCompleted).toBeNull();
  });

  it('keeps every trip when minDistanceKm is 0', () => {
    let s = feed(
      createTripState(),
      seconds(T0, 10, () => ({ speedKph: 0 })),
      { ...CONFIG, minDistanceKm: 0 },
    );
    s = feed(s, parked(T0 + 11_000, 300_000), { ...CONFIG, minDistanceKm: 0 });
    expect(s.completedCount).toBe(1);
    expect(s.lastCompleted?.distanceKm).toBe(0);
    expect(s.lastCompleted?.avgMovingSpeedKph).toBe(0);
  });

  it('ends at the first inactive sample when endAfterEngineOffMs is 0', () => {
    const config = { ...CONFIG, endAfterEngineOffMs: 0 };
    let s = feed(createTripState(), drivenTrip(), config);
    // Active samples a few seconds apart do not end it …
    s = feed(s, [input(T0 + 393_000, { speedKph: 5 })], config);
    expect(s.completedCount).toBe(0);
    s = feed(s, parked(T0 + 394_000, 0), config);
    expect(s.completedCount).toBe(1);
    expect(s.lastCompleted?.endedAt).toBe(T0 + 393_000);
  });

  it('closes a stale trip and starts a new one when activity resumes after a long silence', () => {
    let s = feed(createTripState(), drivenTrip());
    const resumeAt = T0 + 391_000 + 600_000; // no events at all for 10 minutes
    s = updateTrip(s, input(resumeAt, { speedKph: 20 }), CONFIG, PRICING);
    expect(s.completedCount).toBe(1);
    expect(s.lastCompleted?.endedAt).toBe(T0 + 391_000);
    expect(s.current?.startedAt).toBe(resumeAt);
  });

  it('keeps the last completed trip while the next one runs, and replaces it on completion', () => {
    let s = feed(createTripState(), drivenTrip());
    s = feed(s, parked(T0 + 400_000, 300_000));
    const first = s.lastCompleted;
    const secondStart = T0 + 1_000_000;
    s = feed(
      s,
      seconds(secondStart, 60, () => ({ speedKph: 60, fuelRateLph: 5 })),
    );
    expect(s.lastCompleted).toBe(first);
    s = feed(s, parked(secondStart + 61_000, 300_000));
    expect(s.completedCount).toBe(2);
    expect(s.lastCompleted?.id).toBe(tripId(secondStart));
  });

  it('extrapolates start and end odometer from late / early readings', () => {
    let s = feed(createTripState(), [
      ...seconds(T0, 36, () => ({ speedKph: 100, fuelRateLph: 6 })), // 1 km without odometer
      ...seconds(T0 + 37_000, 36, (i) => ({
        speedKph: 100,
        fuelRateLph: 6,
        odometerKm: i < 18 ? 5001 : null,
      })),
    ]);
    s = feed(s, parked(T0 + 74_000, 300_000));
    const trip = s.lastCompleted;
    expect(trip?.startOdometerKm).toBeCloseTo(5000, 0);
    expect(trip?.endOdometerKm).toBeCloseTo(5001.5, 0);
  });

  it('has null odometers when none was ever read', () => {
    let s = feed(
      createTripState(),
      seconds(T0, 36, () => ({ speedKph: 100 })),
    );
    s = feed(s, parked(T0 + 37_000, 300_000));
    expect(s.lastCompleted).toMatchObject({ startOdometerKm: null, endOdometerKm: null });
  });

  it('uses the pricing at the time the trip ends', () => {
    let s = feed(
      createTripState(),
      seconds(T0, 36, () => ({ speedKph: 100, fuelRateLph: 10 })),
    );
    s = feed(s, parked(T0 + 37_000, 300_000), CONFIG, { fuelPricePerL: 2, currency: 'GBP' });
    // 36 s at 10 L/h plus the 1 s stop at 5 L/h = 0.10139 L.
    expect(s.lastCompleted).toMatchObject({ fuelUsedL: 0.101, cost: 0.2, currency: 'GBP' });
  });

  it('gives unknown cost for an invalid price', () => {
    const s = feed(
      createTripState(),
      seconds(T0, 36, () => ({ speedKph: 100, fuelRateLph: 10 })),
      CONFIG,
      {
        fuelPricePerL: Number.NaN,
        currency: 'EUR',
      },
    );
    expect(s.current?.cost).toBeNull();
  });
});

describe('trip ids and state', () => {
  it('derives ids deterministically from the start time', () => {
    expect(tripId(T0)).toBe(`trip-${T0.toString(36)}`);
    expect(tripId(T0 + 0.7)).toBe(tripId(T0));
  });

  it('is JSON-serialisable and deterministic', () => {
    const inputs = [
      ...seconds(T0, 100, (i) => ({
        speedKph: (i * 7) % 90,
        fuelRateLph: 3 + (i % 4),
        odometerKm: 100,
      })),
      ...parked(T0 + 101_000, 300_000),
    ];
    const a = feed(createTripState(), inputs);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(feed(createTripState(), inputs)).toEqual(a);
    const mid = feed(createTripState(), inputs.slice(0, 50));
    const revived = JSON.parse(JSON.stringify(mid)) as TripState;
    expect(feed(revived, inputs.slice(50))).toEqual(a);
  });
});
