import type { HudConfig } from '../types/config.ts';
import type { HudState } from '../types/state.ts';
import {
  advanceBrightness,
  advanceContext,
  advanceGear,
  advanceTrip,
  refreshMaintenance,
} from './derived.ts';
import { dropPhoneData } from './phone.ts';
import {
  ENDED_CALL_SHOW_MS,
  HAZARD_PASSED_DROP_M,
  HAZARD_TTL_MS,
  MAINTENANCE_RECHECK_MS,
  MESSAGE_TTL_MS,
  PHONE_DATA_GRACE_MS,
  ROAD_TTL_MS,
  freshSignal,
  hazardDistanceM,
} from './selectors.ts';

/**
 * Clock tick: advance everything that changes with time alone — the driving context (speed may
 * have gone stale), a gear estimate whose inputs went stale, brightness, trip ending, maintenance
 * status (at most once a minute) — and expire phone data that is no longer current.
 */
export function applyTick(state: HudState, config: HudConfig): HudState {
  let next: HudState = { ...state, context: advanceContext(state, config) };
  if (next.gear.estimate.gear !== null && drivetrainStale(next)) {
    next = { ...next, gear: advanceGear(next, config) };
  }
  next = {
    ...next,
    env: { ...next.env, brightness: advanceBrightness(next, config) },
    trip: advanceTrip(next, config),
  };
  const { checkedAt } = next.maintenance;
  if (checkedAt === null || next.now - checkedAt >= MAINTENANCE_RECHECK_MS) {
    next = { ...next, maintenance: refreshMaintenance(next, config) };
  }
  return expirePhoneData(next);
}

/** Neither rpm/speed nor a reported gear is fresh: the displayed gear must not linger. */
function drivetrainStale(state: HudState): boolean {
  const inferable = freshSignal(state, 'speed') !== null && freshSignal(state, 'rpm') !== null;
  return !inferable && freshSignal(state, 'transmissionGear') === null;
}

/**
 * Drop messages older than a minute, an 'ended' call 2 s after it ended, a road (speed limit)
 * the phone has not refreshed for 75 s, hazards it has not refreshed for 2 minutes or that are
 * well behind the vehicle, and — 30 s after the phone disconnected — everything else the phone
 * provided (route, road, hazards, media, call).
 */
function expirePhoneData(state: HudState): HudState {
  const { now } = state;
  if (!state.phone.connected && now - state.phone.since >= PHONE_DATA_GRACE_MS) {
    return expireMessages(dropPhoneData(state));
  }

  let next = expireMessages(state);
  const call = next.call;
  if (call !== null && call.state === 'ended' && now - call.updatedAt >= ENDED_CALL_SHOW_MS) {
    next = { ...next, call: null };
  }
  if (next.road !== null && now - next.road.updatedAt > ROAD_TTL_MS) next = { ...next, road: null };
  const hazards = next.hazards.filter((tracked) => {
    if (now - tracked.hazard.updatedAt > HAZARD_TTL_MS) return false;
    const d = hazardDistanceM(next, tracked);
    return d === null || d >= -HAZARD_PASSED_DROP_M;
  });
  if (hazards.length !== next.hazards.length) next = { ...next, hazards };
  return next;
}

function expireMessages(state: HudState): HudState {
  const { now } = state;
  const messages = state.messages.filter((m) => now - m.receivedAt <= MESSAGE_TTL_MS);
  return messages.length === state.messages.length ? state : { ...state, messages };
}
