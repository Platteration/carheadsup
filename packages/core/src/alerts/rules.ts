import type { Alert, AlertKind, AlertSeverity } from '../types/alerts.ts';
import type { HudConfig } from '../types/config.ts';
import type { MaintenanceItemStatus } from '../types/records.ts';
import type { SignalId, SignalMap } from '../types/signals.ts';
import type { HudState } from '../types/state.ts';
import { lookupDtc } from '../obd/dtc-lookup.ts';
import {
  freshSignal,
  freshSupplyVoltage,
  isAdasFresh,
  isEngineRunning,
  isObdLinkUp,
} from '../state/selectors.ts';
import {
  formatDays,
  formatLongDistance,
  formatPressure,
  formatTemperature,
  formatVoltage,
  truncateText,
} from './format.ts';

/**
 * What a rule wants the alert under `key` to look like now. The engine turns specs into
 * `Alert`s, carrying over raise/dismiss bookkeeping from the previous evaluation.
 */
export interface AlertSpec {
  key: string;
  kind: AlertKind;
  severity: AlertSeverity;
  /** ≤ 24 characters. */
  title: string;
  detail: string | null;
  code: string | null;
  /**
   * Rule-managed raise time. A time in the future schedules the alert: it is tracked but not
   * displayed until then (used to require a condition to persist). Default: kept from the
   * previous alert, or now for new and escalated alerts.
   */
  raisedAt?: number;
  /** Auto-clear time for transient alerts. Default: kept from the previous alert, else null. */
  expiresAt?: number | null;
  /**
   * A new occurrence under an existing key (e.g. a different voltage fault): forget the
   * previous alert's raise and dismiss state.
   */
  renew?: boolean;
}

export interface RuleContext {
  state: HudState;
  config: HudConfig;
  now: number;
  /** The alert under `key` from the previous evaluation, including hidden ones. */
  previous(key: string): Alert | undefined;
}

export type AlertRule = (ctx: RuleContext) => AlertSpec[];

const NONE: AlertSpec[] = [];

// ---------------------------------------------------------------------------------------------
// Coolant

