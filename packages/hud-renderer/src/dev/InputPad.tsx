import type { InputAction } from '@carheadsup/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { describeError } from '../common/api.ts';
import type { HudApi } from '../common/api.ts';
import { actionForKey } from '../hud/keyboard.ts';
import { cx } from '../hud/util.ts';
import { INPUT_BUTTONS, isEditableTarget } from './sim-model.ts';

/** How long a pressed button stays highlighted after its input was sent. */
const FLASH_MS = 250;

/**
 * Driver inputs (steering-wheel buttons / gestures) sent to `POST /api/input`, with the same
 * keyboard shortcuts as the kiosk: Enter/Space accept, Esc dismiss, ←/→ pages, B blank, +/− brightness.
 * Shortcuts are ignored while typing in a field or when a button has focus.
 */
export function InputPad({ api }: { api: HudApi }) {
  const [flash, setFlash] = useState<InputAction | null>(null);
  const [error, setError] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = async (action: InputAction) => {
    setFlash(action);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), FLASH_MS);
    try {
      await api.sendInput(action);
      setError(null);
    } catch (err) {
      setError(err);
    }
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      const action = actionForKey(event);
      if (action === null) return;
      event.preventDefault();
      void sendRef.current(action);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div class="input-pad">
      <div class="input-pad__buttons" role="group" aria-label="Driver inputs">
        {INPUT_BUTTONS.map((b) => (
          <button
            key={b.action}
            type="button"
            class={cx('dbtn', 'input-pad__button', flash === b.action && 'dbtn--flash')}
            title={b.title}
            onClick={() => void send(b.action)}
          >
            <span>{b.label}</span>
            <kbd>{b.keys}</kbd>
          </button>
        ))}
      </div>
      {error !== null && <p class="sim-error">Input not delivered: {describeError(error)}</p>}
    </div>
  );
}
