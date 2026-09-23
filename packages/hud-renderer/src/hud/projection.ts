import type { ProjectionConfig } from '@carheadsup/core';

/**
 * Pure math turning a `ProjectionConfig` into one CSS `matrix3d()` for the HUD stage.
 *
 * Coordinates are CSS pixels, y down. The stage is laid out at the *logical* size (the image as
 * the driver perceives it — screen size, or width/height swapped for 90°/270° panels) with
 * `transform-origin: 0 0`, and the transform maps logical pixels to screen pixels:
 *
 *   screen = R · M · K · O · S · logical
 *
 *   S  scale about the centre            (content size, in the corrected image)
 *   O  offset by a fraction of the image (content position)
 *   K  keystone: the unit square → the four configured corners (a homography)
 *   M  mirror about the centre           (undo the windshield reflection)
 *   R  rotate about the centre and fit   (panel mounted sideways / upside down)
 *
 * S and O act before K so that size and position adjustments stay rectangular to the driver once
 * the keystone has made the image rectangular; M and R act last because they compensate for the
 * physical optics and mounting, which are independent of what the driver sees.
 */

/** Row-major 3×3 matrix [a b c; d e f; g h i] acting on column vectors (x, y, 1). */
export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export type Vec2 = readonly [number, number];
export type Quad = readonly [Vec2, Vec2, Vec2, Vec2];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** The unit square in TL, TR, BR, BL order (the order of `ProjectionConfig.corners`). */
export const UNIT_SQUARE: Quad = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const EPSILON = 1e-9;

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = a;
  const [b0, b1, b2, b3, b4, b5, b6, b7, b8] = b;
  return [
    a0 * b0 + a1 * b3 + a2 * b6,
    a0 * b1 + a1 * b4 + a2 * b7,
    a0 * b2 + a1 * b5 + a2 * b8,
    a3 * b0 + a4 * b3 + a5 * b6,
    a3 * b1 + a4 * b4 + a5 * b7,
    a3 * b2 + a4 * b5 + a5 * b8,
    a6 * b0 + a7 * b3 + a8 * b6,
    a6 * b1 + a7 * b4 + a8 * b7,
    a6 * b2 + a7 * b5 + a8 * b8,
  ];
}

/** Compose left to right in application order: `chain(A, B, C)` applies A first, then B, then C. */
export function chain(...steps: Mat3[]): Mat3 {
  return steps.reduce<Mat3>((acc, m) => multiply(m, acc), IDENTITY);
}

export function translate(tx: number, ty: number): Mat3 {
  return [1, 0, tx, 0, 1, ty, 0, 0, 1];
}

export function scale(sx: number, sy: number = sx): Mat3 {
  return [sx, 0, 0, 0, sy, 0, 0, 0, 1];
}