export function coolantRule({ state, config, previous }: RuleContext): AlertSpec[] {
  const temp = freshSignal(state, 'coolantTemp');
  if (temp === null) return NONE;
  const prev = previous('coolant');
  const {
    coolantHighC: high,
    coolantCriticalC: critical,
    coolantHysteresisC: hyst,
  } = config.alerts;
  let severity: 'warning' | 'critical';
  if (temp >= critical || (prev?.severity === 'critical' && temp >= critical - hyst)) {
    severity = 'critical';
  } else if (temp >= high || (prev !== undefined && temp >= high - hyst)) {
    severity = 'warning';
  } else {
    return NONE;
  }
  return [
    {
      key: 'coolant',
      kind: 'coolant',
      severity,
      title: severity === 'critical' ? 'OVERHEATING – STOP' : 'ENGINE HOT',
      detail: `Coolant ${formatTemperature(temp, config)}`,
      code: null,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Supply voltage

type VoltageFault = 'charging' | 'battery-low' | 'overvoltage';

/**
 * Every voltage fault must persist before it is raised. Charging faults need a full minute
 * (the alternator is still ramping up after a start, and idle loads dip briefly). The others
 * need 10 s: this is the "ignore the first 10 s after engine start" rule — the state has no
 * engine-start timestamp, but a start-up transient is by definition younger than 10 s — and it
 * also rides through cranking dips (the engine counts as off while cranking) and load dumps.
 */
export const VOLTAGE_FAULTS: Readonly<
  Record<VoltageFault, { title: string; severity: AlertSeverity; sustainMs: number }>
> = {
  charging: { title: 'CHARGING FAULT', severity: 'warning', sustainMs: 60_000 },
  'battery-low': { title: 'BATTERY LOW', severity: 'caution', sustainMs: 10_000 },
  overvoltage: { title: 'OVERVOLTAGE', severity: 'warning', sustainMs: 10_000 },
};

function voltageFaultOf(alert: Alert | undefined): VoltageFault | null {
  if (alert === undefined) return null;
  for (const [fault, def] of Object.entries(VOLTAGE_FAULTS) as [
    VoltageFault,
    (typeof VOLTAGE_FAULTS)[VoltageFault],
  ][]) {
    if (def.title === alert.title) return fault;
  }
  return null;
}

export function voltageRule({ state, config, now, previous }: RuleContext): AlertSpec[] {
  const volts = freshSupplyVoltage(state);
  if (volts === null) return NONE;
  const prev = previous('voltage');
  const prevFault = voltageFaultOf(prev);
  const running = isEngineRunning(state);
  const {
    voltageHighV: high,
    voltageLowRunningV: lowRunning,
    voltageLowOffV: lowOff,
    voltageHysteresisV: hyst,
  } = config.alerts;

  // A fault holds past its threshold only while it is already being tracked (hysteresis).
  let fault: VoltageFault;
  if (volts >= high || (prevFault === 'overvoltage' && volts >= high - hyst)) {
    fault = 'overvoltage';
  } else if (
    running &&
    (volts <= lowRunning || (prevFault === 'charging' && volts <= lowRunning + hyst))
  ) {
    fault = 'charging';
  } else if (
    !running &&
    (volts <= lowOff || (prevFault === 'battery-low' && volts <= lowOff + hyst))
  ) {
    fault = 'battery-low';
  } else {
    return NONE;
  }

  const def = VOLTAGE_FAULTS[fault];
  const continuing = prev !== undefined && prevFault === fault;
  const detail =
    fault === 'charging'
      ? `${formatVoltage(volts)}, engine running`
      : fault === 'battery-low'
        ? `${formatVoltage(volts)}, engine off`
        : formatVoltage(volts);
  return [
    {
      key: 'voltage',
      kind: 'voltage',
      severity: def.severity,
      title: def.title,
      detail,
      code: null,
      raisedAt: continuing ? prev.raisedAt : now + def.sustainMs,
      renew: !continuing,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Trouble codes

/**
 * One alert per code. Confirmed (stored / permanent) codes take their severity from the DTC
 * database; codes that are only pending are informational until the ECU confirms them.
 */
export function checkEngineRule({ state }: RuleContext): AlertSpec[] {
  const dtcs = state.vehicle.dtcs;
  if (dtcs.length === 0) return NONE;
  const confirmed = new Map<string, boolean>();
  for (const entry of dtcs) {
    confirmed.set(entry.code, (confirmed.get(entry.code) ?? false) || entry.kind !== 'pending');
  }
  const specs: AlertSpec[] = [];
  for (const [code, isConfirmed] of confirmed) {
    const info = lookupDtc(code);
    specs.push({
      key: `check-engine:${info.code}`,
      kind: 'check-engine',
      severity: isConfirmed ? info.severity : 'info',
      title: 'CHECK ENGINE',
      detail: `${info.code} – ${info.short}`,
      code: info.code,
    });
  }
  return specs;
}

// ---------------------------------------------------------------------------------------------
// Fuel

/** A low-fuel alert clears only once the level is this many points above the threshold. */
export const FUEL_LOW_HYSTERESIS_PCT = 2;

export function fuelLowRule({ state, config, previous }: RuleContext): AlertSpec[] {
  if (freshSignal(state, 'fuelLevel') === null) return NONE;
  const { levelPct, rangeKm } = state.fuel.readings;
  if (levelPct === null) return NONE;
  const threshold = config.alerts.fuelLowPct;
  const holding = previous('fuel-low') !== undefined;
  if (!(levelPct <= threshold || (holding && levelPct <= threshold + FUEL_LOW_HYSTERESIS_PCT))) {
    return NONE;
  }
  return [
    {
      key: 'fuel-low',
      kind: 'fuel-low',
      severity: 'caution',
      title: 'FUEL LOW',
      detail:
        rangeKm !== null && Number.isFinite(rangeKm)
          ? `Range ${formatLongDistance(rangeKm, config)}`
          : `${Math.round(levelPct)} % left`,
      code: null,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Maintenance

function maintenanceWhen(item: MaintenanceItemStatus, config: HudConfig): string {
  const { remainingKm: km, remainingDays: days } = item;
  const distance = (v: number): string => formatLongDistance(v, config);
  if (item.status === 'overdue') {
    if (km !== null && km <= 0) return km === 0 ? 'due now' : `${distance(-km)} overdue`;
    if (days !== null && days <= 0)
      return days === 0 ? 'due today' : `${formatDays(-days)} overdue`;
    return 'overdue';
  }
  // Due soon: name the dimension whose warning window has been reached (distance first).
  const itemConfig = config.maintenance.items.find((i) => i.id === item.itemId);
  const kmDue = km !== null && (itemConfig === undefined || km <= itemConfig.warnBeforeKm);
  if (km !== null && (kmDue || days === null)) return `in ${distance(km)}`;
  if (days !== null) return `in ${formatDays(days)}`;
  return 'due soon';
}

/** One alert per item that is due soon (info) or overdue (caution). */
export function maintenanceRule({ state, config }: RuleContext): AlertSpec[] {
  const specs: AlertSpec[] = [];
  for (const item of state.maintenance.status) {
    if (item.status !== 'due-soon' && item.status !== 'overdue') continue;
    const overdue = item.status === 'overdue';
    specs.push({
      key: `maintenance-due:${item.itemId}`,
      kind: 'maintenance-due',
      severity: overdue ? 'caution' : 'info',
      title: overdue ? 'SERVICE OVERDUE' : 'SERVICE DUE',
      detail: `${item.label} – ${maintenanceWhen(item, config)}`,
      code: null,
    });
  }
  return specs;
}

// ---------------------------------------------------------------------------------------------
// Tyres

/** A tyre stays "low" for the alert until it is this much above the threshold (kPa). */
export const TPMS_HYSTERESIS_KPA = 7;

export const TYRES: ReadonlyArray<{ signal: SignalId; name: string }> = [
  { signal: 'tirePressureFL', name: 'Front left' },
  { signal: 'tirePressureFR', name: 'Front right' },
  { signal: 'tirePressureRL', name: 'Rear left' },
  { signal: 'tirePressureRR', name: 'Rear right' },
];

export function tpmsRule({ state, config, previous }: RuleContext): AlertSpec[] {
  if (!config.vehicle.hasTpms) return NONE;
  const limit =
    config.alerts.tpmsLowKpa + (previous('tpms') !== undefined ? TPMS_HYSTERESIS_KPA : 0);
  let lowest: { name: string; kpa: number } | null = null;
  let lowCount = 0;
  for (const tyre of TYRES) {
    const kpa = freshSignal(state, tyre.signal);
    if (kpa === null || kpa >= limit) continue;
    lowCount++;
    if (lowest === null || kpa < lowest.kpa) lowest = { name: tyre.name, kpa };
  }
  if (lowest === null) return NONE;
  const more = lowCount > 1 ? ` +${lowCount - 1}` : '';
  return [
    {
      key: 'tpms',
      kind: 'tpms',
      severity: 'warning',
      title: 'TYRE PRESSURE LOW',
      detail: `${lowest.name} ${formatPressure(lowest.kpa, config)}${more}`,
      code: null,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Ice

/** The ice-risk caution shows for this long … */
export const ICE_RISK_SHOW_MS = 10_000;
/** … and is re-armed only after the outside temperature rises this far above the threshold. */
export const ICE_RISK_REARM_C = 2;

export function iceRiskRule({ state, config, now, previous }: RuleContext): AlertSpec[] {
  const ambient = freshSignal(state, 'ambientTemp');
  const threshold = config.alerts.iceRiskC;
  const prev = previous('ice-risk');
  if (prev !== undefined) {
    // Latched (and hidden once expired) until it warms up clearly; an unknown temperature keeps it.
    if (ambient !== null && ambient > threshold + ICE_RISK_REARM_C) return NONE;
    return [
      {
        key: prev.key,
        kind: 'ice-risk',
        severity: prev.severity,
        title: prev.title,
        detail: prev.detail,
        code: null,
      },
    ];
  }
  if (ambient === null || ambient > threshold) return NONE;
  return [
    {
      key: 'ice-risk',
      kind: 'ice-risk',
      severity: 'caution',
      title: 'ICE RISK',
      detail: `Outside ${formatTemperature(ambient, config)}`,
      code: null,
      expiresAt: now + ICE_RISK_SHOW_MS,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Forward collision

export function forwardCollisionRule({ state }: RuleContext): AlertSpec[] {
  const { adas } = state;
  if (adas.collision === 'none' || !isAdasFresh(state, adas.collisionUpdatedAt)) return NONE;
  const ttc = adas.ttcSeconds;
  const critical = adas.collision === 'warning';
  return [
    {
      key: 'forward-collision',
      kind: 'forward-collision',
      severity: critical ? 'critical' : 'caution',
      title: critical ? 'BRAKE!' : 'VEHICLE AHEAD',
      detail:
        ttc !== null && Number.isFinite(ttc) && ttc >= 0 ? `Impact in ${ttc.toFixed(1)} s` : null,
      code: null,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// OBD link

/** The OBD-link notice appears once no vehicle data has arrived for this long. */
export const OBD_LINK_ALERT_AFTER_MS = 10_000;

function latestSampleAt(signals: SignalMap): number | null {
  let latest: number | null = null;
  for (const sample of Object.values(signals)) {
    if (sample !== undefined && (latest === null || sample.at > latest)) latest = sample.at;
  }
  return latest;
}

/**
 * Informational notice when the adapter link has been down for 10 s after having delivered
 * data. "Down" is any state but 'connected', measured from the last sample, so an adapter
 * cycling through connecting → initializing → error still counts as one outage.
 */
export function obdLinkRule({ state, now }: RuleContext): AlertSpec[] {
  if (isObdLinkUp(state)) return NONE;
  const lastDataAt = latestSampleAt(state.vehicle.signals);
  if (lastDataAt === null || now - lastDataAt < OBD_LINK_ALERT_AFTER_MS) return NONE;
  const { link } = state.vehicle;
  const detail =
    link.message !== null && link.message.trim() !== ''
      ? truncateText(link.message, 40)
      : link.state === 'error'
        ? 'Adapter error'
        : 'Reconnecting…';
  return [
    {
      key: 'obd-link',
      kind: 'obd-link',
      severity: 'info',
      title: 'OBD LINK LOST',
      detail,
      code: null,
    },
  ];
}

/** Evaluation order; it is also the order of alerts in `HudState.alerts`. */
export const ALERT_RULES: readonly AlertRule[] = [
  forwardCollisionRule,
  coolantRule,
  voltageRule,
  checkEngineRule,
  tpmsRule,
  fuelLowRule,
  iceRiskRule,
  maintenanceRule,
  obdLinkRule,
];
