import type { CollisionLevel } from './adas.ts';
import type { AlertKind, AlertSeverity } from './alerts.ts';
import type {
  ClockFormat,
  DrivingContext,
  FuelEconomyUnit,
  SpeedLimitSignStyle,
  WidgetId,
  Zone,
} from './config.ts';
import type { HazardType, Lane, Maneuver } from './nav.ts';
import type { CallState } from './phone.ts';
import type { MaintenanceItemStatus, TripSummary } from './records.ts';
import type { SignalId } from './signals.ts';
import type { DtcKind, DtcSeverity, ObdLinkState } from './vehicle.ts';

/**
 * A HUD frame is the complete, display-ready description of what to draw.
 * It is produced by the pure `composeFrame()` and consumed by the renderer,
 * which does no unit conversion and no business logic.
 * All numbers are already converted to the driver's units and rounded.
 */

export type SpeedUnitLabel = 'km/h' | 'mph';
export type DistanceUnitLabel = 'm' | 'km' | 'ft' | 'mi';
export type TemperatureUnitLabel = '°C' | '°F';
export type PressureUnitLabel = 'kPa' | 'psi' | 'bar';

export interface DisplayDistance {
  value: number;
  unit: DistanceUnitLabel;
  /** Pre-formatted, e.g. "300 m", "1.2 km", "0.3 mi", "500 ft". */
  text: string;
}

interface WidgetBase {
  zone: Zone;
}

export interface SpeedWidget extends WidgetBase {
  id: 'speed';
  value: number;
  unit: SpeedUnitLabel;
  /** True when above the posted limit plus tolerance — the renderer turns the speed red. */
  overLimit: boolean;
  /** How far over the limit, in display units; null when not over or limit unknown. */
  overBy: number | null;
}

export interface SpeedLimitWidget extends WidgetBase {
  id: 'speedLimit';
  /** Null together with `unlimited: true` for roads without a limit. */
  value: number | null;
  unlimited: boolean;
  unit: SpeedUnitLabel;
  style: SpeedLimitSignStyle;
}

export interface TachometerWidget extends WidgetBase {
  id: 'tachometer';
  rpm: number;
  /** rpm / redline, clamped 0–1. */
  fraction: number;
  redlineRpm: number;
}

export interface GearWidget extends WidgetBase {
  id: 'gear';
  /** "1"–"10", "N", or "R". */
  gear: string;
  /** True when inferred from the rpm/speed ratio rather than reported by the car. */
  inferred: boolean;
}

export interface NavWidget extends WidgetBase {
  id: 'nav';
  maneuver: Maneuver;
  distance: DisplayDistance | null;
  street: string | null;
  then: Maneuver | null;
  iconPng: string | null;
  /** Maneuver is close (≈ < 200 m / 0.1 mi) — emphasise and count down. */
  imminent: boolean;
  /** 0–1 progress bar for the final approach (1 = at the maneuver), or null outside the approach. */
  approach: number | null;
}

export interface LanesWidget extends WidgetBase {
  id: 'lanes';
  lanes: Lane[];
}

export interface EtaWidget extends WidgetBase {
  id: 'eta';
  etaEpochMs: number | null;
  clock: ClockFormat;
  remainingMinutes: number | null;
  remainingDistance: DisplayDistance | null;
}

export interface HazardWidget extends WidgetBase {
  id: 'hazard';
  type: HazardType;
  distance: DisplayDistance | null;
  /** Enforced limit for cameras, display units. */
  speedLimit: number | null;
  /** Expected delay for traffic, whole minutes. */
  delayMinutes: number | null;
  label: string;
}

export interface FuelWidget extends WidgetBase {
  id: 'fuel';
  /** Instantaneous economy; null when stationary or unknown. */
  instant: number | null;
  /** Trip-average economy. */
  average: number | null;
  unit: FuelEconomyUnit;
  /** Estimated remaining range. */
  range: number | null;
  rangeUnit: 'km' | 'mi';
  levelPct: number | null;
  low: boolean;
}

export interface CoolantWidget extends WidgetBase {
  id: 'coolant';
  value: number;
  unit: TemperatureUnitLabel;
  status: 'hot' | 'critical';
}

export interface VoltageWidget extends WidgetBase {
  id: 'voltage';
  /** Volts, one decimal. */
  value: number;
  status: 'low' | 'high';
}

export interface TireReading {
  value: number | null;
  low: boolean;
}

export interface TpmsWidget extends WidgetBase {
  id: 'tpms';
  unit: PressureUnitLabel;
  fl: TireReading;
  fr: TireReading;
  rl: TireReading;
  rr: TireReading;
  anyLow: boolean;
}

