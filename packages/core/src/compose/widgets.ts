import { tpmsLowLimitKpa, unavailableTyres, voltageFaultOf } from '../alerts/rules.ts';
import { resolveLayout } from '../config/config.ts';
import {
  ENGINE_RUNNING_RPM,
  freshSignal,
  freshSpeedKph,
  freshSupplyVoltage,
  hazardDistanceM,
  navDistanceM,
  navRemainingM,
  wallNow,
} from '../state/selectors.ts';
import type { DisplayConfig, DrivingContext, HudConfig, WidgetId, Zone } from '../types/config.ts';
import type {
  BoostWidget,
  ClockWidget,
  CoolantWidget,
  EtaWidget,
  FuelWidget,
  GearWidget,
  HazardWidget,
  LanesWidget,
  MediaWidget,
  NavWidget,
  OutsideTempWidget,
  SpeedLimitWidget,
  SpeedWidget,
  TachometerWidget,
  TireReading,
  TpmsWidget,
  TripSummaryWidget,
  VoltageWidget,
  WidgetFrame,
  WidgetFrameById,
} from '../types/frame.ts';
import type { Alert } from '../types/alerts.ts';
import type { Hazard, HazardType, Maneuver, NavInfo } from '../types/nav.ts';
import type { SignalId } from '../types/signals.ts';
import type { HudState } from '../types/state.ts';
import {
  clamp,
  convertEconomy,
  displayLongDistance,
  displayPressure,
  displaySpeed,
  displayTemperature,
  formatNavDistance,
  pressureUnitLabel,
  roundTo,
  speedUnitLabel,
  temperatureUnitLabel,
} from '../units.ts';
import { displayTrip } from './records.ts';

/** A maneuver closer than this is "imminent" (emphasised countdown). */
export const NAV_IMMINENT_M = 200;
/** The approach progress bar covers the last stretch before the maneuver. */
export const NAV_APPROACH_M = 300;
/** Standard atmosphere, used for boost when the barometric PID is unavailable. */
export const STANDARD_BARO_KPA = 101.3;
/** Boost gauge span (manifold gauge pressure, kPa): full vacuum … +1.6 bar. */
export const BOOST_GAUGE_MIN_KPA = -100;
export const BOOST_GAUGE_MAX_KPA = 160;

interface WidgetEnv {
  state: HudState;
  config: HudConfig;
  context: DrivingContext;
  moving: boolean;
}

type Builder<I extends WidgetId> = (env: WidgetEnv, zone: Zone) => WidgetFrameById<I> | null;
type AnyBuilder = (env: WidgetEnv, zone: Zone) => WidgetFrame | null;

/**
 * The layout's widgets for the current context, each included only when relevant and backed by
 * current data (adaptive clutter), in layout (priority) order.
 */
export function composeWidgets(state: HudState, config: HudConfig): WidgetFrame[] {
  const context = state.context.context;
  const env: WidgetEnv = {
    state,
    config,
    context,
    moving: context === 'city' || context === 'highway',
  };
  const widgets: WidgetFrame[] = [];
  const seen = new Set<WidgetId>();
  for (const placement of resolveLayout(config)) {
    if (seen.has(placement.id) || !placement.contexts.includes(context)) continue;
    seen.add(placement.id);
    const widget = buildWidget(placement.id, env, placement.zone);
    if (widget !== null) widgets.push(widget);
  }
  return widgets;
}

function buildWidget(id: WidgetId, env: WidgetEnv, zone: Zone): WidgetFrame | null {
  // Unknown ids (e.g. a layout written by a newer version) are skipped.
  if (!Object.hasOwn(BUILDERS, id)) return null;
  const builder: AnyBuilder = BUILDERS[id];
  return builder(env, zone);
}

// ---------------------------------------------------------------------------------------------
// Speed

/** The posted limit while the phone is connected: km/h, `unlimited`, or null when unknown. */
function roadLimit(state: HudState): { kph: number | null; unlimited: boolean } | null {
  const { road } = state;
  if (!state.phone.connected || road === null) return null;
  if (road.unlimited) return { kph: null, unlimited: true };
  const kph = road.speedLimitKph;
  return kph !== null && Number.isFinite(kph) && kph > 0 ? { kph, unlimited: false } : null;
}

