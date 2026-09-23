import type { ShiftLightConfig } from '../types/config.ts';
import type { ShiftLightFrame } from '../types/frame.ts';
import { clamp } from '../units.ts';

/**
 * Shift bar: level = (rpm − startRpm) / (shiftRpm − startRpm) clamped to 0–1, flashing at or
 * above flashRpm. Null when disabled, rpm unknown (null / not finite), or below startRpm.
 */
export function computeShiftLight(
  rpm: number | null,
  config: ShiftLightConfig,
): ShiftLightFrame | null {
  if (!config.enabled || rpm === null || !Number.isFinite(rpm) || rpm < config.startRpm) {
    return null;
  }
  const span = config.shiftRpm - config.startRpm;
  const level = span > 0 ? clamp((rpm - config.startRpm) / span, 0, 1) : 1;
  return { level, flash: rpm >= config.flashRpm };
}
