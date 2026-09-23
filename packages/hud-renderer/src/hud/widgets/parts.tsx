import type { ComponentChildren } from 'preact';
import type { SpeedLimitSignStyle } from '@carheadsup/core';
import { formatNumber } from '../../common/format.ts';
import { r2 } from '../icons/geometry.ts';
import { clamp01, cx, pct } from '../util.ts';
import type { Tone } from '../util.ts';

/** Root element shared by all widgets: stable class and data attributes for styling and tests. */
export function WidgetRoot({
  id,
  class: className,
  children,
  tone,
  label,
}: {
  id: string;
  class?: string;
  children: ComponentChildren;
  tone?: Tone;
  label?: string;
}) {
  return (
    <div
      class={cx('hud-w', `hud-w--${id}`, tone && `hud-tone--${tone}`, className)}
      data-widget={id}
      aria-label={label}
    >
      {children}
    </div>
  );
}

/** A number. B612's digits are tabular, so changing values keep their width. */
export function Num({
  children,
  class: className,
}: {
  children: ComponentChildren;
  class?: string;
}) {
  return <span class={cx('hud-num', className)}>{children}</span>;
}

/** A small unit label following a number. */
export function Unit({ children }: { children: ComponentChildren }) {
  return <span class="hud-unit">{children}</span>;
}

/** Horizontal meter: a faint outlined track with a fill for `fraction` (0–1). */
export function Meter({
  fraction,
  class: className,
  children,
}: {
  fraction: number;
  class?: string;
  children?: ComponentChildren;
}) {
  return (
    <div class={cx('hud-meter', className)} data-fraction={clamp01(fraction).toFixed(3)}>
      <div class="hud-meter__fill" style={{ width: pct(fraction) }} />
      {children}
    </div>
  );
}

/** Parallel chords across a circle, for the end-of-restrictions sign (no clip path needed). */
function stripeChords(cxp: number, cyp: number, radius: number, offsets: number[]): string {
  // Stripes run bottom-left → top-right; offsets are measured along the perpendicular.
  const ux = Math.SQRT1_2;
  const uy = -Math.SQRT1_2;
  const nx = Math.SQRT1_2;
  const ny = Math.SQRT1_2;
  return offsets
    .map((t) => {
      const half = Math.sqrt(Math.max(0, radius * radius - t * t));
      const mx = cxp + nx * t;
      const my = cyp + ny * t;
      return `M${r2(mx - ux * half)} ${r2(my - uy * half)}L${r2(mx + ux * half)} ${r2(my + uy * half)}`;
    })
    .join('');
}

const UNLIMITED_STRIPES = stripeChords(50, 50, 36, [-16, -8, 0, 8, 16]);

export interface SpeedSignProps {
  style: SpeedLimitSignStyle;
  value: number | null;
  unlimited: boolean;
  class?: string;
}

/**
 * Speed-limit sign drawn for a black (transparent) background: the Vienna-convention red ring
 * with white numerals and no white fill; the US/Canada MUTCD white-outlined rectangle; or, for
 * unlimited roads, the grey end-of-restrictions ring with diagonal stripes.
 */
export function SpeedSign({ style, value, unlimited, class: className }: SpeedSignProps) {
  if (unlimited) {
    return (
      <svg
        viewBox="0 0 100 100"
        class={cx('hud-sign', 'hud-sign--unlimited', className)}
        role="img"
        aria-label="No speed limit"
      >
        <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" stroke-width="7" />
        <path
          d={UNLIMITED_STRIPES}
          stroke="currentColor"
          stroke-width="4.5"
          stroke-linecap="round"
        />
      </svg>
    );
  }
  if (value === null || !Number.isFinite(value)) return null;
  const text = formatNumber(value, 0);
  if (style === 'mutcd') {
    return (
      <svg
        viewBox="0 0 80 100"
        class={cx('hud-sign', 'hud-sign--mutcd', className)}
        role="img"
        aria-label={`Speed limit ${text}`}
      >
        <rect
          x="4"
          y="4"
          width="72"
          height="92"
          rx="9"
          fill="none"
          stroke="currentColor"
          stroke-width="6"
        />
        <text
          class="hud-sign__legend"
          x="40"
          y="27"
          text-anchor="middle"
          font-size="14"
          font-weight="700"
          letter-spacing="1"
          fill="currentColor"
        >
          SPEED
        </text>
        <text
          class="hud-sign__legend"
          x="40"
          y="44"
          text-anchor="middle"
          font-size="14"
          font-weight="700"
          letter-spacing="1"
          fill="currentColor"
        >
          LIMIT
        </text>
        <text
          class="hud-sign__value"
          x="40"
          y="82"
          text-anchor="middle"
          font-size={text.length >= 3 ? 30 : 40}
          font-weight="700"
          fill="currentColor"
        >
          {text}
        </text>
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 100 100"
      class={cx('hud-sign', 'hud-sign--vienna', className)}
      role="img"
      aria-label={`Speed limit ${text}`}
    >
      <circle class="hud-sign__ring" cx="50" cy="50" r="43" fill="none" stroke-width="12" />
      <text
        class="hud-sign__value"
        x="50"
        y="51"
        text-anchor="middle"
        dominant-baseline="central"
        font-size={text.length >= 3 ? 34 : 44}
        font-weight="700"
        fill="currentColor"
      >
        {text}
      </text>
    </svg>
  );
}