function speedWidget({ state, config }: WidgetEnv, zone: Zone): SpeedWidget | null {
  const kph = freshSpeedKph(state);
  if (kph === null) return null;
  const { system } = config.units;
  const value = displaySpeed(kph, system);
  const limitKph = roadLimit(state)?.kph ?? null;
  let overBy: number | null = null;
  if (limitKph !== null) {
    const { overspeedToleranceKph: tolKph, overspeedTolerancePct: tolPct } = config.alerts;
    const threshold = limitKph + Math.max(tolKph, (limitKph * tolPct) / 100);
    if (kph > threshold) overBy = Math.max(1, value - displaySpeed(limitKph, system));
  }
  return {
    id: 'speed',
    zone,
    value,
    unit: speedUnitLabel(system),
    overLimit: overBy !== null,
    overBy,
  };
}

function speedLimitWidget({ state, config }: WidgetEnv, zone: Zone): SpeedLimitWidget | null {
  const limit = roadLimit(state);
  if (limit === null) return null;
  const { system } = config.units;
  return {
    id: 'speedLimit',
    zone,
    value: limit.kph === null ? null : displaySpeed(limit.kph, system),
    unlimited: limit.unlimited,
    unit: speedUnitLabel(system),
    style: config.display.speedLimitSign,
  };
}

// ---------------------------------------------------------------------------------------------
// Engine

function tachometerWidget({ state, config }: WidgetEnv, zone: Zone): TachometerWidget | null {
  const rpm = freshSignal(state, 'rpm');
  if (rpm === null || rpm < ENGINE_RUNNING_RPM) return null;
  const redlineRpm = config.vehicle.redlineRpm;
  return {
    id: 'tachometer',
    zone,
    rpm: Math.round(rpm),
    fraction: redlineRpm > 0 ? roundTo(clamp(rpm / redlineRpm, 0, 1), 3) : 0,
    redlineRpm,
  };
}

function gearWidget({ state, config }: WidgetEnv, zone: Zone): GearWidget | null {
  if (config.vehicle.transmission === 'cvt') return null;
  const { gear, inferred } = state.gear.estimate;
  if (gear === null) return null;
  // Belt and braces: never show a gear the current data cannot back.
  const inferable = freshSignal(state, 'speed') !== null && freshSignal(state, 'rpm') !== null;
  if (!inferable && freshSignal(state, 'transmissionGear') === null) return null;
  return { id: 'gear', zone, gear: String(gear), inferred };
}

function boostWidget({ state, config }: WidgetEnv, zone: Zone): BoostWidget | null {
  const map = freshSignal(state, 'map');
  if (map === null) return null;
  const baro = freshSignal(state, 'baroPressure');
  const gaugeKpa = map - (baro !== null && baro > 0 ? baro : STANDARD_BARO_KPA);
  const unit = config.units.pressure;
  const span = BOOST_GAUGE_MAX_KPA - BOOST_GAUGE_MIN_KPA;
  return {
    id: 'boost',
    zone,
    value: displayPressure(gaugeKpa, unit),
    unit: pressureUnitLabel(unit),
    fraction: roundTo(clamp((gaugeKpa - BOOST_GAUGE_MIN_KPA) / span, 0, 1), 3),
  };
}

/**
 * The alert under `key` once it has been raised (dismissed or not). The out-of-range widgets
 * follow their alert rather than bare thresholds, so they share its hysteresis and its
 * persistence time and do not flicker with a reading that straddles a threshold.
 */
function raisedAlert(state: HudState, key: string): Alert | undefined {
  return state.alerts.find((a) => a.key === key && a.raisedAt <= state.now);
}

/** Coolant temperature while the overheating alert is up. */
function coolantWidget({ state, config }: WidgetEnv, zone: Zone): CoolantWidget | null {
  const temp = freshSignal(state, 'coolantTemp');
  const alert = raisedAlert(state, 'coolant');
  if (temp === null || alert === undefined) return null;
  const unit = config.units.temperature;
  return {
    id: 'coolant',
    zone,
    value: displayTemperature(temp, unit),
    unit: temperatureUnitLabel(unit),
    status: alert.severity === 'critical' ? 'critical' : 'hot',
  };
}

