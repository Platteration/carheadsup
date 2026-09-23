import type { Maneuver, ManeuverType } from '@carheadsup/core';
import type { JSX } from 'preact';
import { Turtle, arrowHead, pointAlong, r2 } from './geometry.ts';
import type { ArrowHeadSpec, Route } from './geometry.ts';
import { lookup } from '../util.ts';

/**
 * Maneuver arrows on a 48×48 grid. The route to drive is a thick stroke with a filled head in
 * `currentColor`; context (the road you leave, the other branch of a fork, the roundabout ring)
 * is a thinner, dimmed "ghost" stroke. Right-hand variants mirror the left-hand drawings.
 */

const SIZE = 48;
const ROUTE_WIDTH = 6;
const GHOST_WIDTH = 4;
const GHOST_OPACITY = 0.38;
const HEAD: ArrowHeadSpec = { length: 12, halfWidth: 9.5 };

type Side = 'left' | 'right';

interface Drawing {
  routes: Route[];
  ghosts: Route[];
  /** Extra elements drawn on top (flag, ring number, boat …). */
  extra?: JSX.Element;
}

/** Mirror helper: canonical drawings are left-handed; `k` flips x and turn directions. */
function sideFactor(side: Side): 1 | -1 {
  return side === 'left' ? 1 : -1;
}

function mx(x: number, side: Side): number {
  return SIZE / 2 + sideFactor(side) * (x - SIZE / 2);
}

function turtle(x: number, y: number, side: Side, heading = 0): Turtle {
  return new Turtle(mx(x, side), y, heading * sideFactor(side));
}

/** Plain turn of a given severity (degrees of heading change, canonical = left). */
function turn(side: Side, severity: 'slight' | 'normal' | 'sharp' | 'uturn'): Drawing {
  const k = sideFactor(side);
  switch (severity) {
    case 'slight':
      return {
        routes: [
          turtle(29, 44, side)
            .forward(14)
            .turn(12, -45 * k)
            .arrow(18, HEAD),
        ],
        ghosts: [],
      };
    case 'normal':
      return {
        routes: [
          turtle(33, 44, side)
            .forward(12)
            .turn(10, -90 * k)
            .arrow(17, HEAD),
        ],
        ghosts: [],
      };
    case 'sharp':
      return {
        routes: [
          turtle(33, 44, side)
            .forward(20)
            .turn(8, -135 * k)
            .arrow(17, HEAD),
        ],
        ghosts: [],
      };
    case 'uturn':
      return {
        routes: [
          turtle(32, 44, side)
            .forward(22)
            .turn(8.5, -180 * k)
            .arrow(19, HEAD),
        ],
        ghosts: [],
      };
  }
}

/** Keep left/right: an S-bend into the kept branch; the other branch continues as a ghost. */
function keep(side: Side): Drawing {
  const k = sideFactor(side);
  const active = turtle(24, 44, side)
    .forward(8)
    .turn(10, -45 * k)
    .forward(6)
    .turn(10, 45 * k)
    .arrow(14, HEAD);
  const ghost = turtle(24, 36, side)
    .turn(10, 45 * k)
    .forward(6)
    .turn(10, -45 * k)
    .forward(12)
    .done();
  return { routes: [active], ghosts: [ghost] };
}

/** Fork: a Y with the chosen branch bright and the other ghosted. */
function fork(side: Side): Drawing {
  const k = sideFactor(side);
  const active = turtle(24, 44, side)
    .forward(12)
    .turn(12, -40 * k)
    .arrow(18, HEAD);
  const ghost = turtle(24, 32, side)
    .turn(12, 40 * k)
    .forward(15)
    .done();
  return { routes: [active], ghosts: [ghost] };
}

/** Merge: join the ghosted road on the given side. */
function merge(side: Side): Drawing {
  const k = sideFactor(side);
  const road = turtle(16, 46, side).forward(42).done();
  const active = turtle(33, 44, side)
    .forward(4)
    .turn(9, -45 * k)
    .forward(16.5)
    .turn(9, 45 * k)
    .arrow(12.5, HEAD);
  return { routes: [active], ghosts: [road] };
}

/** Ramp: leave the (ghosted) carriageway at a shallow angle. */
function ramp(side: Side): Drawing {
  const k = sideFactor(side);
  const road = turtle(29, 46, side).forward(42).done();
  const active = turtle(29, 44, side)
    .forward(12)
    .turn(16, -35 * k)
    .arrow(20, HEAD);
  return { routes: [active], ghosts: [road] };
}

/** Exit: branch off the (ghosted) carriageway and curve away more strongly than a ramp. */
function exit(side: Side): Drawing {
  const k = sideFactor(side);
  const road = turtle(31, 46, side).forward(42).done();
  const active = turtle(31, 44, side)
    .forward(10)
    .turn(13, -65 * k)
    .arrow(15, HEAD);
  return { routes: [active], ghosts: [road] };
}

// ---------------------------------------------------------------------------
// Roundabouts

