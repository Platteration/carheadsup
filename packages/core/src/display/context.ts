import type { ContextConfig, DrivingContext } from '../types/config.ts';
import { notImplemented } from '../todo.ts';

export interface ContextInput {
  at: number;
  /** Null when unknown/stale. */
  speedKph: number | null;
  engineRunning: boolean;
  linkUp: boolean;
}

/** Implementations may add private fields (candidate context, dwell timers …). */
export interface ContextState {
  context: DrivingContext;
  since: number;
  /** When the vehicle last became stationary, null while moving. */
  stationarySince: number | null;
}

export function createContextState(now: number): ContextState {
  return notImplemented(`createContextState(${now})`);
}

/**
 * Derive the driving context with hysteresis so the layout does not flicker:
 *  - parked:  engine off, or stationary ≥ parkedAfterMs, or link down with no speed
 *  - stopped: stationary (< stationaryKph) but not yet parked
 *  - highway: ≥ highwayEnterKph sustained for highwayDwellMs; left below highwayExitKph
 *  - city:    moving otherwise
 */
export function updateContext(
  state: ContextState,
  input: ContextInput,
  config: ContextConfig,
): ContextState {
  return notImplemented(`updateContext(${state.context}, ${input.at}, ${config.highwayEnterKph})`);
}
