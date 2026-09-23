import type { ProjectionConfig } from '@carheadsup/core';
import type { ComponentChildren } from 'preact';
import { isIdentityProjection, projectionLayout, toCssMatrix3d } from './projection.ts';

export interface StageSize {
  width: number;
  height: number;
}

export interface ProjectionStageProps {
  /** Null (or an identity projection) draws the content untransformed. */
  projection: ProjectionConfig | null;
  /** Measured size of the screen area (the HUD root), or null before the first measurement. */
  size: StageSize | null;
  children: ComponentChildren;
}

/**
 * The element everything is drawn in. With a non-trivial projection it is laid out at the logical
 * (driver-perceived) size and warped onto the screen with a single `matrix3d()`; until the screen
 * has been measured it stays invisible, so a mis-projected first frame never flashes on the glass.
 */
export function ProjectionStage({ projection, size, children }: ProjectionStageProps) {
  if (projection === null || isIdentityProjection(projection)) {
    return <div class="hud-stage">{children}</div>;
  }
  if (size === null || size.width <= 0 || size.height <= 0) {
    return (
      <div class="hud-stage" style={{ visibility: 'hidden' }} data-projection="pending">
        {children}
      </div>
    );
  }
  const layout = projectionLayout(projection, size.width, size.height);
  return (
    <div
      class="hud-stage hud-stage--projected"
      data-projection="applied"
      style={{
        width: `${layout.width}px`,
        height: `${layout.height}px`,
        transform: toCssMatrix3d(layout.matrix),
      }}
    >
      {children}
    </div>
  );
}
