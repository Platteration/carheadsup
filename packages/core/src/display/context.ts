import type { ContextConfig, DrivingContext } from '../types/config.ts';

export interface ContextInput {
  at: number;
  /** Null when unknown/stale. */
  speedKph: number | null;
  engineRunning: boolean;
  linkUp: boolean;
}

/** All fields are plain numbers/strings/null, so the state is JSON-serialisable. */
export interface ContextState {
  context: DrivingContext;
  since: number;
  /** When the vehicle last became stationary, null while moving. */
  stationarySince: number | null;
  /** When speed first reached `highwayEnterKph` in the current uninterrupted run (dwell timer). */
  highwayCandidateSince: number | null;
  /**
   * When the vehicle came to a complete standstill (speed below `STILL_KPH`); reset by any
   * creeping, so crawling in a traffic jam never counts towards `parkedAfterMs`.
   */
  stillSince: number | null;
  /** Timestamp of the last input with a known speed (drives the data-gap grace period). */
  lastSpeedAt: number | null;
  /**
   * When the engine was last seen stopping at a complete standstill (start-stop vs switched
   * off); reset by any creeping, like `stillSince`.
   */
  engineOffSince: number | null;
}

/**
 * Once stationary, the vehicle only counts as moving again at `stationaryKph` plus this margin,
 * so creeping at 1–3 km/h never flickers between 'city' and 'stopped'.
 */
export const STATIONARY_HYSTERESIS_KPH = 2;

/** Below this speed (km/h) the vehicle is standing completely still (OBD speed reads 0). */
export const STILL_KPH = 1;

/**
 * When vehicle data stops arriving while stopped but the adapter link is still up (ELM327
 * timeouts, BUS BUSY, a slow trouble-code read), hold 'stopped' this long after speed was last
 * known before assuming the ignition went off. The poller keeps the link up when the ECU
 * falls silent, so this is also how long ignition-off takes to bring up the parked dashboard.
 */
export const DATA_GAP_GRACE_MS = 10_000;

export function createContextState(now: number): ContextState {
  return {
    context: 'parked',
    since: now,
    stationarySince: null,
    highwayCandidateSince: null,
    stillSince: null,
    lastSpeedAt: null,
    engineOffSince: null,
  };
}

const isMovingContext = (context: DrivingContext): boolean =>
  context === 'city' || context === 'highway';

function next(
  state: ContextState,
  context: DrivingContext,
  at: number,
  fields: Partial<Omit<ContextState, 'context' | 'since'>>,
): ContextState {
  return {
    ...state,
    ...fields,
    context,
    since: context === state.context ? state.since : at,
  };
}

/**
 * Derive the driving context with hysteresis so the layout does not flicker:
 *  - parked:  at a complete standstill with the engine off for ≥ engineOffParkedAfterMs (so
 *             automatic start-stop does not flash the parked dashboard at red lights), at a
 *             complete standstill with the engine running for ≥ parkedAfterMs, or stopped with
 *             no vehicle data at all: at once when the link is down, after DATA_GAP_GRACE_MS
 *             when the link is up but the ECU has fallen silent (ignition off). Parked is sticky
 *             until the vehicle actually moves (starting the engine alone does not leave it).
 *  - stopped: stationary (< stationaryKph, left again only at stationaryKph + hysteresis) but not
 *             yet parked.
 *  - highway: ≥ highwayEnterKph sustained for highwayDwellMs; left below highwayExitKph.
 *  - city:    moving otherwise.
 *
 * Safety exceptions: a vehicle known to be moving is never 'parked' (hybrids drive and creep
 * with the engine off, so creeping restarts both parking timers), and a moving context is
 * never left on missing data alone — only a speed reading (e.g. 0 once the adapter is back)
 * can end it, so a dead adapter at speed never brings up the full-screen dashboard.
 * While speed is unknown but the link is up and the engine runs, the context is held.
 */
export function updateContext(
  state: ContextState,
  input: ContextInput,
  config: ContextConfig,
): ContextState {
  const { at } = input;
  const speed =
    input.speedKph !== null && Number.isFinite(input.speedKph) && input.speedKph >= 0
      ? input.speedKph
      : null;

  if (speed === null) {
    if (isMovingContext(state.context) || state.context === 'parked') return state;
    if (input.linkUp && input.engineRunning) return state;
    const briefGap =
      input.linkUp && state.lastSpeedAt !== null && at - state.lastSpeedAt < DATA_GAP_GRACE_MS;
    if (briefGap) return state;
    return next(state, 'parked', at, { highwayCandidateSince: null });
  }

  const wasStationary = !isMovingContext(state.context);
  const movingThreshold = wasStationary
    ? config.stationaryKph + STATIONARY_HYSTERESIS_KPH
    : config.stationaryKph;

  if (speed < movingThreshold) {
    const stationarySince = state.stationarySince ?? at;
    const stillSince =
      speed < Math.min(config.stationaryKph, STILL_KPH) ? (state.stillSince ?? at) : null;
    // Like `stillSince`, engine-off time only counts at a complete standstill: a hybrid (or a
    // start-stop engine) creeping along in a jam is still driving.
    const engineOffSince =
      !input.engineRunning && stillSince !== null ? (state.engineOffSince ?? at) : null;
    const parked =
      state.context === 'parked' ||
      (engineOffSince !== null && at - engineOffSince >= config.engineOffParkedAfterMs) ||
      (stillSince !== null && at - stillSince >= config.parkedAfterMs);
    return next(state, parked ? 'parked' : 'stopped', at, {
      stationarySince,
      stillSince,
      highwayCandidateSince: null,
      lastSpeedAt: at,
      engineOffSince,
    });
  }

  // Moving.
  const moving = { stationarySince: null, stillSince: null, lastSpeedAt: at, engineOffSince: null };
  if (state.context === 'highway') {
    return speed < config.highwayExitKph
      ? next(state, 'city', at, { ...moving, highwayCandidateSince: null })
      : next(state, 'highway', at, moving);
  }
  if (speed >= config.highwayEnterKph) {
    const candidateSince = state.highwayCandidateSince ?? at;
    const sustained = at - candidateSince >= config.highwayDwellMs;
    return next(state, sustained ? 'highway' : 'city', at, {
      ...moving,
      highwayCandidateSince: candidateSince,
    });
  }
  return next(state, 'city', at, { ...moving, highwayCandidateSince: null });
}