const RING = { cx: 24, cy: 22.5, r: 9.5 };
/** Exit stub length beyond the ring; with the smaller head it clears the ring's stroke. */
const RING_STUB = 12;
const RING_HEAD: ArrowHeadSpec = { length: 9, halfWidth: 8 };

/**
 * Exit bearing (degrees clockwise from straight ahead) for a roundabout. Uses the explicit
 * `roundaboutAngle` when present; otherwise assumes a four-arm roundabout and derives the bearing
 * from the exit number (first exit = the first arm in the driving direction).
 */
export function roundaboutBearing(maneuver: Maneuver, clockwise: boolean): number {
  const angle = maneuver.roundaboutAngle;
  if (typeof angle === 'number' && Number.isFinite(angle)) return ((angle % 360) + 360) % 360;
  const exitNumber = maneuver.roundaboutExit;
  if (typeof exitNumber === 'number' && Number.isFinite(exitNumber) && exitNumber >= 1) {
    const arms = clockwise ? [270, 0, 90, 180] : [90, 0, 270, 180];
    return arms[(Math.floor(exitNumber) - 1) % 4] ?? 0;
  }
  return 0;
}

function ringPoint(bearing: number, radius: number): { x: number; y: number } {
  const a = (bearing * Math.PI) / 180;
  return { x: RING.cx + Math.sin(a) * radius, y: RING.cy - Math.cos(a) * radius };
}

/**
 * Roundabout: enter from the bottom, travel round the ring in the driving direction
 * (counter-clockwise for right-hand traffic) and leave at the exit bearing.
 */
