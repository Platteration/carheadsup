import type { BrightnessConfig } from '../types/config.ts';
import { clamp } from '../units.ts';

export interface BrightnessInput {
  at: number;
  /** Ambient light, null when there is no sensor or the reading is stale. */
  lux: number | null;
  /** Current solar elevation if a location is known. */
  sunElevationDeg: number | null;
}

/** All fields are plain numbers/booleans/null, so the state is JSON-serialisable. */
export interface BrightnessState {
  /** Smoothed auto level 0–1 (before the driver's manual offset). */
  level: number;
  night: boolean;
  /**
   * When `level` was last moved towards a target (lux, sun or manual); null until the first
   * target, so the first real sample snaps instead of fading in from the initial guess.
   */
  updatedAt: number | null;
  /** The level currently being approached; null until the first target. */
  target: number | null;
}

/** Sun fallback (no lux): daytime level as a fraction of `maxLevel`. */
export const SUN_DAY_LEVEL_FACTOR = 0.8;
/** Sun fallback (no lux): night-time level as a multiple of `minLevel`. */
export const SUN_NIGHT_LEVEL_FACTOR = 2;

/** Lux values are floored here before taking log10 (sensors report 0 in the dark). */
const MIN_LUX = 1e-3;

/**
 * Initial state before any reading: night only when forced, and the daytime sun fallback level
 * (a visible default for installations with neither light sensor nor location).
 */
export function createBrightnessState(config: BrightnessConfig): BrightnessState {
  return {
    level:
      config.mode === 'manual' ? clamp(config.manualLevel, 0, 1) : sunFallbackLevel(false, config),
    night: config.nightMode === 'always',
    updatedAt: null,
    target: null,
  };
}

/**
 * Map an ambient light reading through the brightness curve, interpolating linearly on
 * log10(lux) between points and holding the end levels outside the curve. Not clamped to
 * min/max. An empty curve yields 1.
 */
export function luxToLevel(lux: number, curve: BrightnessConfig['curve']): number {
  const first = curve[0];
  if (first === undefined) return 1;
  const x = Math.log10(Math.max(lux, MIN_LUX));
  if (x <= Math.log10(Math.max(first[0], MIN_LUX))) return first[1];
  for (let i = 1; i < curve.length; i++) {
    const lo = curve[i - 1];
    const hi = curve[i];
    if (lo === undefined || hi === undefined) break;
    const x1 = Math.log10(Math.max(hi[0], MIN_LUX));
    if (x <= x1) {
      const x0 = Math.log10(Math.max(lo[0], MIN_LUX));
      const f = x1 > x0 ? (x - x0) / (x1 - x0) : 1;
      return lo[1] + (hi[1] - lo[1]) * f;
    }
  }
  const last = curve[curve.length - 1];
  return last === undefined ? 1 : last[1];
}

function sunFallbackLevel(night: boolean, config: BrightnessConfig): number {
  const raw = night
    ? config.minLevel * SUN_NIGHT_LEVEL_FACTOR
    : config.maxLevel * SUN_DAY_LEVEL_FACTOR;
  return clamp(raw, config.minLevel, config.maxLevel);
}

const finiteOrNull = (v: number | null): number | null =>
  v !== null && Number.isFinite(v) ? v : null;

function nextNight(
  night: boolean,
  lux: number | null,
  sunDeg: number | null,
  config: BrightnessConfig,
): boolean {
  const bySun = (): boolean => (sunDeg === null ? night : sunDeg < config.nightSunElevationDeg);
  switch (config.nightMode) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'sun':
      return bySun();
    case 'sensor':
      if (lux === null) return bySun();
      return night ? lux <= config.nightExitLux : lux < config.nightEnterLux;
  }
}

/**
 * Map lux through the curve (interpolated on log10 lux), clamp to [minLevel, maxLevel] and
 * smooth exponentially (fast when darkening, slow when brightening). Without a lux reading
 * fall back to the sun (day → maxLevel·0.8, night → minLevel·2) or hold the last level.
 * Night mode per `nightMode` with lux hysteresis between nightEnterLux and nightExitLux.
 *
 * Smoothing: level += (target − level)·(1 − e^(−Δt/τ)), with Δt from the timestamps and
 * τ = riseTimeMs when brightening, fallTimeMs when darkening (τ = 0 → instant). The first
 * target snaps. Manual mode returns `manualLevel` unsmoothed. Night mode 'sensor' uses the sun
 * when there is no lux reading; 'sun' holds the previous value when the elevation is unknown.
 */
export function updateBrightness(
  state: BrightnessState,
  input: BrightnessInput,
  config: BrightnessConfig,
): BrightnessState {
  const lux = finiteOrNull(input.lux);
  const sunDeg = finiteOrNull(input.sunElevationDeg);
  const night = nextNight(state.night, lux, sunDeg, config);

  if (config.mode === 'manual') {
    const level = clamp(config.manualLevel, 0, 1);
    return { level, night, updatedAt: input.at, target: level };
  }

  let target: number | null = null;
  if (lux !== null) {
    target = clamp(luxToLevel(lux, config.curve), config.minLevel, config.maxLevel);
  } else if (sunDeg !== null) {
    target = sunFallbackLevel(sunDeg < config.nightSunElevationDeg, config);
  }

  if (target === null) {
    // Nothing to go on: hold, but respect a changed min/max.
    return { ...state, level: clamp(state.level, config.minLevel, config.maxLevel), night };
  }

  let level: number;
  if (state.updatedAt === null) {
    level = target;
  } else {
    const dt = Math.max(0, input.at - state.updatedAt);
    const tau = target > state.level ? config.riseTimeMs : config.fallTimeMs;
    const alpha = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
    level = state.level + (target - state.level) * alpha;
  }
  return {
    level: clamp(level, config.minLevel, config.maxLevel),
    night,
    updatedAt: input.at,
    target,
  };
}
