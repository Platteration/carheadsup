import type { ActiveTrip } from '../trip/trip.ts';
import type { GearAnchor } from '../vehicle/gear.ts';
import type { GeoPoint } from './state.ts';

/**
 * A completed trip, persisted on the HUD and synced to the phone. Times are wall-clock epoch ms
 * (converted from engine time with the latest clock offset when the trip ends).
 */
export interface TripRecord {
  /**
   * `trip-<seq>-<start>` (both base 36): the sequence number keeps ids unique on this HUD
   * whatever its clock does; the start time keeps them apart from another HUD's trips (or this
   * one's after its data was wiped) in the phone's log. Opaque to everything else.
   */
  id: string;
  /**
   * The HUD's sequence number of this trip, taken when it started: 1 for its first, then one more
   * for every trip started since (a trip too short to keep leaves a gap). It only grows, whatever
   * the clock does, so the phone syncs by it (`trips-request.sinceSeq`). Absent from trips
   * recorded by HUD versions before it existed.
   */
  seq?: number;
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
 * Keeps the odometer estimate in line with the dash when the car does not report its odometer
 * (PID A6). The estimate grows with the distance integrated from the speed PID, which reads a few
 * per cent off (tyre size, the speedometer's built-in lead) and misses the distance driven while
 * the OBD link is down. Every dash reading entered by hand (a service, "Correct the odometer")
 * confirms the estimate: it restarts from that reading and, measured against the previous one,
 * corrects `scale`.
 */
export interface OdometerCalibration {
  /** The dash reading last entered by hand, km; null before the first. */
  confirmedKm: number | null;
  /** Distance integrated from the speed PID since then, before scaling, km. */
  rawKmSince: number;
  /**
   * Learned ratio of the dash's distance to the speed-integrated one, 0.9–1.1 (1 until two dash
   * readings far enough apart have measured it).
   */
  scale: number;
}

/**
 * State that survives restarts, written by the server to the data directory.
 * The reducer seeds itself from this and exposes an updated copy via `extractPersisted`.
 */
export interface PersistedState {
  /** Best-known odometer and when it was known. */
  odometerKm: number | null;
  /**
   * How the odometer estimate is kept in line with the dash (see {@link OdometerCalibration}).
   * Absent in files written before it existed.
   */
  odometerCalibration?: OdometerCalibration | null;
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
  /**
   * The last sequence number given to a trip (`TripRecord.seq`; 0 or absent: none yet). Absent in
   * files written before it existed.
   */
  tripSeq?: number;
  /**
   * The HUD's wall clock when this was written (epoch ms): a floor for the next start. A system
   * clock that reads earlier at start-up has gone back — a Pi without a real-time clock under a
   * read-only root restores the same time at every boot — so the HUD's wall clock starts here
   * instead and counts as untrusted until network or phone time arrives. Written by the server
   * (`extractPersisted` leaves it out); absent in files written before it existed.
   */
  lastWallMs?: number | null;
  /**
   * The phone's last location, rounded to about 11 km (`EnvironmentState.lastLocation`), for
   * night mode before the phone connects. Absent in files written before it existed.
   */
  lastLocation?: GeoPoint | null;
}
