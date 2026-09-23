import type { InputAction } from '@carheadsup/core';

/** The parts of a KeyboardEvent the mapping looks at. */
export interface KeyLike {
  key: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

/** A Map rather than an object literal so keys like "toString" cannot hit the prototype. */
const KEY_ACTIONS: ReadonlyMap<string, InputAction> = new Map([
  ['Enter', 'primary'],
  [' ', 'primary'],
  ['Spacebar', 'primary'],
  ['Escape', 'secondary'],
  ['Backspace', 'secondary'],
  ['ArrowLeft', 'prev-page'],
  ['ArrowRight', 'next-page'],
  ['b', 'toggle-blank'],
  ['B', 'toggle-blank'],
  ['+', 'brightness-up'],
  ['=', 'brightness-up'],
  ['-', 'brightness-down'],
  ['_', 'brightness-down'],
]);

/** Actions that make sense to repeat while a key is held (everything else fires once). */
const REPEATABLE: ReadonlySet<InputAction> = new Set(['brightness-up', 'brightness-down']);

/**
 * Kiosk keyboard → driver input action: Enter/Space primary (accept / acknowledge),
 * Escape/Backspace secondary (decline / dismiss), ←/→ dashboard pages, B blank, +/− brightness.
 * Keys with Ctrl/Alt/Meta are left to the browser; auto-repeat only adjusts brightness.
 */
export function actionForKey(event: KeyLike): InputAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  const action = KEY_ACTIONS.get(event.key) ?? null;
  if (action && event.repeat && !REPEATABLE.has(action)) return null;
  return action;
}
