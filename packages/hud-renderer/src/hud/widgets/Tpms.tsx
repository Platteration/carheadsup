import type { TireReading, TpmsWidget } from '@carheadsup/core';
import { formatNumber } from '../../common/format.ts';
import { cx } from '../util.ts';
import { Num, WidgetRoot } from './parts.tsx';

type Corner = 'fl' | 'fr' | 'rl' | 'rr';

const WHEELS: Record<Corner, { x: number; y: number }> = {
  fl: { x: 0.5, y: 6 },
  fr: { x: 19.5, y: 6 },
  rl: { x: 0.5, y: 25 },
  rr: { x: 19.5, y: 25 },
};

/** Top view of a car with the four wheels; low tyres are highlighted. */
function CarOutline({ low }: { low: Record<Corner, boolean> }) {
  return (
    <svg viewBox="0 0 26 40" class="hud-tpms__car" aria-hidden="true">
      <rect
        x="5"
        y="2"
        width="16"
        height="36"
        rx="6"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
      />
      <path
        d="M8 13.5h10M8 29h10"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        opacity="0.6"
      />
      {(Object.keys(WHEELS) as Corner[]).map((c) => (
        <rect
          key={c}
          class={cx('hud-tpms__wheel', low[c] && 'hud-tpms__wheel--low')}
          x={WHEELS[c].x}
          y={WHEELS[c].y}
          width="6"
          height="9"
          rx="2"
        />
      ))}
    </svg>
  );
}

function Reading({ corner, reading }: { corner: Corner; reading: TireReading }) {
  return (
    <Num
      class={cx(
        'hud-tpms__value',
        `hud-tpms__value--${corner}`,
        reading.low && 'hud-tpms__value--low',
      )}
    >
      {formatNumber(reading.value, 0)}
    </Num>
  );
}

/** Tyre pressures at the four corners of a car outline; low ones in amber. */
export function Tpms({ w }: { w: TpmsWidget }) {
  const low = { fl: w.fl.low, fr: w.fr.low, rl: w.rl.low, rr: w.rr.low };
  return (
    <WidgetRoot id="tpms" class={cx(w.anyLow && 'hud-tpms--low')}>
      <div class="hud-tpms">
        <div class="hud-tpms__grid">
          <Reading corner="fl" reading={w.fl} />
          <CarOutline low={low} />
          <Reading corner="fr" reading={w.fr} />
          <Reading corner="rl" reading={w.rl} />
          <Reading corner="rr" reading={w.rr} />
        </div>
        <span class="hud-unit hud-tpms__unit">{w.unit}</span>
      </div>
    </WidgetRoot>
  );
}
