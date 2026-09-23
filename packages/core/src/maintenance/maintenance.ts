import type { MaintenanceConfig, MaintenanceItemConfig } from '../types/config.ts';
import type {
  MaintenanceItemStatus,
  MaintenanceRecord,
  MaintenanceStatusKind,
} from '../types/records.ts';

export interface MaintenanceState {
  records: MaintenanceRecord[];
  /** Status as of `checkedAt`; recomputed by the reducer on odometer/time changes (at most once a minute). */
  status: MaintenanceItemStatus[];
  checkedAt: number | null;
}

const DAY_MS = 86_400_000;

/**
 * Default service schedule for a typical petrol car. Returns fresh objects on every call, so
 * callers may mutate the result.
 */
export function defaultMaintenanceItems(): MaintenanceItemConfig[] {
  return [
    {
      id: 'oil',
      label: 'Oil & filter',
      intervalKm: 8000,
      intervalDays: 365,
      warnBeforeKm: 500,
      warnBeforeDays: 14,
    },
    {
      id: 'tyre-rotation',
      label: 'Tyre rotation',
      intervalKm: 10_000,
      intervalDays: null,
      warnBeforeKm: 500,
      warnBeforeDays: 14,
    },
    {
      id: 'air-filter',
      label: 'Air filter',
      intervalKm: 20_000,
      intervalDays: 730,
      warnBeforeKm: 1000,
      warnBeforeDays: 30,
    },
    {
      id: 'brake-fluid',
      label: 'Brake fluid',
      intervalKm: null,
      intervalDays: 730,
      warnBeforeKm: 0,
      warnBeforeDays: 30,
    },
    {
      id: 'cabin-filter',
      label: 'Cabin filter',
      intervalKm: 15_000,
      intervalDays: 365,
      warnBeforeKm: 1000,
      warnBeforeDays: 30,
    },
    {
      id: 'coolant',
      label: 'Coolant',
      intervalKm: 100_000,
      intervalDays: 1825,
      warnBeforeKm: 2000,
      warnBeforeDays: 30,
    },
  ];
}

const validOdometer = (km: number | null): number | null =>
  km !== null && Number.isFinite(km) && km >= 0 ? km : null;

/** The most recent record per item (later `at` wins; on a tie, the later entry). */
function latestByItem(records: readonly MaintenanceRecord[]): Map<string, MaintenanceRecord> {
  const latest = new Map<string, MaintenanceRecord>();
  for (const record of records) {
    const prev = latest.get(record.itemId);
    if (prev === undefined || record.at >= prev.at) latest.set(record.itemId, record);
  }
  return latest;
}

/**
 * Build the state from persisted records, keeping only the latest record per item (in order of
 * first appearance). Status is computed later, when the config and odometer are known.
 */
export function createMaintenanceState(records: MaintenanceRecord[]): MaintenanceState {
  const latest = [...latestByItem(records).values()].map((r) => ({
    itemId: r.itemId,
    odometerKm: validOdometer(r.odometerKm),
    at: r.at,
  }));
  return { records: latest, status: [], checkedAt: null };
}

/**
 * Record that an item was serviced (replaces the previous record for that item). `checkedAt`
 * is reset so the reducer recomputes `status` on its next pass.
 */
export function recordService(
  state: MaintenanceState,
  itemId: string,
  odometerKm: number | null,
  at: number,
): MaintenanceState {
  const record: MaintenanceRecord = { itemId, odometerKm: validOdometer(odometerKm), at };
  const index = state.records.findIndex((r) => r.itemId === itemId);
  const records =
    index === -1
      ? [...state.records, record]
      : [
          ...state.records.slice(0, index),
          record,
          ...state.records.slice(index + 1).filter((r) => r.itemId !== itemId),
        ];
  return { ...state, records, checkedAt: null };
}

const SEVERITY: Record<MaintenanceStatusKind, number> = {
  unknown: 0,
  ok: 1,
  'due-soon': 2,
  overdue: 3,
};

/** Classify one dimension: past due → overdue, within the warning margin → due-soon. */
function classify(remaining: number, warnBefore: number): MaintenanceStatusKind {
  if (remaining < 0) return 'overdue';
  if (remaining <= warnBefore) return 'due-soon';
  return 'ok';
}

/** Round to a whole number without producing −0. */
const whole = (v: number): number => Math.round(v) || 0;

/**
 * Compute due status per configured item from the last record, the current odometer and
 * time. Items without any record are 'unknown'. 'due-soon' within warnBeforeKm/Days,
 * 'overdue' past due. Whichever of distance/time comes first wins.
 *
 * A dimension only counts when it can be evaluated: distance needs the item's km interval, an
 * odometer reading on the record and a current odometer; time needs the day interval. If
 * neither can be evaluated the status is 'unknown'. `remainingKm`/`remainingDays` are rounded
 * to whole units (negative when overdue); the status uses the unrounded values.
 */
export function maintenanceStatus(
  config: MaintenanceConfig,
  records: readonly MaintenanceRecord[],
  odometerKm: number | null,
  now: number,
): MaintenanceItemStatus[] {
  const latest = latestByItem(records);
  const odometer = validOdometer(odometerKm);
  return config.items.map((item): MaintenanceItemStatus => {
    const record = latest.get(item.id);
    if (record === undefined) {
      return {
        itemId: item.id,
        label: item.label,
        lastDoneAt: null,
        lastDoneKm: null,
        dueAtKm: null,
        dueAtEpochMs: null,
        remainingKm: null,
        remainingDays: null,
        status: 'unknown',
      };
    }
    const lastDoneKm = validOdometer(record.odometerKm);
    const dueAtKm =
      item.intervalKm !== null && lastDoneKm !== null ? lastDoneKm + item.intervalKm : null;
    const dueAtEpochMs = item.intervalDays !== null ? record.at + item.intervalDays * DAY_MS : null;
    const remainingKm = dueAtKm !== null && odometer !== null ? dueAtKm - odometer : null;
    const remainingDays = dueAtEpochMs !== null ? (dueAtEpochMs - now) / DAY_MS : null;

    let status: MaintenanceStatusKind = 'unknown';
    if (remainingKm !== null) status = classify(remainingKm, item.warnBeforeKm);
    if (remainingDays !== null) {
      const byTime = classify(remainingDays, item.warnBeforeDays);
      if (SEVERITY[byTime] > SEVERITY[status]) status = byTime;
    }
    return {
      itemId: item.id,
      label: item.label,
      lastDoneAt: record.at,
      lastDoneKm,
      dueAtKm,
      dueAtEpochMs,
      remainingKm: remainingKm === null ? null : whole(remainingKm),
      remainingDays: remainingDays === null ? null : whole(remainingDays),
      status,
    };
  });
}
