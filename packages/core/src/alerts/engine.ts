import { ALERT_SEVERITY_RANK } from '../types/alerts.ts';
import type { Alert } from '../types/alerts.ts';
import type { HudConfig } from '../types/config.ts';
import type { HudState } from '../types/state.ts';
import { ALERT_RULES, type AlertSpec, type RuleContext } from './rules.ts';

/**
 * Re-evaluate all alert conditions against `state` (whose `alerts` are the previous alerts)
 * and return the new alert list. Keeps `raisedAt` / `dismissedAt` for alerts that persist,
 * applies hysteresis when clearing threshold alerts, drops expired transient alerts, and
 * re-raises (un-dismisses) an alert whose severity escalates.
 *
 * Returns `state.alerts` itself when nothing changed, and reuses unchanged alert objects, so
 * callers can detect changes by reference. `updatedAt` moves only when an alert changes.
 * Critical alerts are never dismissible (and never stay dismissed).
 */
export function evaluateAlerts(state: HudState, config: HudConfig): Alert[] {
  const previous = new Map<string, Alert>();
  for (const alert of state.alerts) previous.set(alert.key, alert);

  const ctx: RuleContext = {
    state,
    config,
    now: state.now,
    previous: (key) => previous.get(key),
  };
  const next: Alert[] = [];
  const seen = new Set<string>();
  for (const rule of ALERT_RULES) {
    for (const spec of rule(ctx)) {
      if (seen.has(spec.key)) continue;
      seen.add(spec.key);
      next.push(materialise(spec, spec.renew ? undefined : previous.get(spec.key), state.now));
    }
  }
  return sameAlerts(state.alerts, next) ? state.alerts : next;
}

function materialise(spec: AlertSpec, prev: Alert | undefined, now: number): Alert {
  const dismissible = spec.severity !== 'critical';
  if (prev === undefined) {
    return {
      key: spec.key,
      kind: spec.kind,
      severity: spec.severity,
      title: spec.title,
      detail: spec.detail,
      code: spec.code,
      raisedAt: spec.raisedAt ?? now,
      updatedAt: now,
      expiresAt: spec.expiresAt ?? null,
      dismissible,
      dismissedAt: null,
    };
  }
  const escalated = ALERT_SEVERITY_RANK[spec.severity] > ALERT_SEVERITY_RANK[prev.severity];
  const raisedAt = spec.raisedAt ?? (escalated ? now : prev.raisedAt);
  const dismissedAt = escalated || !dismissible ? null : prev.dismissedAt;
  const expiresAt = spec.expiresAt !== undefined ? spec.expiresAt : prev.expiresAt;
  if (
    prev.kind === spec.kind &&
    prev.severity === spec.severity &&
    prev.title === spec.title &&
    prev.detail === spec.detail &&
    prev.code === spec.code &&
    prev.raisedAt === raisedAt &&
    prev.expiresAt === expiresAt &&
    prev.dismissible === dismissible &&
    prev.dismissedAt === dismissedAt
  ) {
    return prev;
  }
  return {
    key: spec.key,
    kind: spec.kind,
    severity: spec.severity,
    title: spec.title,
    detail: spec.detail,
    code: spec.code,
    raisedAt,
    updatedAt: now,
    expiresAt,
    dismissible,
    dismissedAt,
  };
}

function sameAlerts(a: readonly Alert[], b: readonly Alert[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Mark the alert under `key` as dismissed at `at` (no-op for unknown keys, non-dismissible or
 * already dismissed alerts). Returns `alerts` itself when nothing changed.
 */
export function dismissAlert(alerts: Alert[], key: string, at: number): Alert[] {
  const index = alerts.findIndex((a) => a.key === key);
  const alert = alerts[index];
  if (alert === undefined || !alert.dismissible || alert.dismissedAt !== null) return alerts;
  const next = alerts.slice();
  next[index] = { ...alert, dismissedAt: at, updatedAt: at };
  return next;
}
