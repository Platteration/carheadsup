import type { BrightnessConfig, DayHours } from '../types/config.ts';
import { clamp } from '../units.ts';

export interface BrightnessInput {
  at: number;
  /** Ambient light, null when there is no sensor or the reading is stale. */
  lux: number | null;
  /** Current solar elevation if a location is known. */
  sunElevationDeg: number | null;
  /**
   * The local wall-clock time as hours since midnight (0 ≤ h < 24), null when the time zone is
   * unknown. Consulted (`nightHours`) only when neither lux nor the sun is known.
   */
  localHour: number | null;
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
  /**
   * By day: when the light sensor started reading below `nightEnterLux` (without a reading
   * at or above it since). Night follows once that has lasted {@link NIGHT_ENTER_DWELL_MS};
   * null otherwise.
   */
  darkSince: number | null;
  /**
   * The light sensor has driven the level. Its first reading snaps level and palette, like the
   * first target of all: what came before (the sun, the clock) was only a guess.
   */
  luxSeen: boolean;
}

/**
 * Without a light reading (sun or clock fallback): the daytime level as a fraction of
 * `maxLevel`. Full: there is no telling bright sunshine from an overcast day, and an
 * unreadable HUD in the sun is the worse mistake (the night level takes over at dusk).
 */
export const SUN_DAY_LEVEL_FACTOR = 1;
/** Without a light reading (sun or clock fallback): the night level as a multiple of `minLevel`. */
export const SUN_NIGHT_LEVEL_FACTOR = 2;
/**
 * The light sensor must read below `nightEnterLux` this long before the night palette comes on,
 * so an underpass or a bridge's shadow does not flash it. The level itself still follows at once.
 */
export const NIGHT_ENTER_DWELL_MS = 1500;

/** Lux values are floored here before taking log10 (sensors report 0 in the dark). */
const MIN_LUX = 1e-3;

/**
 * Initial state before any reading: night only when forced, and the daytime fallback level (a
 * visible default). The first update with anything to go on — a light reading, the sun, or the
 * local time for `nightHours` — snaps level and palette to it, so a HUD that starts at night is
 * dim from its first frame.
 */
export function createBrightnessState(config: BrightnessConfig): BrightnessState {
  return {
    level:
      config.mode === 'manual' ? clamp(config.manualLevel, 0, 1) : sunFallbackLevel(false, config),
    night: config.nightMode === 'always',
    updatedAt: null,
    target: null,
    darkSince: null,
    luxSeen: false,
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

/** Whether `hour` (0–24) falls in `hours`, which may run across midnight. */
export function inDayHours(hour: number, hours: DayHours): boolean {
  const { start, end } = hours;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * Night or day without a light reading: by the sun when its elevation is known, else by the
 * local time (`nightHours`), else unknown (null).
 */
function fallbackNight(
  sunDeg: number | null,
  localHour: number | null,
  config: BrightnessConfig,
): boolean | null {
  if (sunDeg !== null) return sunDeg < config.nightSunElevationDeg;
  if (localHour !== null && config.nightHours !== null) {
    return inDayHours(localHour, config.nightHours);
  }
  return null;
}

function nextNight(
  state: BrightnessState,
  at: number,
  lux: number | null,
  fallback: boolean | null,
  snap: boolean,
  config: BrightnessConfig,
): Pick<BrightnessState, 'night' | 'darkSince'> {
  const settle = (night: boolean) => ({ night, darkSince: null });
  switch (config.nightMode) {
    case 'always':
      return settle(true);
    case 'never':
      return settle(false);
    case 'sun':
      return settle(fallback ?? state.night);
    case 'sensor': {
      if (lux === null) return settle(fallback ?? state.night);
      if (state.night) return settle(lux <= config.nightExitLux);
      if (lux >= config.nightEnterLux) return settle(false);
      // Dark: at once on the first reading (start-up), otherwise once it has lasted the dwell.
      const darkSince = state.darkSince ?? at;
      return snap || at - darkSince >= NIGHT_ENTER_DWELL_MS
        ? settle(true)
        : { night: false, darkSince };
    }
  }
}

/**
 * Map lux through the curve (interpolated on log10 lux), clamp to [minLevel, maxLevel] and
 * smooth exponentially (darkening faster than brightening). Without a lux reading fall back to
 * the sun, else to the local time against `nightHours` (day → maxLevel, night → minLevel·2), else
 * hold the last level. Night mode per `nightMode`, with lux hysteresis between nightEnterLux and
 * nightExitLux and NIGHT_ENTER_DWELL_MS below nightEnterLux before night comes on.
 *
 * Smoothing: level += (target − level)·(1 − e^(−Δt/τ)), with Δt from the timestamps and
 * τ = riseTimeMs when brightening, fallTimeMs when darkening (τ = 0 → instant). The first
 * target snaps (level and palette), and so does the light sensor's first reading. Manual mode
 * returns `manualLevel` unsmoothed. Night modes 'sensor' (without a lux reading) and 'sun' use
 * the sun, else `nightHours`, else hold the previous palette.
 */
export function updateBrightness(
  state: BrightnessState,
  input: BrightnessInput,
  config: BrightnessConfig,
): BrightnessState {
  const lux = finiteOrNull(input.lux);
  const sunDeg = finiteOrNull(input.sunElevationDeg);
  const hour = finiteOrNull(input.localHour);
  const fallback = fallbackNight(sunDeg, hour, config);
  // The first target of all, and the light sensor's first reading, snap.
  const snap = state.updatedAt === null || (lux !== null && !state.luxSeen);
  const nightState = nextNight(state, input.at, lux, fallback, snap, config);
  const luxSeen = state.luxSeen || lux !== null;

  if (config.mode === 'manual') {
    const level = clamp(config.manualLevel, 0, 1);
    return { ...nightState, luxSeen, level, updatedAt: input.at, target: level };
  }

  let target: number | null = null;
  if (lux !== null) {
    target = clamp(luxToLevel(lux, config.curve), config.minLevel, config.maxLevel);
  } else if (fallback !== null) {
    target = sunFallbackLevel(fallback, config);
  }

  if (target === null) {
    // Nothing to go on: hold, but respect a changed min/max.
    return {
      ...state,
      ...nightState,
      level: clamp(state.level, config.minLevel, config.maxLevel),
    };
  }

  let level: number;
  if (snap || state.updatedAt === null) {
    level = target;
  } else {
    const dt = Math.max(0, input.at - state.updatedAt);
    const tau = target > state.level ? config.riseTimeMs : config.fallTimeMs;
    const alpha = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
    level = state.level + (target - state.level) * alpha;
  }
  return {
    ...nightState,
    luxSeen,
    level: clamp(level, config.minLevel, config.maxLevel),
    updatedAt: input.at,
    target,
  };
}
