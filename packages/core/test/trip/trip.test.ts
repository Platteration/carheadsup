import { describe, expect, it } from 'vitest';
import type { TripConfig } from '../../src/types/config.ts';
import {
  RESUME_CONFIRM_MS,
  createTripState,
  reconcileResumedTrip,
  restoreActiveTrip,
  resumeTripState,
  shiftActiveTrip,
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
      id: tripId(1, T0),
      seq: 1,
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
    expect(s.lastCompleted).toMatchObject({ id: tripId(2, secondStart), seq: 2 });
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

describe('trip sequence numbers', () => {
  const trip = (from: number): TripInput[] => [
    ...seconds(from, 60, () => ({ speedKph: 60 })),
    ...parked(from + 61_000, 300_000),
  ];

  it('numbers completed trips on from the last one, and ids follow', () => {
    let s = feed(createTripState(41), trip(T0));
    expect(s.lastCompleted).toMatchObject({ seq: 42, id: tripId(42, T0) });
    s = feed(s, trip(T0 + 400_000));
    expect(s.lastCompleted).toMatchObject({ seq: 43, id: tripId(43, T0 + 400_000) });
    expect(s.lastSeq).toBe(43);
  });

  it('gives two trips that start at the same clock time different ids', () => {
    // A clock restored to the same time at every boot: the second "drive" starts at T0 again.
    const first = feed(createTripState(), trip(T0));
    const second = feed(createTripState(first.lastSeq), trip(T0));
    expect(second.lastCompleted?.id).not.toBe(first.lastCompleted?.id);
  });

  it('gives every trip its number when it starts, so a discarded one leaves a gap', () => {
    let s = feed(
      createTripState(3),
      seconds(T0, 5, () => ({ speedKph: 0 })),
    );
    expect(s.active?.seq).toBe(4);
    expect(s.lastSeq).toBe(4);
    s = feed(s, parked(T0 + 6_000, 300_000));
    expect(s.completedCount).toBe(0);
    s = feed(s, trip(T0 + 400_000));
    expect(s.lastCompleted?.seq).toBe(5);
  });

  it('gives a trip completed again after a lost write the same number and id', () => {
    // The trip is saved while driving, completes, and the power goes before the state that
    // follows its completion is written: the next start completes the saved copy once more.
    const driving = feed(
      createTripState(9),
      seconds(T0, 120, () => ({ speedKph: 60 })),
    );
    const saved = restoreActiveTrip(JSON.parse(JSON.stringify(driving.active)));
    if (saved === null) throw new Error('not restored');
    const completed = feed(driving, parked(T0 + 121_000, 300_000)).lastCompleted;
    const again = updateTrip(
      resumeTripState(saved, PRICING, T0 + 7_200_000, 0, { lastSeq: 9 }),
      input(T0 + 7_200_000, { linkUp: false }),
      CONFIG,
      PRICING,
    ).lastCompleted;
    expect(completed?.seq).toBe(10);
    expect(again?.id).toBe(completed?.id);
  });

  it('numbers a trip saved before numbers existed when it ends', () => {
    const driving = feed(
      createTripState(),
      seconds(T0, 120, () => ({ speedKph: 60 })),
    );
    const legacy: unknown = { ...JSON.parse(JSON.stringify(driving.active)), seq: undefined };
    const saved = restoreActiveTrip(JSON.parse(JSON.stringify(legacy)));
    expect(saved?.seq).toBe(0);
    if (saved === null) throw new Error('not restored');
    const ended = updateTrip(
      resumeTripState(saved, PRICING, T0 + 7_200_000, 0, { lastSeq: 4 }),
      input(T0 + 7_200_000, { linkUp: false }),
      CONFIG,
      PRICING,
    );
    expect(ended.lastCompleted?.seq).toBe(5);
    expect(ended.lastSeq).toBe(5);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'starts from 0 with an invalid last number (%s)',
    (lastSeq) => {
      expect(createTripState(lastSeq).lastSeq).toBe(0);
    },
  );
});

describe('trip ids and state', () => {
  it('derives ids deterministically from the sequence number and the start time', () => {
    expect(tripId(1, T0)).toBe(`trip-1-${T0.toString(36)}`);
    expect(tripId(36, T0)).toBe(`trip-10-${T0.toString(36)}`);
    expect(tripId(1, T0 + 0.7)).toBe(tripId(1, T0));
    // The same start (a clock that restores the same time at every boot): still distinct.
    expect(tripId(2, T0)).not.toBe(tripId(1, T0));
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

describe('trips across a restart', () => {
  const drive = (): TripState =>
    feed(createTripState(), [
      ...seconds(T0, 600, (i) => ({ speedKph: i < 5 ? 0 : 60, fuelRateLph: 4, odometerKm: 900 })),
      ...parked(T0 + 601_000, 20_000, { linkUp: false }),
    ]);

  it('round-trips a trip in progress through JSON', () => {
    const active = drive().active;
    expect(active).not.toBeNull();
    const restored = restoreActiveTrip(JSON.parse(JSON.stringify(active)));
    expect(restored).toEqual(active);
    expect(restored).not.toBe(active);
  });

  it('completes the resumed trip on the first update after a long power-down', () => {
    const before = drive();
    const active = restoreActiveTrip(JSON.parse(JSON.stringify(before.active)));
    if (active === null) throw new Error('not restored');
    const resumed = resumeTripState(active, PRICING, T0 + 7_200_000);
    expect(resumed.current).toEqual(before.current);
    expect(resumed.endPending).toBe(false);
    const after = updateTrip(resumed, input(T0 + 7_200_000, { linkUp: false }), CONFIG, PRICING);
    expect(after.active).toBeNull();
    expect(after.completedCount).toBe(1);
    expect(after.lastCompleted).toMatchObject({
      id: tripId(1, T0),
      endedAt: T0 + 600_000,
      distanceKm: expect.closeTo(9.93, 2) as unknown,
    });
  });

  it('continues the same trip after a short power blip', () => {
    const before = drive();
    const active = restoreActiveTrip(before.active);
    if (active === null) throw new Error('not restored');
    const after = feed(resumeTripState(active, PRICING, T0 + 700_000), [
      ...seconds(T0 + 700_000, 60, () => ({ speedKph: 60, odometerKm: 910 })),
      ...parked(T0 + 761_000, 400_000),
    ]);
    expect(after.completedCount).toBe(1);
    expect(after.lastCompleted?.id).toBe(tripId(1, T0));
    expect(after.lastCompleted?.distanceKm).toBeGreaterThan(10.9);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'trip'],
    ['an empty object', {}],
    ['a negative distance', { distanceKm: -1 }],
    ['a NaN duration', { movingMs: Number.NaN }],
    ['activity before the start', { lastActivityAt: T0 - 1 }],
    ['a last sample before the last activity', { last: { at: T0 } }],
    ['a broken odometer', { odometer: { firstKm: 1 } }],
    ['a non-boolean flag', { fuelKnown: 'yes' }],
  ])('rejects %s', (_, patch) => {
    const active = drive().active;
    const value =
      patch === null || typeof patch !== 'object' || Object.keys(patch).length === 0
        ? patch
        : {
            ...active,
            ...patch,
            last: { ...active?.last, ...(patch as { last?: object }).last },
          };
    expect(restoreActiveTrip(value)).toBeNull();
  });

  it('completes, rather than drops or continues, a trip saved "in the future" of the start-up', () => {
    // An unclean power cut on a Pi without a real-time clock: it boots with an older time than
    // the one the trip was saved with, so how long the car was off is unknown.
    const before = drive();
    const active = restoreActiveTrip(JSON.parse(JSON.stringify(before.active)));
    if (active === null) throw new Error('not restored');
    const boot = T0 + 300_000; // before the trip's last sample (T0 + 621 s)
    const resumed = resumeTripState(active, PRICING, boot);
    expect(resumed.endPending).toBe(true);
    expect(resumed.current).toEqual(before.current);
    // Even a sample of the next drive right away: the old trip ends first, a new one starts.
    const after = updateTrip(resumed, input(boot + 1000, { speedKph: 30 }), CONFIG, PRICING);
    expect(after.completedCount).toBe(1);
    expect(after.endPending).toBe(false);
    expect(after.lastCompleted).toMatchObject({
      id: tripId(1, T0),
      startedAt: T0,
      endedAt: T0 + 600_000,
      distanceKm: expect.closeTo(9.93, 2) as unknown,
    });
    expect(after.active?.startedAt).toBe(boot + 1000);
  });

  describe('network time after a resumed trip (a start-up clock that was behind)', () => {
    const DAY = 24 * 3_600_000;

    /** Resumed 81 s after the last activity by the start-up clock, then 2 minutes of driving. */
    function resumedAndDriving(): { state: TripState; boot: number } {
      const active = restoreActiveTrip(JSON.parse(JSON.stringify(drive().active)));
      if (active === null) throw new Error('not restored');
      const boot = T0 + 681_000;
      const state = feed(resumeTripState(active, PRICING, boot), [
        ...parked(boot, 10_000, { linkUp: false }),
        ...seconds(boot + 20_000, 120, () => ({ speedKph: 60, fuelRateLph: 4, odometerKm: 911 })),
      ]);
      expect(state.completedCount).toBe(0);
      expect(state.current?.distanceKm).toBeCloseTo(11.93, 1);
      expect(state.resumed?.sinceResume?.startedAt).toBe(boot + 20_000);
      return { state, boot };
    }

    it('completes the trip from before the restart, with its saved times, and goes on with the rest', () => {
      const { state, boot } = resumedAndDriving();
      const split = reconcileResumedTrip(state, DAY, CONFIG, PRICING);
      expect(split.completedCount).toBe(1);
      expect(split.lastCompleted).toMatchObject({
        id: tripId(1, T0),
        startedAt: T0,
        endedAt: T0 + 600_000,
        distanceKm: expect.closeTo(9.93, 2) as unknown,
        startOdometerKm: 900,
      });
      expect(split.resumed).toBeNull();
      expect(split.active).toMatchObject({
        startedAt: boot + 20_000,
        distanceKm: expect.closeTo(2, 1) as unknown,
      });
      expect(split.current).toMatchObject({
        startedAt: boot + 20_000 + DAY,
        distanceKm: expect.closeTo(2, 1) as unknown,
      });
      // The new trip goes on and ends on its own, with wall-clock times.
      const ended = feed(split, [
        ...seconds(boot + 141_000, 10, () => ({ speedKph: 60, wallOffsetMs: DAY })),
        ...parked(boot + 152_000, 300_000, { wallOffsetMs: DAY }),
      ]);
      expect(ended.completedCount).toBe(2);
      expect(ended.lastCompleted).toMatchObject({
        id: tripId(2, boot + 20_000 + DAY),
        startedAt: boot + 20_000 + DAY,
        endedAt: boot + 151_000 + DAY,
        distanceKm: expect.closeTo(2.17, 1) as unknown,
      });
    });

    it('splits before any driving since the start-up too', () => {
      const active = restoreActiveTrip(JSON.parse(JSON.stringify(drive().active)));
      if (active === null) throw new Error('not restored');
      const resumed = resumeTripState(active, PRICING, T0 + 681_000);
      const split = reconcileResumedTrip(resumed, 3_600_000, CONFIG, PRICING);
      expect(split.completedCount).toBe(1);
      expect(split.lastCompleted?.id).toBe(tripId(1, T0));
      expect(split.active).toBeNull();
      expect(split.current).toBeNull();
    });

    it('keeps the trip together when the break was short after all, or the clock was ahead', () => {
      const { state } = resumedAndDriving();
      // 81 s + 2 min is still shorter than the 5 minutes that end a trip.
      expect(reconcileResumedTrip(state, 120_000, CONFIG, PRICING)).toBe(state);
      expect(reconcileResumedTrip(state, -3_600_000, CONFIG, PRICING)).toBe(state);
      expect(reconcileResumedTrip(state, Number.NaN, CONFIG, PRICING)).toBe(state);
    });

    it('forgets where the trip was resumed once it ends', () => {
      const { state, boot } = resumedAndDriving();
      const ended = feed(state, parked(boot + 141_000, 300_000));
      expect(ended.completedCount).toBe(1);
      expect(ended.resumed).toBeNull();
      expect(reconcileResumedTrip(ended, DAY, CONFIG, PRICING)).toBe(ended);
    });

    it('does not keep one for a trip that is completed at once', () => {
      const active = restoreActiveTrip(JSON.parse(JSON.stringify(drive().active)));
      if (active === null) throw new Error('not restored');
      expect(resumeTripState(active, PRICING, T0 + 300_000).resumed).toBeNull();
      expect(createTripState().resumed).toBeNull();
    });
  });

  describe('resumed with an untrusted clock (it went back; the HUD started from its saved time)', () => {
    /** Resumed 81 s after the last activity by the start-up clock, then 2 minutes of driving. */
    function provisional(): { state: TripState; boot: number } {
      const active = restoreActiveTrip(JSON.parse(JSON.stringify(drive().active)));
      if (active === null) throw new Error('not restored');
      const boot = T0 + 681_000;
      const resumed = resumeTripState(active, PRICING, boot, 0, {
        clockTrusted: false,
        lastSeq: 7,
      });
      expect(resumed.resumed?.confirmBy).toBe(boot + RESUME_CONFIRM_MS);
      const state = feed(resumed, [
        ...parked(boot, 10_000, { linkUp: false }),
        ...seconds(boot + 20_000, 120, () => ({ speedKph: 60, fuelRateLph: 4, odometerKm: 911 })),
      ]);
      expect(state.completedCount).toBe(0);
      expect(state.current?.distanceKm).toBeCloseTo(11.93, 1);
      return { state, boot };
    }

    it('splits it at the restart when the real time does not come in time', () => {
      const { state, boot } = provisional();
      const before = updateTrip(
        state,
        input(boot + RESUME_CONFIRM_MS - 1, { speedKph: 60 }),
        CONFIG,
        PRICING,
      );
      expect(before.completedCount).toBe(0);
      const split = updateTrip(
        before,
        input(boot + RESUME_CONFIRM_MS, { speedKph: 60 }),
        CONFIG,
        PRICING,
      );
      expect(split.completedCount).toBe(1);
      expect(split.lastCompleted).toMatchObject({
        id: tripId(1, T0),
        seq: 1, // its own number, taken when it started
        startedAt: T0,
        endedAt: T0 + 600_000,
        distanceKm: expect.closeTo(9.93, 2) as unknown,
      });
      expect(split.resumed).toBeNull();
      // Today's drive goes on as a trip of its own, numbered after the last one given.
      expect(split.active).toMatchObject({ seq: 8, startedAt: boot + 20_000 });
      expect(split.lastSeq).toBe(8);
      expect(split.current?.distanceKm).toBeCloseTo(2, 1);
    });

    it('splits a trip nothing was driven after too', () => {
      const active = restoreActiveTrip(JSON.parse(JSON.stringify(drive().active)));
      if (active === null) throw new Error('not restored');
      const boot = T0 + 681_000;
      const resumed = resumeTripState(active, PRICING, boot, 0, { clockTrusted: false });
      const after = feed(resumed, parked(boot, RESUME_CONFIRM_MS, { linkUp: false }));
      expect(after.completedCount).toBe(1);
      expect(after.active).toBeNull();
      expect(after.current).toBeNull();
    });

    it('keeps it as one when the real time shows a short break', () => {
      const { state, boot } = provisional();
      // The phone's time: the start-up clock was right after all (81 s + 2 min of break < 5 min).
      expect(reconcileResumedTrip(state, 0, CONFIG, PRICING, false)).toBe(state);
      const confirmed = reconcileResumedTrip(state, 120_000, CONFIG, PRICING, true);
      expect(confirmed.resumed?.confirmBy).toBeNull();
      expect(confirmed.active).toBe(state.active);
      const later = feed(
        confirmed,
        seconds(boot + RESUME_CONFIRM_MS, 10, () => ({ speedKph: 60, wallOffsetMs: 120_000 })),
      );
      expect(later.completedCount).toBe(0);
      expect(later.current?.startedAt).toBe(T0 + 120_000);
    });

    it('splits it at once when the real time shows a long break', () => {
      const { state, boot } = provisional();
      const split = reconcileResumedTrip(state, 3_600_000, CONFIG, PRICING, true);
      expect(split.completedCount).toBe(1);
      expect(split.lastCompleted).toMatchObject({ seq: 1, startedAt: T0, endedAt: T0 + 600_000 });
      expect(split.active?.startedAt).toBe(boot + 20_000);
    });
  });

  it('shifts every time of a trip by an offset, and back', () => {
    const active = drive().active;
    if (active === null) throw new Error('no trip');
    const shifted = shiftActiveTrip(active, 5000);
    expect(shifted).toMatchObject({
      startedAt: active.startedAt + 5000,
      lastActivityAt: active.lastActivityAt + 5000,
      last: { at: active.last.at + 5000 },
      distanceKm: active.distanceKm,
    });
    expect(shiftActiveTrip(shifted, -5000)).toEqual(active);
    expect(shiftActiveTrip(active, 0)).toBe(active);
  });
});

describe('trip times and the wall clock', () => {
  const HOUR = 3_600_000;

  it('measures durations in engine time and stamps records with wall-clock times', () => {
    // Engine time starts at T0; network time then shows the wall clock was 3 hours behind.
    let s = feed(
      createTripState(),
      seconds(T0, 300, (i) => ({ speedKph: i < 5 ? 0 : 50, fuelRateLph: 3, odometerKm: 500 })),
    );
    expect(s.current?.startedAt).toBe(T0);
    const offset = 3 * HOUR;
    s = feed(
      s,
      seconds(T0 + 301_000, 300, () => ({ speedKph: 50, fuelRateLph: 3, wallOffsetMs: offset })),
    );
    // The trip goes on, not split by the step, its start moved to the corrected wall clock.
    expect(s.completedCount).toBe(0);
    expect(s.current).toMatchObject({ startedAt: T0 + offset, durationS: 601 });
    s = feed(s, parked(T0 + 602_000, 300_000, { wallOffsetMs: offset }));
    expect(s.completedCount).toBe(1);
    expect(s.lastCompleted).toMatchObject({
      id: tripId(1, T0 + offset),
      startedAt: T0 + offset,
      endedAt: T0 + 601_000 + offset,
      durationS: 601,
    });
  });
});
