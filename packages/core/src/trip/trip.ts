import type { TripConfig } from '../types/config.ts';
import type { TripRecord, TripSummary } from '../types/records.ts';
import { notImplemented } from '../todo.ts';

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

/** Trip state. Implementations add private accumulator fields. */
export interface TripState {
  /** Live summary of the trip in progress, or null when no trip is active. */
  current: TripSummary | null;
  /** Most recently completed trip (kept after it ends so the server can persist/sync it). */
  lastCompleted: TripRecord | null;
  /** Increments every time a trip completes — the server persists when this changes. */
  completedCount: number;
}

export function createTripState(): TripState {
  return notImplemented('createTripState');
}

/**
 * Advance the trip. A trip starts when the engine starts or the vehicle moves, integrates
 * distance (trapezoidal, gaps > 5 s are not bridged), fuel (from fuel rate), moving/idle time
 * and max speed, and ends after `config.endAfterEngineOffMs` of engine-off / link-down.
 * Trips shorter than `config.minDistanceKm` are discarded rather than completed.
 * Record ids must be deterministic (derived from `startedAt`), never random.
 */
export function updateTrip(
  state: TripState,
  input: TripInput,
  config: TripConfig,
  pricing: TripPricing,
): TripState {
  return notImplemented(
    `updateTrip(${input.at}, ${config.minDistanceKm}, ${pricing.currency}, ${String(state.current)})`,
  );
}
