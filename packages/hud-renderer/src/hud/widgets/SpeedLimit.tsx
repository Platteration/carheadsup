import type { SpeedLimitWidget } from '@carheadsup/core';
import { SpeedSign, WidgetRoot } from './parts.tsx';

/** Posted speed limit as a road sign in the configured style. */
export function SpeedLimit({ w }: { w: SpeedLimitWidget }) {
  if (!w.unlimited && (w.value === null || !Number.isFinite(w.value))) return null;
  return (
    <WidgetRoot id="speedLimit">
      <SpeedSign style={w.style} value={w.value} unlimited={w.unlimited} class="hud-limit" />
    </WidgetRoot>
  );
}
