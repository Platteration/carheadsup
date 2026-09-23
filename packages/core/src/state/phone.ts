import type { HudEvent } from '../types/events.ts';
import type { CallInfo, MediaInfo, MessageInfo, PhoneLinkStatus } from '../types/phone.ts';
import type { HudState, MediaState, TrackedHazard } from '../types/state.ts';
import { MAX_MESSAGES } from './selectors.ts';

/** Reducer handlers for companion-app events (phone link, nav, road, media, calls, messages). */

type EventOf<T extends HudEvent['type']> = Extract<HudEvent, { type: T }>;

/**
 * `MediaState.trackChangedAt` of a track that has not started playing since it appeared: far in
 * the past, so it never shows a toast, and replaced by the time playback starts.
 */
export const TRACK_NOT_ANNOUNCED = Number.MIN_SAFE_INTEGER;

export function applyPhoneLink(state: HudState, event: EventOf<'phone/link'>): HudState {
  const prev = state.phone;
  const phone: PhoneLinkStatus = {
    connected: event.connected,
    deviceName: event.deviceName !== undefined ? event.deviceName : prev.deviceName,
    appVersion: event.appVersion !== undefined ? event.appVersion : prev.appVersion,
    since: event.connected !== prev.connected ? state.now : prev.since,
  };
  return { ...state, phone };
}

/** New guidance; remembers the integrated distance so the maneuver distance can be dead-reckoned. */
export function applyNav(state: HudState, event: EventOf<'nav/update'>): HudState {
  return {
    ...state,
    nav: { info: event.nav, integratedKmAtUpdate: state.odometer.integratedKm },
  };
}

/**
 * Replace the hazard list. Hazards are re-stamped with the HUD's receipt time (their expiry is
 * measured against the HUD clock) and anchored for dead reckoning.
 */
export function applyHazards(state: HudState, event: EventOf<'hazards/update'>): HudState {
  const integratedKmAtUpdate = state.odometer.integratedKm;
  const hazards: TrackedHazard[] = event.hazards.map((hazard) => ({
    hazard: { ...hazard, updatedAt: state.now },
    integratedKmAtUpdate,
  }));
  return { ...state, hazards };
}

/**
 * Store now-playing info. The "now playing" toast is driven by `trackChangedAt`, which moves
 * to now when the track key changes while playing — or, for a track that changed while paused,
 * when it starts playing. Pausing and resuming the same track never re-announces it.
 */
export function applyMedia(state: HudState, info: MediaInfo | null): HudState {
  if (info === null) return state.media === null ? state : { ...state, media: null };
  const prev = state.media;
  let trackChangedAt: number;
  if (prev === null || prev.info.trackKey !== info.trackKey) {
    trackChangedAt = info.playing ? state.now : TRACK_NOT_ANNOUNCED;
  } else if (info.playing && prev.trackChangedAt === TRACK_NOT_ANNOUNCED) {
    trackChangedAt = state.now;
  } else {
    trackChangedAt = prev.trackChangedAt;
  }
  const media: MediaState = { info, trackChangedAt };
  return { ...state, media };
}

/**
 * Store the call, normalising its timestamps to the HUD clock: `updatedAt` is the receipt
 * time (an 'ended' call is cleared 2 s later) and `startedAt` is when the call entered its
 * current phase — first seen while ringing/dialing, then the moment it was answered — so the
 * call timer counts from pickup.
 */
export function applyCall(state: HudState, info: CallInfo | null): HudState {
  if (info === null) return state.call === null ? state : { ...state, call: null };
  const { now } = state;
  const prev = state.call;
  const answered = info.state === 'active' || info.state === 'held';
  let startedAt: number;
  if (prev !== null && prev.id === info.id) {
    const wasAnswered = prev.state === 'active' || prev.state === 'held';
    startedAt = answered && !wasAnswered && prev.state !== 'ended' ? now : prev.startedAt;
  } else {
    startedAt = Number.isFinite(info.startedAt) && info.startedAt <= now ? info.startedAt : now;
  }
  return { ...state, call: { ...info, startedAt, updatedAt: now } };
}

/**
 * Remember a message notification (sender only), most recent first, at most
 * {@link MAX_MESSAGES}. A repeated id updates the entry in place and keeps its receipt time,
 * so a re-sent notification does not toast again.
 */
export function applyMessage(state: HudState, message: MessageInfo): HudState {
  const index = state.messages.findIndex((m) => m.id === message.id);
  const existing = state.messages[index];
  if (existing !== undefined) {
    const messages = state.messages.slice();
    messages[index] = { ...message, receivedAt: existing.receivedAt };
    return { ...state, messages };
  }
  const messages = [{ ...message, receivedAt: state.now }, ...state.messages].slice(
    0,
    MAX_MESSAGES,
  );
  return { ...state, messages };
}

export function applyLocation(state: HudState, event: EventOf<'location/update'>): HudState {
  const { lat, lon } = event;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return state;
  }
  return { ...state, env: { ...state.env, location: { lat, lon, at: state.now } } };
}
