export type AlertSeverity = 'info' | 'caution' | 'warning' | 'critical';

export const ALERT_SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  caution: 1,
  warning: 2,
  critical: 3,
};

export type AlertKind =
  | 'coolant' // coolant temperature out of range
  | 'voltage' // battery / charging voltage out of range
  | 'check-engine' // a DTC is present (one alert per code)
  | 'fuel-low'
  | 'maintenance-due'
  | 'tpms' // tyre pressure low
  | 'ice-risk' // outside temperature near freezing
  | 'forward-collision'
  | 'hazard' // road hazard ahead (camera, accident …)
  | 'obd-link' // OBD adapter disconnected / failing
  | 'phone-link'
  | 'system';

export interface Alert {
  /** Stable dedupe key, e.g. "check-engine:P0420" or "coolant". */
  key: string;
  kind: AlertKind;
  severity: AlertSeverity;
  /** Glanceable title, ≤ 24 characters, e.g. "ENGINE HOT". */
  title: string;
  /** Secondary line, e.g. "P0420 – Catalytic converter efficiency". */
  detail: string | null;
  /** DTC code for check-engine alerts. */
  code: string | null;
  raisedAt: number;
  updatedAt: number;
  /** Auto-clear time for transient alerts, or null for condition-driven alerts. */
  expiresAt: number | null;
  /** Whether the driver can dismiss it (critical alerts cannot). */
  dismissible: boolean;
  /** Epoch ms when dismissed; dismissed alerts stay in state (for hysteresis) but are not displayed. */
  dismissedAt: number | null;
}
