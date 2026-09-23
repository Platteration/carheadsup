import { useEffect, useRef, useState } from 'preact/hooks';
import { useFocusTrap } from '../common/focus-trap.ts';
import { SAMPLE_FRAMES, SAMPLE_FRAME_NAMES } from '../hud/fixtures.ts';
import { HudPreview } from './HudPreview.tsx';
import type { Backdrop, PanelSize } from './sim-model.ts';

/** Thumbnail width in the gallery grid. */
export const THUMB_WIDTH = 320;

/** "highway-exit-lanes" → "Highway exit lanes". */
export function fixtureTitle(name: string): string {
  const words = name.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Every sample frame rendered by the real HUD view at thumbnail size; works without a server.
 * Clicking a thumbnail opens it large.
 */
export function Gallery({ panel, backdrop }: { panel: PanelSize; backdrop: Backdrop }) {
  const [open, setOpen] = useState<string | null>(null);
  const lightbox = useRef<HTMLDivElement>(null);
  // Modal: keyboard focus stays in the lightbox and returns to the thumbnail afterwards.
  useFocusTrap(lightbox, open !== null);
  useEffect(() => {
    if (open === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
      const index = SAMPLE_FRAME_NAMES.indexOf(open);
      if (event.key === 'ArrowRight')
        setOpen(SAMPLE_FRAME_NAMES[(index + 1) % SAMPLE_FRAME_NAMES.length] ?? open);
      if (event.key === 'ArrowLeft') {
        setOpen(
          SAMPLE_FRAME_NAMES[(index - 1 + SAMPLE_FRAME_NAMES.length) % SAMPLE_FRAME_NAMES.length] ??
            open,
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const opened = open === null ? null : (SAMPLE_FRAMES[open] ?? null);
  return (
    <div class="gallery">
      <p class="gallery__intro">
        {SAMPLE_FRAME_NAMES.length} sample frames at {panel.label}, rendered by the HUD view. Click
        one to enlarge.
      </p>
      <ul class="gallery__grid">
        {SAMPLE_FRAME_NAMES.map((name) => (
          <li key={name} class="gallery__item">
            <button
              type="button"
              class="gallery__card"
              onClick={() => setOpen(name)}
              aria-label={`Enlarge ${fixtureTitle(name)}`}
            >
              <HudPreview
                frame={SAMPLE_FRAMES[name] ?? null}
                panel={panel}
                backdrop={backdrop}
                width={THUMB_WIDTH}
              />
              <span class="gallery__name">{fixtureTitle(name)}</span>
              <span class="gallery__meta">{SAMPLE_FRAMES[name]?.context}</span>
            </button>
          </li>
        ))}
      </ul>
      {open !== null && opened !== null && (
        <div
          class="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={fixtureTitle(open)}
          ref={lightbox}
          onClick={(e) => e.target === e.currentTarget && setOpen(null)}
        >
          <div class="lightbox__panel">
            <header class="lightbox__head">
              <h2>{fixtureTitle(open)}</h2>
              <span class="muted">← → to browse · Esc to close</span>
              <button type="button" class="dbtn dbtn--small" onClick={() => setOpen(null)}>
                Close
              </button>
            </header>
            <HudPreview
              frame={opened}
              panel={panel}
              backdrop={backdrop}
              maxScale={1.5}
              maxHeight={window.innerHeight * 0.72}
            />
          </div>
        </div>
      )}
    </div>
  );
}
