import type { ProjectionConfig } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  UNIT_SQUARE,
  applyToPoint,
  chain,
  homographyFromQuads,
  isIdentityProjection,
  keystoneMatrix,
  projectionLayout,
  rotate,
  scale,
  solveLinearSystem,
  toCssMatrix3d,
  translate,
} from '../../src/hud/projection.ts';
import type { Mat3, Quad, Vec2 } from '../../src/hud/projection.ts';

const BASE: ProjectionConfig = {
  mirrorX: false,
  mirrorY: false,
  rotation: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  corners: { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] },
  showGrid: false,
};

const W = 800;
const H = 480;

function config(patch: Partial<ProjectionConfig>): ProjectionConfig {
  return { ...BASE, ...patch };
}

function expectPoint(actual: Vec2, expected: Vec2, digits = 6) {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
}

function expectMatrix(actual: Mat3, expected: Mat3) {
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 9));
}

/** Apply a CSS matrix3d() string to a 2-D point, as the browser would (z = 0, w divide). */
function applyCss(css: string, [x, y]: Vec2): Vec2 {
  const m = css
    .replace(/^matrix3d\(|\)$/g, '')
    .split(',')
    .map(Number);
  expect(m).toHaveLength(16);
  const at = (row: number, col: number) => m[col * 4 + row]!;
  const X = at(0, 0) * x + at(0, 1) * y + at(0, 3);
  const Y = at(1, 0) * x + at(1, 1) * y + at(1, 3);
  const Wc = at(3, 0) * x + at(3, 1) * y + at(3, 3);
  return [X / Wc, Y / Wc];
}

