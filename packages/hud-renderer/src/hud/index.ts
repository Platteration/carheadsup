/**
 * Public surface of the projected HUD for the other renderer pages (dev console, settings).
 * The kiosk entry (`main-hud.tsx`) imports modules directly so its bundle stays free of the
 * sample fixtures.
 */
export { HudView } from './HudView.tsx';
export type { HudViewProps } from './HudView.tsx';
export { SAMPLE_FRAMES, SAMPLE_FRAME_NAMES, FIXTURE_TIME } from './fixtures.ts';
export { AlignmentGrid } from './overlays/AlignmentGrid.tsx';
export {
  applyToPoint,
  homographyFromQuads,
  isIdentityProjection,
  keystoneMatrix,
  projectionLayout,
  toCssMatrix3d,
} from './projection.ts';
export type { Mat3, ProjectionLayout, Quad, Vec2 } from './projection.ts';
export { actionForKey } from './keyboard.ts';
