import type { AlertKind, HazardType } from '@carheadsup/core';
import type { GlyphName } from './Glyph.tsx';

export { Glyph, GLYPH_NAMES, hasGlyph } from './Glyph.tsx';
export type { GlyphName, GlyphProps } from './Glyph.tsx';
export { ManeuverIcon, hasManeuverDrawing, roundaboutBearing } from './maneuver.tsx';
export type { ManeuverIconProps } from './maneuver.tsx';
export { LaneIcon, hasLaneDrawing } from './lanes.tsx';
export type { LaneIconProps } from './lanes.tsx';

/** Icon for each alert kind (compile-time exhaustive). */
export const ALERT_GLYPHS: Readonly<Record<AlertKind, GlyphName>> = {
  coolant: 'thermometer',
  voltage: 'battery',
  'check-engine': 'engine',
  'fuel-low': 'fuel',
  'maintenance-due': 'wrench',
  tpms: 'tyre',
  'ice-risk': 'snowflake',
  'forward-collision': 'collision',
  hazard: 'warning',
  'obd-link': 'link',
  'phone-link': 'phone-off',
  system: 'info',
};

/** Icon for each road hazard type (compile-time exhaustive). */
export const HAZARD_GLYPHS: Readonly<Record<HazardType, GlyphName>> = {
  'speed-camera': 'speed-camera',
  'red-light-camera': 'traffic-light',
  'section-control': 'section-control',
  police: 'police',
  accident: 'accident',
  'road-works': 'cone',
  'traffic-jam': 'traffic-jam',
  slowdown: 'slowdown',
  'object-on-road': 'object',
  weather: 'weather',
  'school-zone': 'school',
  'railway-crossing': 'railway',
  other: 'warning',
};