export interface ClockWidget extends WidgetBase {
  id: 'clock';
  epochMs: number;
  format: ClockFormat;
}

export interface OutsideTempWidget extends WidgetBase {
  id: 'outsideTemp';
  value: number;
  unit: TemperatureUnitLabel;
  iceRisk: boolean;
}

export interface MediaWidget extends WidgetBase {
  id: 'media';
  title: string | null;
  artist: string | null;
  playing: boolean;
}

export interface BoostWidget extends WidgetBase {
  id: 'boost';
  /** Manifold gauge pressure (MAP − baro), display pressure units; negative = vacuum. */
  value: number;
  unit: PressureUnitLabel;
  /** 0–1 of the gauge range. */
  fraction: number;
}

export interface TripSummaryWidget extends WidgetBase {
  id: 'tripSummary';
  distance: DisplayDistance;
  durationS: number;
  averageEconomy: number | null;
  economyUnit: FuelEconomyUnit;
  fuelUsed: number | null;
  fuelUnit: 'L' | 'gal';
  cost: number | null;
  currency: string;
}

export type WidgetFrame =
  | SpeedWidget
  | SpeedLimitWidget
  | TachometerWidget
  | GearWidget
  | NavWidget
  | LanesWidget
  | EtaWidget
  | HazardWidget
  | FuelWidget
  | CoolantWidget
  | VoltageWidget
  | TpmsWidget
  | ClockWidget
  | OutsideTempWidget
  | MediaWidget
  | BoostWidget
  | TripSummaryWidget;

/** Compile-time check that every WidgetId has a frame type and vice versa. */
export type WidgetFrameById<I extends WidgetId> = Extract<WidgetFrame, { id: I }>;

export interface AlertFrame {
  key: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string | null;
  code: string | null;
  dismissible: boolean;
}

export interface ToastFrame {
  kind: 'media' | 'message' | 'info';
  title: string;
  subtitle: string | null;
  /** 0–1; the renderer applies it directly so fades are driven by the composer. */
  opacity: number;
}

export interface CallFrame {
  state: CallState;
  /** Contact name, falling back to the number, falling back to "Unknown caller". */
  name: string;
  number: string | null;
  /** Seconds since the call became active (for the timer), null while ringing. */
  durationS: number | null;
  /** Which gestures/buttons are available right now. */
  canAccept: boolean;
  canDecline: boolean;
}

export interface ShiftLightFrame {
  /** 0–1 fill of the shift bar. */
  level: number;
  /** Above the flash threshold — renderer blinks the bar. */
  flash: boolean;
}

export type GaugeStatus = 'ok' | 'warn' | 'crit' | 'unknown';

export interface DiagnosticGauge {
  signal: SignalId;
  label: string;
  /** Display units. */
  value: number | null;
  unit: string;
  decimals: number;
  min: number;
  max: number;
  status: GaugeStatus;
}

export interface DiagnosticDtc {
  code: string;
  kind: DtcKind;
  description: string;
  short: string;
  severity: DtcSeverity;
}

export type DiagnosticsPageKind =
  'overview' | 'engine' | 'fuel' | 'electrical' | 'trouble-codes' | 'trip' | 'maintenance';

export interface DiagnosticsFrame {
  page: DiagnosticsPageKind;
  pageIndex: number;
  pageCount: number;
  title: string;
  gauges: DiagnosticGauge[];
  dtcs: DiagnosticDtc[];
  milOn: boolean;
  trip: TripSummary | null;
  maintenance: MaintenanceItemStatus[];
  vehicle: {
    vin: string | null;
    adapter: string | null;
    protocol: string | null;
  };
}

export interface HudFrame {
  at: number;
  context: DrivingContext;
  /** Driver blanked the display — render nothing but a tiny indicator. */
  blanked: boolean;
  theme: {
    night: boolean;
    /** Effective display brightness 0–1 (after auto curve + manual offset). */
    brightness: number;
  };
  /** Visible widgets in priority order (most important first within each zone). */
  widgets: WidgetFrame[];
  /** Visible alerts, most severe first, capped by `display.maxAlerts`. */
  alerts: AlertFrame[];
  toast: ToastFrame | null;
  call: CallFrame | null;
  shiftLight: ShiftLightFrame | null;
  blindSpot: { left: boolean; right: boolean };
  collision: CollisionLevel;
  /** Full-screen diagnostics dashboard, only when parked. */
  diagnostics: DiagnosticsFrame | null;
  status: {
    obd: ObdLinkState;
    phone: boolean;
    /** Unit is running against simulated inputs. */
    simulated: boolean;
  };
}
