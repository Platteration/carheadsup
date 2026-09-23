import type { TachometerWidget } from '@carheadsup/core';
import { formatNumber } from '../../common/format.ts';
import { clamp01, cx, pct } from '../util.ts';
import { Meter, Num, Unit, WidgetRoot } from './parts.tsx';

/**
 * Where the red zone starts on the bar (fraction of redline): the last 1 000 rpm, but never less
 * than the final 5 % or more than the final 30 % of the bar.
 */
export function redZoneStart(redlineRpm: number): number {
  if (!Number.isFinite(redlineRpm) || redlineRpm <= 0) return 0.9;
  return Math.min(0.95, Math.max(0.7, 1 - 1000 / redlineRpm));
}

/** Tick positions (fractions) every 1 000 rpm below the redline. */
export function tachTicks(redlineRpm: number): number[] {
  if (!Number.isFinite(redlineRpm) || redlineRpm <= 1000) return [];
  const ticks: number[] = [];
  for (let rpm = 1000; rpm < redlineRpm && ticks.length < 20; rpm += 1000)
    ticks.push(rpm / redlineRpm);
  return ticks;
}

/** Engine speed as a horizontal bar with a red zone before the redline and a numeric readout. */
export function Tachometer({ w }: { w: TachometerWidget }) {
  const zone = redZoneStart(w.redlineRpm);
  const fraction = clamp01(w.fraction);
  const inZone = fraction >= zone;
  return (
    <WidgetRoot id="tachometer" class={cx(inZone && 'hud-tach--red')}>
      <div class="hud-tach">
        <Meter fraction={fraction} class="hud-tach__bar">
          <div class="hud-tach__zone" style={{ left: pct(zone) }} />
          {tachTicks(w.redlineRpm).map((t) => (
            <div key={t} class="hud-tach__tick" style={{ left: pct(t) }} />
          ))}
        </Meter>
        <div class="hud-tach__readout">
          <Num>{formatNumber(w.rpm)}</Num>
          <Unit>rpm</Unit>
        </div>
      </div>
    </WidgetRoot>
  );
}
