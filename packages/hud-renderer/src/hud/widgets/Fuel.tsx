import type { FuelWidget } from '@carheadsup/core';
import { formatNumber } from '../../common/format.ts';
import { Glyph } from '../icons/index.ts';
import { economyUnitLabel } from '../util.ts';
import { Meter, Num, Unit, WidgetRoot } from './parts.tsx';

const isNum = (v: number | null): v is number => v !== null && Number.isFinite(v);

/**
 * Fuel economy (instantaneous, or the trip average while stationary), trip average, estimated
 * range and tank level. Amber when the level is low.
 */
export function Fuel({ w }: { w: FuelWidget }) {
  const primary = isNum(w.instant) ? w.instant : w.average;
  const showAverage = isNum(w.instant) && isNum(w.average);
  const secondary = [
    showAverage ? `avg ${formatNumber(w.average, 1)}` : null,
    isNum(w.range) ? `${formatNumber(w.range)} ${w.rangeUnit}` : null,
  ].filter((s): s is string => s !== null);
  if (!isNum(primary) && secondary.length === 0 && !isNum(w.levelPct)) return null;
  return (
    <WidgetRoot id="fuel" tone={w.low ? 'caution' : undefined}>
      <div class="hud-fuel">
        <Glyph name="fuel" class="hud-fuel__icon" />
        <div class="hud-fuel__body">
          {isNum(primary) && (
            <div class="hud-fuel__economy">
              <Num>{formatNumber(primary, 1)}</Num>
              <Unit>{economyUnitLabel(w.unit)}</Unit>
            </div>
          )}
          {secondary.length > 0 && <div class="hud-fuel__sub">{secondary.join(' · ')}</div>}
          {isNum(w.levelPct) && <Meter fraction={w.levelPct / 100} class="hud-fuel__level" />}
        </div>
      </div>
    </WidgetRoot>
  );
}
