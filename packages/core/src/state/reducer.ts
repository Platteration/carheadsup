import type { HudConfig } from '../types/config.ts';
import type { HudEvent } from '../types/events.ts';
import type { PersistedState } from '../types/records.ts';
import type { HudState } from '../types/state.ts';
import { notImplemented } from '../todo.ts';

export const EMPTY_PERSISTED_STATE: PersistedState = {
  odometerKm: null,
  learnedGearRatios: null,
  avgLPer100km: null,
  maintenanceRecords: [],
};

export function createInitialState(
  config: HudConfig,
  persisted: PersistedState,
  now: number,
  options?: { simulated?: boolean },
): HudState {
  return notImplemented(
    `createInitialState(${config.version}, ${persisted.odometerKm}, ${now}, ${String(options)})`,
  );
}

/**
 * The single pure state transition. Never mutates `state`; never reads the clock
 * (time comes from `event.at`); never performs I/O.
 */
export function reduce(state: HudState, event: HudEvent, config: HudConfig): HudState {
  return notImplemented(`reduce(${state.now}, ${event.type}, ${config.version})`);
}

/** What the server should write to disk. */
export function extractPersisted(state: HudState): PersistedState {
  return notImplemented(`extractPersisted(${state.now})`);
}
