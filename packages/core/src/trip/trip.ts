import type { TripConfig } from '../types/config.ts';
import type { TripRecord, TripSummary } from '../types/records.ts';

export { tripsToCsv, TRIP_CSV_COLUMNS } from './csv.ts';

export interface TripInput {
  at: number;
  speedKph: number | null;
  engineRunning: boolean;
  /** Current fuel flow from `FuelReadings.rateLph`. */
  fuelRateLph: number | null;
  odometerKm: number | null;
  /** OBD link up; a lost link counts like engine-off for ending trips. */
  linkUp: boolean;
  /**
   * Wall clock − engine time (`ClockState.wallOffsetMs`): `at` and the trip's own times are
   * engine time; summaries and records carry wall-clock times. Default 0.
   */
  wallOffsetMs?: number;
}

export interface TripPricing {
  fuelPricePerL: number;
  currency: string;
}

/**
 * Accumulators of the trip in progress (unrounded; rounding happens in summaries/records). Its
 * times are engine time in `TripState`, and wall-clock time when persisted (`shiftActiveTrip`).
 */
export interface ActiveTrip {
  startedAt: number;
  /** Last sample with the engine running or the vehicle moving (and the link up). */
  lastActivityAt: number;
  distanceKm: number;
  movingMs: number;
  idleMs: number;
  /** Fuel integrated over segments where the fuel rate was known. */
  fuelL: number;
  /** Distance covered during those segments (denominator of the trip's economy). */
  fuelDistanceKm: number;
  fuelKnown: boolean;
  maxSpeedKph: number;
  /** First/last odometer readings and the integrated distance when each was seen. */
  odometer: {
    firstKm: number;
    distanceAtFirst: number;
    lastKm: number;
    distanceAtLast: number;
  } | null;
  /** Previous sample, for trapezoidal integration. */
  last: {
    at: number;
    speedKph: number | null;
    fuelRateLph: number | null;
    engineRunning: boolean;
    linkUp: boolean;
  };
}

/** Trip state. Implementations add private accumulator fields. */
export interface TripState {
  /** Live summary of the trip in progress, or null when no trip is active. */
  current: TripSummary | null;
  /** Most recently completed trip (kept after it ends so the server can persist/sync it). */
  lastCompleted: TripRecord | null;
  /** Increments every time a trip completes — the server persists when this changes. */
  completedCount: number;
  active: ActiveTrip | null;
  /**
   * `active` was carried over a restart across which the clock went back (see
   * `resumeTripState`): the next update completes it.
   */
  endPending: boolean;
  /**
   * `active` continues a trip from before the restart (see `resumeTripState`): what a later
   * `clock/sync` needs to split it again if the start-up clock turns out to have been behind
   * (`reconcileResumedTrip`). Null otherwise, and once the trip ends.
   */
  resumed: ResumedTrip | null;
}

/** A trip continued across a restart, as `TripState.resumed` keeps it. */
export interface ResumedTrip {
  /** The trip as restored at start-up (engine time). */
  restored: ActiveTrip;
  /** Engine time of the start-up. */
  resumedAt: number;
  /** Wall clock − engine time at the start-up: `restored` + this are the times as saved. */
  wallOffsetMs: number;
  /**
   * What was driven since the start-up, as a trip of its own: integrated alongside `active`
   * from the first activity after the start-up on (null before).
   */
  sinceResume: ActiveTrip | null;
}

/** At or above this speed the vehicle is moving; below it with the engine running it is idling. */
export const TRIP_MOVING_KPH = 1;
/** Consecutive samples further apart than this are not integrated across. */
export const TRIP_MAX_GAP_MS = 5000;
/** Economy needs at least this much distance with known fuel flow. */
const MIN_ECONOMY_DISTANCE_KM = 0.1;

const round = (v: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};
/** A finite, non-negative reading, or null (invalid readings count as unknown). */
const reading = (v: number | null): number | null =>
  v !== null && Number.isFinite(v) && v >= 0 ? v : null;

