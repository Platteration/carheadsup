import { useEffect, useMemo, useState } from 'preact/hooks';

/**
 * Photosensitivity guard for everything that flashes. The CSS blink rates stay under 3 Hz, but a
 * flashing element that is mounted and unmounted straight from per-frame input (a collision level
 * or shift point dithering at its threshold) would appear and disappear at the frame rate. These
 * helpers keep such states from toggling faster than once per {@link FLASH_HOLD_MS} and keep
 * every blink on one clock, so a remount never restarts its phase.
 */

/** A flashing state stays on at least this long after the input last asked for it. */
export const FLASH_HOLD_MS = 1000;

/** Blink periods, matching `.hud-flash` and `.hud-flash-fast` in hud.css. */
export const BLINK_PERIOD_MS = 1000;
export const BLINK_FAST_PERIOD_MS = 400;

/**
 * `active`, held on for `holdMs` after it last was: turns on at once, turns off only after the
 * input has stayed off for the whole hold time.
 */
export function useHold(active: boolean, holdMs: number = FLASH_HOLD_MS): boolean {
  const [held, setHeld] = useState(active);
  useEffect(() => {
    if (active) {
      setHeld(true);
      return undefined;
    }
    if (!held) return undefined;
    const timer = setTimeout(() => setHeld(false), holdMs);
    return () => clearTimeout(timer);
  }, [active, held, holdMs]);
  return active || held;
}

/** Time on the document timeline (what CSS animations run on), in ms. */
function timelineNow(): number {
  if (typeof document !== 'undefined') {
    const current = document.timeline?.currentTime;
    if (typeof current === 'number' && Number.isFinite(current)) return current;
  }
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/**
 * Negative `animation-delay` that puts a blink starting now in phase with a shared clock:
 * every flashing element is on and off at the same moments, however often it is remounted.
 */
export function phaseDelay(periodMs: number, now: number = timelineNow()): string {
  const offset = Math.round(((now % periodMs) + periodMs) % periodMs) % periodMs;
  return offset === 0 ? '0ms' : `-${offset}ms`;
}

/**
 * Inline style for an element that blinks with period `periodMs` while `on`: the phase is fixed
 * when blinking starts (mount, or `on` turning true) and kept until it stops.
 */
export function useBlinkPhase(periodMs: number, on = true): { animationDelay: string } | undefined {
  return useMemo(() => (on ? { animationDelay: phaseDelay(periodMs) } : undefined), [on, periodMs]);
}
