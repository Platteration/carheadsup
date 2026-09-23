import type { ClockWidget } from '@carheadsup/core';
import { formatClock } from '../../common/format.ts';
import { Num, Unit, WidgetRoot } from './parts.tsx';

/** Local time of day in the configured format. */
export function Clock({ w }: { w: ClockWidget }) {
  if (!Number.isFinite(w.epochMs)) return null;
  const { time, suffix } = formatClock(w.epochMs, w.format);
  return (
    <WidgetRoot id="clock">
      <div class="hud-clock">
        <Num>{time}</Num>
        {suffix && <Unit>{suffix}</Unit>}
      </div>
    </WidgetRoot>
  );
}
