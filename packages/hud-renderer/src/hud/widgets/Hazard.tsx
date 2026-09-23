import type { HazardWidget } from '@carheadsup/core';
import { Glyph, HAZARD_GLYPHS } from '../icons/index.ts';
import { cx, lookup, splitDistance } from '../util.ts';
import { DEFAULT_WIDGET_CONTEXT, Num, SpeedSign, Unit, WidgetRoot } from './parts.tsx';
import type { WidgetContext } from './parts.tsx';

/** Road hazard ahead: icon, distance, short label, and the camera limit or traffic delay. */
export function Hazard({
  w,
  ctx = DEFAULT_WIDGET_CONTEXT,
}: {
  w: HazardWidget;
  ctx?: WidgetContext;
}) {
  const distance = w.distance ? splitDistance(w.distance) : null;
  const glyph = lookup(HAZARD_GLYPHS, w.type, 'warning');
  const hasLimit = w.speedLimit !== null && Number.isFinite(w.speedLimit);
  const hasDelay = w.delayMinutes !== null && Number.isFinite(w.delayMinutes) && w.delayMinutes > 0;
  return (
    <WidgetRoot id="hazard" class={cx(`hud-hazard--${w.type}`)} tone="caution">
      <div class="hud-hazard" data-hazard={w.type}>
        <Glyph name={glyph} class="hud-hazard__icon" />
        <div class="hud-hazard__text">
          {distance && (
            <div class="hud-hazard__distance">
              <Num>{distance.value}</Num>
              {distance.unit && <Unit>{distance.unit}</Unit>}
            </div>
          )}
          {w.label && <div class="hud-hazard__label">{w.label}</div>}
        </div>
        {hasLimit && (
          <SpeedSign
            style={ctx.signStyle}
            value={w.speedLimit}
            unlimited={false}
            class="hud-hazard__limit"
          />
        )}
        {hasDelay && <div class="hud-hazard__delay">+{Math.round(w.delayMinutes ?? 0)} min</div>}
      </div>
    </WidgetRoot>
  );
}
