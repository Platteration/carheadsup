import type { HudConfig } from '../types/config.ts';
import type { HudFrame } from '../types/frame.ts';
import type { HudState } from '../types/state.ts';
import { notImplemented } from '../todo.ts';

/**
 * Decide exactly what the driver sees. Pure function of state + config (+ `state.now`).
 * Applies adaptive clutter (layout placements × driving context × per-widget relevance),
 * unit conversion, staleness, alert selection, toast fading, call card, shift light and
 * the parked diagnostics dashboard.
 */
export function composeFrame(state: HudState, config: HudConfig): HudFrame {
  return notImplemented(`composeFrame(${state.now}, ${config.version})`);
}
