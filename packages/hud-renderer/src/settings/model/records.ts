import {
  L_PER_UK_GAL,
  L_PER_US_GAL,
  SIGNAL_IDS,
  SIGNAL_META,
  cToF,
  convertEconomy,
  displayLongDistance,
  displaySpeed,
  kmToMi,
  kpaToBar,
  kpaToPsi,
  kphToMph,
  roundTo,
  speedUnitLabel,
  staleLimitMs,
} from '@carheadsup/core';
import type {
  ApiDiagnostics,
  FuelEconomyUnit,
  MaintenanceItemStatus,
  MaintenanceStatusKind,
  SignalId,
  SignalMeta,
  TripRecord,
  UnitsConfig,
} from '@carheadsup/core';
import { formatCurrency, formatDurationS, formatNumber } from '../../common/format.ts';

/**
 * Presentation of trips, maintenance items and live signals in the driver's units. Canonical
 * values come from the API; conversions use the core unit helpers.
 */

export const ECONOMY_LABELS: Readonly<Record<FuelEconomyUnit, string>> = {
  'L/100km': 'L/100 km',
  'km/L': 'km/L',
  'mpg-us': 'mpg',
  'mpg-uk': 'mpg (UK)',
};

function litresPerGallon(units: UnitsConfig): number {
  return units.fuelEconomy === 'mpg-uk' ? L_PER_UK_GAL : L_PER_US_GAL;
}

/** A fuel quantity in the driver's units: litres, or US/UK gallons (following the mpg flavour). */
export function formatFuel(litres: number, units: UnitsConfig): string {
  if (units.system === 'imperial') {
    return `${formatNumber(litres / litresPerGallon(units), 2)} gal`;
  }
  return `${formatNumber(litres, litres < 10 ? 2 : 1)} L`;
}

export function formatLongDistance(km: number, units: UnitsConfig, decimals = 1): string {
  const unit = units.system === 'imperial' ? 'mi' : 'km';
  return `${formatNumber(displayLongDistance(km, units.system, decimals), decimals)} ${unit}`;
}

export function formatEconomy(lPer100km: number | null, units: UnitsConfig): string | null {
  const value = convertEconomy(lPer100km, units.fuelEconomy);
  return value === null ? null : `${formatNumber(value, 1)} ${ECONOMY_LABELS[units.fuelEconomy]}`;
}

export function formatSpeed(kph: number, units: UnitsConfig): string {
  return `${formatNumber(displaySpeed(kph, units.system))} ${speedUnitLabel(units.system)}`;
}

export interface TripView {
  id: string;
  startedAt: number;
  endedAt: number;
  distance: string;
  duration: string;
  fuel: string | null;
  economy: string | null;
  cost: string | null;
  avgSpeed: string;
  maxSpeed: string;
}

export function tripView(trip: TripRecord, units: UnitsConfig): TripView {
  return {
    id: trip.id,
    startedAt: trip.startedAt,
    endedAt: trip.endedAt,
    distance: formatLongDistance(trip.distanceKm, units),
    duration: formatDurationS(trip.durationS),
    fuel: trip.fuelUsedL === null ? null : formatFuel(trip.fuelUsedL, units),
    economy: formatEconomy(trip.avgLPer100km, units),
    cost: trip.cost === null ? null : formatCurrency(trip.cost, trip.currency),
    avgSpeed: formatSpeed(trip.avgMovingSpeedKph, units),
    maxSpeed: formatSpeed(trip.maxSpeedKph, units),
  };
}

export interface TripTotals {
  count: number;
  distanceKm: number;
  durationS: number;
  /** Fuel over the trips that report it, or null when none does. */
  fuelL: number | null;
  /** Consumption over the trips that report fuel (their fuel / their distance). */
  avgLPer100km: number | null;
  /** Cost summed per currency (trips can span a currency change). */
  costs: Array<{ currency: string; amount: number }>;
}

export function tripTotals(trips: readonly TripRecord[]): TripTotals {
  let distanceKm = 0;
  let durationS = 0;
  let fuelL = 0;
  let fuelDistanceKm = 0;
  let anyFuel = false;
  const costs = new Map<string, number>();
  for (const t of trips) {
    distanceKm += t.distanceKm;
    durationS += t.durationS;
    if (t.fuelUsedL !== null && Number.isFinite(t.fuelUsedL)) {
      anyFuel = true;
      fuelL += t.fuelUsedL;
      fuelDistanceKm += t.distanceKm;
    }
    if (t.cost !== null && Number.isFinite(t.cost)) {
      costs.set(t.currency, (costs.get(t.currency) ?? 0) + t.cost);
    }
  }
  return {
    count: trips.length,
    distanceKm,
    durationS,
    fuelL: anyFuel ? fuelL : null,
    avgLPer100km:
      anyFuel && fuelDistanceKm > 0 && fuelL > 0 ? (fuelL / fuelDistanceKm) * 100 : null,
    costs: [...costs.entries()].map(([currency, amount]) => ({
      currency,
      amount: roundTo(amount, 2),
    })),
  };
}

