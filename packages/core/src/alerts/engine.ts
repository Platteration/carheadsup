import type { Alert } from '../types/alerts.ts';
import type { HudConfig } from '../types/config.ts';
import type { HudState } from '../types/state.ts';
import { notImplemented } from '../todo.ts';

/**
 * Re-evaluate all alert conditions against `state` (whose `alerts` are the previous alerts)
 * and return the new alert list. Keeps `raisedAt` / `dismissedAt` for alerts that persist,
 * applies hysteresis when clearing threshold alerts, drops expired transient alerts, and
 * re-raises (un-dismisses) an alert whose severity escalates.
 */
export function evaluateAlerts(state: HudState, config: HudConfig): Alert[] {
  return notImplemented(`evaluateAlerts(${state.now}, ${config.version})`);
}
