import { lookupDtc } from '../obd/dtc.ts';
import { SIGNAL_META } from '../obd/pids.ts';
import { freshSignal, isEngineRunning } from '../state/selectors.ts';
import { ALERT_SEVERITY_RANK } from '../types/alerts.ts';
import type { HudConfig } from '../types/config.ts';
import type {
  DiagnosticDtc,
  DiagnosticGauge,
  DiagnosticsFrame,
  DiagnosticsPageKind,
  GaugeStatus,
} from '../types/frame.ts';
import type {
  MaintenanceItemStatus,
  MaintenanceStatusKind,
  TripSummary,
} from '../types/records.ts';
import type { SignalId, SignalMeta } from '../types/signals.ts';
import type { HudState } from '../types/state.ts';
import type { DtcKind } from '../types/vehicle.ts';
import {
  L_PER_UK_GAL,
  L_PER_US_GAL,
  cToF,
  kmToMi,
  kpaToBar,
  kpaToPsi,
  kphToMph,
  roundTo,
} from '../units.ts';

/** The parked diagnostics dashboard. */

/** Dashboard page titles. */
export const DIAGNOSTICS_PAGE_TITLES: Readonly<Record<DiagnosticsPageKind, string>> = {
  overview: 'Overview',
  engine: 'Engine',
  fuel: 'Fuel',
  electrical: 'Electrical',
  'trouble-codes': 'Trouble codes',
  trip: 'Trip',
  maintenance: 'Maintenance',
};

/** Signals on the engine / fuel / electrical pages, in display order. */
export const DIAGNOSTICS_PAGE_SIGNALS: Readonly<
  Record<'engine' | 'fuel' | 'electrical', readonly SignalId[]>
> = {
  engine: [
    'rpm',
    'engineLoad',
    'absoluteLoad',
    'coolantTemp',
    'oilTemp',
    'intakeAirTemp',
    'throttle',
    'relativeThrottle',
    'acceleratorPedal',
    'timingAdvance',
    'map',
    'baroPressure',
    'maf',
    'runTime',
    'catalystTempB1S1',
  ],
  fuel: [
    'fuelLevel',
    'fuelRate',
    'shortFuelTrimB1',
    'longFuelTrimB1',
    'shortFuelTrimB2',
    'longFuelTrimB2',
    'commandedLambda',
    'fuelPressure',
    'fuelRailPressure',
    'ethanolPercent',
  ],
  electrical: ['batteryVoltage', 'controlModuleVoltage'],
};

/** Distance counters shown with the trouble codes. */
const DTC_PAGE_SIGNALS: readonly SignalId[] = ['distanceWithMil', 'distanceSinceClear'];
const TYRE_SIGNALS: readonly SignalId[] = [
  'tirePressureFL',
  'tirePressureFR',
  'tirePressureRL',
  'tirePressureRR',
];

/**
 * Pages in order. Engine, fuel and electrical appear only while at least one of their signals
 * has a fresh value, so the driver never pages through screens of dashes.
 */
export function diagnosticsPageKinds(state: HudState): DiagnosticsPageKind[] {
  const pages: DiagnosticsPageKind[] = ['overview'];
  for (const page of ['engine', 'fuel', 'electrical'] as const) {
    if (DIAGNOSTICS_PAGE_SIGNALS[page].some((s) => freshSignal(state, s) !== null)) {
      pages.push(page);
    }
  }
  pages.push('trouble-codes', 'trip', 'maintenance');
  return pages;
}

/** Non-negative page modulo; 0 for an empty range or a non-finite index. */
export function pageModulo(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return ((Math.trunc(index) % count) + count) % count;
}

