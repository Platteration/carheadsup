import type { MaintenanceConfig } from '../types/config.ts';
import type { MaintenanceItemStatus, MaintenanceRecord } from '../types/records.ts';
import { notImplemented } from '../todo.ts';

export interface MaintenanceState {
  records: MaintenanceRecord[];
  /** Status as of `checkedAt`; recomputed by the reducer on odometer/time changes (at most once a minute). */
  status: MaintenanceItemStatus[];
  checkedAt: number | null;
}

export function createMaintenanceState(records: MaintenanceRecord[]): MaintenanceState {
  return notImplemented(`createMaintenanceState(${records.length})`);
}

/** Record that an item was serviced (replaces the previous record for that item). */
export function recordService(
  state: MaintenanceState,
  itemId: string,
  odometerKm: number | null,
  at: number,
): MaintenanceState {
  return notImplemented(
    `recordService(${itemId}, ${String(odometerKm)}, ${at}, ${state.records.length})`,
  );
}

/**
 * Compute due status per configured item from the last record, the current odometer and
 * time. Items without any record are 'unknown'. 'due-soon' within warnBeforeKm/Days,
 * 'overdue' past due. Whichever of distance/time comes first wins.
 */
export function maintenanceStatus(
  config: MaintenanceConfig,
  records: readonly MaintenanceRecord[],
  odometerKm: number | null,
  now: number,
): MaintenanceItemStatus[] {
  return notImplemented(
    `maintenanceStatus(${config.items.length}, ${records.length}, ${String(odometerKm)}, ${now})`,
  );
}
