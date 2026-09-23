import type { ToastFrame } from '@carheadsup/core';
import { Glyph } from '../icons/index.ts';
import type { GlyphName } from '../icons/index.ts';
import { clamp01, lookup } from '../util.ts';

const TOAST_GLYPHS: Record<ToastFrame['kind'], GlyphName> = {
  media: 'music',
  message: 'message',
  info: 'info',
};

/**
 * Transient notice (track change, message sender, info). The composer drives the fade through
 * `opacity`; a fully faded toast is not rendered at all.
 */
export function Toast({ toast }: { toast: ToastFrame }) {
  const opacity = clamp01(toast.opacity);
  if (opacity <= 0) return null;
  return (
    <div
      class={`hud-toast hud-toast--${toast.kind}`}
      style={{ opacity: String(Math.round(opacity * 1000) / 1000) }}
      data-toast={toast.kind}
      role="status"
    >
      <Glyph name={lookup(TOAST_GLYPHS, toast.kind, 'info')} class="hud-toast__icon" />
      <div class="hud-toast__text">
        <div class="hud-toast__title">{toast.title}</div>
        {toast.subtitle && <div class="hud-toast__subtitle">{toast.subtitle}</div>}
      </div>
    </div>
  );
}