/** Supply voltage while a voltage alert is up (after its persistence time: no cranking dips). */
function voltageWidget({ state }: WidgetEnv, zone: Zone): VoltageWidget | null {
  const volts = freshSupplyVoltage(state);
  const fault = voltageFaultOf(raisedAlert(state, 'voltage'));
  if (volts === null || fault === null) return null;
  const status = fault === 'overvoltage' ? 'high' : 'low';
  return { id: 'voltage', zone, value: roundTo(volts, 1), status };
}

// ---------------------------------------------------------------------------------------------
// Navigation

interface NavView {
  info: NavInfo;
  /** Dead-reckoned distance to the maneuver, metres. */
  distanceM: number | null;
}

/** Active guidance, unless hidden on the highway until the maneuver is within reveal range. */
function navView({ state, config, context }: WidgetEnv): NavView | null {
  if (state.nav === null) return null;
  const distanceM = navDistanceM(state);
  if (
    context === 'highway' &&
    (distanceM === null || distanceM > config.display.highwayNavRevealM)
  ) {
    return null;
  }
  return { info: state.nav.info, distanceM };
}

/** The nav app's raw instruction text is detail for when the vehicle is not moving. */
function glanceable(maneuver: Maneuver, moving: boolean): Maneuver {
  return moving && maneuver.instruction != null ? { ...maneuver, instruction: null } : maneuver;
}

function navWidget(env: WidgetEnv, zone: Zone): NavWidget | null {
  const view = navView(env);
  if (view === null) return null;
  const { info, distanceM: d } = view;
  return {
    id: 'nav',
    zone,
    maneuver: glanceable(info.maneuver, env.moving),
    distance: d === null ? null : formatNavDistance(d, env.config.units.system),
    street: info.street,
    then: info.thenManeuver === null ? null : glanceable(info.thenManeuver, env.moving),
    // The renderer draws every known maneuver itself; the phone's bitmap is only the fallback
    // for 'unknown' ones. Leaving it out otherwise keeps up to 44 KiB of base64 out of every
    // frame (the companion app sends the icon with each update, parsed maneuver or not).
    iconPng: info.maneuver.type === 'unknown' ? info.iconPng : null,
    imminent: d !== null && d < NAV_IMMINENT_M,
    approach: d !== null && d <= NAV_APPROACH_M ? roundTo(1 - d / NAV_APPROACH_M, 2) : null,
  };
}

function lanesWidget(env: WidgetEnv, zone: Zone): LanesWidget | null {
  const view = navView(env);
  const lanes = view?.info.lanes;
  if (view === null || lanes === null || lanes === undefined || lanes.length === 0) return null;
  const d = view.distanceM;
  if (d === null || d > env.config.display.laneRevealM) return null;
  return { id: 'lanes', zone, lanes };
}

/**
 * The phone's ETA is a wall-clock time, so the remaining minutes are counted on the wall clock —
 * not while that is untrusted (`ClockState.trusted`: only a lower bound, possibly days behind):
 * then only the phone's own count of the remaining time gives them.
 */
function etaWidget({ state, config }: WidgetEnv, zone: Zone): EtaWidget | null {
  if (state.nav === null) return null;
  const { etaEpochMs, remainingSeconds, remainingDistanceM } = state.nav.info;
  if (etaEpochMs === null && remainingSeconds === null && remainingDistanceM === null) return null;
  let remainingMinutes: number | null = null;
  if (remainingSeconds !== null && Number.isFinite(remainingSeconds)) {
    remainingMinutes = Math.max(0, Math.round(remainingSeconds / 60));
  } else if (etaEpochMs !== null && Number.isFinite(etaEpochMs) && state.clock.trusted) {
    remainingMinutes = Math.max(0, Math.round((etaEpochMs - wallNow(state)) / 60_000));
  }
  const remainingM = navRemainingM(state);
  return {
    id: 'eta',
    zone,
    etaEpochMs,
    clock: config.units.clock,
    remainingMinutes,
    remainingDistance:
      remainingM === null ? null : formatNavDistance(remainingM, config.units.system),
  };
}

const HAZARD_LABELS: Readonly<Record<HazardType, string>> = {
  'speed-camera': 'Speed camera',
  'red-light-camera': 'Red light camera',
  'section-control': 'Section control',
  police: 'Police',
  accident: 'Accident',
  'road-works': 'Road works',
  'traffic-jam': 'Traffic jam',
  slowdown: 'Slowdown',
  'object-on-road': 'Object on road',
  weather: 'Weather',
  'school-zone': 'School zone',
  'railway-crossing': 'Railway crossing',
  other: 'Hazard',
};

