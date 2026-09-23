import type { BoostWidget } from '@carheadsup/core';
import { formatSigned } from '../../common/format.ts';
import { cx } from '../util.ts';
import { Meter, Num, Unit, WidgetRoot } from './parts.tsx';

/** Decimals worth showing per pressure unit (bar needs one more than kPa/psi). */
function boostDecimals(unit: BoostWidget['unit']): number {
  return unit === 'bar' ? 2 : unit === 'psi' ? 1 : 0;
}

/** Turbo boost (or vacuum, dimmed) as a signed value and a bar. */
export function Boost({ w }: { w: BoostWidget }) {
  const vacuum = w.value < 0;
  return (
    <WidgetRoot id="boost" class={cx(vacuum && 'hud-boost--vacuum')}>
      <div class="hud-boost">
        <div class="hud-boost__readout">
          <span class="hud-label">Boost</span>
          <Num>{formatSigned(w.value, boostDecimals(w.unit))}</Num>
          <Unit>{w.unit}</Unit>
        </div>
        <Meter fraction={w.fraction} class="hud-boost__bar" />
      </div>
    </WidgetRoot>
  );
}
