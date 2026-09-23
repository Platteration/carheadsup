import type { AlertFrame } from '@carheadsup/core';
import { BLINK_PERIOD_MS, useBlinkPhase } from '../flash.ts';
import { ALERT_GLYPHS, Glyph } from '../icons/index.ts';
import { alertSeverity } from '../layout.ts';
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

/**
 * One alert banner: severity colour, an icon per alert kind; critical alerts flash (an unknown
 * severity from a newer server is drawn as critical).
 */
export function AlertBanner({ alert }: { alert: AlertFrame }) {
  const detail = alertDetail(alert);
  const severity = alertSeverity(alert);
  const phase = useBlinkPhase(BLINK_PERIOD_MS, severity === 'critical');
  return (
    <div
      class={cx('hud-alert', `hud-tone--${severity}`, severity === 'critical' && 'hud-flash')}
      style={phase}
      data-alert={alert.key}
      data-severity={severity}
      role={severity === 'critical' || severity === 'warning' ? 'alert' : 'status'}
    >
      <Glyph name={lookup(ALERT_GLYPHS, alert.kind, 'warning')} class="hud-alert__icon" />
      <div class="hud-alert__text">
        <div class="hud-alert__title">{alert.title}</div>
        {detail && <div class="hud-alert__detail">{detail}</div>}
      </div>
    </div>
  );
}
