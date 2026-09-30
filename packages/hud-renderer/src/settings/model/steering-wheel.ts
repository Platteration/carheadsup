import {
  parseCanId,
  parseHexByte,
  roundTo,
  valueFitsMask,
  type CanButtonRule,
  type InputAction,
  type SwcWindow,
  type VoltageRange,
} from '@carheadsup/core';

/** Steering-wheel button helpers for the settings form (CAN rules and ladder windows). */

/** What each driver input does, as the settings app names it. */
export const INPUT_ACTION_LABELS: Readonly<Record<InputAction, string>> = {
  primary: 'Accept call / OK',
  secondary: 'Decline / dismiss',
  'next-page': 'Next page',
  'prev-page': 'Previous page',
  'toggle-blank': 'Blank / unblank HUD',
  'brightness-up': 'Brighter',
  'brightness-down': 'Dimmer',
};

/** The order new buttons are given actions in: the ones a steering wheel is most useful for. */
const SUGGESTED_ACTIONS: readonly InputAction[] = [
  'next-page',
  'prev-page',
  'primary',
  'secondary',
  'brightness-up',
  'brightness-down',
  'toggle-blank',
];

function firstUnusedAction(used: ReadonlySet<InputAction>): InputAction {
  return SUGGESTED_ACTIONS.find((a) => !used.has(a)) ?? 'next-page';
}

/** Keep hex digits only, upper-cased, at most `max` of them (what the hex fields accept). */
export function hexDigits(text: string, max: number): string {
  return text
    .toUpperCase()
    .replace(/[^0-9A-F]/g, '')
    .slice(0, max);
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/**
 * A sentence describing when a rule counts its button as held, e.g. "Held while byte 0 reads 01
 * in 11-bit frame 5C1"; null while the rule is incomplete or invalid.
 */
export function describeCanRule(rule: CanButtonRule): string | null {
  const canId = parseCanId(rule.id);
  const mask = parseHexByte(rule.mask);
  const value = parseHexByte(rule.value);
  if (canId === null || mask === null || mask === 0 || value === null) return null;
  if (!valueFitsMask(value, mask) || !Number.isInteger(rule.byte)) return null;
  const frame = `${canId.extended ? '29-bit' : '11-bit'} frame ${rule.id.toUpperCase()}`;
  const bits = mask === 0xff ? `byte ${rule.byte}` : `bits ${hex2(mask)} of byte ${rule.byte}`;
  return `Held while ${bits} ${mask === 0xff ? 'reads' : 'read'} ${hex2(value)} in ${frame}`;
}

/**
 * A new rule: the next button on the same frame, byte and mask as the last rule (its first
 * unused non-zero value), or a blank rule to fill in; with the first action not yet mapped.
 */
export function newCanRule(rules: readonly CanButtonRule[]): CanButtonRule {
  const action = firstUnusedAction(new Set(rules.map((r) => r.action)));
  const last = rules[rules.length - 1];
  const mask = last === undefined ? null : parseHexByte(last.mask);
  if (last === undefined || mask === null || mask === 0) {
    return { id: '', byte: 0, mask: 'FF', value: '01', action, longPressAction: null };
  }
  const taken = new Set(
    rules
      .filter((r) => r.id.toUpperCase() === last.id.toUpperCase() && r.byte === last.byte)
      .filter((r) => parseHexByte(r.mask) === mask)
      .map((r) => parseHexByte(r.value)),
  );
  let value = 1;
  while (value <= 0xff && (!valueFitsMask(value, mask) || taken.has(value))) value += 1;
  return {
    id: last.id,
    byte: last.byte,
    mask: hex2(mask),
    value: hex2(value <= 0xff ? value : 0),
    action,
    longPressAction: null,
  };
}

/** Default width of a new ladder window. */
const NEW_WINDOW_WIDTH_V = 0.3;

/**
 * A new ladder window just above the highest existing one (or from 0 V), kept below the idle
 * range where there is room; with the first action not yet mapped. The person then moves it to
 * the button's measured voltage.
 */
export function newSwcWindow(windows: readonly SwcWindow[], idle: VoltageRange): SwcWindow {
  const action = firstUnusedAction(new Set(windows.map((w) => w.action)));
  const top = windows.reduce((max, w) => Math.max(max, w.maxV), Number.NEGATIVE_INFINITY);
  const minV = Number.isFinite(top) ? roundTo(top + 0.1, 2) : 0;
  const ceiling = roundTo(idle.minV - 0.05, 2);
  const maxV = roundTo(Math.min(minV + NEW_WINDOW_WIDTH_V, Math.max(ceiling, minV + 0.05)), 2);
  return { minV, maxV, action, longPressAction: null };
}