/** Clockwise rotation on screen (y down), like CSS `rotate()`. */
export function rotate(degrees: number): Mat3 {
  const r = (degrees * Math.PI) / 180;
  // Snap right angles exactly so 90° rotations produce clean integers.
  const c = Math.abs(Math.cos(r)) < EPSILON ? 0 : Math.cos(r);
  const s = Math.abs(Math.sin(r)) < EPSILON ? 0 : Math.sin(r);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Apply a homography to a point (with the perspective divide). */
export function applyToPoint(m: Mat3, [x, y]: Vec2): Vec2 {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

/**
 * Solve A·x = b by Gaussian elimination with partial pivoting.
 * Returns null when the system is singular (or numerically so).
 */
export function solveLinearSystem(
  matrix: readonly (readonly number[])[],
  rhs: readonly number[],
): number[] | null {
  const n = rhs.length;
  if (matrix.length !== n || matrix.some((row) => row.length !== n)) return null;
  // Augmented copy [A | b].
  const m = matrix.map((row, i) => [...row, rhs[i] ?? 0]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(m[pivot]![col]!) < EPSILON) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const pivotRow = m[col]!;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const target = m[row]!;
      const factor = target[col]! / pivotRow[col]!;
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) target[k] = target[k]! - factor * pivotRow[k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/**
 * The projective transform (homography) taking the four `from` points onto the four `to` points.
 * With h8 fixed to 1 there are 8 unknowns; each correspondence (x, y) → (u, v) contributes
 *
 *   h0·x + h1·y + h2 − h6·x·u − h7·y·u = u
 *   h3·x + h4·y + h5 − h6·x·v − h7·y·v = v
 *
 * Returns null for degenerate input (three collinear points, repeated points).
 */
export function homographyFromQuads(from: Quad, to: Quad): Mat3 | null {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]!;
    const [u, v] = to[i]!;
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const h = solveLinearSystem(a, b);
  if (!h || h.some((v) => !Number.isFinite(v))) return null;
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = h;
  return [h0, h1, h2, h3, h4, h5, h6, h7, 1];
}

/**
 * Homography from the unit square onto the configured corners, or null when the corners cannot
 * form a usable image: degenerate, or folded (a bow-tie or concave quad puts the horizon line —
 * where w = 0 — inside the image, which the browser cannot draw).
 */
export function keystoneMatrix(corners: ProjectionConfig['corners']): Mat3 | null {
  const target: Quad = [corners.tl, corners.tr, corners.br, corners.bl];
  const h = homographyFromQuads(UNIT_SQUARE, target);
  if (!h) return null;
  // w is affine in (x, y), so positive at all four corners ⇒ positive across the whole square.
  for (const [x, y] of UNIT_SQUARE) {
    if (h[6] * x + h[7] * y + h[8] <= EPSILON) return null;
  }
  return h;
}

function isIdentityCorners(corners: ProjectionConfig['corners']): boolean {
  const eq = (p: Vec2, x: number, y: number) =>
    Math.abs(p[0] - x) < EPSILON && Math.abs(p[1] - y) < EPSILON;
  return (
    eq(corners.tl, 0, 0) && eq(corners.tr, 1, 0) && eq(corners.br, 1, 1) && eq(corners.bl, 0, 1)
  );
}

/** True when the projection leaves the image untouched (no measuring or transform needed). */
export function isIdentityProjection(p: ProjectionConfig): boolean {
  return (
    !p.mirrorX &&
    !p.mirrorY &&
    normalizeRotation(p.rotation) === 0 &&
    Math.abs(p.scale - 1) < EPSILON &&
    Math.abs(p.offsetX) < EPSILON &&
    Math.abs(p.offsetY) < EPSILON &&
    isIdentityCorners(p.corners)
  );
}

function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const r = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
  return r as 0 | 90 | 180 | 270;
}

export interface ProjectionLayout {
  /** Size to lay the stage out at (the logical, driver-perceived image). */
  width: number;
  height: number;
  /** Logical px → screen px, to be applied with `transform-origin: 0 0`. */
  matrix: Mat3;
  /** False when the configured corners were unusable and the keystone was skipped. */
  keystoneApplied: boolean;
}

/**
 * Stage size and transform for a screen of `screenWidth` × `screenHeight` CSS pixels.
 * Out-of-range values are clamped to the documented ranges (scale 0.5–1.5, offsets ±0.5).
 */
export function projectionLayout(
  p: ProjectionConfig,
  screenWidth: number,
  screenHeight: number,
): ProjectionLayout {
  const rotation = normalizeRotation(p.rotation);
  const sideways = rotation === 90 || rotation === 270;
  const width = sideways ? screenHeight : screenWidth;
  const height = sideways ? screenWidth : screenHeight;
  const cx = width / 2;
  const cy = height / 2;

  const s = Number.isFinite(p.scale) ? Math.min(1.5, Math.max(0.5, p.scale)) : 1;
  const ox = Number.isFinite(p.offsetX) ? Math.min(0.5, Math.max(-0.5, p.offsetX)) : 0;
  const oy = Number.isFinite(p.offsetY) ? Math.min(0.5, Math.max(-0.5, p.offsetY)) : 0;

  const scaleStep = chain(translate(-cx, -cy), scale(s), translate(cx, cy));
  const offsetStep = translate(ox * width, oy * height);

  const unitKeystone = isIdentityCorners(p.corners) ? IDENTITY : keystoneMatrix(p.corners);
  // Conjugate the unit-square homography into pixels: D · H · D⁻¹.
  const keystoneStep =
    unitKeystone === null
      ? IDENTITY
      : chain(scale(1 / width, 1 / height), unitKeystone, scale(width, height));

  const mirrorStep = chain(
    translate(-cx, -cy),
    scale(p.mirrorX ? -1 : 1, p.mirrorY ? -1 : 1),
    translate(cx, cy),
  );
  const rotateStep = chain(
    translate(-cx, -cy),
    rotate(rotation),
    translate(screenWidth / 2, screenHeight / 2),
  );

  return {
    width,
    height,
    matrix: chain(scaleStep, offsetStep, keystoneStep, mirrorStep, rotateStep),
    keystoneApplied: unitKeystone !== null,
  };
}

/**
 * Plain decimal for CSS output. Fixed notation keeps the tiny perspective terms (≈1e-5 per px)
 * at full precision without exponent notation; trailing zeros and "-0" are dropped.
 */
function num(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-15) return '0';
  const text = v.toFixed(15).replace(/\.?0+$/, '');
  return text === '-0' ? '0' : text;
}

/**
 * CSS `matrix3d()` for a 2-D homography. The 3×3 matrix is embedded in the 4×4 as
 * [a b 0 c; d e 0 f; 0 0 1 0; g h 0 i] and listed column-major, normalised so i = 1.
 */
export function toCssMatrix3d(m: Mat3): string {
  const k = Math.abs(m[8]) > EPSILON ? m[8] : 1;
  const [a, b, c, d, e, f, g, h, i] = m;
  const columns = [
    a / k,
    d / k,
    0,
    g / k,
    b / k,
    e / k,
    0,
    h / k,
    0,
    0,
    1,
    0,
    c / k,
    f / k,
    0,
    i / k,
  ];
  return `matrix3d(${columns.map(num).join(', ')})`;
}
