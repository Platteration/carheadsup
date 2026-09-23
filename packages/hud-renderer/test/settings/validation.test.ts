import { DEFAULT_CONFIG, parseConfig } from '@carheadsup/core';
import type { HudConfig } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { setAt } from '../../src/settings/model/diff.ts';
import { PERCENT, driverUnits } from '../../src/settings/model/units.ts';
import {
  NO_ISSUES,
  dropIssuesTouching,
  fieldIssueFromServer,
  issuesWithin,
  parseServerErrors,
  sentence,
  validateConfig,
  wildcardIndices,
} from '../../src/settings/model/validation.ts';
import { issueText } from '../../src/settings/ui/fields.tsx';

function config(): HudConfig {
  return parseConfig(DEFAULT_CONFIG).config;
}

describe('validateConfig', () => {
  it('finds nothing wrong with the defaults', () => {
    expect(validateConfig(config())).toBe(NO_ISSUES);
  });

  it('reports range problems with the bound, so fields can phrase them in their unit', () => {
    const issues = validateConfig(setAt(config(), ['alerts', 'coolantCriticalC'], 170));
    const issue = issues.get('alerts.coolantCriticalC');
    expect(issue).toMatchObject({
      source: 'client',
      bound: { kind: 'max', value: 160, inclusive: true },
    });
    const fahrenheit = driverUnits({ ...DEFAULT_CONFIG.units, temperature: 'F' });
    expect(issueText(issue!, fahrenheit.temperature)).toBe('Must be at most 320 °F');
    expect(issueText(issue!)).toBe('Must be at most 160');
  });

  it('reports lower bounds and percent units', () => {
    const issues = validateConfig(setAt(config(), ['display', 'brightness', 'maxLevel'], 1.5));
    expect(issueText(issues.get('display.brightness.maxLevel')!, PERCENT)).toBe(
      'Must be at most 100%',
    );
    const low = validateConfig(setAt(config(), ['display', 'maxAlerts'], 0));
    expect(low.get('display.maxAlerts')).toMatchObject({ bound: { kind: 'min', value: 1 } });
  });

  it('uses friendly wording for cross-field rules', () => {
    const draft = setAt(
      setAt(config(), ['vehicle', 'idleRpm'], 2000),
      ['vehicle', 'redlineRpm'],
      1500,
    );
    expect(validateConfig(draft).get('vehicle.idleRpm')?.message).toBe(
      'Idle speed must be below the redline',
    );
    const shift = setAt(config(), ['shiftLight', 'startRpm'], 6500);
    expect(validateConfig(shift).get('shiftLight.startRpm')?.message).toBe(
      'Must be below the shift point',
    );
  });

  it('reports format, integer, enum, emptiness and array problems', () => {
    let draft = setAt(config(), ['units', 'currency'], 'euro');
    draft = setAt(draft, ['obd', 'tcpPort'], 35000.5);
    draft = setAt(draft, ['units', 'clock'], '13h');
    draft = setAt(draft, ['vehicle', 'name'], '');
    draft = setAt(draft, ['vehicle', 'gearRatiosRpmPerKph'], [100, 120]);
    draft = setAt(
      draft,
      ['obd', 'customPids'],
      [{ signal: 'oilTemp', mode: '22', pid: 'XYZ', header: null, formula: 'A', intervalMs: 1000 }],
    );
    const issues = validateConfig(draft);
    expect(issues.get('units.currency')?.message).toMatch(/^Expected a 3-letter ISO 4217 code/);
    expect(issues.get('obd.tcpPort')?.message).toBe('Must be a whole number');
    expect(issues.get('units.clock')?.message).toBe('Choose one of the options');
    expect(issues.get('vehicle.name')?.message).toBe('Must not be empty');
    expect(issues.get('vehicle.gearRatiosRpmPerKph[1]')?.message).toBe(
      'Expected ratios to decrease from 1st gear upwards',
    );
    expect(issues.get('obd.customPids[0].pid')?.message).toBe('2, 4 or 6 hex digits');
    expect(issuesWithin(issues, 'obd.customPids').map(([k]) => k)).toEqual([
      'obd.customPids[0].pid',
    ]);
  });

  it('flags a missing (NaN) number as "Enter a number"', () => {
    const issues = validateConfig(setAt(config(), ['trip', 'minDistanceKm'], Number.NaN));
    expect(issues.get('trip.minDistanceKm')?.message).toBe('Enter a number');
  });

  it('reports a folded keystone on the first corner', () => {
    const corners = { tl: [1, 1], tr: [1, 0], br: [0, 0], bl: [0, 1] };
    const issues = validateConfig(setAt(config(), ['display', 'projection', 'corners'], corners));
    expect(issues.get('display.projection.corners.tl')?.message).toBe(
      'The corners must form a convex shape',
    );
  });
});

describe('server errors', () => {
  it('splits per-field problems from general ones', () => {
    const { byPath, general } = parseServerErrors([
      'display.brightness.minLevel: expected number <= 1',
      'display.brightness.minLevel: second message is ignored',
      'obd.customPids[0].pid: expected a 2-, 4- or 6-digit hex PID such as "2A0B"',
      '(root): expected object, got array',
      'something without a path',
    ]);
    expect([...byPath.keys()]).toEqual(['display.brightness.minLevel', 'obd.customPids[0].pid']);
    expect(byPath.get('display.brightness.minLevel')).toEqual({
      source: 'server',
      message: 'Must be at most 1',
      bound: { kind: 'max', value: 1, inclusive: true },
    });
    expect(general).toEqual(['(root): expected object, got array', 'Something without a path']);
  });

  it('parses every comparison the server emits', () => {
    expect(fieldIssueFromServer('expected number < 5').bound).toEqual({
      kind: 'max',
      value: 5,
      inclusive: false,
    });
    expect(fieldIssueFromServer('expected number >= -30').bound).toEqual({
      kind: 'min',
      value: -30,
      inclusive: true,
    });
    expect(fieldIssueFromServer('expected number > 0.5').message).toBe('Must be above 0.5');
    expect(fieldIssueFromServer('minLevel must not exceed maxLevel (0.6 > 0.5)')).toEqual({
      source: 'server',
      message: 'MinLevel must not exceed maxLevel (0.6 > 0.5)',
    });
  });

  it('marks server rejections in field text', () => {
    expect(issueText(fieldIssueFromServer('expected number <= 1'), PERCENT)).toBe(
      'Not saved: must be at most 100%',
    );
  });

  it('drops issues that an edit makes obsolete (the path, its parents and children)', () => {
    const map = new Map([
      ['a.b', { source: 'server' as const, message: 'x' }],
      ['a.b.c', { source: 'server' as const, message: 'y' }],
      ['a', { source: 'server' as const, message: 'z' }],
      ['a.bc', { source: 'server' as const, message: 'w' }],
    ]);
    expect([...dropIssuesTouching(map, 'a.b').keys()]).toEqual(['a.bc']);
  });
});

describe('helpers', () => {
  it('wildcards array indices and capitalises sentences', () => {
    expect(wildcardIndices('maintenance.items[12].intervalKm')).toBe(
      'maintenance.items[].intervalKm',
    );
    expect(sentence('  hello ')).toBe('Hello');
    expect(sentence('')).toBe('');
  });
});
