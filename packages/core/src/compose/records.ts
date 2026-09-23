import type { UnitSystem, UnitsConfig } from '../types/config.ts';
import type {
  DiagnosticsMaintenanceItem,
  DiagnosticsTrip,
  DisplayDistance,
  TripSummaryWidget,
} from '../types/frame.ts';
import type { MaintenanceItemStatus, TripSummary } from '../types/records.ts';
import {
  L_PER_UK_GAL,
  L_PER_US_GAL,
  convertEconomy,
  displayLongDistance,
  roundTo,
} from '../units.ts';

/**
 * Trip and service records (canonical km / L) converted for display. The trip-summary widget and
 * the parked dashboard share these, so both always show a trip identically.
 */

/** The unit-dependent fields a trip shows with, identical in the widget and on the dashboard. */
export type TripDisplay = Omit<TripSummaryWidget, 'id' | 'zone'>;

/** What a trip display is computed from (a live `TripSummary` or a completed `TripRecord`). */
export type TripFigures = Pick<
  TripSummary,
  'distanceKm' | 'durationS' | 'fuelUsedL' | 'avgLPer100km' | 'cost' | 'currency'
>;

/**
 * Canonical km → a distance in the driver's long unit (km or mi), rounded to `decimals`.
 * `value` keeps the sign (never −0); `text` is the unsigned magnitude, e.g. "42.7 km", "261 mi".
 */
export function longDisplayDistance(
  km: number,
  system: UnitSystem,
  decimals: number,
): DisplayDistance {
  const unit = system === 'imperial' ? 'mi' : 'km';
  const value = displayLongDistance(km, system, decimals) || 0;
  return { value, unit, text: `${Math.abs(value).toFixed(decimals)} ${unit}` };
}

/** Distance (one decimal), average economy, fuel (two decimals) and cost in the driver's units. */
export function displayTrip(trip: TripFigures, units: UnitsConfig): TripDisplay {
  const { system, fuelEconomy } = units;
  const imperial = system === 'imperial';
  const litresPerGallon = fuelEconomy === 'mpg-uk' ? L_PER_UK_GAL : L_PER_US_GAL;
  const fuel = trip.fuelUsedL;
  return {
    distance: longDisplayDistance(trip.distanceKm, system, 1),
    durationS: trip.durationS,
    averageEconomy: convertEconomy(trip.avgLPer100km, fuelEconomy),
    economyUnit: fuelEconomy,
    fuelUsed:
      fuel === null || !Number.isFinite(fuel)
        ? null
        : roundTo(imperial ? fuel / litresPerGallon : fuel, 2),
    fuelUnit: imperial ? 'gal' : 'L',
    cost: trip.cost,
    currency: trip.currency,
  };
}

/** The dashboard's trip: `completed` tells the last finished trip from the one in progress. */
export function dashboardTrip(
  trip: TripFigures & Pick<TripSummary, 'movingS'>,
  completed: boolean,
  units: UnitsConfig,
): DiagnosticsTrip {
  return { completed, ...displayTrip(trip, units), movingS: trip.movingS };
}

/**
 * A service item for the dashboard: the remaining distance in whole km or mi (negative when
 * overdue), whole days, and the time-based due date. Odometer figures stay off the HUD.
 */
export function dashboardMaintenanceItem(
  item: MaintenanceItemStatus,
  units: UnitsConfig,
): DiagnosticsMaintenanceItem {
  const km = item.remainingKm;
  const days = item.remainingDays;
  return {
    itemId: item.itemId,
    label: item.label,
    status: item.status,
    remaining:
      km === null || !Number.isFinite(km) ? null : longDisplayDistance(km, units.system, 0),
    remainingDays: days === null || !Number.isFinite(days) ? null : Math.round(days) || 0,
    dueAtEpochMs: item.dueAtEpochMs,
  };
}