/** The dashboard for `state.ui.page` (taken modulo the page count). */
export function composeDiagnostics(state: HudState, config: HudConfig): DiagnosticsFrame {
  const pages = diagnosticsPageKinds(state);
  const count = pages.length;
  const pageIndex = pageModulo(state.ui.page, count);
  const page = pages[pageIndex] ?? 'overview';
  const { vehicle } = state;
  const frame: DiagnosticsFrame = {
    page,
    pageIndex,
    pageCount: count,
    title: DIAGNOSTICS_PAGE_TITLES[page],
    gauges: [],
    dtcs: [],
    milOn: vehicle.milOn,
    trip: null,
    maintenance: [],
    vehicle: {
      vin: vehicle.vin,
      adapter: vehicle.link.adapter,
      protocol: vehicle.link.protocol,
    },
  };
  switch (page) {
    case 'overview':
      return {
        ...frame,
        gauges: overviewGauges(state, config),
        dtcs: diagnosticDtcs(state),
        maintenance: sortedMaintenance(state.maintenance.status).filter(
          (item) => item.status === 'due-soon' || item.status === 'overdue',
        ),
      };
    case 'engine':
    case 'fuel':
    case 'electrical':
      return { ...frame, gauges: presentGauges(state, config, DIAGNOSTICS_PAGE_SIGNALS[page]) };
    case 'trouble-codes':
      return {
        ...frame,
        gauges: presentGauges(state, config, DTC_PAGE_SIGNALS),
        dtcs: diagnosticDtcs(state),
      };
    case 'trip':
      return { ...frame, trip: tripForDashboard(state) };
    case 'maintenance':
      return { ...frame, maintenance: sortedMaintenance(state.maintenance.status) };
  }
}

// ---------------------------------------------------------------------------------------------
// Gauges

function overviewGauges(state: HudState, config: HudConfig): DiagnosticGauge[] {
  const battery = freshSignal(state, 'batteryVoltage');
  const ecuVoltage = freshSignal(state, 'controlModuleVoltage');
  const voltage: [SignalId, number | null] =
    battery === null && ecuVoltage !== null
      ? ['controlModuleVoltage', ecuVoltage]
      : ['batteryVoltage', battery];
  const fuelLevel = freshSignal(state, 'fuelLevel') === null ? null : state.fuel.readings.levelPct;
  const gauges = [
    gauge(state, config, 'coolantTemp', freshSignal(state, 'coolantTemp')),
    gauge(state, config, voltage[0], voltage[1]),
    gauge(state, config, 'fuelLevel', fuelLevel),
    gauge(state, config, 'oilTemp', freshSignal(state, 'oilTemp')),
    gauge(state, config, 'ambientTemp', freshSignal(state, 'ambientTemp')),
    gauge(state, config, 'odometer', state.odometer.km),
  ];
  if (config.vehicle.hasTpms && TYRE_SIGNALS.some((s) => freshSignal(state, s) !== null)) {
    for (const tyre of TYRE_SIGNALS)
      gauges.push(gauge(state, config, tyre, freshSignal(state, tyre)));
  }
  return gauges;
}

function presentGauges(
  state: HudState,
  config: HudConfig,
  signals: readonly SignalId[],
): DiagnosticGauge[] {
  const gauges: DiagnosticGauge[] = [];
  for (const signal of signals) {
    const value = freshSignal(state, signal);
    if (value !== null) gauges.push(gauge(state, config, signal, value));
  }
  return gauges;
}

interface DisplayUnit {
  unit: string;
  decimals: number;
  convert: (canonical: number) => number;
}

const identity = (v: number): number => v;

/** How a signal is shown in the driver's units. */
export function gaugeDisplayUnit(meta: SignalMeta, config: HudConfig): DisplayUnit {
  const { units } = config;
  const imperial = units.system === 'imperial';
  const same: DisplayUnit = { unit: meta.unit, decimals: meta.decimals, convert: identity };
  switch (meta.unit) {
    case '°C':
      return units.temperature === 'F' ? { ...same, unit: '°F', convert: cToF } : same;
    case 'kPa':
      if (units.pressure === 'psi') return { unit: 'psi', decimals: 1, convert: kpaToPsi };
      if (units.pressure === 'bar') return { unit: 'bar', decimals: 2, convert: kpaToBar };
      return same;
    case 'km/h':
      return imperial ? { ...same, unit: 'mph', convert: kphToMph } : same;
    case 'km':
      return imperial ? { ...same, unit: 'mi', convert: kmToMi } : same;
    case 'L/h': {
      if (!imperial) return same;
      const litresPerGallon = units.fuelEconomy === 'mpg-uk' ? L_PER_UK_GAL : L_PER_US_GAL;
      return { unit: 'gal/h', decimals: 2, convert: (l) => l / litresPerGallon };
    }
    default:
      return same;
  }
}

