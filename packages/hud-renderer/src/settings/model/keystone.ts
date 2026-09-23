import { roundTo } from '@carheadsup/core';
import type { ProjectionConfig } from '@carheadsup/core';
import { applyToPoint, keystoneMatrix } from '../../hud/projection.ts';
import type { Vec2 } from '../../hud/projection.ts';

/**
 * Pure math behind the four-corner keystone editor. Corners are fractions of the screen (0–1) in
 * the driver-perceived image, before mirroring (see `hud/projection.ts`), so the editor shows
 * them un-mirrored: dragging the top-left handle moves what the driver sees as the top-left.
 */

export type Corners = ProjectionConfig['corners'];
export type CornerKey = keyof Corners;
export type Point = [number, number];

/** Clockwise from top-left, the order of `ProjectionConfig.corners`. */
export const CORNER_KEYS: readonly CornerKey[] = ['tl', 'tr', 'br', 'bl'];

export const CORNER_LABELS: Readonly<Record<CornerKey, string>> = {
  tl: 'Top left',
  tr: 'Top right',
  br: 'Bottom right',
  bl: 'Bottom left',
};

export const IDENTITY_CORNERS: Corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };

/** Arrow-key nudge (≈ 1.6 px on an 800 px panel) and Shift+arrow nudge, as screen fractions. */
export const NUDGE_STEP = 0.002;
export const NUDGE_STEP_COARSE = 0.01;

/** Corner coordinates are stored with this many decimals (sub-pixel even on a 1920 px panel). */
export const CORNER_DECIMALS = 4;

function clampRound(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundTo(Math.min(1, Math.max(0, value)), CORNER_DECIMALS);
}

/**
 * True when TL → TR → BR → BL is a convex quadrilateral turning clockwise on screen (y down),
 * the same rule the config schema enforces, so the keystone never folds or mirrors the image.
 */
export function isConvexClockwise(corners: Corners): boolean {
  const pts = CORNER_KEYS.map((k) => corners[k]);
  for (let i = 0; i < 4; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % 4]!;
    const c = pts[(i + 2) % 4]!;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (!(cross > 1e-6)) return false;
  }
  return true;
}

/** Corners the HUD can actually draw: convex, clockwise, and with a usable homography. */
export function isUsableCorners(corners: Corners): boolean {
  return isConvexClockwise(corners) && keystoneMatrix(corners) !== null;
}

/**
 * Move one corner to `point` (clamped to the screen and rounded). A move that would make the
 * quad unusable is refused: the original object is returned, so the handle simply stops.
 */
export function moveCorner(
  corners: Corners,
  key: CornerKey,
  point: readonly [number, number],
): Corners {
  const target: Point = [clampRound(point[0]), clampRound(point[1])];
  const current = corners[key];
  if (current[0] === target[0] && current[1] === target[1]) return corners;
  const next: Corners = { ...corners, [key]: target };
  return isUsableCorners(next) ? next : corners;
}

/** Move one corner by a screen-fraction delta (arrow-key nudging). */
export function nudgeCorner(corners: Corners, key: CornerKey, dx: number, dy: number): Corners {
  const [x, y] = corners[key];
  return moveCorner(corners, key, [x + dx, y + dy]);
}

/** The nudge for an arrow key (Shift = coarse), or null for any other key. */
export function nudgeForKey(key: string, coarse: boolean): Point | null {
  const step = coarse ? NUDGE_STEP_COARSE : NUDGE_STEP;
  switch (key) {
    case 'ArrowLeft':
      return [-step, 0];
    case 'ArrowRight':
      return [step, 0];
    case 'ArrowUp':
      return [0, -step];
    case 'ArrowDown':
      return [0, step];
    default:
      return null;
  }
}

export interface EditorBox {
  /** Bounding rectangle of the editor surface in client pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Inset (client px) between the surface edge and the screen rectangle, room for the handles. */
  inset: number;
}

/**
 * A pointer position in client pixels → screen fractions. Not clamped (the pointer may be outside
 * the screen rectangle while dragging); `moveCorner` clamps the result.
 */
export function pointerToFraction(clientX: number, clientY: number, box: EditorBox): Point {
  const innerW = Math.max(1, box.width - 2 * box.inset);
  const innerH = Math.max(1, box.height - 2 * box.inset);
  return [(clientX - box.left - box.inset) / innerW, (clientY - box.top - box.inset) / innerH];
}

/**
 * Where the pointer should drag from so a handle does not jump to the pointer on grab: the
 * offset between the pointer and the corner, in screen fractions.
 */
export function grabOffset(pointer: Point, corner: readonly [number, number]): Point {
  return [corner[0] - pointer[0], corner[1] - pointer[1]];
}

/**
 * Lines of the unit grid warped by the keystone (straight lines stay straight under a
 * homography, so two endpoints each suffice), in screen fractions. Empty for unusable corners.
 */
export function warpedGridLines(corners: Corners, divisions = 4): Array<[Vec2, Vec2]> {
  const h = keystoneMatrix(corners);
  if (h === null || divisions < 1) return [];
  const lines: Array<[Vec2, Vec2]> = [];
  for (let i = 0; i <= divisions; i++) {
    const t = i / divisions;
    lines.push([applyToPoint(h, [t, 0]), applyToPoint(h, [t, 1])]);
    lines.push([applyToPoint(h, [0, t]), applyToPoint(h, [1, t])]);
  }
  return lines;
}

export function isIdentityCorners(corners: Corners): boolean {
  return CORNER_KEYS.every(
    (k) => corners[k][0] === IDENTITY_CORNERS[k][0] && corners[k][1] === IDENTITY_CORNERS[k][1],
  );
}

/** "x 2.0 %, y 0.5 %" — a corner's position for labels and screen readers. */
export function describeCorner(point: readonly [number, number]): string {
  return `x ${roundTo(point[0] * 100, 1).toFixed(1)} %, y ${roundTo(point[1] * 100, 1).toFixed(1)} %`;
}
