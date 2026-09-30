/**
 * The scripted route the simulated phone navigates, laid out along the distance the demo
 * scenario actually drives (measured from the VehicleSimulator; `city` starts at 0 m):
 *
 *   city 0–659 m · red light at ~698 m · on-ramp to ~1116 m · highway to ~3976 m ·
 *   exit to ~4342 m · arriving, stopping at ~4511 m.
 *
 * On the highway there is a fixed speed camera, and — as a traffic service would report it once
 * the car is on the A7 — a jam on the A7 beyond exit 14, which the route leaves before reaching.
 *
 * Positions are metres along the route. Everything here is pure data and pure functions; the
 * phone simulation tracks the position from the simulated odometer.
 */
import type { Hazard, Lane, Maneuver, RoadClass } from '@carheadsup/core';

export interface RouteManeuver {
  /** Route position of the maneuver point. */
  at: number;
  maneuver: Maneuver;
  /** Street the maneuver leads onto. */
  street: string;
  lanes: Lane[] | null;
}

export interface RoadSegment {
  /** Route position where the segment starts (it ends where the next one starts). */
  from: number;
  name: string;
  speedLimitKph: number;
  roadClass: RoadClass;
  /** Heading while driving the segment, degrees clockwise from north. */
  bearingDeg: number;
}

export interface ScriptedHazard {
  id: string;
  /** Route position of the hazard (where traffic reaches it). */
  at: number;
  type: Hazard['type'];
  speedLimitKph: number | null;
  /** Expected delay (traffic), seconds. */
  delaySeconds: number | null;
  description: string;
  /** Reported from this route position on; default {@link HAZARD_ANNOUNCE_M} before `at`. */
  announceAt?: number;
  /** Withdrawn at this route position; default `at` (once passed). */
  dropAt?: number;
}

const lane = (
  directions: Lane['directions'],
  recommended: boolean,
  activeDirection: Lane['activeDirection'] = null,
): Lane => ({ directions, recommended, activeDirection: recommended ? activeDirection : null });

export const ROUTE_DESTINATION = 'Harbor Office Park';

export const ROUTE_MANEUVERS: readonly RouteManeuver[] = [
  {
    at: 170,
    maneuver: { type: 'right', instruction: 'Turn right onto Station Road' },
    street: 'Station Road',
    lanes: null,
  },
  {
    at: 430,
    maneuver: { type: 'left', instruction: 'Turn left onto Bridge Avenue' },
    street: 'Bridge Avenue',
    lanes: [
      lane(['left'], true, 'left'),
      lane(['straight'], false),
      lane(['straight', 'right'], false),
    ],
  },
  {
    at: 750,
    maneuver: { type: 'ramp-right', instruction: 'Take the ramp onto A7 North toward Harborside' },
    street: 'A7 North',
    lanes: [lane(['straight'], false), lane(['straight', 'slight-right'], true, 'slight-right')],
  },
  {
    at: 1100,
    maneuver: { type: 'merge-left', instruction: 'Merge onto A7 North' },
    street: 'A7 North',
    lanes: null,
  },
  {
    at: 3990, // EXIT_14_AT
    maneuver: { type: 'exit-right', instruction: 'Take exit 14 toward Harborside' },
    street: 'Exit 14 Harborside',
    lanes: [
      lane(['straight'], false),
      lane(['straight'], false),
      lane(['straight', 'slight-right'], true, 'slight-right'),
      lane(['slight-right'], true, 'slight-right'),
    ],
  },
  {
    at: 4250,
    maneuver: {
      type: 'roundabout-ccw',
      roundaboutExit: 2,
      roundaboutAngle: 180,
      instruction: 'At the roundabout, take the 2nd exit onto Harbor Road',
    },
    street: 'Harbor Road',
    lanes: null,
  },
  {
    at: 4500,
    maneuver: { type: 'arrive-right', instruction: `${ROUTE_DESTINATION} is on the right` },
    street: ROUTE_DESTINATION,
    lanes: null,
  },
];

/** Total route length: the arrival point. */
export const ROUTE_LENGTH_M = ROUTE_MANEUVERS[ROUTE_MANEUVERS.length - 1]!.at;

export const ROAD_SEGMENTS: readonly RoadSegment[] = [
  { from: 0, name: 'Maple Street', speedLimitKph: 50, roadClass: 'residential', bearingDeg: 90 },
  { from: 170, name: 'Station Road', speedLimitKph: 50, roadClass: 'secondary', bearingDeg: 180 },
  { from: 430, name: 'Bridge Avenue', speedLimitKph: 50, roadClass: 'primary', bearingDeg: 90 },
  { from: 750, name: 'A7 North', speedLimitKph: 100, roadClass: 'motorway', bearingDeg: 30 },
  { from: 1100, name: 'A7 North', speedLimitKph: 120, roadClass: 'motorway', bearingDeg: 10 },
  // Camera zone: the scenario's highway step slows to ~105 km/h here.
  { from: 2450, name: 'A7 North', speedLimitKph: 100, roadClass: 'motorway', bearingDeg: 5 },
  { from: 3050, name: 'A7 North', speedLimitKph: 120, roadClass: 'motorway', bearingDeg: 15 },
  { from: 3990, name: 'Exit 14 Harborside', speedLimitKph: 70, roadClass: 'trunk', bearingDeg: 60 },
  { from: 4250, name: 'Harbor Road', speedLimitKph: 50, roadClass: 'primary', bearingDeg: 90 },
  { from: 4400, name: 'Harbor Road', speedLimitKph: 30, roadClass: 'residential', bearingDeg: 95 },
];

