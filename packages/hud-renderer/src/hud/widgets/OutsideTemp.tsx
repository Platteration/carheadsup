import type { OutsideTempWidget } from '@carheadsup/core';
import { formatNumber } from '../../common/format.ts';
import { Glyph } from '../icons/index.ts';
import { cx } from '../util.ts';
import { Num, Unit, WidgetRoot } from './parts.tsx';

/** Outside temperature, with a snowflake when there is a risk of ice. */
export function OutsideTemp({ w }: { w: OutsideTempWidget }) {
  return (
    <WidgetRoot id="outsideTemp" class={cx(w.iceRisk && 'hud-temp--ice')}>
      <div class="hud-temp">
        {w.iceRisk && <Glyph name="snowflake" class="hud-temp__ice" title="Ice risk" />}
        <Num>{formatNumber(w.value)}</Num>
        <Unit>{w.unit}</Unit>
      </div>
    </WidgetRoot>
  );
}
