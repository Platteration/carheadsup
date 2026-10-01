import type { BrightnessState } from '../display/brightness.ts';
import type { ContextState } from '../display/context.ts';
import type { MaintenanceState } from '../maintenance/maintenance.ts';
import type { TripState } from '../trip/trip.ts';
import type { FuelState } from '../vehicle/fuel.ts';
import type { GearState } from '../vehicle/gear.ts';
import type { AdasState } from './adas.ts';
import type { Alert } from './alerts.ts';
import type { Hazard, NavInfo, RoadInfo } from './nav.ts';
import type { CallInfo, MediaInfo, MessageInfo, PhoneLinkStatus } from './phone.ts';
import type { OdometerCalibration } from './records.ts';
import type { VehicleState } from './vehicle.ts';

/**
 * Odometer bookkeeping. `integratedKm` is the distance integrated from speed samples since
 * the process started; it never goes backwards and is used to dead-reckon nav and hazard
 * distances between phone updates.
 */
export interface OdometerState {
  /** Best-known odometer reading. */
  km: number | null;
  source: 'pid' | 'estimated' | null;
  integratedKm: number;
  /** Timestamp and speed of the last integrated sample. */
  lastSampleAt: number | null;
  lastSpeedKph: number | null;
  /** Keeping an estimated odometer in line with the dash (persisted). */
  calibration: OdometerCalibration;
  /**
   * The last phone location fix accurate enough to measure distance with, for bridging what the
   * speed PID cannot measure (the OBD link down or not up yet); not persisted.
   */
  gpsFix: { lat: number; lon: number; at: number } | null;
}

export interface NavState {
  info: NavInfo;
  /** `odometer.integratedKm` when `info` arrived, for dead reckoning. */
  integratedKmAtUpdate: number;
}

export interface TrackedHazard {
  hazard: Hazard;
  integratedKmAtUpdate: number;
}

export interface MediaState {
  info: MediaInfo;
  /** When `trackKey` last changed (drives the "now playing" toast). */
  trackChangedAt: number;
}

/** A place on Earth, degrees (latitude north, longitude east). */
export interface GeoPoint {
  lat: number;
  lon: number;
}

/**
 * The time zone the HUD's system clock is set to, as the server reads it (`clock/zone`). It gives
 * the local time — and, through the zone's principal city, a rough idea of where on Earth the
 * car is — for night mode before (or without) the phone's location.
 */
export interface TimeZoneInfo {
  /** IANA name, e.g. "Europe/Berlin"; null when unknown. */
  name: string | null;
  /** Local time − UTC, minutes, at the time of the event (daylight saving included). */
  utcOffsetMin: number;
  /**
   * The zone's principal location (tz database `zone1970.tab` / `zone.tab`): within a few hundred
   * kilometres for most zones, good enough for sunset and sunrise — though not across a zone that
   * spans a large country (Asia/Shanghai, Asia/Kolkata). Null for zones without one (UTC,
   * Etc/GMT+5).
   */
  location: GeoPoint | null;
}

export interface EnvironmentState {
  lux: number | null;
  luxAt: number | null;
  location: { lat: number; lon: number; at: number } | null;
  /**
   * The phone's last location rounded to {@link LAST_LOCATION_STEP_DEG} (about 11 km), and
   * updated only once the phone is clearly elsewhere (`nextLastLocation`): kept across restarts
   * (`PersistedState.lastLocation`), so night mode knows the sun before the phone connects.
   */
  lastLocation: GeoPoint | null;
  /** The system time zone (`clock/zone`); null until the server reports it. */
  timeZone: TimeZoneInfo | null;
  brightness: BrightnessState;
}

/** `EnvironmentState.lastLocation` is rounded to multiples of this (degrees). */
export const LAST_LOCATION_STEP_DEG = 0.1;

/**
 * Where phones reach this HUD, as the pairing page's QR code tells them (see
 * `protocol/pairing.ts`). The server knows it; the core only shows it.
 */
export interface PairingEndpoint {
  /** The HUD's id on the phone link. */
  hudId: string;
  /** SHA-256 of the HUD's TLS certificate, 64 lowercase hex digits. */
  certFingerprint: string;
  /** The TLS listener's port. */
  tlsPort: number;
  /** The HUD's addresses, most preferred first: IPv4 literals and `<hostname>.local`. */
  hosts: string[];
}

export interface UiState {
  blanked: boolean;
  /** Dashboard page index. */
  page: number;
  /**
   * The driver opened the dashboard while stopped ('next-page' / 'prev-page'); it shows until
   * 'secondary' closes it or the vehicle moves. Only ever true in the 'stopped' context (parked
   * shows the dashboard anyway).
   */
  dashboardRequested: boolean;
  /**
   * When the dashboard turned to its "Pair a phone" page (null while it is not on it). The page
   * shows the pairing token as a QR code, so it turns back to the overview
   * `PAIRING_PAGE_TIMEOUT_MS` later.
   */
  pairingShownAt: number | null;
  /** Manual brightness trim from the driver, −0.5–0.5. */
  brightnessOffset: number;
  /** When the driver last dismissed the current toast. */
  toastDismissedAt: number | null;
  lastInputAt: number | null;
}

/**
 * How engine time relates to the wall clock. Engine time (`event.at`, `state.now` and every
 * timestamp kept in `HudState`) is monotonic: it starts at the wall clock when the server starts
 * and then only counts elapsed time, so a stepped system clock (network time on a Pi without a
 * real-time clock) never expires data or splits a trip. Where the absolute time matters — the
 * clock widget, the sun, service dates, trip records, the phone's ETA — the core converts with
 * `toWallTime` / `wallNow` (`state/selectors.ts`).
 */
export interface ClockState {
  /** Wall-clock epoch ms − engine time, from the latest `clock/sync` (0 until then). */
  wallOffsetMs: number;
  /**
   * Whether the wall clock is known to be right. False while the server started with a system
   * clock that had gone back (earlier than the time it last saved, `PersistedState.lastWallMs`:
   * a Pi without a real-time clock or network time) and neither network time nor the phone's
   * clock has set it since: the wall clock is then only a lower bound. Until then the clock
   * widget is hidden, a trip resumed at start-up waits for the real time before it is continued
   * (see `resumeTripState`), and services recorded meanwhile are dated again once it arrives.
   */
  trusted: boolean;
}

export interface HudState {
  /** Engine time of the most recent event (see {@link ClockState}). */
  now: number;
  clock: ClockState;
  simulated: boolean;
  vehicle: VehicleState;
  context: ContextState;
  gear: GearState;
  /** The shift light is flashing (latched with hysteresis, see `updateShiftFlash`). */
  shiftFlash: boolean;
  fuel: FuelState;
  trip: TripState;
  odometer: OdometerState;
  maintenance: MaintenanceState;
  nav: NavState | null;
  road: RoadInfo | null;
  hazards: TrackedHazard[];
  media: MediaState | null;
  call: CallInfo | null;
  /** Most recent first, capped. */
  messages: MessageInfo[];
  phone: PhoneLinkStatus;
  adas: AdasState;
  /** Where phones reach this HUD (the pairing page); null while the phone link is off. */
  pairing: PairingEndpoint | null;
  env: EnvironmentState;
  alerts: Alert[];
  ui: UiState;
}