function gauge(
  state: HudState,
  config: HudConfig,
  signal: SignalId,
  canonical: number | null,
): DiagnosticGauge {
  const meta = SIGNAL_META[signal];
  const display = gaugeDisplayUnit(meta, config);
  const value =
    canonical === null || !Number.isFinite(canonical)
      ? null
      : roundTo(display.convert(canonical), display.decimals);
  return {
    signal,
    label: meta.label,
    value,
    unit: display.unit,
    decimals: display.decimals,
    min: roundTo(display.convert(meta.min), display.decimals),
    max: roundTo(display.convert(meta.max), display.decimals),
    status:
      canonical === null || value === null
        ? 'unknown'
        : gaugeStatus(state, config, signal, canonical),
  };
}

/**
 * 'crit' where a configured alert threshold of warning level or above is crossed (coolant,
 * supply voltage, tyres); otherwise 'warn' outside the signal's normal band; else 'ok'.
 */
export function gaugeStatus(
  state: HudState,
  config: HudConfig,
  signal: SignalId,
  value: number,
): GaugeStatus {
  const a = config.alerts;
  switch (signal) {
    case 'coolantTemp':
      if (value >= a.coolantHighC) return 'crit';
      break;
    case 'batteryVoltage':
    case 'controlModuleVoltage': {
      const low = isEngineRunning(state) ? a.voltageLowRunningV : a.voltageLowOffV;
      if (value <= low || value >= a.voltageHighV) return 'crit';
      break;
    }
    case 'tirePressureFL':
    case 'tirePressureFR':
    case 'tirePressureRL':
    case 'tirePressureRR':
      if (value < a.tpmsLowKpa) return 'crit';
      break;
    default:
      break;
  }
  const { normalMin, normalMax } = SIGNAL_META[signal];
  if (normalMin !== undefined && value < normalMin) return 'warn';
  if (normalMax !== undefined && value > normalMax) return 'warn';
  return 'ok';
}

// ---------------------------------------------------------------------------------------------
// Trouble codes, trip, maintenance

const KIND_RANK: Readonly<Record<DtcKind, number>> = { permanent: 0, stored: 1, pending: 2 };

/**
 * Decoded trouble codes, one per code (a code in several lists shows its most persistent
 * kind), most severe first, then permanent → stored → pending, then by code.
 */
export function diagnosticDtcs(state: HudState): DiagnosticDtc[] {
  const byCode = new Map<string, DtcKind>();
  for (const entry of state.vehicle.dtcs) {
    const kind = byCode.get(entry.code);
    if (kind === undefined || KIND_RANK[entry.kind] < KIND_RANK[kind]) {
      byCode.set(entry.code, entry.kind);
    }
  }
  const dtcs: DiagnosticDtc[] = [];
  for (const [code, kind] of byCode) {
    const info = lookupDtc(code);
    dtcs.push({
      code: info.code,
      kind,
      description: info.description,
      short: info.short,
      severity: info.severity,
    });
  }
  return dtcs.sort(
    (x, y) =>
      ALERT_SEVERITY_RANK[y.severity] - ALERT_SEVERITY_RANK[x.severity] ||
      KIND_RANK[x.kind] - KIND_RANK[y.kind] ||
      (x.code < y.code ? -1 : x.code > y.code ? 1 : 0),
  );
}

/** The trip in progress, else the last completed one (canonical units, as `TripSummary`). */
function tripForDashboard(state: HudState): TripSummary | null {
  const { current, lastCompleted: last } = state.trip;
  if (current !== null) return current;
  if (last === null) return null;
  return {
    startedAt: last.startedAt,
    distanceKm: last.distanceKm,
    durationS: last.durationS,
    movingS: last.movingS,
    fuelUsedL: last.fuelUsedL,
    avgLPer100km: last.avgLPer100km,
    cost: last.cost,
    currency: last.currency,
  };
}

const STATUS_ORDER: Readonly<Record<MaintenanceStatusKind, number>> = {
  overdue: 0,
  'due-soon': 1,
  ok: 2,
  unknown: 3,
};

/** Most urgent first; configured order within the same status. */
function sortedMaintenance(status: readonly MaintenanceItemStatus[]): MaintenanceItemStatus[] {
  return status
    .map((item, index) => ({ item, index }))
    .sort((a, b) => STATUS_ORDER[a.item.status] - STATUS_ORDER[b.item.status] || a.index - b.index)
    .map(({ item }) => item);
}
