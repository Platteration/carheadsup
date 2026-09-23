import type { JSX } from 'preact';
import { lookup } from '../util.ts';
import { r2 } from './geometry.ts';

/**
 * Hand-drawn 24×24 line glyphs in one style: round caps and joins, `currentColor` strokes, no
 * large fills (bright fills glare and ghost on the windshield). The stroke width comes from the
 * `--glyph-stroke` CSS variable (default 2.75 units, ≥ 3 px at the smallest size the HUD uses).
 */

export const GLYPH_NAMES = [
  // alerts & vehicle
  'engine',
  'thermometer',
  'battery',
  'fuel',
  'tyre',
  'snowflake',
  'wrench',
  'link',
  'collision',
  'warning',
  'info',
  // phone & media
  'phone',
  'phone-off',
  'message',
  'music',
  'pause',
  'arrow-left',
  'arrow-right',
  // status
  'obd',
  // hazards
  'speed-camera',
  'traffic-light',
  'section-control',
  'police',
  'accident',
  'cone',
  'traffic-jam',
  'slowdown',
  'object',
  'weather',
  'school',
  'railway',
] as const;

export type GlyphName = (typeof GLYPH_NAMES)[number];

/** A dot drawn as a filled circle (stays round and solid at any stroke width). */
function Dot({ cx, cy, r = 1.5 }: { cx: number; cy: number; r?: number }) {
  return <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;
}

/** Six-spoked snowflake with a V-branch on every spoke. */
function snowflakePath(): string {
  const c = 12;
  const parts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const ux = Math.sin(a);
    const uy = -Math.cos(a);
    parts.push(`M${c} ${c}L${r2(c + ux * 10)} ${r2(c + uy * 10)}`);
    // Branch origin at 60 % of the spoke, arms at ±45° pointing outwards.
    const bx = c + ux * 6;
    const by = c + uy * 6;
    for (const s of [-1, 1]) {
      const b = a + (s * Math.PI) / 4;
      parts.push(
        `M${r2(bx)} ${r2(by)}L${r2(bx + Math.sin(b) * 3.4)} ${r2(by - Math.cos(b) * 3.4)}`,
      );
    }
  }
  return parts.join('');
}

/** Star polygon with `points` tips centred on (cx, cy). */
function starPoints(cx: number, cy: number, outer: number, inner: number, points = 5): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / points;
    pts.push(`${r2(cx + Math.sin(a) * r)},${r2(cy - Math.cos(a) * r)}`);
  }
  return pts.join(' ');
}

/** Rear view of a car (the forward-collision glyph). */
function CarRear({ transform }: { transform?: string }) {
  return (
    <g transform={transform}>
      <path d="M4 17v-4.5L6.2 8h11.6l2.2 4.5V17z" />
      <path d="M6 17v2.5M18 17v2.5M7.5 13.5h1.5M15 13.5h1.5" />
    </g>
  );
}

const SNOWFLAKE = snowflakePath();

