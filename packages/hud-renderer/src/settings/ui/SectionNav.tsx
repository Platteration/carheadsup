import { useEffect, useRef, useState } from 'preact/hooks';
import { cx } from '../../hud/util.ts';

export interface NavSection {
  id: string;
  short: string;
}

/** A section counts as current once its top passes this far below the viewport top (the sticky bars). */
export const SPY_OFFSET_PX = 140;

/** Scroll a section into view (below the sticky bars) and record it in the URL hash. */
export function goToSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  try {
    history.replaceState(null, '', `#${id}`);
  } catch {
    // Some WebViews refuse history changes for file:// or data: URLs; the scroll still happened.
  }
}

/**
 * The current section: the last one whose top edge is above `offset` px from the viewport top,
 * or the last section when the page is scrolled to the bottom (short final sections never reach
 * the top). `tops` are viewport-relative, in page order.
 */
export function activeSection(
  sections: ReadonlyArray<{ id: string; top: number }>,
  offset: number,
  atBottom: boolean,
): string | null {
  if (sections.length === 0) return null;
  if (atBottom) return sections[sections.length - 1]?.id ?? null;
  let current = sections[0]?.id ?? null;
  for (const s of sections) {
    if (s.top <= offset) current = s.id;
    else break;
  }
  return current;
}

/**
 * Sticky navigation: a horizontally scrolling chip bar on phones, a sidebar on wide screens.
 * The section currently at the top of the viewport is highlighted (scroll spy). Sections are
 * looked up by id on every check, so it keeps working when a section re-mounts (e.g. a
 * placeholder replaced by the loaded section).
 */
export function SectionNav({ sections }: { sections: readonly NavSection[] }) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? '');
  const bar = useRef<HTMLElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const tops = sections.flatMap((s) => {
        const el = document.getElementById(s.id);
        return el ? [{ id: s.id, top: el.getBoundingClientRect().top }] : [];
      });
      const doc = document.documentElement;
      const atBottom =
        window.innerHeight + window.scrollY >= doc.scrollHeight - 4 && window.scrollY > 0;
      const next = activeSection(tops, SPY_OFFSET_PX, atBottom);
      if (next !== null) setActive(next);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [sections]);

  // Keep the active chip visible in the horizontal bar.
  useEffect(() => {
    const list = bar.current?.querySelector<HTMLElement>('.section-nav__list');
    const chip = bar.current?.querySelector<HTMLElement>(`[data-nav="${active}"]`);
    if (chip && list && list.scrollWidth > list.clientWidth) {
      const left = chip.offsetLeft - list.clientWidth / 2 + chip.clientWidth / 2;
      if (typeof list.scrollTo === 'function') list.scrollTo({ left, behavior: 'smooth' });
    }
  }, [active]);

  return (
    <nav class="section-nav" aria-label="Sections" ref={bar}>
      <ul class="section-nav__list">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              data-nav={s.id}
              class={cx('section-nav__link', active === s.id && 'section-nav__link--active')}
              aria-current={active === s.id ? 'location' : undefined}
              onClick={(event) => {
                event.preventDefault();
                setActive(s.id);
                goToSection(s.id);
              }}
            >
              {s.short}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
