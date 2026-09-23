import { selectDisplayedAlerts } from '../alerts/visibility.ts';
import type { HudConfig } from '../types/config.ts';
import type { HudFrame } from '../types/frame.ts';
import type { HudState } from '../types/state.ts';
import { clamp, roundTo } from '../units.ts';
import { composeDiagnostics } from './diagnostics.ts';
import {
  composeBlindSpot,
  composeCall,
  composeCollision,
  composeShiftLight,
  composeToast,
  toAlertFrame,
} from './overlays.ts';
import { composeWidgets } from './widgets.ts';

/** Effective brightness never drops below this, so the HUD cannot be trimmed invisible. */
export const MIN_EFFECTIVE_BRIGHTNESS = 0.05;

/**
 * Decide exactly what the driver sees. Pure function of state + config (+ `state.now`).
 * Applies adaptive clutter (layout placements × driving context × per-widget relevance),
 * unit conversion, staleness, alert selection, toast fading, call card, shift light and
 * the parked diagnostics dashboard.
 *
 * When the driver has blanked the display, widgets, toast, call card, shift light, blind-spot
 * indicators and the dashboard are withheld; critical alerts and the collision warning still
 * pass.
 */
export function composeFrame(state: HudState, config: HudConfig): HudFrame {
  const context = state.context.context;
  const { blanked } = state.ui;
  const alerts = selectDisplayedAlerts(
    state.alerts,
    { now: state.now, context, blanked },
    config,
  ).map(toAlertFrame);
  return {
    at: state.now,
    context,
    blanked,
    theme: { night: state.env.brightness.night, brightness: effectiveBrightness(state) },
    widgets: blanked ? [] : composeWidgets(state, config),
    alerts,
    toast: blanked ? null : composeToast(state, config),
    call: blanked ? null : composeCall(state),
    shiftLight: blanked ? null : composeShiftLight(state, config),
    blindSpot: blanked ? { left: false, right: false } : composeBlindSpot(state),
    collision: composeCollision(state),
    diagnostics: !blanked && context === 'parked' ? composeDiagnostics(state, config) : null,
    status: {
      obd: state.vehicle.link.state,
      phone: state.phone.connected,
      simulated: state.simulated,
    },
  };
}

/** Auto level plus the driver's trim, clamped to [0.05, 1]. */
function effectiveBrightness(state: HudState): number {
  const raw = state.env.brightness.level + state.ui.brightnessOffset;
  return roundTo(clamp(Number.isFinite(raw) ? raw : 1, MIN_EFFECTIVE_BRIGHTNESS, 1), 3);
}
