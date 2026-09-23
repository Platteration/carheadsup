import type { AlertFrame } from '@carheadsup/core';
import { ALERT_GLYPHS, Glyph } from '../icons/index.ts';
import { cx, lookup } from '../util.ts';

/**
 * Secondary line of an alert. When the alert carries a DTC code that its detail text does not
 * already mention, the code is prefixed ("P0420 · Catalytic converter efficiency").
 */
export function alertDetail(alert: AlertFrame): string | null {
  const detail = alert.detail?.trim() || null;
  const code = alert.code?.trim() || null;
  if (code && detail && !detail.toUpperCase().includes(code.toUpperCase())) {
    return `${code} · ${detail}`;
  }
  return detail ?? code;
}

/** One alert banner: severity colour, an icon per alert kind; critical alerts flash. */
export function AlertBanner({ alert }: { alert: AlertFrame }) {
  const detail = alertDetail(alert);
  return (
    <div
      class={cx(
        'hud-alert',
        `hud-tone--${alert.severity}`,
        alert.severity === 'critical' && 'hud-flash',
      )}
      data-alert={alert.key}
      data-severity={alert.severity}
      role={alert.severity === 'critical' || alert.severity === 'warning' ? 'alert' : 'status'}
    >
      <Glyph name={lookup(ALERT_GLYPHS, alert.kind, 'warning')} class="hud-alert__icon" />
      <div class="hud-alert__text">
        <div class="hud-alert__title">{alert.title}</div>
        {detail && <div class="hud-alert__detail">{detail}</div>}
      </div>
    </div>
  );
}