describe('solveLinearSystem', () => {
  it('solves a small system', () => {
    const x = solveLinearSystem(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10],
    );
    expect(x?.[0]).toBeCloseTo(1);
    expect(x?.[1]).toBeCloseTo(3);
  });

  it('needs pivoting when the first pivot is zero', () => {
    const x = solveLinearSystem(
      [
        [0, 1],
        [1, 0],
      ],
      [4, 7],
    );
    expect(x).toEqual([7, 4]);
  });

  it('returns null for singular or malformed systems', () => {
    expect(
      solveLinearSystem(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toBeNull();
    expect(solveLinearSystem([[1, 2]], [1, 2])).toBeNull();
  });
});

describe('homographyFromQuads', () => {
  it('maps the unit square onto itself with the identity', () => {
    expectMatrix(homographyFromQuads(UNIT_SQUARE, UNIT_SQUARE)!, IDENTITY);
  });

  it('maps every source corner onto its target corner', () => {
    const targets: Quad[] = [
      [
        [0.05, 0.02],
        [0.97, 0.08],
        [0.9, 0.95],
        [0.1, 1],
      ],
      [
        [10, 20],
        [300, 0],
        [320, 240],
        [-5, 200],
      ],
      [
        [0.2, 0],
        [0.8, 0],
        [1, 1],
        [0, 1],
      ],
    ];
    for (const target of targets) {
      const h = homographyFromQuads(UNIT_SQUARE, target)!;
      expect(h).not.toBeNull();
      UNIT_SQUARE.forEach((p, i) => expectPoint(applyToPoint(h, p), target[i]!));
    }
  });

  it('works between arbitrary quads', () => {
    const from: Quad = [
      [1, 1],
      [4, 2],
      [5, 6],
      [0, 5],
    ];
    const to: Quad = [
      [0, 0],
      [100, 10],
      [90, 80],
      [5, 70],
    ];
    const h = homographyFromQuads(from, to)!;
    from.forEach((p, i) => expectPoint(applyToPoint(h, p), to[i]!));
  });

  it('rejects degenerate targets', () => {
    const collinear: Quad = [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
      [0.25, 0.25],
    ];
    expect(homographyFromQuads(UNIT_SQUARE, collinear)).toBeNull();
  });
});

describe('keystoneMatrix', () => {
  it('is the identity for identity corners', () => {
    expectMatrix(keystoneMatrix(BASE.corners)!, IDENTITY);
  });

  it('rejects a folded (bow-tie) quad whose horizon crosses the image', () => {
    expect(keystoneMatrix({ tl: [0, 0], tr: [1, 0], br: [0, 1], bl: [1, 1] })).toBeNull();
  });
});

describe('isIdentityProjection', () => {
  it('detects the identity and any deviation from it', () => {
    expect(isIdentityProjection(BASE)).toBe(true);
    expect(isIdentityProjection(config({ mirrorX: true }))).toBe(false);
    expect(isIdentityProjection(config({ mirrorY: true }))).toBe(false);
    expect(isIdentityProjection(config({ rotation: 180 }))).toBe(false);
    expect(isIdentityProjection(config({ scale: 0.9 }))).toBe(false);
    expect(isIdentityProjection(config({ offsetY: 0.05 }))).toBe(false);
    expect(isIdentityProjection(config({ corners: { ...BASE.corners, tl: [0.02, 0] } }))).toBe(
      false,
    );
  });
});

describe('projectionLayout', () => {
  const corners = (layout: ReturnType<typeof projectionLayout>): Vec2[] =>
    (
      [
        [0, 0],
        [layout.width, 0],
        [layout.width, layout.height],
        [0, layout.height],
      ] as Vec2[]
    ).map((p) => applyToPoint(layout.matrix, p));

  it('is the identity for the identity config', () => {
    const layout = projectionLayout(BASE, W, H);
    expect([layout.width, layout.height]).toEqual([W, H]);
    expectMatrix(layout.matrix, IDENTITY);
  });

  it('maps the image corners onto the configured keystone corners', () => {
    const c: ProjectionConfig['corners'] = {
      tl: [0.04, 0.02],
      tr: [0.95, 0.06],
      br: [0.98, 0.97],
      bl: [0.01, 0.92],
    };
    const layout = projectionLayout(config({ corners: c }), W, H);
    expect(layout.keystoneApplied).toBe(true);
    const got = corners(layout);
    [c.tl, c.tr, c.br, c.bl].forEach((p, i) => expectPoint(got[i]!, [p[0] * W, p[1] * H]));
  });

  it('mirrors horizontally and vertically about the centre', () => {
    const x = projectionLayout(config({ mirrorX: true }), W, H);
    expectPoint(applyToPoint(x.matrix, [0, 0]), [W, 0]);
    expectPoint(applyToPoint(x.matrix, [100, 50]), [W - 100, 50]);
    const y = projectionLayout(config({ mirrorY: true }), W, H);
    expectPoint(applyToPoint(y.matrix, [100, 50]), [100, H - 50]);
  });

  it('mirrors after the keystone, so corners stay in the driver frame', () => {
    const c: ProjectionConfig['corners'] = { tl: [0.1, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };
    const layout = projectionLayout(config({ mirrorX: true, corners: c }), W, H);
    // The logical top-left lands at 10 % from the left in the driver's (reflected) view,
    // which is 10 % from the right on the screen.
    expectPoint(applyToPoint(layout.matrix, [0, 0]), [W - 0.1 * W, 0]);
  });

  it('swaps the stage size and rotates clockwise for sideways panels', () => {
    const r90 = projectionLayout(config({ rotation: 90 }), H, W); // portrait panel 480×800
    expect([r90.width, r90.height]).toEqual([W, H]);
    const got = corners(r90);
    // Logical TL → screen top-right, TR → bottom-right, BR → bottom-left, BL → top-left.
    expectPoint(got[0]!, [H, 0]);
    expectPoint(got[1]!, [H, W]);
    expectPoint(got[2]!, [0, W]);
    expectPoint(got[3]!, [0, 0]);

    const r270 = projectionLayout(config({ rotation: 270 }), H, W);
    expectPoint(corners(r270)[0]!, [0, W]);

    const r180 = projectionLayout(config({ rotation: 180 }), W, H);
    expectPoint(applyToPoint(r180.matrix, [0, 0]), [W, H]);
  });

  it('scales about the centre and offsets by a fraction of the image', () => {
    const s = projectionLayout(config({ scale: 0.5 }), W, H);
    expectPoint(applyToPoint(s.matrix, [0, 0]), [W / 4, H / 4]);
    expectPoint(applyToPoint(s.matrix, [W, H]), [(3 * W) / 4, (3 * H) / 4]);
    const o = projectionLayout(config({ offsetX: 0.1, offsetY: -0.05 }), W, H);
    expectPoint(applyToPoint(o.matrix, [0, 0]), [0.1 * W, -0.05 * H]);
  });

  it('clamps out-of-range scale and offsets', () => {
    const big = projectionLayout(config({ scale: 9, offsetX: 3 }), W, H);
    const clamped = projectionLayout(config({ scale: 1.5, offsetX: 0.5 }), W, H);
    expectMatrix(big.matrix, clamped.matrix);
    const nan = projectionLayout(config({ scale: Number.NaN, offsetY: Number.NaN }), W, H);
    expectMatrix(nan.matrix, IDENTITY);
  });

  it('skips an unusable keystone instead of producing a broken image', () => {
    const layout = projectionLayout(
      config({ mirrorX: true, corners: { tl: [0, 0], tr: [0, 0], br: [0, 0], bl: [0, 0] } }),
      W,
      H,
    );
    expect(layout.keystoneApplied).toBe(false);
    expectPoint(applyToPoint(layout.matrix, [0, 0]), [W, 0]);
  });

  it('snaps odd rotations to the nearest right angle', () => {
    const layout = projectionLayout(config({ rotation: 89 as ProjectionConfig['rotation'] }), H, W);
    expect([layout.width, layout.height]).toEqual([W, H]);
  });
});

describe('toCssMatrix3d', () => {
  it('writes the identity', () => {
    expect(toCssMatrix3d(IDENTITY)).toBe(
      'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)',
    );
  });

  it('puts translation in the last column', () => {
    expect(toCssMatrix3d(translate(10, -20))).toBe(
      'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, -20, 0, 1)',
    );
  });

  it('matches applyToPoint for a full perspective projection', () => {
    const layout = projectionLayout(
      config({
        mirrorX: true,
        scale: 0.9,
        offsetY: 0.03,
        corners: { tl: [0.06, 0.03], tr: [0.93, 0], br: [1, 1], bl: [0.02, 0.95] },
      }),
      W,
      H,
    );
    const css = toCssMatrix3d(layout.matrix);
    for (const p of [
      [0, 0],
      [W, 0],
      [W / 2, H / 3],
      [W, H],
      [17, 400],
    ] as Vec2[]) {
      expectPoint(applyCss(css, p), applyToPoint(layout.matrix, p), 4);
    }
  });

  it('normalises by the w component', () => {
    const m: Mat3 = [2, 0, 4, 0, 2, 6, 0, 0, 2];
    expect(toCssMatrix3d(m)).toBe(toCssMatrix3d(translate(2, 3)));
  });
});

describe('matrix helpers', () => {
  it('chain applies steps in order', () => {
    const m = chain(translate(10, 0), scale(2));
    expectPoint(applyToPoint(m, [1, 1]), [22, 2]);
  });

  it('rotate turns clockwise on a y-down screen and snaps right angles', () => {
    expect(rotate(90)).toEqual([0, -1, 0, 1, 0, 0, 0, 0, 1]);
    expectPoint(applyToPoint(rotate(90), [1, 0]), [0, 1]);
  });
});
