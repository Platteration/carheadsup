import type { ActiveTrip } from '../trip/trip.ts';
import type { GearAnchor } from '../vehicle/gear.ts';

/**
 * A completed trip, persisted on the HUD and synced to the phone. Times are wall-clock epoch ms
 * (converted from engine time with the latest clock offset when the trip ends).
 */
export interface TripRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  distanceKm: number;
  /** Elapsed time from start to last movement/engine activity (a clock step does not count). */
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
  /** Wall-clock epoch ms. */
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
  /** When the service was done, wall-clock epoch ms. */
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
  /**
   * What numbers the learned ratios of an automatic (its 2nd-gear ratio), so gears show right
   * after start-up rather than after the first upshifts; kept only with `learnedGearRatios` and
   * for the transmission it was learned on. Absent in files written before it existed.
   */
  gearAnchor?: GearAnchor | null;
  /** Long-run average consumption, seeds range estimation on startup. */
  avgLPer100km: number | null;
  maintenanceRecords: MaintenanceRecord[];
  /**
   * The trip in progress when this was written (null: none), its times as wall-clock epoch ms
   * (engine time does not carry over a restart). The HUD is powered down seconds after the
   * ignition, long before a trip ends by itself; on the next start the reducer completes it (or,
   * after a short power blip, continues it — see `resumeTripState`). Absent in files written
   * before it existed.
   */
  activeTrip?: ActiveTrip | null;
}