/** Route position of exit 14, where the route leaves the A7. */
export const EXIT_14_AT = 3990;

export const SCRIPTED_HAZARDS: readonly ScriptedHazard[] = [
  {
    id: 'sim-camera-a7',
    at: 2750,
    type: 'speed-camera',
    speedLimitKph: 100,
    delaySeconds: null,
    description: 'Fixed speed camera',
  },
  {
    // Stationary traffic on the A7 about 800 m past exit 14, as a traffic service reports it
    // (TomTom: up to ~10 km ahead) from the merge onto the A7. The HUD shows it from 3 km on the
    // highway (`display.trafficRevealM`) — here once the camera is passed — and it goes when
    // the route takes the exit.
    id: 'sim-jam-a7',
    at: 4800,
    type: 'traffic-jam',
    speedLimitKph: null,
    delaySeconds: 480,
    description: 'Stationary traffic',
    announceAt: 1100,
    dropAt: EXIT_14_AT,
  },
];

/** Hazards are reported once they are this close ahead (unless they say otherwise)… */
export const HAZARD_ANNOUNCE_M = 1500;
/** …and dropped once this far behind. */
export const HAZARD_DROP_BEHIND_M = 60;
/** A "then" maneuver is sent when it follows the next one within this distance. */
export const THEN_WITHIN_M = 300;

/** Route start (for location updates), somewhere plausible for an "A7". */
export const ROUTE_ORIGIN = { lat: 53.5511, lon: 9.9937 } as const;

/** Route position from which a scripted hazard is reported. */
export function announceAt(hazard: ScriptedHazard): number {
  return hazard.announceAt ?? hazard.at - HAZARD_ANNOUNCE_M;
}

/** Route position at which a scripted hazard is withdrawn. */
export function dropAt(hazard: ScriptedHazard): number {
  return hazard.dropAt ?? hazard.at;
}

/** Road segment at a route position (the first one before the route, the last one after it). */
export function roadAt(position: number): RoadSegment {
  let current = ROAD_SEGMENTS[0]!;
  for (const segment of ROAD_SEGMENTS) {
    if (segment.from <= position) current = segment;
    else break;
  }
  return current;
}

/** Index of the first maneuver still ahead of `position` (ROUTE_MANEUVERS.length when none). */
export function nextManeuverIndex(position: number): number {
  const index = ROUTE_MANEUVERS.findIndex((m) => m.at > position);
  return index < 0 ? ROUTE_MANEUVERS.length : index;
}

/** The follow-up maneuver to show as "then …", if it comes right after maneuver `index`. */
export function thenManeuver(index: number): Maneuver | null {
  const current = ROUTE_MANEUVERS[index];
  const next = ROUTE_MANEUVERS[index + 1];
  if (current === undefined || next === undefined) return null;
  return next.at - current.at <= THEN_WITHIN_M ? next.maneuver : null;
}

/**
 * Remaining driving time from `position` to the arrival point, assuming 85 % of each segment's
 * speed limit, in whole seconds.
 */
export function remainingSeconds(position: number): number {
  let seconds = 0;
  ROAD_SEGMENTS.forEach((segment, i) => {
    const end = Math.min(ROAD_SEGMENTS[i + 1]?.from ?? ROUTE_LENGTH_M, ROUTE_LENGTH_M);
    const start = Math.max(segment.from, position);
    if (end <= start) return;
    seconds += (end - start) / ((segment.speedLimitKph * 0.85) / 3.6);
  });
  return Math.round(seconds);
}

/** Approximate coordinates at a route position (flat-earth steps along each segment's heading). */
export function locationAt(position: number): { lat: number; lon: number; bearingDeg: number } {
  const p = Math.max(0, position);
  let lat: number = ROUTE_ORIGIN.lat;
  let lon: number = ROUTE_ORIGIN.lon;
  let bearingDeg = ROAD_SEGMENTS[0]!.bearingDeg;
  ROAD_SEGMENTS.forEach((segment, i) => {
    const end = ROAD_SEGMENTS[i + 1]?.from ?? Infinity;
    if (p <= segment.from) return;
    const metres = Math.min(p, end) - segment.from;
    const rad = (segment.bearingDeg * Math.PI) / 180;
    lat += (metres * Math.cos(rad)) / 111_320;
    lon += (metres * Math.sin(rad)) / (111_320 * Math.cos((lat * Math.PI) / 180));
    bearingDeg = segment.bearingDeg;
  });
  return { lat, lon, bearingDeg };
}
