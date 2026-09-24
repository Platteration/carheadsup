import { dismissAlert } from '../alerts/engine.ts';
import { selectDisplayedAlerts } from '../alerts/visibility.ts';
import type { HudConfig } from '../types/config.ts';
import type { InputAction } from '../types/events.ts';
import type { HudState } from '../types/state.ts';
import { clamp, roundTo } from '../units.ts';
import { cyclePage } from './dashboard.ts';
import { callControls, selectToast } from './selectors.ts';

/** Manual brightness trim step and range. */
export const BRIGHTNESS_STEP = 0.1;
export const MAX_BRIGHTNESS_OFFSET = 0.5;

/**
 * Driver input. Call handling is a side effect (see `deriveEffects`): while a call can be
 * accepted (phone connected), 'primary' changes nothing else; while it can be declined or hung
 * up, neither does 'secondary'. Otherwise 'primary' acknowledges the top dismissible alert on
 * screen, and 'secondary' closes a dashboard the driver opened while stopped, else dismisses the
 * toast on screen, else that alert.
 *
 * 'next-page' / 'prev-page' flip the dashboard's pages — except while stopped with the dashboard
 * closed, where either opens it on the current page (`UiState.dashboardRequested`; the parked
 * dashboard otherwise needs minutes with the engine off, see `engineOffParkedAfterMs`).
 */
export function applyInput(state: HudState, action: InputAction, config: HudConfig): HudState {
  const { now } = state;
  const touched: HudState = { ...state, ui: { ...state.ui, lastInputAt: now } };
  const { canAccept, canDecline } = callControls(state.call, state.phone.connected);
  const stopped = state.context.context === 'stopped';
  switch (action) {
    case 'primary':
      return canAccept ? touched : dismissTopAlert(touched, config);
    case 'secondary':
      if (canDecline) return touched;
      if (stopped && state.ui.dashboardRequested) {
        return { ...touched, ui: { ...touched.ui, dashboardRequested: false } };
      }
      if (selectToast(state, config) !== null) {
        return { ...touched, ui: { ...touched.ui, toastDismissedAt: now } };
      }
      return dismissTopAlert(touched, config);
    case 'next-page':
    case 'prev-page': {
      if (stopped && !state.ui.dashboardRequested) {
        return { ...touched, ui: { ...touched.ui, dashboardRequested: true } };
      }
      const page = cyclePage(state, action === 'next-page' ? 1 : -1);
      return { ...touched, ui: { ...touched.ui, page } };
    }
    case 'toggle-blank':
      return { ...touched, ui: { ...touched.ui, blanked: !state.ui.blanked } };
    case 'brightness-up':
    case 'brightness-down': {
      const step = action === 'brightness-up' ? BRIGHTNESS_STEP : -BRIGHTNESS_STEP;
      const brightnessOffset = clamp(
        roundTo(state.ui.brightnessOffset + step, 2),
        -MAX_BRIGHTNESS_OFFSET,
        MAX_BRIGHTNESS_OFFSET,
      );
      return { ...touched, ui: { ...touched.ui, brightnessOffset } };
    }
    default: {
      const unhandled: never = action;
      void unhandled;
      return touched;
    }
  }
}

/** Dismiss the first dismissible alert among those currently displayed. */
function dismissTopAlert(state: HudState, config: HudConfig): HudState {
  const displayed = selectDisplayedAlerts(
    state.alerts,
    { now: state.now, context: state.context.context, blanked: state.ui.blanked },
    config,
  );
  const top = displayed.find((a) => a.dismissible);
  if (top === undefined) return state;
  const alerts = dismissAlert(state.alerts, top.key, state.now);
  return alerts === state.alerts ? state : { ...state, alerts };
}
