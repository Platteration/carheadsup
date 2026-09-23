/** Turn-by-turn maneuver kinds, modelled on OSRM / Mapbox maneuver modifiers. */
export const MANEUVER_TYPES = [
  'depart',
  'arrive',
  'arrive-left',
  'arrive-right',
  'straight',
  'slight-left',
  'left',
  'sharp-left',
  'slight-right',
  'right',
  'sharp-right',
  'uturn-left',
  'uturn-right',
  'keep-left',
  'keep-right',
  'merge-left',
  'merge-right',
  'ramp-left',
  'ramp-right',
  'exit-left',
  'exit-right',
  'fork-left',
  'fork-right',
  /** Counter-clockwise roundabout (right-hand traffic). */
  'roundabout-ccw',
  /** Clockwise roundabout (left-hand traffic). */
  'roundabout-cw',
  'ferry',
  'unknown',
] as const;

export type ManeuverType = (typeof MANEUVER_TYPES)[number];

export interface Maneuver {
  type: ManeuverType;
  /** 1-based exit number for roundabouts. */
  roundaboutExit?: number | null;
  /** Exit bearing relative to entry, degrees clockwise (0–360), for drawing roundabout arrows. */
  roundaboutAngle?: number | null;
  /** Raw instruction text from the nav source, if any (never shown while moving). */
  instruction?: string | null;
}

export const LANE_DIRECTIONS = [
  'straight',
  'slight-left',
  'left',
  'sharp-left',
  'slight-right',
  'right',
  'sharp-right',
  'uturn-left',
  'uturn-right',
  'merge-left',
  'merge-right',
] as const;

export type LaneDirection = (typeof LANE_DIRECTIONS)[number];

export interface Lane {
  /** All arrows painted on the lane. */
  directions: LaneDirection[];
  /** True when this lane can be used for the upcoming maneuver. */
  recommended: boolean;
  /** The arrow to highlight when the lane is recommended. */
  activeDirection?: LaneDirection | null;
}

export interface NavInfo {
  /** Which app produced this, e.g. "google-maps", "osmand", "simulator". */
  source: string;
  maneuver: Maneuver;
  /** Distance to the maneuver at `updatedAt`. Dead-reckoned between updates using vehicle distance. */
  distanceToManeuverM: number | null;
  /** Street the maneuver leads onto ("next street name"). */
  street: string | null;
  /** Street currently being driven on, if known. */
  currentStreet: string | null;
  /** A follow-up maneuver shown as "then …" when it comes right after the next one. */
  thenManeuver: Maneuver | null;
  lanes: Lane[] | null;
  etaEpochMs: number | null;
  remainingDistanceM: number | null;
  remainingSeconds: number | null;
  /** Base64 PNG of the nav app's own maneuver icon, used when `maneuver.type` is 'unknown'. */
  iconPng: string | null;
  /** Epoch ms when the phone sent this update. */
  updatedAt: number;
}

export type RoadClass =
  'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'residential' | 'service' | 'other';

export interface RoadInfo {
  /** Posted limit in km/h; null when unknown; 0 is never used — "no limit" (e.g. autobahn) is `unlimited`. */
  speedLimitKph: number | null;
  /** True for roads without a limit (e.g. German Autobahn "none"). */
  unlimited: boolean;
  /** Where the limit came from. */
  source: 'osm' | 'nav' | 'sign-recognition' | 'manual' | 'simulator' | null;
  roadName: string | null;
  roadClass: RoadClass | null;
  updatedAt: number;
}

export const HAZARD_TYPES = [
  'speed-camera',
  'red-light-camera',
  'section-control',
  'police',
  'accident',
  'road-works',
  'traffic-jam',
  'slowdown',
  'object-on-road',
  'weather',
  'school-zone',
  'railway-crossing',
  'other',
] as const;

export type HazardType = (typeof HAZARD_TYPES)[number];

export interface Hazard {
  id: string;
  type: HazardType;
  /** Distance ahead along the route at `updatedAt`; dead-reckoned like nav distance. */
  distanceM: number | null;
  /** Enforced limit for cameras, if known. */
  speedLimitKph: number | null;
  /** Expected delay for traffic hazards. */
  delaySeconds: number | null;
  description: string | null;
  updatedAt: number;
}
