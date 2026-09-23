import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { cx } from '../../hud/util.ts';
import {
  CORNER_KEYS,
  CORNER_LABELS,
  IDENTITY_CORNERS,
  describeCorner,
  grabOffset,
  isIdentityCorners,
  moveCorner,
  nudgeCorner,
  nudgeForKey,
  pointerToFraction,
  warpedGridLines,
} from '../model/keystone.ts';
import type { CornerKey, Corners, Point } from '../model/keystone.ts';
import { Button } from './common.tsx';

export interface KeystoneEditorProps {
  corners: Corners;
  onChange: (corners: Corners) => void;
  /** Width / height of the panel, for the preview's shape. */
  aspect?: number;
  disabled?: boolean;
}

interface Drag {
  key: CornerKey;
  pointerId: number;
  offset: Point;
}

/**
 * Four-corner keystone editor: drag a handle (mouse or touch) or focus it and nudge with the
 * arrow keys (Shift = coarse). Moves that would fold the image are refused, so the preview
 * always shows a drawable quad. Coordinates are what the driver sees (before mirroring).
 */
export function KeystoneEditor({
  corners,
  onChange,
  aspect = 5 / 3,
  disabled = false,
}: KeystoneEditorProps) {
  const screen = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [selected, setSelected] = useState<CornerKey>('tl');

  const toFraction = (event: PointerEvent): Point | null => {
    const el = screen.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return pointerToFraction(event.clientX, event.clientY, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      inset: 0,
    });
  };

  const onPointerDown =
    (key: CornerKey) => (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
      if (disabled || event.button > 0) return;
      const point = toFraction(event);
      if (!point) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.current = { key, pointerId: event.pointerId, offset: grabOffset(point, corners[key]) };
      setSelected(key);
    };

  const onPointerMove = (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const point = toFraction(event);
    if (!point) return;
    const next = moveCorner(corners, d.key, [point[0] + d.offset[0], point[1] + d.offset[1]]);
    if (next !== corners) onChange(next);
  };

  const endDrag = (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const onKeyDown = (key: CornerKey) => (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
    const delta = nudgeForKey(event.key, event.shiftKey);
    if (!delta || disabled) return;
    event.preventDefault();
    setSelected(key);
    const next = nudgeCorner(corners, key, delta[0], delta[1]);
    if (next !== corners) onChange(next);
  };

  const quad = CORNER_KEYS.map((k) => `${corners[k][0] * 100},${corners[k][1] * 100}`).join(' ');
  const grid = warpedGridLines(corners, 4);

  return (
    <div class={cx('keystone', disabled && 'keystone--disabled')}>
      <div class="keystone__surface">
        <div class="keystone__screen" ref={screen} style={{ aspectRatio: String(aspect) }}>
          <svg
            class="keystone__svg"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <rect
              class="keystone__panel"
              x="0"
              y="0"
              width="100"
              height="100"
              vector-effect="non-scaling-stroke"
            />
            <polygon class="keystone__quad" points={quad} vector-effect="non-scaling-stroke" />
            {grid.map(([a, b], i) => (
              <line
                key={i}
                class="keystone__grid"
                x1={a[0] * 100}
                y1={a[1] * 100}
                x2={b[0] * 100}
                y2={b[1] * 100}
                vector-effect="non-scaling-stroke"
              />
            ))}
          </svg>
          {CORNER_KEYS.map((key) => {
            const [x, y] = corners[key];
            return (
              <button
                key={key}
                type="button"
                class={cx('keystone__handle', selected === key && 'keystone__handle--selected')}
                style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                aria-label={`${CORNER_LABELS[key]} corner, ${describeCorner(corners[key])}. Arrow keys move it; Shift moves faster.`}
                disabled={disabled}
                data-corner={key}
                onPointerDown={onPointerDown(key)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
                onKeyDown={onKeyDown(key)}
                onFocus={() => setSelected(key)}
              />
            );
          })}
        </div>
      </div>
      <div class="keystone__footer">
        <p class="keystone__readout" aria-live="polite">
          <strong>{CORNER_LABELS[selected]}</strong> {describeCorner(corners[selected])}
        </p>
        <Button
          size="small"
          variant="ghost"
          disabled={disabled || isIdentityCorners(corners)}
          onClick={() => onChange(IDENTITY_CORNERS)}
        >
          Reset corners
        </Button>
      </div>
    </div>
  );
}
