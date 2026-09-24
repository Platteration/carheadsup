import type { SignalId } from './signals.ts';

export type UnitSystem = 'metric' | 'imperial';
export type FuelEconomyUnit = 'L/100km' | 'km/L' | 'mpg-us' | 'mpg-uk';
export type TemperatureUnit = 'C' | 'F';
export type PressureUnit = 'kPa' | 'psi' | 'bar';
export type ClockFormat = '12h' | '24h';

export interface UnitsConfig {
  /** Speed & distance: km/h + km/m, or mph + mi/ft. */
  system: UnitSystem;
  fuelEconomy: FuelEconomyUnit;
  temperature: TemperatureUnit;
  pressure: PressureUnit;
  clock: ClockFormat;
  /** ISO 4217 code for trip cost, e.g. "USD". */
  currency: string;
}

export type FuelType = 'gasoline' | 'diesel' | 'e85' | 'lpg';
export type TransmissionType = 'manual' | 'automatic' | 'dct' | 'cvt';

export interface VehicleConfig {
  name: string;
  fuelType: FuelType;
  /** Usable tank capacity in litres; used for range estimation. */
  tankCapacityL: number;
  /** Engine displacement in litres; used for speed-density fuel estimation without MAF. */
  displacementL: number;
  /** Volumetric efficiency (0–1) for speed-density estimation. */
  volumetricEfficiency: number;
  transmission: TransmissionType;
  /** Engine speed at which the shift light is fully lit / the tachometer turns red. */
  redlineRpm: number;
  /** Idle speed, used to discount idle samples in gear learning. */
  idleRpm: number;
  /**
   * Known overall ratios per gear, expressed as engine rpm per km/h (1st gear first).
   * Null means "learn automatically"; learned values are persisted separately.
   */
  gearRatiosRpmPerKph: number[] | null;
  /** Current fuel price per litre, in `units.currency`. */
  fuelPricePerL: number;
  /** Whether the vehicle exposes tyre pressures (via `obd.customPids`). */
  hasTpms: boolean;
}

export type ObdTransportKind = 'serial' | 'tcp' | 'simulator';

/**
 * A manufacturer-specific PID (mode 0x22 etc.) mapped onto a canonical signal,
 * using a Torque-style formula over response bytes A, B, C, D … e.g. "((A*256)+B)/10".
 */
export interface CustomPidConfig {
  signal: SignalId;
  /** Hex mode, e.g. "22". */
  mode: string;
  /** Hex PID, e.g. "2A0B". */
  pid: string;
  /** Optional CAN header (ELM `AT SH`), e.g. "7E0" or "750". */
  header: string | null;
  formula: string;
  /** Poll interval in ms. */
  intervalMs: number;
}

export interface ObdConfig {
  transport: ObdTransportKind;
  /** Serial device, e.g. "/dev/rfcomm0" (Bluetooth SPP) or "/dev/ttyUSB0". */
  serialPath: string;
  baudRate: number;
  /** Wi-Fi ELM327 adapters usually live at 192.168.0.10:35000. */
  tcpHost: string;
  tcpPort: number;
  /** ELM327 protocol number for `AT SP`, "0" = automatic. */
  protocol: string;
  /** Per-command response timeout. */
  timeoutMs: number;
  /** Delay before reconnecting after a link failure. */
  reconnectDelayMs: number;
  /** How often to read stored/pending DTCs. */
  dtcIntervalMs: number;
  customPids: CustomPidConfig[];
}

export type DrivingContext = 'parked' | 'stopped' | 'city' | 'highway';

export const DRIVING_CONTEXTS: readonly DrivingContext[] = ['parked', 'stopped', 'city', 'highway'];

export interface ContextConfig {
  /** Enter 'highway' above this speed (sustained for `highwayDwellMs`). */
  highwayEnterKph: number;
  /** Leave 'highway' below this speed (hysteresis). */
  highwayExitKph: number;
  highwayDwellMs: number;
  /** Below this speed the vehicle counts as stationary. */
  stationaryKph: number;
  /** Complete standstill with the engine running for this long ⇒ 'parked'. */
  parkedAfterMs: number;
  /**
   * Standstill with the engine off for this long ⇒ 'parked'. Not immediate, so an automatic
   * start-stop system does not bring up the parked dashboard at every red light. An ECU that
   * stops answering altogether (ignition off) still parks immediately.
   */
  engineOffParkedAfterMs: number;
}