function roundabout(maneuver: Maneuver, clockwise: boolean): Drawing {
  const bearing = roundaboutBearing(maneuver, clockwise);
  // Angle travelled round the ring from the entry (bearing 180) to the exit.
  let travelled = clockwise ? (bearing - 180 + 360) % 360 : (180 - bearing + 360) % 360;
  if (travelled < 1) travelled = 360;
  const sweep = clockwise ? 1 : 0;
  const entry = ringPoint(180, RING.r);
  const exitPoint = ringPoint(bearing, RING.r);
  const arcs: string[] = [];
  if (travelled > 359) {
    // Full circle (U-turn): split through the opposite point so the arc is well defined.
    const mid = ringPoint(0, RING.r);
    arcs.push(`A${RING.r} ${RING.r} 0 0 ${sweep} ${r2(mid.x)} ${r2(mid.y)}`);
    arcs.push(`A${RING.r} ${RING.r} 0 0 ${sweep} ${r2(exitPoint.x)} ${r2(exitPoint.y)}`);
  } else {
    const large = travelled > 180 ? 1 : 0;
    arcs.push(`A${RING.r} ${RING.r} 0 ${large} ${sweep} ${r2(exitPoint.x)} ${r2(exitPoint.y)}`);
  }
  const tip = ringPoint(bearing, RING.r + RING_STUB);
  const bodyEnd = pointAlong(tip, bearing, -RING_HEAD.length * 0.7);
  const route: Route = {
    d: `M24 47L${r2(entry.x)} ${r2(entry.y)}${arcs.join('')}L${r2(bodyEnd.x)} ${r2(bodyEnd.y)}`,
    head: arrowHead(tip, bearing, RING_HEAD),
    end: tip,
    heading: bearing,
  };
  const ring: Route = {
    d: `M${RING.cx - RING.r} ${RING.cy}a${RING.r} ${RING.r} 0 1 0 ${RING.r * 2} 0a${RING.r} ${RING.r} 0 1 0 ${-RING.r * 2} 0`,
    head: null,
    end: entry,
    heading: 0,
  };
  const exitNumber = maneuver.roundaboutExit;
  const label =
    typeof exitNumber === 'number' && Number.isFinite(exitNumber) && exitNumber >= 1
      ? String(Math.floor(exitNumber))
      : null;
  return {
    routes: [route],
    ghosts: [ring],
    extra: label ? (
      <text
        class="hud-maneuver__exit"
        x={RING.cx}
        y={RING.cy + 0.5}
        text-anchor="middle"
        dominant-baseline="central"
        font-size={label.length > 1 ? 9 : 11}
        font-weight="700"
        fill="currentColor"
        stroke="none"
      >
        {label}
      </text>
    ) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Start, finish and special

function depart(): Drawing {
  return {
    routes: [new Turtle(24, 32).arrow(28, HEAD)],
    ghosts: [],
    extra: <circle cx="24" cy="38.5" r="5" fill="none" stroke="currentColor" stroke-width="4.5" />,
  };
}

/** Chequered flag on a pole whose foot is at (poleX, bottom). */
function Flag({ poleX, top, bottom }: { poleX: number; top: number; bottom: number }) {
  const w = 20;
  const h = 14;
  const cell = w / 4;
  const cells: JSX.Element[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      if ((row + col) % 2 === 0) {
        cells.push(
          <rect
            key={`${row}-${col}`}
            x={poleX + col * cell}
            y={top + (row * h) / 3}
            width={cell}
            height={h / 3}
            fill="currentColor"
            stroke="none"
          />,
        );
      }
    }
  }
  return (
    <g>
      <rect
        x={poleX}
        y={top}
        width={w}
        height={h}
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linejoin="round"
      />
      {cells}
      <path
        d={`M${poleX} ${bottom}V${top - 1}`}
        stroke="currentColor"
        stroke-width="4.5"
        stroke-linecap="round"
      />
    </g>
  );
}

function arrive(side: Side | null): Drawing {
  if (side === null) {
    return { routes: [], ghosts: [], extra: <Flag poleX={14} top={5} bottom={44} /> };
  }
  // Destination on one side of the road: the road ahead plus a flag on that side.
  const roadX = side === 'left' ? 32 : 16;
  return {
    routes: [new Turtle(roadX, 44).arrow(22, { length: 10, halfWidth: 8 })],
    ghosts: [new Turtle(roadX, 22).forward(18).done()],
    extra:
      side === 'left' ? (
        <Flag poleX={6} top={6} bottom={30} />
      ) : (
        <Flag poleX={22} top={6} bottom={30} />
      ),
  };
}

function ferry(): Drawing {
  return {
    routes: [],
    ghosts: [],
    extra: (
      <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 26h38l-6 10H11z" stroke-width="4.5" />
        <path d="M14 26v-8h17v8M20 18v-6h6v6" stroke-width="3.5" />
        <path
          d="M4 43c3-2.5 6-2.5 9 0s6 2.5 9 0 6-2.5 9 0 6 2.5 9 0"
          stroke-width="3.5"
          opacity={GHOST_OPACITY + 0.3}
        />
      </g>
    ),
  };
}

function unknown(): Drawing {
  return {
    routes: [],
    ghosts: [],
    extra: (
      <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <path d="M24 4L44 24 24 44 4 24z" stroke-width="4" />
        <path d="M19 20a5 5 0 1 1 7 4.6c-1.4.7-2 1.6-2 3.2v1" stroke-width="4" />
        <circle cx="24" cy="34.5" r="2.4" fill="currentColor" stroke="none" />
      </g>
    ),
  };
}

const DRAWINGS: Record<ManeuverType, (m: Maneuver) => Drawing> = {
  depart: () => depart(),
  arrive: () => arrive(null),
  'arrive-left': () => arrive('left'),
  'arrive-right': () => arrive('right'),
  straight: () => ({ routes: [new Turtle(24, 44).arrow(40, HEAD)], ghosts: [] }),
  'slight-left': () => turn('left', 'slight'),
  left: () => turn('left', 'normal'),
  'sharp-left': () => turn('left', 'sharp'),
  'slight-right': () => turn('right', 'slight'),
  right: () => turn('right', 'normal'),
  'sharp-right': () => turn('right', 'sharp'),
  'uturn-left': () => turn('left', 'uturn'),
  'uturn-right': () => turn('right', 'uturn'),
  'keep-left': () => keep('left'),
  'keep-right': () => keep('right'),
  'merge-left': () => merge('left'),
  'merge-right': () => merge('right'),
  'ramp-left': () => ramp('left'),
  'ramp-right': () => ramp('right'),
  'exit-left': () => exit('left'),
  'exit-right': () => exit('right'),
  'fork-left': () => fork('left'),
  'fork-right': () => fork('right'),
  'roundabout-ccw': (m) => roundabout(m, false),
  'roundabout-cw': (m) => roundabout(m, true),
  ferry: () => ferry(),
  unknown: () => unknown(),
};

function RoutePath({ route, ghost }: { route: Route; ghost: boolean }) {
  return (
    <g
      class={ghost ? 'hud-route hud-route--ghost' : 'hud-route'}
      opacity={ghost ? GHOST_OPACITY : undefined}
    >
      <path
        d={route.d}
        fill="none"
        stroke="currentColor"
        stroke-width={ghost ? GHOST_WIDTH : ROUTE_WIDTH}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      {route.head && (
        <polygon
          points={route.head}
          fill="currentColor"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
      )}
    </g>
  );
}

export interface ManeuverIconProps {
  maneuver: Maneuver;
  class?: string;
}

/** Arrow for a navigation maneuver; every `ManeuverType` has a drawing. */
export function ManeuverIcon({ maneuver, class: className }: ManeuverIconProps) {
  const draw = lookup(DRAWINGS, maneuver.type, DRAWINGS.unknown);
  const drawing = draw(maneuver);
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      class={className ? `hud-maneuver ${className}` : 'hud-maneuver'}
      data-maneuver={maneuver.type}
      aria-hidden="true"
    >
      {drawing.ghosts.map((g, i) => (
        <RoutePath key={`g${i}`} route={g} ghost />
      ))}
      {drawing.routes.map((r, i) => (
        <RoutePath key={`r${i}`} route={r} ghost={false} />
      ))}
      {drawing.extra}
    </svg>
  );
}

/** Whether a dedicated drawing exists for this maneuver type (tests / defensive callers). */
export function hasManeuverDrawing(type: string): type is ManeuverType {
  return Object.prototype.hasOwnProperty.call(DRAWINGS, type);
}
