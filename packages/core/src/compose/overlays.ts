import { computeShiftLight } from '../display/shift-light.ts';
import {
  ENDED_CALL_SHOW_MS,
  callControls,
  collisionLevel,
  freshSignal,
  isAdasFresh,
  selectToast,
} from '../state/selectors.ts';
import type { CollisionLevel } from '../types/adas.ts';
import type { Alert } from '../types/alerts.ts';
import type { HudConfig } from '../types/config.ts';
import type { AlertFrame, CallFrame, ShiftLightFrame, ToastFrame } from '../types/frame.ts';
import type { HudState } from '../types/state.ts';
import { clamp, roundTo } from '../units.ts';

/** Everything drawn outside the widget grid: toast, call card, shift light, ADAS, alerts. */

/** Toasts fade out linearly over their last second. */
export const TOAST_FADE_MS = 1000;

export function composeToast(state: HudState, config: HudConfig): ToastFrame | null {
  const toast = selectToast(state, config);
  if (toast === null) return null;
  const remaining = toast.endsAt - state.now;
  const opacity =
    remaining >= TOAST_FADE_MS ? 1 : roundTo(clamp(remaining / TOAST_FADE_MS, 0, 1), 2);
  if (opacity <= 0) return null;
  return { kind: toast.kind, title: toast.title, subtitle: toast.subtitle, opacity };
}

/**
 * The call card: shown while ringing, dialing, active or held, and for 2 s after the call
 * ended. The timer counts whole seconds since the call was answered. Without a phone link the
 * card has no controls.
 */
export function composeCall(state: HudState): CallFrame | null {
  const { call, now } = state;
  if (call === null) return null;
  if (call.state === 'ended' && now - call.updatedAt >= ENDED_CALL_SHOW_MS) return null;
  const answered = call.state === 'active' || call.state === 'held';
  const { canAccept, canDecline } = callControls(call, state.phone.connected);
  return {
    state: call.state,
    name: call.callerName?.trim() || call.number?.trim() || 'Unknown caller',
    number: call.number,
    durationS: answered ? Math.max(0, Math.floor((now - call.startedAt) / 1000)) : null,
    canAccept,
    canDecline,
  };
}

/** Shift bar while driving (never parked), from fresh rpm; flashing as latched in the state. */
export function composeShiftLight(state: HudState, config: HudConfig): ShiftLightFrame | null {
  if (!config.shiftLight.enabled || state.context.context === 'parked') return null;
  const light = computeShiftLight(freshSignal(state, 'rpm'), config.shiftLight, state.shiftFlash);
  return light === null ? null : { level: roundTo(light.level, 3), flash: light.flash };
}

const NO_BLIND_SPOT = { left: false, right: false } as const;

/** Blind-spot indicators from a connected module, only while its reading is ≤ 1 s old. */
export function composeBlindSpot(state: HudState): { left: boolean; right: boolean } {
  const { adas } = state;
  return isAdasFresh(state, adas.blindSpotUpdatedAt)
    ? { left: adas.blindSpotLeft, right: adas.blindSpotRight }
    : { ...NO_BLIND_SPOT };
}

/**
 * Forward-collision level from a connected module while its reading is ≤ 1 s old; a 'warning'
 * is held for 1 s after the module last reported it (see `collisionLevel`).
 */
export function composeCollision(state: HudState): CollisionLevel {
  return collisionLevel(state);
}

export function toAlertFrame(alert: Alert): AlertFrame {
  return {
    key: alert.key,
    kind: alert.kind,
    severity: alert.severity,
    title: alert.title,
    detail: alert.detail,
    code: alert.code,
    dismissible: alert.dismissible,
  };
}
