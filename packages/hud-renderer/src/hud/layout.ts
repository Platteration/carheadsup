import type {
  AlertFrame,
  AlertSeverity,
  CollisionLevel,
  DrivingContext,
  HudFrame,
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

const SEVERITIES: ReadonlySet<string> = new Set<AlertSeverity>([
  'info',
  'caution',
  'warning',
  'critical',
]);

/**
 * An alert's severity for drawing. A severity this renderer does not know (from a newer server)
 * is treated as critical: over-warning is safe, showing an unknown emergency as a quiet info
 * line is not.
 */
export function alertSeverity(alert: AlertFrame): AlertSeverity {
  return typeof alert.severity === 'string' && SEVERITIES.has(alert.severity)
    ? alert.severity
    : 'critical';
}

/**
 * A frame's forward-collision level for drawing. An unknown level from a newer server (say
 * "imminent") is drawn as the strongest known one, 'warning'; a missing value means no threat.
 */
export function collisionLevel(level: unknown): CollisionLevel {
  if (level === 'none' || level === 'caution' || level === 'warning') return level;
  return typeof level === 'string' && level !== '' ? 'warning' : 'none';
}

/**
 * Alerts to draw. When the driver has blanked the display only critical alerts break through;
 * otherwise the composer's selection is shown as-is (minus entries that are not alerts at all).
 */
export function visibleAlerts(frame: HudFrame): AlertFrame[] {
  const alerts = frame.alerts.filter(
    (a): a is AlertFrame => typeof a === 'object' && a !== null && !Array.isArray(a),
  );
  return frame.blanked ? alerts.filter((a) => alertSeverity(a) === 'critical') : alerts;
}

/** At most this many alert banners are stacked; critical alerts may exceed it. */
export const MAX_ALERT_BANNERS = 3;

export interface AlertPlan {
  /** Alerts drawn as banners, in frame order (most severe first). */
  shown: AlertFrame[];
  /** Lower-priority alerts summarised as "+N more". */
  more: number;
}

/**
 * Which alerts get a banner. Every critical alert does, whatever the count; the others fill the
 * remaining room up to `maxBanners` in frame order, and the rest are counted, never silently lost.
 */
export function planAlerts(
  alerts: readonly AlertFrame[],
  maxBanners: number = MAX_ALERT_BANNERS,
): AlertPlan {
  const critical = alerts.filter((a) => alertSeverity(a) === 'critical').length;
  let room = Math.max(0, maxBanners - critical);
  const shown: AlertFrame[] = [];
  for (const alert of alerts) {
    if (alertSeverity(alert) === 'critical') shown.push(alert);
    else if (room > 0) {
      shown.push(alert);
      room -= 1;
    }
  }
  return { shown, more: alerts.length - shown.length };
}

/**
 * Whether the calibration grid may replace the HUD: only while the car is known to be standing
 * still (parked or stopped), or before any frame has told us anything. A grid left switched on
 * must never cover the speed and warnings of a moving car.
 */
export function gridAllowed(context: DrivingContext | null): boolean {
  return context === null || context === 'parked' || context === 'stopped';
}
