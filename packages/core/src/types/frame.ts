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
import type { MaintenanceStatusKind } from './records.ts';
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
  /**
   * The nav app's maneuver icon (base64 PNG) to draw instead of a built-in arrow. Only set
   * when `maneuver.type` is 'unknown': known maneuvers are drawn by the renderer.
   */
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
  /** Sign style for `speedLimit` (the driver's configured speed-limit sign). */
  limitStyle: SpeedLimitSignStyle;
  /** Expected delay for traffic, whole minutes (rounded; null when under half a minute). */
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
  /** Wall-clock time. */
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
  | 'overview'
  | 'engine'
  | 'fuel'
  | 'electrical'
  | 'trouble-codes'
  | 'trip'
  | 'maintenance'
  /** "Pair a phone": the pairing QR code. Last, and only while parked. */
  | 'pair';

/** The trip on the parked dashboard, in the driver's units. */
export interface DiagnosticsTrip {
  /** False for the trip in progress, true for the last completed trip (shown when none is active). */
  completed: boolean;
  /** One decimal, e.g. "42.7 km" / "26.5 mi". */
  distance: DisplayDistance;
  /** Wall-clock driving time, seconds. */
  durationS: number;
  /** Time spent moving, seconds. */
  movingS: number;
  /** Trip-average economy; null when fuel flow is unknown. */
  averageEconomy: number | null;
  economyUnit: FuelEconomyUnit;
  /** Two decimals; null when fuel flow is unknown. */
  fuelUsed: number | null;
  fuelUnit: 'L' | 'gal';
  /** Fuel cost in `currency`; null when fuel is unknown. */
  cost: number | null;
  /** ISO 4217 code. */
  currency: string;
}

/** One service item on the parked dashboard, in the driver's units. */
export interface DiagnosticsMaintenanceItem {
  itemId: string;
  label: string;
  status: MaintenanceStatusKind;
  /**
   * Distance left until the service is due, whole km or mi; `value` is negative when overdue by
   * distance, while `text` is the unsigned magnitude ("320 km") to read as "in 320 km" or
   * "320 km overdue". Null when the item has no distance interval or no odometer is known.
   */
  remaining: DisplayDistance | null;
  /** Whole days until due, negative when overdue; null when the item has no time interval. */
  remainingDays: number | null;
  /** When the service falls due by time (epoch ms); null when not time-based or never done. */
  dueAtEpochMs: number | null;
}

/**
 * What the "Pair a phone" page shows:
 * - 'ready': the pairing QR code ({@link PairingFrame.uri});
 * - 'open': no pairing token is set, so there is nothing to pair with — any phone can connect;
 *   the page explains how to set one instead of showing a code;
 * - 'unavailable': the HUD's phone link (TLS) is not running, or it has no usable address.
 */
export type PairingPageStatus = 'ready' | 'open' | 'unavailable';

/** The "Pair a phone" page of the parked dashboard. */
export interface PairingFrame {
  status: PairingPageStatus;
  /** The HUD's name as phones see it, e.g. "My car HUD". */
  hudName: string;
  /**
   * The pairing URI (`protocol/pairing.ts`) to draw as a QR code — status 'ready' only. It
   * carries the pairing token, so it is in no other frame than this page's.
   */
  uri: string | null;
  /** The certificate's fingerprint as people compare it (`shortFingerprint`); null without TLS. */
  fingerprint: string | null;
  /** Whole seconds until the dashboard turns back to the overview by itself. */
  closesInS: number;
}

export interface DiagnosticsFrame {
  page: DiagnosticsPageKind;
  pageIndex: number;
  pageCount: number;
  title: string;
  gauges: DiagnosticGauge[];
  dtcs: DiagnosticDtc[];
  milOn: boolean;
  /** Trip page: the trip in progress, else the last completed one; null before the first trip. */
  trip: DiagnosticsTrip | null;
  /** Maintenance page: every item; overview: only those due soon or overdue. Most urgent first. */
  maintenance: DiagnosticsMaintenanceItem[];
  /** The "Pair a phone" page; null on every other page. */
  pairing: PairingFrame | null;
  vehicle: {
    vin: string | null;
    adapter: string | null;
    protocol: string | null;
  };
}

export interface HudFrame {
  /**
   * Engine time of the state it shows: monotonic (it never steps with the system clock), for
   * judging whether frames keep coming. Wall-clock times are in the clock and ETA widgets.
   */
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
  /**
   * Full-screen diagnostics dashboard: when parked, or when stopped after the driver opened it
   * ('next-page' / 'prev-page'); never while moving. Its "Pair a phone" page only when parked.
   */
  diagnostics: DiagnosticsFrame | null;
  status: {
    obd: ObdLinkState;
    phone: boolean;
    /** Unit is running against simulated inputs. */
    simulated: boolean;
  };
}
