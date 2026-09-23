import type { SpeedWidget } from '@carheadsup/core';
import { formatNumber } from '../../common/format.ts';
import { cx } from '../util.ts';
import { Num, WidgetRoot } from './parts.tsx';

/** Current speed in very large tabular numerals; red with a "+N" badge when over the limit. */
export function Speed({ w }: { w: SpeedWidget }) {
  const showOverBy = w.overLimit && w.overBy !== null && Number.isFinite(w.overBy) && w.overBy > 0;
  return (
    <WidgetRoot
      id="speed"
      class={cx(w.overLimit && 'hud-speed--over')}
      label={`Speed ${formatNumber(w.value)} ${w.unit}`}
    >
      <div class="hud-speed">
        <Num class="hud-speed__value">{formatNumber(w.value)}</Num>
        <div class="hud-speed__meta">
          <span class="hud-speed__unit">{w.unit}</span>
          {showOverBy && <span class="hud-speed__over">+{formatNumber(w.overBy)}</span>}
        </div>
      </div>
    </WidgetRoot>
  );
}