/** "Thu 14 May · 15:42" in the driver's clock format. */
export function formatDateTime(
  epochMs: number,
  clock: UnitsConfig['clock'],
  locale?: string,
): string {
  const date = new Date(epochMs);
  const day = date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: clock === '12h',
  });
  return `${day} · ${time}`;
}

// ---------------------------------------------------------------------------------------------
// Maintenance

export const MAINTENANCE_STATUS_LABELS: Readonly<Record<MaintenanceItemStatus['status'], string>> =
  {
    ok: 'OK',
    'due-soon': 'Due soon',
    overdue: 'Overdue',
    unknown: 'No record',
  };

/** Most urgent first; stable by label within a status. */
const STATUS_ORDER: Readonly<Record<MaintenanceStatusKind, number>> = {
  overdue: 0,
  'due-soon': 1,
  unknown: 2,
  ok: 3,
};

export function sortMaintenance(items: readonly MaintenanceItemStatus[]): MaintenanceItemStatus[] {
  return [...items].sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      a.label.localeCompare(b.label),
  );
}

/** A unique item id derived from a label ("Spark plugs" → "spark-plugs", "spark-plugs-2" …). */
export function maintenanceIdFor(label: string, taken: readonly string[]): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      // Drop the accents NFKD split off ("ü" → "u"), then join words with dashes.
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

function plural(n: number, word: string): string {
  return `${formatNumber(n)} ${word}${Math.abs(n) === 1 ? '' : 's'}`;
}

/** "420 km or 20 days left", "Overdue by 12 days", "Log the last service to start tracking". */
export function maintenanceRemaining(item: MaintenanceItemStatus, units: UnitsConfig): string {
  const parts: string[] = [];
  const overdue: string[] = [];
  const unit = units.system === 'imperial' ? 'mi' : 'km';
  if (item.remainingKm !== null) {
    const shown = Math.round(displayLongDistance(Math.abs(item.remainingKm), units.system));
    const text = `${formatNumber(shown)} ${unit}`;
    (item.remainingKm < 0 ? overdue : parts).push(text);
  }
  if (item.remainingDays !== null) {
    const days = Math.round(item.remainingDays);
    (days < 0 ? overdue : parts).push(plural(Math.abs(days), 'day'));
  }
  if (overdue.length > 0) return `Overdue by ${overdue.join(' and ')}`;
  if (parts.length > 0) return `${parts.join(' or ')} left`;
  return 'Log the last service to start tracking';
}

/** "Last done at 48 210 km" / "Last done 14 Mar 2026" / null when never recorded. */
export function maintenanceLastDone(
  item: MaintenanceItemStatus,
  units: UnitsConfig,
  locale?: string,
): string | null {
  const parts: string[] = [];
  if (item.lastDoneKm !== null) {
    parts.push(`at ${formatLongDistance(item.lastDoneKm, units, 0)}`);
  }
  if (item.lastDoneAt !== null) {
    parts.push(
      new Date(item.lastDoneAt).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    );
  }
  return parts.length === 0 ? null : `Last done ${parts.join(', ')}`;
}

/**
 * Best guess of the current odometer for pre-filling "mark done": the car's own odometer PID,
 * else the end of the newest trip, else the most recent service record. Null when unknown.
 */
export function bestKnownOdometerKm(
  diagnostics: ApiDiagnostics | null,
  trips: readonly TripRecord[],
  maintenance: readonly MaintenanceItemStatus[],
): number | null {
  // The HUD's own odometer: the car's reading, or its estimate from the last dash reading.
  const fromHud = diagnostics?.odometer?.km;
  if (fromHud !== null && fromHud !== undefined && Number.isFinite(fromHud)) return fromHud;
  const fromCar = diagnostics?.signals.odometer?.value;
  if (fromCar !== undefined && Number.isFinite(fromCar)) return fromCar;
  const newestTrip = [...trips].sort((a, b) => b.startedAt - a.startedAt)[0];
  if (newestTrip?.endOdometerKm !== null && newestTrip?.endOdometerKm !== undefined) {
    return newestTrip.endOdometerKm;
  }
  const serviced = maintenance
    .map((m) => m.lastDoneKm)
    .filter((km): km is number => km !== null && Number.isFinite(km));
  return serviced.length > 0 ? Math.max(...serviced) : null;
}

// ---------------------------------------------------------------------------------------------
// Live signals

export interface SignalRow {
  id: SignalId;
  label: string;
  /** Formatted value in the driver's units. */
  value: string;
  unit: string;
  /** Outside the signal's normal band. */
  abnormal: boolean;
  /** Too old to be treated as live (see {@link signalRows}). */
  stale: boolean;
}

interface Shown {
  value: number;
  unit: string;
  decimals: number;
}