/**
 * Short label, chosen by the HUD from the hazard type. The phone's free-text description is used
 * only for 'other', kept glanceable, and only while the vehicle is not moving: a moving driver
 * gets the fixed "Hazard" label, never third-party text to read.
 */
export function hazardLabel(hazard: Hazard, moving = false): string {
  if (!moving && hazard.type === 'other' && hazard.description !== null) {
    const text = hazard.description.trim();
    if (text !== '') return text.length <= 24 ? text : `${text.slice(0, 23).trimEnd()}…`;
  }
  return HAZARD_LABELS[hazard.type] ?? HAZARD_LABELS.other;
}

/** Hazard types that slow traffic down: on the highway they appear from `trafficRevealM`. */
export const TRAFFIC_HAZARD_TYPES: readonly HazardType[] = [
  'traffic-jam',
  'slowdown',
  'accident',
  'road-works',
];

/** A traffic hazard: a jam, slowdown, accident or road works, or anything with a delay. */
export function isTrafficHazard(hazard: Hazard): boolean {
  if (TRAFFIC_HAZARD_TYPES.includes(hazard.type)) return true;
  const delay = hazard.delaySeconds;
  return delay !== null && Number.isFinite(delay) && delay > 0;
}

/**
 * How close `hazard` must be to appear: `hazardRevealM`, or on the highway for a traffic hazard
 * the longer `trafficRevealM` — at 130 km/h, 1 km is under 30 s to the end of a jam.
 */
export function hazardRevealDistanceM(
  hazard: Hazard,
  context: DrivingContext,
  display: DisplayConfig,
): number {
  const base = display.hazardRevealM;
  if (context !== 'highway' || !isTrafficHazard(hazard)) return base;
  return Math.max(base, display.trafficRevealM);
}

/** A traffic delay in whole minutes; null when unknown or under half a minute. */
export function delayMinutes(delaySeconds: number | null): number | null {
  if (delaySeconds === null || !Number.isFinite(delaySeconds)) return null;
  const minutes = Math.round(delaySeconds / 60);
  return minutes >= 1 ? minutes : null;
}

/** The nearest hazard ahead within reveal range (dead-reckoned; passed hazards are skipped). */
function hazardWidget(
  { state, config, context, moving }: WidgetEnv,
  zone: Zone,
): HazardWidget | null {
  let nearest: { hazard: Hazard; distanceM: number } | null = null;
  for (const tracked of state.hazards) {
    const d = hazardDistanceM(state, tracked);
    if (d === null || d < 0) continue;
    if (d > hazardRevealDistanceM(tracked.hazard, context, config.display)) continue;
    if (nearest === null || d < nearest.distanceM)
      nearest = { hazard: tracked.hazard, distanceM: d };
  }
  if (nearest === null) return null;
  const { hazard, distanceM } = nearest;
  const { system } = config.units;
  const limit = hazard.speedLimitKph;
  return {
    id: 'hazard',
    zone,
    type: hazard.type,
    distance: formatNavDistance(distanceM, system),
    speedLimit:
      limit !== null && Number.isFinite(limit) && limit > 0 ? displaySpeed(limit, system) : null,
    limitStyle: config.display.speedLimitSign,
    delayMinutes: delayMinutes(hazard.delaySeconds),
    label: hazardLabel(hazard, moving),
  };
}

// ---------------------------------------------------------------------------------------------
// Fuel, tyres, comfort

function fuelWidget({ state, config }: WidgetEnv, zone: Zone): FuelWidget | null {
  const readings = state.fuel.readings;
  const { system, fuelEconomy: unit } = config.units;
  const speedFresh = freshSpeedKph(state) !== null;
  const levelFresh = freshSignal(state, 'fuelLevel') !== null;
  const level = levelFresh ? readings.levelPct : null;
  const rangeKm = levelFresh ? readings.rangeKm : null;
  const instant = speedFresh ? convertEconomy(readings.instantLPer100km, unit) : null;
  const average = convertEconomy(readings.averageLPer100km, unit);
  const range =
    rangeKm !== null && Number.isFinite(rangeKm) ? displayLongDistance(rangeKm, system) : null;
  const levelPct = level !== null && Number.isFinite(level) ? Math.round(level) : null;
  if (instant === null && average === null && range === null && levelPct === null) return null;
  return {
    id: 'fuel',
    zone,
    instant,
    average,
    unit,
    range,
    rangeUnit: system === 'imperial' ? 'mi' : 'km',
    levelPct,
    low: level !== null && level <= config.alerts.fuelLowPct,
  };
}

