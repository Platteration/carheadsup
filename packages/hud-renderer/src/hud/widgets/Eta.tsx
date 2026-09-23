import type { EtaWidget } from '@carheadsup/core';
import { formatClock, formatMinutes } from '../../common/format.ts';
import { Num, Unit, WidgetRoot } from './parts.tsx';

/** Arrival time in the configured clock format plus remaining time and distance. */
export function Eta({ w }: { w: EtaWidget }) {
  const clock =
    w.etaEpochMs !== null && Number.isFinite(w.etaEpochMs)
      ? formatClock(w.etaEpochMs, w.clock)
      : null;
  const rest = [
    w.remainingMinutes !== null && Number.isFinite(w.remainingMinutes)
      ? formatMinutes(w.remainingMinutes)
      : null,
    w.remainingDistance?.text ?? null,
  ].filter((s): s is string => s !== null);
  if (!clock && rest.length === 0) return null;
  return (
    <WidgetRoot id="eta">
      <div class="hud-eta">
        {clock && (
          <div class="hud-eta__time">
            <span class="hud-eta__label">ETA</span>
            <Num>{clock.time}</Num>
            {clock.suffix && <Unit>{clock.suffix}</Unit>}
          </div>
        )}
        {rest.length > 0 && <div class="hud-eta__rest">{rest.join(' · ')}</div>}
      </div>
    </WidgetRoot>
  );
}
