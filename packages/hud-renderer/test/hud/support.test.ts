import type { AlertFrame, HudFrame, WidgetFrame } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { actionForKey } from '../../src/hud/keyboard.ts';
import { readKioskParams } from '../../src/hud/kiosk.ts';
import {
  MAX_ALERT_BANNERS,
  ZONES,
  alertSeverity,
  collisionLevel,
  gridAllowed,
  groupByZone,
  planAlerts,
  visibleAlerts,
  zonePosition,
} from '../../src/hud/layout.ts';
import { SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';
import {
  MIN_BRIGHTNESS,
  clamp01,
  contentBrightness,
  cx,
  economyUnitLabel,
  gaugeTone,
  pct,
  splitDistance,
} from '../../src/hud/util.ts';

describe('layout', () => {
  it('lists the nine zones in reading order', () => {
    expect(ZONES).toHaveLength(9);
    expect(ZONES.map((z) => zonePosition(z).row)).toEqual([
      'top',
      'top',
      'top',
      'middle',
      'middle',
      'middle',
      'bottom',
      'bottom',
      'bottom',
    ]);
    expect(zonePosition('right')).toEqual({ row: 'middle', column: 'end' });
  });

  it('groups widgets by zone, keeping priority order', () => {
    const groups = groupByZone(SAMPLE_FRAMES['city-nav']!.widgets);
    expect(groups['top-left'].map((w) => w.id)).toEqual(['nav', 'eta']);
    expect(groups.left.map((w) => w.id)).toEqual(['gear', 'fuel']);
    expect(groups['bottom-right'].map((w) => w.id)).toEqual(['outsideTemp', 'clock']);
    expect(groups.top).toEqual([]);
  });

  it('sends widgets with an unknown zone to the bottom zone instead of dropping them', () => {
    const odd = {
      id: 'clock',
      zone: 'dashboard',
      epochMs: 0,
      format: '24h',
    } as unknown as WidgetFrame;
    expect(groupByZone([odd]).bottom).toEqual([odd]);
  });

  it('lets only critical alerts through while blanked', () => {
    const frame = SAMPLE_FRAMES['engine-hot']!;
    const caution = { ...frame.alerts[0]!, key: 'x', severity: 'caution' as const };
    const both: HudFrame = { ...frame, alerts: [frame.alerts[0]!, caution] };
    expect(visibleAlerts(both)).toHaveLength(2);
    expect(visibleAlerts({ ...both, blanked: true }).map((a) => a.severity)).toEqual(['critical']);
  });

  it('treats a severity from a newer server as critical, also while blanked', () => {
    const frame = SAMPLE_FRAMES['engine-hot']!;
    const odd = { ...frame.alerts[0]!, key: 'odd', severity: 'emergency' } as unknown as AlertFrame;
    expect(alertSeverity(odd)).toBe('critical');
    expect(alertSeverity({ ...odd, severity: undefined } as unknown as AlertFrame)).toBe(
      'critical',
    );
    expect(alertSeverity({ ...odd, severity: 'info' })).toBe('info');
    expect(visibleAlerts({ ...frame, blanked: true, alerts: [odd] })).toEqual([odd]);
  });

  it('draws an unknown collision level as a warning and a missing one as none', () => {
    expect(collisionLevel('warning')).toBe('warning');
    expect(collisionLevel('caution')).toBe('caution');
    expect(collisionLevel('none')).toBe('none');
    expect(collisionLevel('imminent')).toBe('warning');
    expect(collisionLevel(undefined)).toBe('none');
    expect(collisionLevel(null)).toBe('none');
    expect(collisionLevel('')).toBe('none');
  });

  it('gives every critical alert a banner and counts the rest instead of dropping them', () => {
    const alert = (key: string, severity: AlertFrame['severity']): AlertFrame => ({
      key,
      kind: 'check-engine',
      severity,
      title: key,
      detail: null,
      code: null,
      dismissible: severity !== 'critical',
    });
    expect(MAX_ALERT_BANNERS).toBe(3);
    const two = [alert('a', 'critical'), alert('b', 'caution')];
    expect(planAlerts(two)).toEqual({ shown: two, more: 0 });
    const five = [
      alert('c1', 'critical'),
      alert('c2', 'critical'),
      alert('w1', 'warning'),
      alert('w2', 'warning'),
      alert('i1', 'info'),
    ];
    expect(planAlerts(five).shown.map((a) => a.key)).toEqual(['c1', 'c2', 'w1']);
    expect(planAlerts(five).more).toBe(2);
    const criticals = ['1', '2', '3', '4'].map((k) => alert(k, 'critical'));
    expect(planAlerts([...criticals, alert('w', 'warning')])).toEqual({
      shown: criticals,
      more: 1,
    });
    expect(planAlerts([])).toEqual({ shown: [], more: 0 });
  });

  it('allows the calibration grid only while standing still or before any frame', () => {
    expect(gridAllowed('parked')).toBe(true);
    expect(gridAllowed('stopped')).toBe(true);
    expect(gridAllowed(null)).toBe(true);
    expect(gridAllowed('city')).toBe(false);
    expect(gridAllowed('highway')).toBe(false);
    expect(gridAllowed('cruising' as HudFrame['context'])).toBe(false);
  });
});

describe('util', () => {
  it('joins class names', () => {
    expect(cx('a', false, null, undefined, 'b', '')).toBe('a b');
  });

  it('clamps fractions and formats percentages', () => {
    expect([clamp01(-1), clamp01(0.3), clamp01(2), clamp01(Number.NaN)]).toEqual([0, 0.3, 1, 0]);
    expect(pct(0.4251)).toBe('42.5%');
    expect(pct(7)).toBe('100%');
  });

  it('splits pre-formatted distances', () => {
    expect(splitDistance({ value: 1.2, unit: 'km', text: '1.2 km' })).toEqual({
      value: '1.2',
      unit: 'km',
    });
    expect(splitDistance({ value: 500, unit: 'ft', text: '500ft' })).toEqual({
      value: '500',
      unit: 'ft',
    });
    expect(splitDistance({ value: 0, unit: 'm', text: 'now' })).toEqual({ value: 'now', unit: '' });
    expect(splitDistance({ value: 0, unit: 'mi', text: 'mi' })).toEqual({ value: 'mi', unit: '' });
  });

  it('labels economy units', () => {
    expect(economyUnitLabel('L/100km')).toBe('L/100 km');
    expect(economyUnitLabel('km/L')).toBe('km/L');
    expect(economyUnitLabel('mpg-us')).toBe('mpg');
    expect(economyUnitLabel('mpg-uk')).toBe('mpg');
    expect(economyUnitLabel('mi/kWh' as 'km/L')).toBe('mi/kWh');
  });

  it('maps gauge statuses to tones', () => {
    expect(['ok', 'warn', 'crit', 'unknown', 'fault'].map((s) => gaugeTone(s as 'ok'))).toEqual([
      'neutral',
      'caution',
      'critical',
      'unknown',
      'unknown',
    ]);
  });

  it('clamps content brightness to a visible minimum', () => {
    expect(MIN_BRIGHTNESS).toBe(0.05);
    expect(contentBrightness(0.6)).toBe(0.6);
    expect(contentBrightness(0)).toBe(0.05);
    expect(contentBrightness(1.4)).toBe(1);
    expect(contentBrightness(Number.NaN)).toBe(1);
  });
});

describe('actionForKey', () => {
  it('maps the kiosk keys to driver inputs', () => {
    const map = Object.fromEntries(
      [
        'Enter',
        ' ',
        'Escape',
        'Backspace',
        'ArrowLeft',
        'ArrowRight',
        'b',
        'B',
        '+',
        '=',
        '-',
        '_',
      ].map((key) => [key, actionForKey({ key })]),
    );
    expect(map).toEqual({
      Enter: 'primary',
      ' ': 'primary',
      Escape: 'secondary',
      Backspace: 'secondary',
      ArrowLeft: 'prev-page',
      ArrowRight: 'next-page',
      b: 'toggle-blank',
      B: 'toggle-blank',
      '+': 'brightness-up',
      '=': 'brightness-up',
      '-': 'brightness-down',
      _: 'brightness-down',
    });
  });

  it('ignores other keys and browser shortcuts', () => {
    expect(actionForKey({ key: 'x' })).toBeNull();
    expect(actionForKey({ key: 'ArrowUp' })).toBeNull();
    expect(actionForKey({ key: 'b', ctrlKey: true })).toBeNull();
    expect(actionForKey({ key: '+', metaKey: true })).toBeNull();
    expect(actionForKey({ key: 'Enter', altKey: true })).toBeNull();
    expect(actionForKey({ key: 'toString' })).toBeNull();
  });

  it('repeats only brightness while a key is held', () => {
    expect(actionForKey({ key: '+', repeat: true })).toBe('brightness-up');
    expect(actionForKey({ key: 'b', repeat: true })).toBeNull();
    expect(actionForKey({ key: 'Enter', repeat: true })).toBeNull();
  });
});

describe('readKioskParams', () => {
  it('reads the fixture and preview flags', () => {
    expect(readKioskParams('')).toEqual({ fixture: null, preview: false });
    expect(readKioskParams('?fixture=city-nav&preview=1')).toEqual({
      fixture: 'city-nav',
      preview: true,
    });
    expect(readKioskParams('?preview')).toEqual({ fixture: null, preview: true });
    expect(readKioskParams('?fixture=%20&preview=0')).toEqual({ fixture: null, preview: false });
    expect(readKioskParams('?preview=false').preview).toBe(false);
    expect(readKioskParams('?preview=off').preview).toBe(false);
    expect(readKioskParams('?preview=yes').preview).toBe(true);
  });
});