export function createTripState(): TripState {
  return {
    current: null,
    lastCompleted: null,
    completedCount: 0,
    active: null,
    endPending: false,
    resumed: null,
  };
}

/**
 * Trip state that carries on with a trip persisted before a restart (see `restoreActiveTrip`),
 * its times already converted to engine time (`shiftActiveTrip`); `now` is the start-up time.
 * The first update afterwards ends it — with its last activity as the end time — when the
 * restart came after `endAfterEngineOffMs` (the usual ignition-off power-down), and continues
 * it after a shorter power blip.
 *
 * A trip whose last sample lies after `now` was saved by a clock that ran ahead of this start's
 * one — typically a Pi without a real-time clock that lost power uncleanly and restored an older
 * time. How long the car was off cannot be known then, so the first update completes the trip
 * (it is neither dropped nor merged with the next drive).
 *
 * The start-up clock can also be behind without showing it: a Pi without a real-time clock boots
 * with the time it saved at shutdown, so every break looks short and the trip is continued. The
 * trip then remembers where it was resumed (`TripState.resumed`) until it ends, so that network
 * time arriving later can split it after all (`reconcileResumedTrip`).
 */
export function resumeTripState(
  active: ActiveTrip,
  pricing: TripPricing,
  now: number,
  wallOffsetMs = 0,
): TripState {
  const endPending = !(active.last.at <= now);
  return {
    ...createTripState(),
    active,
    current: summarise(active, pricing, wallOffsetMs),
    endPending,
    resumed: endPending
      ? null
      : { restored: active, resumedAt: now, wallOffsetMs, sinceResume: null },
  };
}

/**
 * The wall clock was synced (`wallOffsetMs`, wall clock − engine time): if the trip in progress
 * was resumed after a restart and the start-up clock turns out to have been behind by enough
 * that the break was really `config.endAfterEngineOffMs` or longer, split it again — the trip
 * from before the restart is completed with the times it was saved with, and what was driven
 * since becomes the trip in progress. Otherwise `state` is returned unchanged.
 */
export function reconcileResumedTrip(
  state: TripState,
  wallOffsetMs: number,
  config: TripConfig,
  pricing: TripPricing,
): TripState {
  const { resumed } = state;
  if (resumed === null || state.active === null || !Number.isFinite(wallOffsetMs)) return state;
  const clockBehindMs = wallOffsetMs - resumed.wallOffsetMs;
  const breakMs = resumed.resumedAt - resumed.restored.lastActivityAt + clockBehindMs;
  if (clockBehindMs <= 0 || breakMs < config.endAfterEngineOffMs) return state;
  const completed = finishTrip(
    { ...state, active: resumed.restored },
    config,
    pricing,
    resumed.wallOffsetMs,
  );
  const trip = resumed.sinceResume;
  return {
    ...completed,
    active: trip,
    current: trip === null ? null : summarise(trip, pricing, wallOffsetMs),
  };
}

