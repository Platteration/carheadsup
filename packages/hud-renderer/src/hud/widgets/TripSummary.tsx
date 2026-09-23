import type { TripSummaryWidget } from '@carheadsup/core';
import { formatCurrency, formatDurationS, formatNumber } from '../../common/format.ts';
import { economyUnitLabel, splitDistance } from '../util.ts';
import { Num, Unit, WidgetRoot } from './parts.tsx';

interface Stat {
  key: string;
  label: string;
  value: string;
  unit?: string;
}

/** The trip's stats in priority order; the widget shows as many as fit on one line. */
export function tripStats(w: TripSummaryWidget): Stat[] {
  const distance = splitDistance(w.distance);
  const stats: Stat[] = [
    { key: 'distance', label: 'Trip', value: distance.value, unit: distance.unit },
    { key: 'duration', label: 'Time', value: formatDurationS(w.durationS) },
  ];
  if (w.averageEconomy !== null && Number.isFinite(w.averageEconomy)) {
    stats.push({
      key: 'economy',
      label: 'Avg',
      value: formatNumber(w.averageEconomy, 1),
      unit: economyUnitLabel(w.economyUnit),
    });
  }
  if (w.cost !== null && Number.isFinite(w.cost)) {
    stats.push({ key: 'cost', label: 'Cost', value: formatCurrency(w.cost, w.currency) });
  }
  if (w.fuelUsed !== null && Number.isFinite(w.fuelUsed)) {
    stats.push({
      key: 'fuel',
      label: 'Fuel',
      value: formatNumber(w.fuelUsed, 1),
      unit: w.fuelUnit,
    });
  }
  return stats;
}

/** Trip so far — distance, time, average economy, cost — shown when stopped or parked. */
export function TripSummary({ w }: { w: TripSummaryWidget }) {
  return (
    <WidgetRoot id="tripSummary">
      <div class="hud-trip">
        {tripStats(w).map((s) => (
          <div key={s.key} class={`hud-trip__stat hud-trip__stat--${s.key}`}>
            <span class="hud-label">{s.label}</span>
            <span class="hud-trip__value">
              <Num>{s.value}</Num>
              {s.unit && <Unit>{s.unit}</Unit>}
            </span>
          </div>
        ))}
      </div>
    </WidgetRoot>
  );
}
