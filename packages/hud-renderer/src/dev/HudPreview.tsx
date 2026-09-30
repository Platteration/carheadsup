import type { HudFrame, ProjectionConfig } from '@carheadsup/core';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { HudView } from '../hud/HudView.tsx';
import { cx } from '../hud/util.ts';
import type { Backdrop, PanelSize } from './sim-model.ts';
import './preview.css';

export interface HudPreviewProps {
  frame: HudFrame | null;
  panel: PanelSize;
  backdrop: Backdrop;
  /** Only `showGrid` is honoured: the preview never mirrors or warps. */
  projection?: ProjectionConfig | null;
  /** Fixed display width (thumbnails); otherwise the preview fits its container. */
  width?: number;
  /** Upper bound on the scale when fitting (keeps text crisp-looking and the page calm). */
  maxScale?: number;
  /** Upper bound on the displayed height in px when fitting. */
  maxHeight?: number;
  class?: string;
}

/**
 * The HUD rendered at the panel's real pixel size and scaled to fit, so layout and type look
 * exactly as on the device. With a backdrop the HUD is composited with `screen` blending —
 * black adds nothing and bright pixels add light — which is how a reflection on glass looks.
 */
export function HudPreview({
  frame,
  panel,
  backdrop,
  projection = null,
  width,
  maxScale = 1.25,
  maxHeight,
  class: extra,
}: HudPreviewProps) {
  const box = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(width ?? null);

  useLayoutEffect(() => {
    if (width !== undefined) return undefined;
    const el = box.current;
    if (!el) return undefined;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);

  const target = width ?? available ?? panel.width;
  let scale = Math.min(maxScale, target / panel.width);
  if (maxHeight !== undefined) scale = Math.min(scale, maxHeight / panel.height);
  scale = Math.max(0.05, scale);

  return (
    <div class={cx('preview', extra)} ref={box}>
      <div
        class={cx('preview__frame', backdrop !== 'none' && 'preview__frame--glass')}
        style={{
          width: `${Math.round(panel.width * scale)}px`,
          height: `${Math.round(panel.height * scale)}px`,
        }}
        data-panel={`${panel.width}x${panel.height}`}
      >
        {backdrop !== 'none' && <RoadBackdrop scene={backdrop} />}
        <div
          class="preview__hud"
          style={{
            width: `${panel.width}px`,
            height: `${panel.height}px`,
            transform: `scale(${scale})`,
          }}
        >
          <HudView frame={frame} projection={projection} preview />
        </div>
      </div>
    </div>
  );
}

const SCENES: Readonly<
  Record<
    Exclude<Backdrop, 'none'>,
    { sky: [string, string, string]; ground: string; road: string; line: string; hills: string }
  >
> = {
  night: {
    sky: ['#03050a', '#0a1020', '#1a2233'],
    ground: '#06080b',
    road: '#121418',
    line: '#6d7178',
    hills: '#05070c',
  },
  dusk: {
    sky: ['#1a1433', '#5b3a5e', '#e08a4c'],
    ground: '#1a1512',
    road: '#26252a',
    line: '#b9b5ae',
    hills: '#2a1f2e',
  },
  day: {
    sky: ['#5f97cf', '#9cc3e6', '#dfeaf3'],
    ground: '#5f6b4f',
    road: '#6d7076',
    line: '#f3f3ee',
    hills: '#7c8a78',
  },
};

/** A simple road scene seen through the windshield, drawn behind the HUD preview. */
export function RoadBackdrop({ scene }: { scene: Exclude<Backdrop, 'none'> }) {
  const s = SCENES[scene];
  const horizon = 250;
  // Centre-line dashes shrink towards the vanishing point at (800, horizon).
  const dashes = [0.08, 0.16, 0.27, 0.42, 0.62, 0.9].map((t, i) => {
    const y0 = horizon + (600 - horizon) * t;
    const y1 = horizon + (600 - horizon) * Math.min(1, t + 0.05 + i * 0.012);
    const w0 = 1 + t * 7;
    const w1 = 1 + Math.min(1, t + 0.05 + i * 0.012) * 7;
    return `M${800 - w0} ${y0}L${800 + w0} ${y0}L${800 + w1} ${y1}L${800 - w1} ${y1}Z`;
  });
  return (
    <svg
      class="preview__backdrop"
      viewBox="0 0 1600 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      data-scene={scene}
    >
      <defs>
        <linearGradient id={`sky-${scene}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={s.sky[0]} />
          <stop offset="0.7" stop-color={s.sky[1]} />
          <stop offset="1" stop-color={s.sky[2]} />
        </linearGradient>
        <radialGradient id="tail" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#ff4a3a" stop-opacity="0.95" />
          <stop offset="1" stop-color="#ff2a1a" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="lamp" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#ffd9a0" stop-opacity="0.8" />
          <stop offset="1" stop-color="#ffb060" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="1600" height={horizon + 1} fill={`url(#sky-${scene})`} />
      <path
        d={`M0 ${horizon} L0 ${horizon - 30} Q 220 ${horizon - 70} 420 ${horizon - 28} T 900 ${horizon - 36} T 1300 ${horizon - 50} T 1600 ${horizon - 24} L1600 ${horizon} Z`}
        fill={s.hills}
      />
      <rect x="0" y={horizon} width="1600" height={600 - horizon} fill={s.ground} />
      <path d={`M780 ${horizon} L820 ${horizon} L1700 600 L-100 600 Z`} fill={s.road} />
      <path d={`M784 ${horizon} L-60 600`} stroke={s.line} stroke-width="5" opacity="0.8" />
      <path d={`M816 ${horizon} L1660 600`} stroke={s.line} stroke-width="5" opacity="0.8" />
      {dashes.map((d, i) => (
        <path key={i} d={d} fill={s.line} opacity="0.85" />
      ))}
      {scene !== 'day' && (
        <g>
          <circle cx="770" cy={horizon + 22} r="10" fill="url(#tail)" />
          <circle cx="806" cy={horizon + 22} r="10" fill="url(#tail)" />
          <circle
            cx="330"
            cy={horizon - 60}
            r="46"
            fill="url(#lamp)"
            opacity={scene === 'night' ? 0.7 : 0.35}
          />
          <circle
            cx="1290"
            cy={horizon - 48}
            r="36"
            fill="url(#lamp)"
            opacity={scene === 'night' ? 0.6 : 0.3}
          />
        </g>
      )}
      {scene === 'day' && (
        <rect x="0" y="0" width="1600" height="600" fill="#ffffff" opacity="0.08" />
      )}
    </svg>
  );
}
