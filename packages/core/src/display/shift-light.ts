import type { ShiftLightConfig } from '../types/config.ts';
import type { ShiftLightFrame } from '../types/frame.ts';
import { notImplemented } from '../todo.ts';

/** Null when disabled, rpm unknown, or below startRpm. */
export function computeShiftLight(
  rpm: number | null,
  config: ShiftLightConfig,
): ShiftLightFrame | null {
  return notImplemented(`computeShiftLight(${String(rpm)}, ${config.enabled})`);
}