const GLYPHS: Record<GlyphName, () => JSX.Element> = {
  engine: () => (
    <>
      <path d="M2.5 10.5v6M2.5 13.5H5" />
      <path d="M5 9.5h3V7h6v2.5h2l2 2h1.5v-2h2.5v8.5h-2.5v-2H18L15.5 19H9l-2-2.5H5z" />
      <path d="M8.5 4.5h7M12 4.5V7" />
    </>
  ),
  thermometer: () => (
    <>
      <path d="M10 12.5V4.5a2 2 0 0 1 4 0v8a4 4 0 1 1-4 0z" />
      <path d="M14 6.5h3M14 9.5h3" />
      <path d="M2.5 21.5c1.6-1.2 3.2-1.2 4.8 0s3.2 1.2 4.7 0 3.2-1.2 4.7 0 3.2 1.2 4.8 0" />
    </>
  ),
  battery: () => (
    <>
      <rect x="2.5" y="7" width="19" height="13" rx="2" />
      <path d="M6 7V4.5h3.5V7M14.5 7V4.5H18V7" />
      <path d="M6 13.5h4.5M8.25 11.25v4.5M13.5 13.5H18" />
    </>
  ),
  fuel: () => (
    <>
      <path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
      <path d="M2.5 21h13M6.5 6.5h5v4h-5z" />
      <path d="M14 9.5h2a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 0 3 0V8.5l-3-3.5" />
    </>
  ),
  tyre: () => (
    <>
      <path d="M7 20c-4.2-3.5-4.4-11.5-.3-15.5M17 20c4.2-3.5 4.4-11.5.3-15.5" />
      <path d="M5.5 20.5h13M8 20.5v-2M12 20.5v-2M16 20.5v-2" />
      <path d="M12 6.5v6.5" />
      <Dot cx={12} cy={16.3} r={1.6} />
    </>
  ),
  snowflake: () => <path d={SNOWFLAKE} />,
  wrench: () => (
    <>
      <path d="M4.5 19.5l8.2-8.2" />
      <path d="M12.7 11.3a5.2 5.2 0 0 1 6.6-7.1l-3.1 3.1.4 2.9 2.9.4 3.1-3.1a5.2 5.2 0 0 1-7.1 6.6" />
    </>
  ),
  link: () => (
    <>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </>
  ),
  collision: () => (
    <>
      <CarRear transform="translate(0 2)" />
      <path d="M12 1.5v3.5M6.5 3l1.8 2.6M17.5 3l-1.8 2.6" />
    </>
  ),
  warning: () => (
    <>
      <path d="M12 3L22 20.5H2z" />
      <path d="M12 9.5v5" />
      <Dot cx={12} cy={17.4} r={1.5} />
    </>
  ),
  info: () => (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v6" />
      <Dot cx={12} cy={7.6} r={1.5} />
    </>
  ),
  phone: () => (
    <path d="M5.5 3.5h3.2l1.6 4.6-2.1 1.5a11.5 11.5 0 0 0 6.2 6.2l1.5-2.1 4.6 1.6v3.2a2 2 0 0 1-2 2A16.5 16.5 0 0 1 3.5 5.5a2 2 0 0 1 2-2z" />
  ),
  'phone-off': () => (
    <>
      <path d="M5.5 3.5h3.2l1.6 4.6-2.1 1.5a11.5 11.5 0 0 0 6.2 6.2l1.5-2.1 4.6 1.6v3.2a2 2 0 0 1-2 2A16.5 16.5 0 0 1 3.5 5.5a2 2 0 0 1 2-2z" />
      <path d="M3 3l18 18" />
    </>
  ),
  message: () => (
    <path d="M4 4.5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" />
  ),
  music: () => (
    <>
      <path d="M9 18V5.5l11-2.5v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ),
  pause: () => <path d="M8.5 5v14M15.5 5v14" />,
  'arrow-left': () => <path d="M20 12H5M11 5.5L4.5 12l6.5 6.5" />,
  'arrow-right': () => <path d="M4 12h15M13 5.5l6.5 6.5-6.5 6.5" />,
  obd: () => (
    <>
      <path d="M2.5 7h19l-2.2 10H4.7z" />
      <path d="M7 10.5h.01M10.3 10.5h.01M13.7 10.5h.01M17 10.5h.01M8.5 13.8h.01M12 13.8h.01M15.5 13.8h.01" />
    </>
  ),
  'speed-camera': () => (
    <>
      <rect x="2.5" y="6.5" width="12" height="8.5" rx="1.5" />
      <path d="M14.5 9l6-3v10.5l-6-3" />
      <path d="M8.5 15v6M5 21h7" />
    </>
  ),
  'traffic-light': () => (
    <>
      <rect x="7.5" y="2" width="9" height="20" rx="2.5" />
      <circle cx="12" cy="6.8" r="1.9" fill="currentColor" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="12" cy="17.2" r="1.9" />
    </>
  ),
  'section-control': () => (
    <>
      <path d="M2.5 5.5v13M21.5 5.5v13M6 12h12" />
      <path d="M9 8.5L5.5 12 9 15.5M15 8.5l3.5 3.5-3.5 3.5" />
    </>
  ),
  police: () => (
    <>
      <path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z" />
      <polygon points={starPoints(12, 11.5, 4.4, 1.9)} stroke-width="1.5" />
    </>
  ),
  accident: () => (
    <>
      <g transform="rotate(-14 10 16)">
        <path d="M2.5 20.5V16l2.2-4.5h10.6l2.2 4.5v4.5z" />
        <path d="M4.8 20.5v1.8M15.2 20.5v1.8M5.8 16.8h1.5M12.7 16.8h1.5" />
      </g>
      <polygon points={starPoints(18.5, 6, 4.8, 2.2, 7)} stroke-width="2" />
    </>
  ),
  cone: () => (
    <>
      <path d="M10 3.5h4l4.3 16H5.7z" />
      <path d="M8.2 10.5h7.6M7 15h10M3 19.5h18" />
    </>
  ),
  'traffic-jam': () => (
    <>
      {/* The car ahead peeks out above the one in front of us: a queue. */}
      <path d="M7 10.5V7.8l1.5-3.6h7L17 7.8v2.7" />
      <path d="M3 20.5V16l2.4-4.5h13.2L21 16v4.5z" />
      <path d="M5.5 20.5v1.8M18.5 20.5v1.8M6.5 16.7h2M15.5 16.7h2" />
    </>
  ),
  slowdown: () => (
    <>
      <path d="M3.5 17.5a8.5 8.5 0 1 1 17 0" />
      <path d="M12 16L7.2 11.5" />
      <Dot cx={12} cy={16.5} r={2} />
      <path d="M3.5 21h17" />
    </>
  ),
  object: () => (
    <>
      <path d="M5 21.5L9 3M19 21.5L15 3" />
      <path d="M9 17.5l1.5-4h3l1.5 4z" />
    </>
  ),
  weather: () => (
    <>
      <path d="M7 14.5a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.3 1A3.5 3.5 0 0 1 17 14.5z" />
      <path d="M8 18l-1 3M12.5 18l-1 3M17 18l-1 3" />
    </>
  ),
  school: () => (
    <>
      <circle cx="8" cy="4.5" r="2" />
      <path d="M8 8v6.5M8 14.5l-2.5 6.5M8 14.5l2.5 6.5M4.5 12l3.5-2.5 3.5 2.5" />
      <circle cx="16.5" cy="8.5" r="1.7" />
      <path d="M16.5 11.5v4.5M16.5 16l-2 5M16.5 16l2 5M13.5 14l3-2 3 2" />
    </>
  ),
  railway: () => (
    <>
      <path d="M4 4l16 16M20 4L4 20" />
    </>
  ),
};

export interface GlyphProps {
  name: GlyphName;
  class?: string;
  /** Accessible label; decorative (aria-hidden) when omitted. */
  title?: string;
}

export function Glyph({ name, class: className, title }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      class={className ? `hud-glyph ${className}` : 'hud-glyph'}
      data-glyph={name}
      fill="none"
      stroke="currentColor"
      stroke-width="2.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
    >
      {lookup(GLYPHS, name, GLYPHS.warning)()}
    </svg>
  );
}

/** True when a drawing exists for `name` (used by tests and defensive callers). */
export function hasGlyph(name: string): name is GlyphName {
  return Object.prototype.hasOwnProperty.call(GLYPHS, name);
}
