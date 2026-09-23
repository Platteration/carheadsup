import { describe, expect, it } from 'vitest';
import {
  compareAlerts,
  isAlertLive,
  isAlertShownInContext,
  selectDisplayedAlerts,
} from '../../src/alerts/visibility.ts';
import type { Alert } from '../../src/types/alerts.ts';
import { T0, makeConfig } from '../state/fixtures.ts';

function alert(overrides: Partial<Alert> & Pick<Alert, 'key' | 'kind' | 'severity'>): Alert {
  return {
    title: overrides.key.toUpperCase(),
    detail: null,
    code: null,
    raisedAt: T0,
    updatedAt: T0,
    expiresAt: null,
    dismissible: overrides.severity !== 'critical',
    dismissedAt: null,
    ...overrides,
  };
}

describe('isAlertLive', () => {
  it('excludes dismissed, scheduled and expired alerts', () => {
    const base = alert({ key: 'a', kind: 'coolant', severity: 'warning' });
    expect(isAlertLive(base, T0)).toBe(true);
    expect(isAlertLive({ ...base, dismissedAt: T0 }, T0 + 1)).toBe(false);
    expect(isAlertLive({ ...base, raisedAt: T0 + 10 }, T0 + 9)).toBe(false);
    expect(isAlertLive({ ...base, raisedAt: T0 + 10 }, T0 + 10)).toBe(true);
    expect(isAlertLive({ ...base, expiresAt: T0 + 10 }, T0 + 9)).toBe(true);
    expect(isAlertLive({ ...base, expiresAt: T0 + 10 }, T0 + 10)).toBe(false);
  });
});

describe('isAlertShownInContext', () => {
  const config = makeConfig();

  it('shows everything at rest', () => {
    for (const context of ['parked', 'stopped'] as const) {
      expect(
        isAlertShownInContext(
          alert({ key: 'm', kind: 'maintenance-due', severity: 'info' }),
          context,
          config,
        ),
      ).toBe(true);
      expect(
        isAlertShownInContext(
          alert({ key: 'o', kind: 'obd-link', severity: 'info' }),
          context,
          config,
        ),
      ).toBe(true);
      expect(
        isAlertShownInContext(
          alert({ key: 'c', kind: 'check-engine', severity: 'caution' }),
          context,
          config,
        ),
      ).toBe(true);
    }
  });

  it('holds back maintenance, link notices and minor trouble codes while moving', () => {
    for (const context of ['city', 'highway'] as const) {
      expect(
        isAlertShownInContext(
          alert({ key: 'm', kind: 'maintenance-due', severity: 'caution' }),
          context,
          config,
        ),
      ).toBe(false);
      expect(
        isAlertShownInContext(
          alert({ key: 'o', kind: 'obd-link', severity: 'info' }),
          context,
          config,
        ),
      ).toBe(false);
      expect(
        isAlertShownInContext(
          alert({ key: 'c', kind: 'check-engine', severity: 'info' }),
          context,
          config,
        ),
      ).toBe(false);
      expect(
        isAlertShownInContext(
          alert({ key: 'c', kind: 'check-engine', severity: 'caution' }),
          context,
          config,
        ),
      ).toBe(false);
      expect(
        isAlertShownInContext(
          alert({ key: 'c', kind: 'check-engine', severity: 'warning' }),
          context,
          config,
        ),
      ).toBe(true);
      expect(
        isAlertShownInContext(
          alert({ key: 'f', kind: 'fuel-low', severity: 'caution' }),
          context,
          config,
        ),
      ).toBe(true);
    }
  });

  it('shows minor trouble codes while moving when configured to', () => {
    const config = makeConfig({ alerts: { showDtcWhileDriving: true } });
    expect(
      isAlertShownInContext(
        alert({ key: 'c', kind: 'check-engine', severity: 'info' }),
        'highway',
        config,
      ),
    ).toBe(true);
  });
});

describe('selectDisplayedAlerts', () => {
  const alerts: Alert[] = [
    alert({ key: 'fuel-low', kind: 'fuel-low', severity: 'caution', raisedAt: T0 }),
    alert({ key: 'tpms', kind: 'tpms', severity: 'warning', raisedAt: T0 + 1 }),
    alert({ key: 'coolant', kind: 'coolant', severity: 'critical', raisedAt: T0 + 2 }),
    alert({ key: 'ice-risk', kind: 'ice-risk', severity: 'caution', raisedAt: T0 + 3 }),
    alert({ key: 'gone', kind: 'fuel-low', severity: 'critical', dismissedAt: T0 }),
  ];

  it('sorts by severity then recency and caps at maxAlerts', () => {
    const config = makeConfig({ display: { maxAlerts: 3 } });
    const shown = selectDisplayedAlerts(
      alerts,
      { now: T0 + 10, context: 'city', blanked: false },
      config,
    );
    expect(shown.map((a) => a.key)).toEqual(['coolant', 'tpms', 'ice-risk']);
  });

  it('passes only critical alerts while blanked', () => {
    const shown = selectDisplayedAlerts(
      alerts,
      { now: T0 + 10, context: 'city', blanked: true },
      makeConfig(),
    );
    expect(shown.map((a) => a.key)).toEqual(['coolant']);
  });

  it('orders ties by key for stability', () => {
    const a = alert({ key: 'a', kind: 'tpms', severity: 'warning' });
    const b = alert({ key: 'b', kind: 'tpms', severity: 'warning' });
    expect([b, a].sort(compareAlerts).map((x) => x.key)).toEqual(['a', 'b']);
  });
});
