import type { ShiftLightFrame } from '@carheadsup/core';
import { BLINK_FAST_PERIOD_MS, useBlinkPhase } from '../flash.ts';
import { clamp01, cx } from '../util.ts';

export const SHIFT_SEGMENTS = 12;

export type ShiftSegmentColor = 'green' | 'amber' | 'red';

/** Colour band of segment `index`: the first half green, then amber, the last sixth red. */
export function shiftSegmentColor(
  index: number,
  count: number = SHIFT_SEGMENTS,
): ShiftSegmentColor {
  const position = (index + 1) / count;
  if (position <= 0.5) return 'green';
  if (position <= 5 / 6) return 'amber';
  return 'red';
}

/** Number of lit segments for a fill level (rounded, so a level of 1 lights every segment). */
export function litSegments(level: number, count: number = SHIFT_SEGMENTS): number {
  return Math.round(clamp01(level) * count);
}

/**
 * Shift-light bar across the top: segments light green → amber → red with rpm; above the flash
 * threshold every segment lights red and the bar blinks.
 */
export function ShiftLight({ shift }: { shift: ShiftLightFrame }) {
  const lit = shift.flash ? SHIFT_SEGMENTS : litSegments(shift.level);
  const phase = useBlinkPhase(BLINK_FAST_PERIOD_MS, shift.flash);
  return (
    <div
      class={cx('hud-shift', shift.flash && 'hud-shift--flash hud-flash-fast')}
      style={phase}
      data-lit={lit}
      aria-hidden="true"
    >
      {Array.from({ length: SHIFT_SEGMENTS }, (_, i) => (
        <span
          key={i}
          class={cx(
            'hud-shift__seg',
            `hud-shift__seg--${shift.flash ? 'red' : shiftSegmentColor(i)}`,
            i < lit && 'hud-shift__seg--lit',
          )}
        />
      ))}
    </div>
  );
}
