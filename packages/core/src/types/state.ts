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

export interface EnvironmentState {
  lux: number | null;
  luxAt: number | null;
  location: { lat: number; lon: number; at: number } | null;
  brightness: BrightnessState;
}

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
