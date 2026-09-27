import type { CollisionLevel, WidgetFrame } from '@carheadsup/core';

export type HudLayout = 'configured' | 'apex';
export type GlowDirection = 'left' | 'right' | 'front' | 'rear';
export type GlowSeverity = Exclude<CollisionLevel, 'none'>;
export interface DirectionalWarnings {
  left: boolean;
  right: boolean;
  front: CollisionLevel;
  /** Rendering contract only. The current live HudFrame has no rear-collision input. */
  rear?: CollisionLevel;
}
export interface Glow {
  direction: GlowDirection;
  severity: GlowSeverity;
  label: string;
}

/** Unknown URL values retain the existing configured layout. No persisted vehicle settings. */
export function readHudLayout(search: string): HudLayout {
  return new URLSearchParams(search).get('layout') === 'apex' ? 'apex' : 'configured';
}

/** Pure presentation mapping. Never infer a threat from speed, gear, navigation or OBD data. */
export function directionalGlows(input: DirectionalWarnings): Glow[] {
  const glows: Glow[] = [];
  if (input.left === true) {
    glows.push({ direction: 'left', severity: 'caution', label: 'Vehicle in left blind spot' });
  }
  if (input.right === true) {
    glows.push({ direction: 'right', severity: 'caution', label: 'Vehicle in right blind spot' });
  }
  for (const direction of ['front', 'rear'] as const) {
    const severity = input[direction];
    if (severity === 'caution' || severity === 'warning') {
      glows.push({ direction, severity, label: `${direction === 'front' ? 'Front' : 'Rear'} collision ${severity}` });
    }
  }
  return glows;
}

/** Keep fault-bearing widgets even when quiet informational widgets are omitted. */
export function isApexNotice(w: WidgetFrame): boolean {
  switch (w.id) {
    case 'coolant':
    case 'voltage':
    case 'hazard':
      return true;
    case 'tpms':
      return w.anyLow;
    case 'fuel':
      return w.low;
    case 'outsideTemp':
      return w.iceRisk;
    default:
      return false;
  }
}

/** Use only widgets composed by the core, already fresh and in display units. */
export function selectApexWidgets(widgets: readonly WidgetFrame[]) {
  return {
    speed: widgets.find((w) => w.id === 'speed'),
    nav: widgets.find((w) => w.id === 'nav'),
    limit: widgets.find((w) => w.id === 'speedLimit'),
    rpm: widgets.find((w) => w.id === 'tachometer'),
    gear: widgets.find((w) => w.id === 'gear'),
    notices: widgets.filter(isApexNotice),
  };
}
