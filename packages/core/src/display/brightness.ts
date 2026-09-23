import type { BrightnessConfig } from '../types/config.ts';
import { notImplemented } from '../todo.ts';

export interface BrightnessInput {
  at: number;
  /** Ambient light, null when there is no sensor or the reading is stale. */
  lux: number | null;
  /** Current solar elevation if a location is known. */
  sunElevationDeg: number | null;
}

/** Implementations may add private smoothing fields. */
export interface BrightnessState {
  /** Smoothed auto level 0–1 (before the driver's manual offset). */
  level: number;
  night: boolean;
  updatedAt: number | null;
}

export function createBrightnessState(config: BrightnessConfig): BrightnessState {
  return notImplemented(`createBrightnessState(${config.mode})`);
}

/**
 * Map lux through the curve (interpolated on log10 lux), clamp to [minLevel, maxLevel] and
 * smooth exponentially (fast when darkening, slow when brightening). Without a lux reading
 * fall back to the sun (day → maxLevel·0.8, night → minLevel·2) or hold the last level.
 * Night mode per `nightMode` with lux hysteresis between nightEnterLux and nightExitLux.
 */
export function updateBrightness(
  state: BrightnessState,
  input: BrightnessInput,
  config: BrightnessConfig,
): BrightnessState {
  return notImplemented(`updateBrightness(${state.level}, ${input.at}, ${config.mode})`);
}