/** A canonical value in the driver's units (mirrors how the parked dashboard shows gauges). */
export function signalInDriverUnits(meta: SignalMeta, value: number, units: UnitsConfig): Shown {
  const imperial = units.system === 'imperial';
  switch (meta.unit) {
    case '°C':
      return units.temperature === 'F'
        ? { value: cToF(value), unit: '°F', decimals: meta.decimals }
        : { value, unit: '°C', decimals: meta.decimals };
    case 'kPa':
      if (units.pressure === 'psi') return { value: kpaToPsi(value), unit: 'psi', decimals: 1 };
      if (units.pressure === 'bar') return { value: kpaToBar(value), unit: 'bar', decimals: 2 };
      return { value, unit: 'kPa', decimals: meta.decimals };
    case 'km/h':
      return imperial
        ? { value: kphToMph(value), unit: 'mph', decimals: meta.decimals }
        : { value, unit: 'km/h', decimals: meta.decimals };
    case 'km':
      return imperial
        ? { value: kmToMi(value), unit: 'mi', decimals: meta.decimals }
        : { value, unit: 'km', decimals: meta.decimals };
    case 'L/h':
      return imperial
        ? { value: value / litresPerGallon(units), unit: 'gal/h', decimals: 2 }
        : { value, unit: 'L/h', decimals: meta.decimals };
    case 'gear':
      return { value, unit: '', decimals: 0 };
    default:
      return { value, unit: meta.unit, decimals: meta.decimals };
  }
}

/** Per signal: its latest sample time, and the local (monotonic) time that last moved. */
export type SignalWatch = ReadonlyMap<SignalId, { at: number; changedAt: number }>;

/**
 * Follow each signal's sample time across polls. A signal is "changed" at `now` when it is new or
 * its `at` moved; otherwise it keeps the moment it last changed. Only the HUD's own timestamps are
 * compared with each other, so the phone's clock never matters.
 */
export function watchSignals(
  previous: SignalWatch,
  diagnostics: ApiDiagnostics,
  now: number,
): SignalWatch {
  const next = new Map<SignalId, { at: number; changedAt: number }>();
  for (const id of SIGNAL_IDS) {
    const sample = diagnostics.signals[id];
    if (sample === undefined || !Number.isFinite(sample.at)) continue;
    const before = previous.get(id);
    next.set(
      id,
      before !== undefined && before.at === sample.at ? before : { at: sample.at, changedAt: now },
    );
  }
  return next;
}

export interface SignalAging {
  /** From {@link watchSignals}, updated with the same response. */
  watch: SignalWatch;
  /** Local monotonic time, same clock as the watch. */
  now: number;
  /** Poll interval: a value is only seen to change once per poll, so it gets this much slack. */
  poll: number;
}

/**
 * Rows for the live signal table, in the canonical signal order. A value is stale when it is
 * older than its limit on the HUD's own clock (`diagnostics.now − at`: the phone's clock may be
 * minutes off, and this works from the very first poll — a car that stopped answering while the
 * adapter link still reports connected shows stale at once), and always while the OBD link is not
 * connected. A frozen reading is never shown as live.
 *
 * Without `now` (an older HUD) a value is stale when it is older than its limit relative to the
 * newest sample in the same response, or when, across polls (`aging`), its sample time has not
 * moved for longer than its limit.
 */
export function signalRows(
  diagnostics: ApiDiagnostics,
  units: UnitsConfig,
  aging?: SignalAging,
): SignalRow[] {
  const entries = SIGNAL_IDS.flatMap((id) => {
    const sample = diagnostics.signals[id];
    return sample !== undefined && Number.isFinite(sample.value) ? [{ id, ...sample }] : [];
  });
  const hudNow: unknown = diagnostics.now;
  const serverNow = typeof hudNow === 'number' && Number.isFinite(hudNow) ? hudNow : null;
  const newest = entries.reduce((max, e) => Math.max(max, e.at), Number.NEGATIVE_INFINITY);
  const linkUp = diagnostics.link.state === 'connected';
  /** How long the signal's sample time has stood still, beyond one poll of slack. */
  const frozenFor = (id: SignalId): number => {
    const seen = aging?.watch.get(id);
    return aging === undefined || seen === undefined
      ? 0
      : aging.now - seen.changedAt - Math.max(0, aging.poll);
  };
  const age = (id: SignalId, at: number): number =>
    serverNow !== null ? serverNow - at : Math.max(newest - at, frozenFor(id));
  return entries.map(({ id, value, at }) => {
    const meta = SIGNAL_META[id];
    const shown = signalInDriverUnits(meta, value, units);
    const abnormal =
      (meta.normalMin !== undefined && value < meta.normalMin) ||
      (meta.normalMax !== undefined && value > meta.normalMax);
    return {
      id,
      label: meta.label,
      value: formatNumber(shown.value, shown.decimals),
      unit: shown.unit,
      abnormal,
      stale: !linkUp || !(age(id, at) <= staleLimitMs(id)),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Status

/** Seconds → "3 d 4 h", "2 h 05 min", "12 min", "40 s". */
export function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${s} s`;
}