/** `trip` with every time moved by `deltaMs` (between engine time and wall-clock time). */
export function shiftActiveTrip(trip: ActiveTrip, deltaMs: number): ActiveTrip {
  if (deltaMs === 0 || !Number.isFinite(deltaMs)) return trip;
  return {
    ...trip,
    startedAt: trip.startedAt + deltaMs,
    lastActivityAt: trip.lastActivityAt + deltaMs,
    last: { ...trip.last, at: trip.last.at + deltaMs },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isAmount = (v: unknown): v is number => isTime(v) && v >= 0;
const isAmountOrNull = (v: unknown): v is number | null => v === null || isAmount(v);
const TRIP_AMOUNTS = ['distanceKm', 'movingMs', 'idleMs', 'fuelL', 'fuelDistanceKm', 'maxSpeedKph'];
const ODOMETER_FIELDS = ['firstKm', 'distanceAtFirst', 'lastKm', 'distanceAtLast'];

/**
 * Validate a trip in progress read back from disk (written from `ActiveTrip` as JSON). Returns
 * a fresh copy, or null when anything is missing, of the wrong type, negative or out of order.
 * Times are not compared with the clock: see `resumeTripState` for a trip "in the future".
 */
export function restoreActiveTrip(value: unknown): ActiveTrip | null {
  if (!isRecord(value)) return null;
  const { startedAt, lastActivityAt, last, odometer } = value;
  if (!isTime(startedAt) || !isTime(lastActivityAt) || lastActivityAt < startedAt) return null;
  if (!TRIP_AMOUNTS.every((k) => isAmount(value[k])) || typeof value['fuelKnown'] !== 'boolean') {
    return null;
  }
  if (
    !isRecord(last) ||
    !isTime(last['at']) ||
    last['at'] < lastActivityAt ||
    !isAmountOrNull(last['speedKph']) ||
    !isAmountOrNull(last['fuelRateLph']) ||
    typeof last['engineRunning'] !== 'boolean' ||
    typeof last['linkUp'] !== 'boolean'
  ) {
    return null;
  }
  if (
    odometer !== null &&
    !(isRecord(odometer) && ODOMETER_FIELDS.every((k) => isAmount(odometer[k])))
  ) {
    return null;
  }
  // Every field read below was validated above.
  const trip = value as unknown as ActiveTrip;
  return {
    startedAt,
    lastActivityAt,
    distanceKm: trip.distanceKm,
    movingMs: trip.movingMs,
    idleMs: trip.idleMs,
    fuelL: trip.fuelL,
    fuelDistanceKm: trip.fuelDistanceKm,
    fuelKnown: trip.fuelKnown,
    maxSpeedKph: trip.maxSpeedKph,
    odometer:
      trip.odometer === null
        ? null
        : {
            firstKm: trip.odometer.firstKm,
            distanceAtFirst: trip.odometer.distanceAtFirst,
            lastKm: trip.odometer.lastKm,
            distanceAtLast: trip.odometer.distanceAtLast,
          },
    last: {
      at: trip.last.at,
      speedKph: trip.last.speedKph,
      fuelRateLph: trip.last.fuelRateLph,
      engineRunning: trip.last.engineRunning,
      linkUp: trip.last.linkUp,
    },
  };
}

/** Deterministic trip id derived from its (wall-clock) start time. */
export function tripId(startedAt: number): string {
  return `trip-${Math.trunc(startedAt).toString(36)}`;
}

/**
 * Advance the trip. A trip starts when the engine starts or the vehicle moves, integrates
 * distance (trapezoidal, gaps > 5 s are not bridged), fuel (from fuel rate), moving/idle time
 * and max speed, and ends after `config.endAfterEngineOffMs` of engine-off / link-down.
 * Trips shorter than `config.minDistanceKm` are discarded rather than completed.
 * Record ids must be deterministic (derived from `startedAt`), never random.
 *
 * The end time is the last activity, not when the timeout expired. If activity resumes after a
 * silence longer than the timeout (e.g. no ticks arrived meanwhile) the old trip is closed and a
 * new one starts with this sample. A trip resumed with `endPending` is closed by any update.
 *
 * Durations are measured in engine time (`input.at`); the start and end times of summaries and
 * records are wall-clock times (`input.wallOffsetMs` added), so a clock step during the trip
 * moves both rather than stretching it.
 */
export function updateTrip(
  state: TripState,
  input: TripInput,
  config: TripConfig,
  pricing: TripPricing,
): TripState {
  const speedKph = reading(input.speedKph);
  const active =
    input.linkUp && (input.engineRunning || (speedKph !== null && speedKph >= TRIP_MOVING_KPH));

  const offset = wallOffset(input);

  let next = state;
  if (next.active !== null) {
    const silentMs = input.at - next.active.lastActivityAt;
    const timedOut = active
      ? silentMs > Math.max(config.endAfterEngineOffMs, TRIP_MAX_GAP_MS)
      : silentMs >= config.endAfterEngineOffMs;
    if (timedOut || next.endPending) next = finishTrip(next, config, pricing, offset);
  }

  let trip = next.active;
  if (trip === null) {
    if (!active) return next;
    trip = startTrip(input, speedKph);
  } else {
    trip = integrate(trip, input, speedKph, active);
  }
  const resumed =
    next.resumed === null ? null : trackSinceResume(next.resumed, input, speedKph, active);
  return { ...next, active: trip, current: summarise(trip, pricing, offset), resumed };
}

/** Integrate `input` into the part of a resumed trip driven since the start-up. */
function trackSinceResume(
  resumed: ResumedTrip,
  input: TripInput,
  speedKph: number | null,
  active: boolean,
): ResumedTrip {
  const since = resumed.sinceResume;
  if (since === null) {
    return active ? { ...resumed, sinceResume: startTrip(input, speedKph) } : resumed;
  }
  return { ...resumed, sinceResume: integrate(since, input, speedKph, active) };
}

const wallOffset = (input: TripInput): number =>
  input.wallOffsetMs !== undefined && Number.isFinite(input.wallOffsetMs) ? input.wallOffsetMs : 0;

function startTrip(input: TripInput, speedKph: number | null): ActiveTrip {
  const odometerKm = reading(input.odometerKm);
  return {
    startedAt: input.at,
    lastActivityAt: input.at,
    distanceKm: 0,
    movingMs: 0,
    idleMs: 0,
    fuelL: 0,
    fuelDistanceKm: 0,
    fuelKnown: false,
    maxSpeedKph: speedKph ?? 0,
    odometer:
      odometerKm === null
        ? null
        : { firstKm: odometerKm, distanceAtFirst: 0, lastKm: odometerKm, distanceAtLast: 0 },
    last: {
      at: input.at,
      speedKph,
      fuelRateLph: reading(input.fuelRateLph),
      engineRunning: input.engineRunning,
      linkUp: input.linkUp,
    },
  };
}

function integrate(
  trip: ActiveTrip,
  input: TripInput,
  speedKph: number | null,
  active: boolean,
): ActiveTrip {
  const { last } = trip;
  if (input.at < last.at) return trip; // out-of-order sample
  const fuelRateLph = reading(input.fuelRateLph);
  const dt = input.at - last.at;
  let { distanceKm, movingMs, idleMs, fuelL, fuelDistanceKm, fuelKnown } = trip;

  if (dt > 0 && dt <= TRIP_MAX_GAP_MS) {
    let segmentKm = 0;
    if (last.speedKph !== null && speedKph !== null) {
      const meanKph = (last.speedKph + speedKph) / 2;
      segmentKm = (meanKph * dt) / 3_600_000;
      distanceKm += segmentKm;
      if (meanKph >= TRIP_MOVING_KPH) movingMs += dt;
      else if (last.engineRunning && last.linkUp) idleMs += dt;
    }
    if (last.fuelRateLph !== null && fuelRateLph !== null) {
      fuelL += (((last.fuelRateLph + fuelRateLph) / 2) * dt) / 3_600_000;
      fuelDistanceKm += segmentKm;
      fuelKnown = true;
    }
  }

  const odometerKm = reading(input.odometerKm);
  let { odometer } = trip;
  if (odometerKm !== null) {
    odometer =
      odometer === null
        ? {
            firstKm: odometerKm,
            distanceAtFirst: distanceKm,
            lastKm: odometerKm,
            distanceAtLast: distanceKm,
          }
        : { ...odometer, lastKm: odometerKm, distanceAtLast: distanceKm };
  }

  return {
    ...trip,
    lastActivityAt: active ? input.at : trip.lastActivityAt,
    distanceKm,
    movingMs,
    idleMs,
    fuelL,
    fuelDistanceKm,
    fuelKnown,
    maxSpeedKph: speedKph !== null ? Math.max(trip.maxSpeedKph, speedKph) : trip.maxSpeedKph,
    odometer,
    last: {
      at: input.at,
      speedKph,
      fuelRateLph,
      engineRunning: input.engineRunning,
      linkUp: input.linkUp,
    },
  };
}

function fuelUsed(trip: ActiveTrip): number | null {
  return trip.fuelKnown ? round(trip.fuelL, 3) : null;
}

function economy(trip: ActiveTrip): number | null {
  if (!trip.fuelKnown || trip.fuelDistanceKm < MIN_ECONOMY_DISTANCE_KM) return null;
  return round((trip.fuelL / trip.fuelDistanceKm) * 100, 2);
}

function cost(trip: ActiveTrip, pricing: TripPricing): number | null {
  if (!trip.fuelKnown || !Number.isFinite(pricing.fuelPricePerL) || pricing.fuelPricePerL < 0) {
    return null;
  }
  return round(trip.fuelL * pricing.fuelPricePerL, 2);
}

function durationS(trip: ActiveTrip): number {
  return Math.round((trip.lastActivityAt - trip.startedAt) / 1000);
}

function summarise(trip: ActiveTrip, pricing: TripPricing, wallOffsetMs: number): TripSummary {
  return {
    startedAt: trip.startedAt + wallOffsetMs,
    distanceKm: round(trip.distanceKm, 3),
    durationS: durationS(trip),
    movingS: Math.round(trip.movingMs / 1000),
    fuelUsedL: fuelUsed(trip),
    avgLPer100km: economy(trip),
    cost: cost(trip, pricing),
    currency: pricing.currency,
  };
}

/**
 * Odometer at the trip's start and end, extrapolated with the integrated distance when the
 * first/last reading arrived after the start / before the end.
 */
function odometerBounds(trip: ActiveTrip): { start: number | null; end: number | null } {
  const o = trip.odometer;
  if (o === null) return { start: null, end: null };
  return {
    start: round(Math.max(0, o.firstKm - o.distanceAtFirst), 1),
    end: round(o.lastKm + (trip.distanceKm - o.distanceAtLast), 1),
  };
}

/**
 * Close the active trip: complete it, or discard it if it is shorter than `minDistanceKm`. The
 * record's times are wall-clock times (engine time + `wallOffsetMs`).
 */
function finishTrip(
  state: TripState,
  config: TripConfig,
  pricing: TripPricing,
  wallOffsetMs: number,
): TripState {
  const trip = state.active;
  if (trip === null) return state;
  const ended: TripState = {
    ...state,
    active: null,
    current: null,
    endPending: false,
    resumed: null,
  };
  if (trip.distanceKm < config.minDistanceKm) return ended;

  const odometer = odometerBounds(trip);
  const movingHours = trip.movingMs / 3_600_000;
  const startedAt = trip.startedAt + wallOffsetMs;
  const record: TripRecord = {
    id: tripId(startedAt),
    startedAt,
    endedAt: trip.lastActivityAt + wallOffsetMs,
    distanceKm: round(trip.distanceKm, 3),
    durationS: durationS(trip),
    movingS: Math.round(trip.movingMs / 1000),
    idleS: Math.round(trip.idleMs / 1000),
    fuelUsedL: fuelUsed(trip),
    avgLPer100km: economy(trip),
    maxSpeedKph: round(trip.maxSpeedKph, 1),
    avgMovingSpeedKph: movingHours > 0 ? round(trip.distanceKm / movingHours, 1) : 0,
    cost: cost(trip, pricing),
    currency: pricing.currency,
    startOdometerKm: odometer.start,
    endOdometerKm: odometer.end,
  };
  return { ...ended, lastCompleted: record, completedCount: state.completedCount + 1 };
}
