import type { ComponentChild } from 'preact';
import { render } from 'preact';
import { act } from 'preact/test-utils';

/** Small DOM helpers for the renderer's happy-dom smoke tests. */

export interface Mounted {
  container: HTMLElement;
  unmount: () => void;
}

export function mount(vnode: ComponentChild): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(vnode, container);
  });
  return {
    container,
    unmount: () => {
      act(() => render(null, container));
      container.remove();
    },
  };
}

/** Let pending promises and timers run, flushing Preact updates. */
export async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Poll until `check` stops throwing (or returns a truthy value), flushing renders in between. */
export async function waitFor<T>(check: () => T, timeoutMs = 2000): Promise<NonNullable<T>> {
  const started = Date.now();
  let lastError: unknown = null;
  for (;;) {
    try {
      const value = check();
      if (value) return value as NonNullable<T>;
      lastError = new Error('condition not met');
    } catch (error) {
      lastError = error;
    }
    if (Date.now() - started > timeoutMs) throw lastError;
    await settle(10);
  }
}

export function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The first element matching `selector` whose text contains `needle`. */
export function byText<E extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
  needle: string,
): E | null {
  return [...root.querySelectorAll<E>(selector)].find((el) => text(el).includes(needle)) ?? null;
}

export function button(root: ParentNode, label: string): HTMLButtonElement {
  const found =
    byText<HTMLButtonElement>(root, 'button', label) ??
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === label,
    ) ??
    null;
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

/** The form field (`.field`) whose label contains `label`, within `root`. */
export function field(root: ParentNode, label: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>('.field')].find((f) =>
    text(f.querySelector('.field__label')).includes(label),
  );
  if (!found) throw new Error(`no field "${label}"`);
  return found;
}

export function section(root: ParentNode, id: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`section#${id}`);
  if (!found) throw new Error(`no section #${id}`);
  return found;
}

export async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

export async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

export async function check(input: HTMLInputElement, checked: boolean): Promise<void> {
  await act(async () => {
    input.checked = checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

export async function press(target: EventTarget, key: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}