export type WidgetId =
  | 'speed'
  | 'speedLimit'
  | 'tachometer'
  | 'gear'
  | 'nav'
  | 'lanes'
  | 'eta'
  | 'hazard'
  | 'fuel'
  | 'coolant'
  | 'voltage'
  | 'tpms'
  | 'clock'
  | 'outsideTemp'
  | 'media'
  | 'boost'
  | 'tripSummary';

/** 3×3 grid on the projected image. */
export type Zone =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export interface WidgetPlacement {
  id: WidgetId;
  zone: Zone;
  /** Contexts in which the widget may appear ("adaptive clutter"). Conditional widgets still hide when irrelevant. */
  contexts: DrivingContext[];
}

export type LayoutPreset = 'minimal' | 'standard' | 'sport' | 'custom';

export interface LayoutConfig {
  preset: LayoutPreset;
  /** Ignored unless preset is 'custom'; otherwise the preset's placements are used. */
  widgets: WidgetPlacement[];
}

export interface ProjectionConfig {
  /** Mirror horizontally — required when the image is reflected off the windshield. */
  mirrorX: boolean;
  mirrorY: boolean;
  /** Rotation in degrees (0, 90, 180, 270). */
  rotation: 0 | 90 | 180 | 270;
  /** Uniform scale of the drawn content (0.5–1.5). */
  scale: number;
  /** Content offset as a fraction of the screen (−0.5–0.5). */
  offsetX: number;
  offsetY: number;
  /**
   * Keystone / windshield-curvature correction: where the four corners of the content end up,
   * as fractions of the screen (0–1). Identity is TL(0,0) TR(1,0) BR(1,1) BL(0,1).
   */
  corners: {
    tl: [number, number];
    tr: [number, number];
    br: [number, number];
    bl: [number, number];
  };
  /** Draw an alignment grid instead of the HUD (used while calibrating on the windshield). */
  showGrid: boolean;
}

export type NightModeSource = 'sensor' | 'sun' | 'always' | 'never';

export interface BrightnessConfig {
  mode: 'auto' | 'manual';
  /** Used when mode is 'manual' (0–1). */
  manualLevel: number;
  minLevel: number;
  maxLevel: number;
  /** Piecewise-linear lux → level curve, sorted by lux; interpolated on log10(lux). */
  curve: Array<[lux: number, level: number]>;
  /** Time constant when getting brighter (slow, avoids flicker under trees). */
  riseTimeMs: number;
  /** Time constant when getting darker (fast, e.g. entering a tunnel). */
  fallTimeMs: number;
  nightMode: NightModeSource;
  /** Sensor mode: enter night below this lux, leave above `nightExitLux`. */
  nightEnterLux: number;
  nightExitLux: number;
  /** Sun mode: night when the sun is below this elevation (degrees). */
  nightSunElevationDeg: number;
}

export type SpeedLimitSignStyle = 'vienna' | 'mutcd';

export interface DisplayConfig {
  projection: ProjectionConfig;
  brightness: BrightnessConfig;
  layout: LayoutConfig;
  context: ContextConfig;
  /** 'vienna' = red ring (most of the world); 'mutcd' = US/Canada rectangle. */
  speedLimitSign: SpeedLimitSignStyle;
  /** Show the song/artist toast for this long after a track change. */
  mediaToastMs: number;
  /** Show a message-sender toast for this long. */
  messageToastMs: number;
  /** Show nav only within this distance of the next maneuver while on the highway. */
  highwayNavRevealM: number;
  /** Show lane guidance only within this distance of the maneuver. */
  laneRevealM: number;
  /** Show a hazard only within this distance. */
  hazardRevealM: number;
  /** Maximum simultaneously displayed alert banners. */
  maxAlerts: number;
}

export interface ShiftLightConfig {
  enabled: boolean;
  /** Bar starts filling here. */
  startRpm: number;
  /** Bar full / optimal shift point. */
  shiftRpm: number;
  /** Flash above this. */
  flashRpm: number;
}

