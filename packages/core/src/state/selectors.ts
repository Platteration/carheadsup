import type { HudConfig } from '../types/config.ts';
import type { CallInfo, CallState } from '../types/phone.ts';
import type { SignalId } from '../types/signals.ts';
import type { HudState, TrackedHazard } from '../types/state.ts';
import { freshValue } from '../staleness.ts';

/**
 * Pure read-only views of `HudState` shared by the reducer, the alert engine, the effect
 * derivation and the frame composer, so all of them agree on what "fresh", "running",
 * "showing" … mean.
 */

/** Engine speed at or above which the engine counts as running (cranking stays below it). */
export const ENGINE_RUNNING_RPM = 300;
/** ADAS readings (blind spot, collision) older than this are ignored. */
export const ADAS_FRESH_MS = 1000;
/** A light-sensor reading older than this no longer drives brightness. */
export const LUX_FRESH_MS = 5000;
/** Message notifications are forgotten this long after receipt. */
export const MESSAGE_TTL_MS = 60_000;
/** At most this many recent messages are kept (most recent first). */
export const MAX_MESSAGES = 5;
/** An 'ended' call card stays up this long after the call ended. */
export const ENDED_CALL_SHOW_MS = 2000;
/** Hazards not refreshed by the phone for this long are dropped. */
export const HAZARD_TTL_MS = 120_000;
/** A hazard is dropped once dead reckoning puts it this far behind the vehicle. */
export const HAZARD_PASSED_DROP_M = 50;
/** Phone-sourced route data (nav, road, hazards …) survives a phone disconnect this long. */
export const PHONE_DATA_GRACE_MS = 30_000;
/** Maintenance status is recomputed on ticks at most this often. */
export const MAINTENANCE_RECHECK_MS = 60_000;
/** Speed samples further apart than this are not integrated across (odometer). */
export const ODOMETER_MAX_GAP_MS = 5000;

/** Fresh value of a vehicle signal at `state.now`, or null when missing or stale. */
export function freshSignal(state: HudState, signal: SignalId): number | null {
  return freshValue(state.vehicle.signals, signal, state.now);
}

/** Fresh road speed, km/h; negative readings count as unknown. */
export function freshSpeedKph(state: HudState): number | null {
  const speed = freshSignal(state, 'speed');
  return speed !== null && speed >= 0 ? speed : null;
}

/** Engine running ⇔ a fresh rpm reading of at least {@link ENGINE_RUNNING_RPM}. */
export function isEngineRunning(state: HudState): boolean {
  const rpm = freshSignal(state, 'rpm');
  return rpm !== null && rpm >= ENGINE_RUNNING_RPM;
}

export function isObdLinkUp(state: HudState): boolean {
  return state.vehicle.link.state === 'connected';
}

/** Battery voltage (adapter pin 16), falling back to the ECU supply voltage (PID 0x42). */
export function freshSupplyVoltage(state: HudState): number | null {
  return freshSignal(state, 'batteryVoltage') ?? freshSignal(state, 'controlModuleVoltage');
}

/** Distance the vehicle has covered since `integratedKm` was sampled, metres (≥ 0). */
export function travelledSinceM(state: HudState, integratedKmAtUpdate: number): number {
  const m = (state.odometer.integratedKm - integratedKmAtUpdate) * 1000;
  return Number.isFinite(m) && m > 0 ? m : 0;
}

/**
 * Dead-reckoned distance to the next maneuver: the phone's distance minus what the vehicle has
 * covered since that update, floored at 0. Null without active guidance or a distance.
 */
export function navDistanceM(state: HudState): number | null {
  const nav = state.nav;
  const d = nav?.info.distanceToManeuverM;
  if (nav === null || d === null || d === undefined || !Number.isFinite(d)) return null;
  return Math.max(0, d - travelledSinceM(state, nav.integratedKmAtUpdate));
}

/** Dead-reckoned remaining route distance, metres, floored at 0. */
export function navRemainingM(state: HudState): number | null {
  const nav = state.nav;
  const d = nav?.info.remainingDistanceM;
  if (nav === null || d === null || d === undefined || !Number.isFinite(d)) return null;
  return Math.max(0, d - travelledSinceM(state, nav.integratedKmAtUpdate));
}

/**
 * Dead-reckoned distance to a hazard, metres. Negative once the vehicle has passed it; null
 * when the phone gave no distance.
 */
export function hazardDistanceM(state: HudState, tracked: TrackedHazard): number | null {
  const d = tracked.hazard.distanceM;
  if (d === null || !Number.isFinite(d)) return null;
  return d - travelledSinceM(state, tracked.integratedKmAtUpdate);
}

/** Whether an ADAS reading stamped `updatedAt` may still be shown. */
export function isAdasFresh(state: HudState, updatedAt: number | null): boolean {
  return (
    state.adas.moduleConnected &&
    updatedAt !== null &&
    state.now - updatedAt >= 0 &&
    state.now - updatedAt <= ADAS_FRESH_MS
  );
}

/** Call states that put a call card on screen (plus 'ended', briefly). */
const LIVE_CALL_STATES: ReadonlySet<CallState> = new Set(['ringing', 'dialing', 'active', 'held']);

export function isCallLive(call: CallInfo | null): call is CallInfo {
  return call !== null && LIVE_CALL_STATES.has(call.state);
}

/**
 * What the driver can do about the current call. `primary` accepts a ringing call; `secondary`
 * declines a ringing call and hangs up one that is dialing or active.
 */
export function callControls(call: CallInfo | null): { canAccept: boolean; canDecline: boolean } {
  const state = call?.state;
  return {
    canAccept: state === 'ringing',
    canDecline: state === 'ringing' || state === 'dialing' || state === 'active',
  };
}

/** A toast chosen for display, before fading is applied. */
export interface ToastSelection {
  kind: 'media' | 'message';
  title: string;
  subtitle: string | null;
  /** When the toast appeared (receipt / track change). */
  startedAt: number;
  /** When it disappears. */
  endsAt: number;
}

/**
 * The toast showing right now, if any: a message sender (within `messageToastMs` of receipt)
 * beats a track change (within `mediaToastMs`). Nothing shows while a call is up, and a toast
 * the driver dismissed after it appeared stays hidden (the next one still shows).
 */
export function selectToast(state: HudState, config: HudConfig): ToastSelection | null {
  if (isCallLive(state.call)) return null;
  const { now } = state;
  const dismissedAt = state.ui.toastDismissedAt;
  const showing = (startedAt: number, durationMs: number): boolean =>
    now >= startedAt &&
    now < startedAt + durationMs &&
    (dismissedAt === null || dismissedAt < startedAt);

  const message = state.messages[0];
  if (
    config.phone.showMessageSender &&
    message !== undefined &&
    showing(message.receivedAt, config.display.messageToastMs)
  ) {
    return {
      kind: 'message',
      title: message.sender,
      subtitle: message.app,
      startedAt: message.receivedAt,
      endsAt: message.receivedAt + config.display.messageToastMs,
    };
  }

  const media = state.media;
  if (
    config.phone.showMedia &&
    media !== null &&
    media.info.playing &&
    media.info.title !== null &&
    media.info.title !== '' &&
    showing(media.trackChangedAt, config.display.mediaToastMs)
  ) {
    return {
      kind: 'media',
      title: media.info.title,
      subtitle: media.info.artist,
      startedAt: media.trackChangedAt,
      endsAt: media.trackChangedAt + config.display.mediaToastMs,
    };
  }
  return null;
}
