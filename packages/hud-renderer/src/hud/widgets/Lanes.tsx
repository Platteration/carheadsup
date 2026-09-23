import type { LanesWidget } from '@carheadsup/core';
import { LaneIcon } from '../icons/index.ts';
import { cx } from '../util.ts';
import { WidgetRoot } from './parts.tsx';

/** Lane guidance: every lane's painted arrows; lanes to use in green, the others faint. */
export function Lanes({ w }: { w: LanesWidget }) {
  if (w.lanes.length === 0) return null;
  return (
    <WidgetRoot id="lanes">
      <div class="hud-lanes" style={{ '--lanes': String(w.lanes.length) }}>
        {w.lanes.map((lane, i) => (
          <div
            key={i}
            class={cx('hud-lane', lane.recommended && 'hud-lane--recommended')}
            data-recommended={lane.recommended ? 'true' : 'false'}
          >
            <LaneIcon lane={lane} />
          </div>
        ))}
      </div>
    </WidgetRoot>
  );
}
