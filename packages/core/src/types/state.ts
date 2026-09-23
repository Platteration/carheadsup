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

export interface UiState {
  blanked: boolean;
  /** Parked-dashboard page index. */
  page: number;
  /** Manual brightness trim from the driver, −0.5–0.5. */
  brightnessOffset: number;
  /** When the driver last dismissed the current toast. */
  toastDismissedAt: number | null;
  lastInputAt: number | null;
}

export interface HudState {
  /** Timestamp of the most recent event. */
  now: number;
  simulated: boolean;
  vehicle: VehicleState;
  context: ContextState;
  gear: GearState;
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
  env: EnvironmentState;
  alerts: Alert[];
  ui: UiState;
}
