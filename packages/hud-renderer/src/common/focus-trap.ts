import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

/** Elements that take keyboard focus (enabled controls, links, explicit tab stops). */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** The keyboard-focusable elements inside `root`, in document order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[inert], [aria-hidden="true"]'),
  );
}

/**
 * Keep Tab and Shift+Tab inside `root` (a modal): from the last element Tab wraps to the first,
 * from the first Shift+Tab wraps to the last, and focus that is somewhere else comes back in.
 * Returns true when it moved focus (the key's default action is then prevented).
 */
export function trapTab(root: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return false;
  const items = focusableIn(root);
  const active = document.activeElement;
  const inside = active instanceof Node && root.contains(active);
  const first = items[0];
  const last = items[items.length - 1];
  let target: HTMLElement | undefined;
  if (first === undefined || last === undefined) target = undefined;
  else if (event.shiftKey) target = !inside || active === first ? last : undefined;
  else target = !inside || active === last ? first : undefined;
  if (target === undefined && items.length > 0) return false;
  event.preventDefault();
  target?.focus();
  return true;
}

/**
 * Modal focus handling while `active`: focus moves into `ref` (its first focusable element),
 * stays there on Tab / Shift+Tab or when something tries to focus the page behind it, and goes
 * back to where it was when the modal closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement>, active = true): void {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root.contains(document.activeElement)) focusableIn(root)[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      trapTab(root, event);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) {
        focusableIn(root)[0]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      if (previous?.isConnected) previous.focus();
    };
  }, [ref, active]);
}
