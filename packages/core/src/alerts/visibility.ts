import { ALERT_SEVERITY_RANK } from '../types/alerts.ts';
import type { Alert, AlertKind } from '../types/alerts.ts';
import type { DrivingContext, HudConfig } from '../types/config.ts';

/**
 * Alerts stay in `HudState.alerts` for bookkeeping even when they are not shown:
 *  - dismissed by the driver (kept so hysteresis does not re-raise them),
 *  - scheduled — `raisedAt` in the future: the condition must persist until then (debounce),
 *  - expired transient alerts kept as a latch until their re-arm condition is met.
 * Only "live" alerts are candidates for display.
 */
export function isAlertLive(alert: Alert, now: number): boolean {
  return (
    alert.dismissedAt === null &&
    alert.raisedAt <= now &&
    (alert.expiresAt === null || now < alert.expiresAt)
  );
}

/** Alert kinds that are detail for when the vehicle is at rest, not for the moving driver. */
const AT_REST_ONLY_KINDS: ReadonlySet<AlertKind> = new Set(['maintenance-due', 'obd-link']);

const isMoving = (context: DrivingContext): boolean => context === 'city' || context === 'highway';

/**
 * Driver-distraction filter: while moving, maintenance and OBD-link notices wait until the
 * vehicle stops, and check-engine alerts below 'warning' are hidden unless
 * `alerts.showDtcWhileDriving` is set.
 */
export function isAlertShownInContext(
  alert: Alert,
  context: DrivingContext,
  config: HudConfig,
): boolean {
  if (!isMoving(context)) return true;
  if (AT_REST_ONLY_KINDS.has(alert.kind)) return false;
  if (alert.kind === 'check-engine' && !config.alerts.showDtcWhileDriving) {
    return ALERT_SEVERITY_RANK[alert.severity] >= ALERT_SEVERITY_RANK.warning;
  }
  return true;
}

/** Most severe first, then most recently raised, then by key for a stable order. */
export function compareAlerts(a: Alert, b: Alert): number {
  return (
    ALERT_SEVERITY_RANK[b.severity] - ALERT_SEVERITY_RANK[a.severity] ||
    b.raisedAt - a.raisedAt ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

/**
 * The alerts the driver sees, in display order: live, allowed in the current context, sorted by
 * {@link compareAlerts} and capped at `display.maxAlerts` — except that every critical alert is
 * shown, however many there are (they cannot be dismissed either); less severe ones fill the
 * room the critical ones leave. While the display is blanked only critical alerts break through.
 */
export function selectDisplayedAlerts(
  alerts: readonly Alert[],
  options: { now: number; context: DrivingContext; blanked: boolean },
  config: HudConfig,
): Alert[] {
  const { now, context, blanked } = options;
  const limit = Math.max(0, config.display.maxAlerts);
  // Sorted most severe first, so the critical alerts come before everything they displace.
  return alerts
    .filter(
      (a) =>
        isAlertLive(a, now) &&
        isAlertShownInContext(a, context, config) &&
        (!blanked || a.severity === 'critical'),
    )
    .sort(compareAlerts)
    .filter((a, index) => a.severity === 'critical' || index < limit);
}
