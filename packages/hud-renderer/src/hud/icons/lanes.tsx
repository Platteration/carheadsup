import type { Lane, LaneDirection } from '@carheadsup/core';
import { Turtle } from './geometry.ts';
import type { ArrowHeadSpec, Route } from './geometry.ts';
import { lookup } from '../util.ts';

/**
 * Lane arrows on a 24×32 grid, as painted on the road: one shared stem from the bottom with a
 * branch per direction. A lane may carry several arrows (e.g. straight + right).
 */

const W = 24;
const STEM_BOTTOM = 31;
const PIVOT_Y = 19;
const STROKE = 3.4;
const HEAD: ArrowHeadSpec = { length: 7.5, halfWidth: 6 };

type Side = 'left' | 'right';

function branch(side: Side, build: (t: Turtle, k: 1 | -1) => Route): Route {
  const k = side === 'left' ? 1 : -1;
  return build(new Turtle(W / 2, PIVOT_Y), k);
}

const BRANCHES: Record<LaneDirection, () => Route> = {
  straight: () => new Turtle(W / 2, PIVOT_Y).arrow(17, HEAD),
  'slight-left': () => branch('left', (t, k) => t.turn(9, -40 * k).arrow(9.5, HEAD)),
  'slight-right': () => branch('right', (t, k) => t.turn(9, -40 * k).arrow(9.5, HEAD)),
  left: () => branch('left', (t, k) => t.turn(5, -90 * k).arrow(6.5, HEAD)),
  right: () => branch('right', (t, k) => t.turn(5, -90 * k).arrow(6.5, HEAD)),
  'sharp-left': () => branch('left', (t, k) => t.turn(4, -135 * k).arrow(7.5, HEAD)),
  'sharp-right': () => branch('right', (t, k) => t.turn(4, -135 * k).arrow(7.5, HEAD)),
  'uturn-left': () =>
    branch('left', (t, k) =>
      t
        .forward(5)
        .turn(4, -180 * k)
        .arrow(11, HEAD),
    ),
  'uturn-right': () =>
    branch('right', (t, k) =>
      t
        .forward(5)
        .turn(4, -180 * k)
        .arrow(11, HEAD),
    ),
  'merge-left': () =>
    branch('left', (t, k) =>
      t
        .turn(6, -40 * k)
        .forward(3)
        .turn(6, 40 * k)
        .arrow(8, HEAD),
    ),
  'merge-right': () =>
    branch('right', (t, k) =>
      t
        .turn(6, -40 * k)
        .forward(3)
        .turn(6, 40 * k)
        .arrow(8, HEAD),
    ),
};

/** Opacity of arrows that are painted on the lane but not the one to follow. */
const INACTIVE_OPACITY = 0.4;

function Branch({ route, dim }: { route: Route; dim: boolean }) {
  return (
    <g
      opacity={dim ? INACTIVE_OPACITY : undefined}
      class={dim ? 'hud-lane__dir' : 'hud-lane__dir hud-lane__dir--active'}
    >
      <path
        d={route.d}
        fill="none"
        stroke="currentColor"
        stroke-width={STROKE}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      {route.head && (
        <polygon
          points={route.head}
          fill="currentColor"
          stroke="currentColor"
          stroke-width="1"
          stroke-linejoin="round"
        />
      )}
    </g>
  );
}

export interface LaneIconProps {
  lane: Lane;
  class?: string;
}

/**
 * All arrows painted on one lane. In a recommended lane the `activeDirection` (or, if unset, the
 * only direction) is drawn at full strength and the others dimmed. Colour comes from CSS
 * (`currentColor`): the lanes widget paints recommended lanes green and the rest faint.
 */
export function LaneIcon({ lane, class: className }: LaneIconProps) {
  const directions =
    lane.directions.length > 0 ? lane.directions : (['straight'] as LaneDirection[]);
  const active =
    lane.activeDirection ?? (lane.recommended && directions.length === 1 ? directions[0] : null);
  // Draw inactive arrows first so the active one sits on top where branches overlap.
  const ordered = [...new Set(directions)].sort(
    (a, b) => Number(a === active) - Number(b === active),
  );
  return (
    <svg
      viewBox={`0 0 ${W} 32`}
      class={className ? `hud-lane-icon ${className}` : 'hud-lane-icon'}
      data-directions={directions.join(' ')}
      aria-hidden="true"
    >
      <path
        d={`M${W / 2} ${STEM_BOTTOM}V${PIVOT_Y}`}
        stroke="currentColor"
        stroke-width={STROKE}
        stroke-linecap="round"
      />
      {ordered.map((dir) => (
        <Branch
          key={dir}
          route={lookup(BRANCHES, dir, BRANCHES.straight)()}
          dim={lane.recommended && active !== null && dir !== active}
        />
      ))}
    </svg>
  );
}

/** Whether a drawing exists for this lane direction (tests / defensive callers). */
export function hasLaneDrawing(direction: string): direction is LaneDirection {
  return Object.prototype.hasOwnProperty.call(BRANCHES, direction);
}
