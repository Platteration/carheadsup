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
}

export interface TripPricing {
  fuelPricePerL: number;
  currency: string;
}

/** Accumulators of the trip in progress (unrounded; rounding happens in summaries/records). */
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
  return { current: null, lastCompleted: null, completedCount: 0, active: null };
}

/** Deterministic trip id derived from its start time. */
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
 * new one starts with this sample.
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

  let next = state;
  if (next.active !== null) {
    const silentMs = input.at - next.active.lastActivityAt;
    const timedOut = active
      ? silentMs > Math.max(config.endAfterEngineOffMs, TRIP_MAX_GAP_MS)
      : silentMs >= config.endAfterEngineOffMs;
    if (timedOut) next = finishTrip(next, config, pricing);
  }

  let trip = next.active;
  if (trip === null) {
    if (!active) return next;
    trip = startTrip(input, speedKph);
  } else {
    trip = integrate(trip, input, speedKph, active);
  }
  return { ...next, active: trip, current: summarise(trip, pricing) };
}

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

function summarise(trip: ActiveTrip, pricing: TripPricing): TripSummary {
  return {
    startedAt: trip.startedAt,
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

/** Close the active trip: complete it, or discard it if it is shorter than `minDistanceKm`. */
function finishTrip(state: TripState, config: TripConfig, pricing: TripPricing): TripState {
  const trip = state.active;
  if (trip === null) return state;
  const ended: TripState = { ...state, active: null, current: null };
  if (trip.distanceKm < config.minDistanceKm) return ended;

  const odometer = odometerBounds(trip);
  const movingHours = trip.movingMs / 3_600_000;
  const record: TripRecord = {
    id: tripId(trip.startedAt),
    startedAt: trip.startedAt,
    endedAt: trip.lastActivityAt,
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