const TYRE_SIGNALS = {
  fl: 'tirePressureFL',
  fr: 'tirePressureFR',
  rl: 'tirePressureRL',
  rr: 'tirePressureRR',
} as const satisfies Record<string, SignalId>;

/** Tyre pressures; while moving only when a tyre is low ("low" as for the tyre alert). */
function tpmsWidget({ state, config, moving }: WidgetEnv, zone: Zone): TpmsWidget | null {
  if (!config.vehicle.hasTpms) return null;
  const unit = config.units.pressure;
  const alerting = state.alerts.some((a) => a.key === 'tpms');
  const limit = tpmsLowLimitKpa(config, alerting);
  let anyLow = false;
  let anyValue = false;
  // A sensor fault is no reading (the 'TPMS UNAVAILABLE' caution says so), not a flat tyre.
  const unavailable = unavailableTyres(state);
  const tyre = (signal: SignalId): TireReading => {
    const kpa = freshSignal(state, signal);
    if (kpa === null || unavailable.has(signal)) return { value: null, low: false };
    anyValue = true;
    const low = kpa < limit;
    anyLow ||= low;
    return { value: displayPressure(kpa, unit), low };
  };
  const fl = tyre(TYRE_SIGNALS.fl);
  const fr = tyre(TYRE_SIGNALS.fr);
  const rl = tyre(TYRE_SIGNALS.rl);
  const rr = tyre(TYRE_SIGNALS.rr);
  if (!anyValue || (moving && !anyLow)) return null;
  return { id: 'tpms', zone, unit: pressureUnitLabel(unit), fl, fr, rl, rr, anyLow };
}

/**
 * The time of day — not while the wall clock is untrusted (`ClockState.trusted`: it went back
 * at start-up and only a lower bound is known): no clock is better than a wrong one.
 */
function clockWidget({ state, config }: WidgetEnv, zone: Zone): ClockWidget | null {
  if (!state.clock.trusted) return null;
  return { id: 'clock', zone, epochMs: wallNow(state), format: config.units.clock };
}

function outsideTempWidget({ state, config }: WidgetEnv, zone: Zone): OutsideTempWidget | null {
  const temp = freshSignal(state, 'ambientTemp');
  if (temp === null) return null;
  const unit = config.units.temperature;
  return {
    id: 'outsideTemp',
    zone,
    value: displayTemperature(temp, unit),
    unit: temperatureUnitLabel(unit),
    iceRisk: temp <= config.alerts.iceRiskC,
  };
}

/** Now playing, only while the phone that reports it is connected. */
function mediaWidget({ state }: WidgetEnv, zone: Zone): MediaWidget | null {
  const media = state.media?.info;
  if (!state.phone.connected || media === undefined || !media.playing) return null;
  if (media.title === null || media.title === '') return null;
  return { id: 'media', zone, title: media.title, artist: media.artist, playing: true };
}

function tripSummaryWidget({ state, config }: WidgetEnv, zone: Zone): TripSummaryWidget | null {
  const trip = state.trip.current;
  if (trip === null) return null;
  return { id: 'tripSummary', zone, ...displayTrip(trip, config.units) };
}

const BUILDERS: { readonly [I in WidgetId]: Builder<I> } = {
  speed: speedWidget,
  speedLimit: speedLimitWidget,
  tachometer: tachometerWidget,
  gear: gearWidget,
  nav: navWidget,
  lanes: lanesWidget,
  eta: etaWidget,
  hazard: hazardWidget,
  fuel: fuelWidget,
  coolant: coolantWidget,
  voltage: voltageWidget,
  tpms: tpmsWidget,
  clock: clockWidget,
  outsideTemp: outsideTempWidget,
  media: mediaWidget,
  boost: boostWidget,
  tripSummary: tripSummaryWidget,
};
