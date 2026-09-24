import type { ShiftLightConfig } from '../types/config.ts';
import type { ShiftLightFrame } from '../types/frame.ts';
import { clamp } from '../units.ts';

/**
 * Once flashing, the shift light keeps flashing down to `flashRpm` minus this: max(100 rpm, 2 %
 * of `flashRpm`), so an engine speed hovering at the threshold does not flicker the flash.
 */
export function shiftFlashHysteresisRpm(flashRpm: number): number {
  return Math.max(100, 0.02 * flashRpm);
}

/**
 * The flash latch: turns on at rpm ≥ `flashRpm`, off only below `flashRpm` −
 * {@link shiftFlashHysteresisRpm}; off whenever the light is disabled or rpm is unknown.
 */
export function updateShiftFlash(
  flashing: boolean,
  rpm: number | null,
  config: ShiftLightConfig,
): boolean {
  if (!config.enabled || rpm === null || !Number.isFinite(rpm)) return false;
  const threshold = flashing
    ? config.flashRpm - shiftFlashHysteresisRpm(config.flashRpm)
    : config.flashRpm;
  return rpm >= threshold;
}

/**
 * Shift bar: level = (rpm − startRpm) / (shiftRpm − startRpm) clamped to 0–1. Null when
 * disabled, rpm unknown (null / not finite), or below startRpm. `flashing` is the latch from
 * {@link updateShiftFlash}; without it the bar flashes at or above flashRpm.
 */
export function computeShiftLight(
  rpm: number | null,
  config: ShiftLightConfig,
  flashing?: boolean,
): ShiftLightFrame | null {
  if (!config.enabled || rpm === null || !Number.isFinite(rpm) || rpm < config.startRpm) {
    return null;
  }
  const span = config.shiftRpm - config.startRpm;
  const level = span > 0 ? clamp((rpm - config.startRpm) / span, 0, 1) : 1;
  return { level, flash: flashing ?? rpm >= config.flashRpm };
}
