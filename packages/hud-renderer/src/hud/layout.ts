import type {
  AlertFrame,
  HudFrame,
  SpeedLimitSignStyle,
  WidgetFrame,
  Zone,
} from '@carheadsup/core';

/** The 3×3 zones in reading order (row by row). */
export const ZONES: readonly Zone[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
];

export type ZoneColumn = 'start' | 'center' | 'end';
export type ZoneRow = 'top' | 'middle' | 'bottom';

const ZONE_POSITION: Record<Zone, { row: ZoneRow; column: ZoneColumn }> = {
  'top-left': { row: 'top', column: 'start' },
  top: { row: 'top', column: 'center' },
  'top-right': { row: 'top', column: 'end' },
  left: { row: 'middle', column: 'start' },
  center: { row: 'middle', column: 'center' },
  right: { row: 'middle', column: 'end' },
  'bottom-left': { row: 'bottom', column: 'start' },
  bottom: { row: 'bottom', column: 'center' },
  'bottom-right': { row: 'bottom', column: 'end' },
};

export function zonePosition(zone: Zone): { row: ZoneRow; column: ZoneColumn } {
  return ZONE_POSITION[zone];
}

function isZone(value: string): value is Zone {
  return Object.prototype.hasOwnProperty.call(ZONE_POSITION, value);
}

/**
 * Group widgets by zone, preserving frame order (priority order) inside each zone. Widgets with
 * an unrecognised zone (e.g. from a newer server) fall back to the centre column's bottom zone
 * rather than disappearing silently.
 */
export function groupByZone(widgets: readonly WidgetFrame[]): Record<Zone, WidgetFrame[]> {
  const groups = Object.fromEntries(ZONES.map((z) => [z, [] as WidgetFrame[]])) as Record<
    Zone,
    WidgetFrame[]
  >;
  for (const widget of widgets) {
    const zone = isZone(widget.zone) ? widget.zone : 'bottom';
    groups[zone].push(widget);
  }
  return groups;
}

/**
 * Alerts to draw. When the driver has blanked the display only critical alerts break through;
 * otherwise the composer's selection is shown as-is.
 */
export function visibleAlerts(frame: HudFrame): AlertFrame[] {
  return frame.blanked ? frame.alerts.filter((a) => a.severity === 'critical') : frame.alerts;
}

/**
 * Sign style for small inline limits (e.g. a speed camera's enforced limit). Hazard frames do not
 * carry it, so it is taken from the frame's speed-limit widget, defaulting to the Vienna ring.
 */
export function signStyleOf(frame: HudFrame): SpeedLimitSignStyle {
  for (const w of frame.widgets) {
    if (w.id === 'speedLimit') return w.style;
  }
  return 'vienna';
}
