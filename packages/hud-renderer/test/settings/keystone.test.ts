import { describe, expect, it } from 'vitest';
import {
  IDENTITY_CORNERS,
  NUDGE_STEP,
  NUDGE_STEP_COARSE,
  describeCorner,
  grabOffset,
  isConvexClockwise,
  isIdentityCorners,
  isUsableCorners,
  moveCorner,
  nudgeCorner,
  nudgeForKey,
  pointerToFraction,
  warpedGridLines,
} from '../../src/settings/model/keystone.ts';
import type { Corners } from '../../src/settings/model/keystone.ts';

const TRAPEZOID: Corners = { tl: [0.05, 0], tr: [0.95, 0], br: [1, 1], bl: [0, 1] };

describe('corner validity', () => {
  it('accepts the identity and a keystone trapezoid', () => {
    expect(isConvexClockwise(IDENTITY_CORNERS)).toBe(true);
    expect(isUsableCorners(TRAPEZOID)).toBe(true);
  });

  it('rejects bow-ties, concave quads, reversed winding and collapsed corners', () => {
    const bowTie: Corners = { tl: [0, 0], tr: [1, 1], br: [1, 0], bl: [0, 1] };
    const concave: Corners = { tl: [0, 0], tr: [1, 0], br: [0.3, 0.3], bl: [0, 1] };
    const counterClockwise: Corners = { tl: [0, 0], tr: [0, 1], br: [1, 1], bl: [1, 0] };
    const collapsed: Corners = { tl: [0, 0], tr: [0, 0], br: [1, 1], bl: [0, 1] };
    for (const c of [bowTie, concave, counterClockwise, collapsed]) {
      expect(isConvexClockwise(c)).toBe(false);
      expect(isUsableCorners(c)).toBe(false);
    }
  });
});

describe('moveCorner', () => {
  it('moves a corner, clamped to the screen and rounded to 4 decimals', () => {
    const moved = moveCorner(IDENTITY_CORNERS, 'tl', [0.123456, -0.2]);
    expect(moved.tl).toEqual([0.1235, 0]);
    expect(moved.tr).toBe(IDENTITY_CORNERS.tr);
    expect(moveCorner(IDENTITY_CORNERS, 'br', [1.4, 2]).br).toEqual([1, 1]);
    expect(moveCorner(IDENTITY_CORNERS, 'bl', [Number.NaN, 0.5]).bl).toEqual([0, 0.5]);
  });

  it('refuses a move that would fold the image (returns the same object)', () => {
    // Dragging top-left past the bottom-right diagonal makes the quad concave.
    expect(moveCorner(IDENTITY_CORNERS, 'tl', [0.9, 0.9])).toBe(IDENTITY_CORNERS);
    // Dragging onto a neighbour collapses an edge.
    expect(moveCorner(IDENTITY_CORNERS, 'tl', [1, 0])).toBe(IDENTITY_CORNERS);
  });

  it('returns the same object when nothing changes', () => {
    expect(moveCorner(IDENTITY_CORNERS, 'tr', [1, 0])).toBe(IDENTITY_CORNERS);
    expect(moveCorner(IDENTITY_CORNERS, 'tr', [1.2, -0.3])).toBe(IDENTITY_CORNERS);
  });
});

describe('keyboard nudging', () => {
  it('maps arrow keys to fine and coarse steps', () => {
    expect(nudgeForKey('ArrowLeft', false)).toEqual([-NUDGE_STEP, 0]);
    expect(nudgeForKey('ArrowRight', true)).toEqual([NUDGE_STEP_COARSE, 0]);
    expect(nudgeForKey('ArrowUp', false)).toEqual([0, -NUDGE_STEP]);
    expect(nudgeForKey('ArrowDown', true)).toEqual([0, NUDGE_STEP_COARSE]);
    expect(nudgeForKey('Enter', false)).toBeNull();
  });

  it('nudges inward and stops at the screen edge', () => {
    const inward = nudgeCorner(IDENTITY_CORNERS, 'tl', NUDGE_STEP, NUDGE_STEP);
    expect(inward.tl).toEqual([0.002, 0.002]);
    expect(nudgeCorner(IDENTITY_CORNERS, 'tl', -NUDGE_STEP, 0)).toBe(IDENTITY_CORNERS);
    const repeated = [1, 2, 3, 4, 5].reduce(
      (c) => nudgeCorner(c, 'br', -NUDGE_STEP, 0),
      IDENTITY_CORNERS,
    );
    expect(repeated.br).toEqual([0.99, 1]);
  });
});

describe('pointer mapping', () => {
  const box = { left: 100, top: 50, width: 440, height: 280, inset: 20 };

  it('maps client pixels to screen fractions inside the inset', () => {
    expect(pointerToFraction(120, 70, box)).toEqual([0, 0]);
    expect(pointerToFraction(520, 310, box)).toEqual([1, 1]);
    expect(pointerToFraction(320, 190, box)).toEqual([0.5, 0.5]);
  });

  it('does not clamp (the drag clamps), and survives a zero-size box', () => {
    expect(pointerToFraction(80, 50, box)[0]).toBeLessThan(0);
    const [x, y] = pointerToFraction(10, 10, { left: 0, top: 0, width: 0, height: 0, inset: 0 });
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  });

  it('keeps the grab offset so a handle does not jump to the pointer', () => {
    const offset = grabOffset([0.52, 0.49], [0.5, 0.5]);
    expect(offset[0]).toBeCloseTo(-0.02, 10);
    expect(offset[1]).toBeCloseTo(0.01, 10);
  });
});

describe('preview helpers', () => {
  it('draws the identity grid as straight axis-aligned lines', () => {
    const lines = warpedGridLines(IDENTITY_CORNERS, 2);
    expect(lines).toHaveLength(6);
    for (const [a, b] of lines) {
      const vertical = Math.abs(a[0] - b[0]) < 1e-9;
      const horizontal = Math.abs(a[1] - b[1]) < 1e-9;
      expect(vertical || horizontal).toBe(true);
    }
  });

  it('warps the grid through the corners and draws nothing for unusable quads', () => {
    const lines = warpedGridLines(TRAPEZOID, 1);
    const [first] = lines;
    expect(first?.[0][0]).toBeCloseTo(0.05, 9);
    expect(first?.[1][0]).toBeCloseTo(0, 9);
    expect(warpedGridLines({ tl: [0, 0], tr: [1, 1], br: [1, 0], bl: [0, 1] })).toEqual([]);
    expect(warpedGridLines(IDENTITY_CORNERS, 0)).toEqual([]);
  });

  it('describes and recognises corners', () => {
    expect(describeCorner([0.02, 0.005])).toBe('x 2.0 %, y 0.5 %');
    expect(isIdentityCorners(IDENTITY_CORNERS)).toBe(true);
    expect(isIdentityCorners(TRAPEZOID)).toBe(false);
  });
});