export interface AlertThresholdsConfig {
  /** Coolant ≥ this ⇒ warning. */
  coolantHighC: number;
  /** Coolant ≥ this ⇒ critical. */
  coolantCriticalC: number;
  /** Hysteresis applied when clearing temperature alerts. */
  coolantHysteresisC: number;
  /** Engine running and voltage ≤ this ⇒ charging-system warning. */
  voltageLowRunningV: number;
  /** Engine off and voltage ≤ this ⇒ weak-battery caution. */
  voltageLowOffV: number;
  /** Voltage ≥ this ⇒ over-voltage warning. */
  voltageHighV: number;
  voltageHysteresisV: number;
  /** Speed is "over the limit" when above limit + tolerance. */
  overspeedToleranceKph: number;
  /** …or above limit × (1 + pct/100), whichever is larger. */
  overspeedTolerancePct: number;
  /** Fuel level (%) at which to warn. */
  fuelLowPct: number;
  /** Tyre pressure (kPa gauge) below which to warn. */
  tpmsLowKpa: number;
  /** Outside temperature at or below which to show an ice-risk caution. */
  iceRiskC: number;
  /** Whether informational check-engine alerts may show while moving (otherwise only when stopped/parked). */
  showDtcWhileDriving: boolean;
}

export interface MaintenanceItemConfig {
  id: string;
  label: string;
  intervalKm: number | null;
  intervalDays: number | null;
  warnBeforeKm: number;
  warnBeforeDays: number;
}

export interface MaintenanceConfig {
  items: MaintenanceItemConfig[];
}

export interface TripConfig {
  /** A trip ends after the engine has been off (or the link down) this long. */
  endAfterEngineOffMs: number;
  /** Trips shorter than this distance are discarded. */
  minDistanceKm: number;
}

export interface PhoneConfig {
  /** Shared secret the companion app must present in `hello`. Empty = no pairing required. */
  pairingToken: string;
  /** Show who sent a message (content is never shown). */
  showMessageSender: boolean;
  /** Ask the phone to read messages aloud. */
  readMessagesAloud: boolean;
  /** Show song/artist on track change. */
  showMedia: boolean;
}

export type LightSensorKind = 'none' | 'bh1750' | 'veml7700' | 'tsl2591';
export type GestureSensorKind = 'none' | 'apds9960';

export interface SensorsConfig {
  lightSensor: LightSensorKind;
  gestureSensor: GestureSensorKind;
  i2cBus: number;
  /** Lux multiplier compensating for the sensor window / tint. */
  lightSensorGain: number;
  /** Optional GPIO buttons (BCM numbering; null = unused). Read through libgpiod `gpiomon`. */
  buttons: {
    primary: number | null;
    secondary: number | null;
    next: number | null;
  };
  /** Optional fixed location for sun-based night mode when no phone location is available. */
  fallbackLocation: { lat: number; lon: number } | null;
  /** Optional ADAS module feed (newline-delimited JSON over UDP). */
  adasUdpPort: number | null;
  /**
   * IPv4 / IPv6 addresses the ADAS feed accepts datagrams from (compared in canonical form, see
   * `normalizeIpAddress`; an IPv4-mapped IPv6 address equals its IPv4 address). Empty = any
   * sender, which lets anyone on the car's network raise or hide collision warnings.
   */
  adasAllowedSenders: string[];
}

export interface ServerConfig {
  port: number;
  /** Bind address; "0.0.0.0" to allow the phone on the car's Wi-Fi. */
  host: string;
  /** Bearer token required for the config API from non-local clients. Empty = open. */
  apiToken: string;
  /** Advertise `_carheadsup._tcp` over mDNS so the phone can find the HUD. */
  mdns: boolean;
  /** Frames per second pushed to the renderer. */
  frameRate: number;
}

export interface HudConfig {
  version: 1;
  units: UnitsConfig;
  vehicle: VehicleConfig;
  obd: ObdConfig;
  display: DisplayConfig;
  shiftLight: ShiftLightConfig;
  alerts: AlertThresholdsConfig;
  maintenance: MaintenanceConfig;
  trip: TripConfig;
  phone: PhoneConfig;
  sensors: SensorsConfig;
  server: ServerConfig;
}

/** Recursive partial used for config patches. Arrays and tuples are replaced wholesale. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
