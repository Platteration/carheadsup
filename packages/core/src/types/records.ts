import type { ActiveTrip } from '../trip/trip.ts';

/** A completed trip, persisted on the HUD and synced to the phone. */
export interface TripRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  distanceKm: number;
  /** Wall-clock duration from start to last movement/engine activity. */
  durationS: number;
  movingS: number;
  idleS: number;
  /** Null when the vehicle provides no usable fuel-rate data. */
  fuelUsedL: number | null;
  avgLPer100km: number | null;
  maxSpeedKph: number;
  /** Average over moving time. */
  avgMovingSpeedKph: number;
  /** fuelUsedL × fuel price, null when fuel is unknown. */
  cost: number | null;
  currency: string;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
}

/** Live view of the trip in progress. */
export interface TripSummary {
  startedAt: number;
  distanceKm: number;
  durationS: number;
  movingS: number;
  fuelUsedL: number | null;
  avgLPer100km: number | null;
  cost: number | null;
  currency: string;
}

export interface MaintenanceRecord {
  itemId: string;
  odometerKm: number | null;
  at: number;
}

export type MaintenanceStatusKind = 'ok' | 'due-soon' | 'overdue' | 'unknown';

export interface MaintenanceItemStatus {
  itemId: string;
  label: string;
  lastDoneAt: number | null;
  lastDoneKm: number | null;
  dueAtKm: number | null;
  dueAtEpochMs: number | null;
  remainingKm: number | null;
  remainingDays: number | null;
  status: MaintenanceStatusKind;
}

/**
 * State that survives restarts, written by the server to the data directory.
 * The reducer seeds itself from this and exposes an updated copy via `extractPersisted`.
 */
export interface PersistedState {
  /** Best-known odometer and when it was known. */
  odometerKm: number | null;
  /** Automatically learned gear ratios (rpm per km/h, 1st gear first). */
  learnedGearRatios: number[] | null;
  /** Long-run average consumption, seeds range estimation on startup. */
  avgLPer100km: number | null;
  maintenanceRecords: MaintenanceRecord[];
  /**
   * The trip in progress when this was written (null: none). The HUD is powered down seconds
   * after the ignition, long before a trip ends by itself; on the next start the reducer
   * completes it (or, after a short power blip, continues it). Absent in files written before
   * it existed.
   */
  activeTrip?: ActiveTrip | null;
}
