import { DEFAULT_CONFIG } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import {
  MINUTES_FROM_MS,
  PERCENT,
  SECONDS_FROM_MS,
  describeBound,
  driverUnits,
  formatForInput,
  parseNumberText,
  plainUnit,
  textMatchesValue,
  toCanonical,
} from '../../src/settings/model/units.ts';

const metric = driverUnits(DEFAULT_CONFIG.units);
const us = driverUnits({
  ...DEFAULT_CONFIG.units,
  system: 'imperial',
  temperature: 'F',
  pressure: 'psi',
});

describe('parseNumberText', () => {
  it('accepts plain, signed, decimal and exponent numbers', () => {
    expect(parseNumberText('42')).toEqual({ ok: true, value: 42 });
    expect(parseNumberText('  -3.5 ')).toEqual({ ok: true, value: -3.5 });
    expect(parseNumberText('+7')).toEqual({ ok: true, value: 7 });
    expect(parseNumberText('.5')).toEqual({ ok: true, value: 0.5 });
    expect(parseNumberText('12.')).toEqual({ ok: true, value: 12 });
    expect(parseNumberText('1e3')).toEqual({ ok: true, value: 1000 });
  });

  it('accepts a decimal comma and typographic minus signs', () => {
    expect(parseNumberText('12,5')).toEqual({ ok: true, value: 12.5 });
    expect(parseNumberText('−4')).toEqual({ ok: true, value: -4 });
    expect(parseNumberText('–2,5')).toEqual({ ok: true, value: -2.5 });
  });

  it('refuses thousands separators instead of reading them as a decimal comma', () => {
    const error = 'Leave out the thousands separator (decimals: 1.5 or 1,5)';
    for (const text of ['48,210', '10,000', '1,500', '-1,500', '1,234,567', '12,345.6']) {
      expect(parseNumberText(text), text).toEqual({ ok: false, error });
    }
    // Still a decimal comma: not three digits after it, or a leading zero.
    expect(parseNumberText('1,5')).toEqual({ ok: true, value: 1.5 });
    expect(parseNumberText('12,50')).toEqual({ ok: true, value: 12.5 });
    expect(parseNumberText('0,125')).toEqual({ ok: true, value: 0.125 });
    expect(parseNumberText('1,5000')).toEqual({ ok: true, value: 1.5 });
  });

  it('rejects everything else', () => {
    for (const text of [
      'abc',
      '1,234,5',
      '1.2.3',
      '1,5.2',
      '--1',
      '12 km',
      '0x10',
      'Infinity',
      '1e999',
    ]) {
      expect(parseNumberText(text)).toEqual({ ok: false, error: 'Enter a number' });
    }
  });

  it('handles empty input and whole-number fields', () => {
    expect(parseNumberText('')).toEqual({ ok: false, error: 'Required' });
    expect(parseNumberText('  ', { allowEmpty: true })).toEqual({ ok: true, value: null });
    expect(parseNumberText('3.5', { integer: true })).toEqual({
      ok: false,
      error: 'Enter a whole number',
    });
    expect(parseNumberText('3', { integer: true })).toEqual({ ok: true, value: 3 });
  });
});

describe('unit conversion', () => {
  it('converts display values to canonical ones and back', () => {
    expect(toCanonical(230, us.temperature)).toBeCloseTo(110, 6);
    expect(formatForInput(110, us.temperature)).toBe('230');
    expect(toCanonical(65, us.speed)).toBeCloseTo(104.60736, 4);
    expect(formatForInput(80, us.speed)).toBe('50');
    expect(toCanonical(26, us.pressure)).toBeCloseTo(179.26, 1);
    expect(formatForInput(180, us.pressure)).toBe('26.1');
    expect(
      formatForInput(180, driverUnits({ ...DEFAULT_CONFIG.units, pressure: 'bar' }).pressure),
    ).toBe('1.8');
    expect(formatForInput(1000, us.shortDistance)).toBe('3281');
    expect(formatForInput(8000, us.distance)).toBe('4971');
    expect(formatForInput(110, metric.temperature)).toBe('110');
  });

  it('treats temperature differences as scale-only', () => {
    expect(formatForInput(3, us.temperatureDelta)).toBe('5.4');
    expect(toCanonical(9, us.temperatureDelta)).toBeCloseTo(5, 6);
  });

  it('rounds integer fields after conversion and trims float noise elsewhere', () => {
    expect(toCanonical(1.25, SECONDS_FROM_MS, true)).toBe(1250);
    expect(toCanonical(5, MINUTES_FROM_MS, true)).toBe(300_000);
    expect(toCanonical(30, PERCENT)).toBe(0.3);
    expect(formatForInput(0.3, PERCENT)).toBe('30');
    expect(formatForInput(5000, SECONDS_FROM_MS)).toBe('5');
    expect(formatForInput(400, SECONDS_FROM_MS)).toBe('0.4');
  });

  it('formats missing values as empty text and never prints -0', () => {
    expect(formatForInput(null, plainUnit('V'))).toBe('');
    expect(formatForInput(Number.NaN, plainUnit('V'))).toBe('');
    expect(formatForInput(-0.0001, plainUnit('V'))).toBe('0');
  });
});

describe('textMatchesValue', () => {
  it('recognises partial typing that already equals the value', () => {
    expect(textMatchesValue('12.', 12, plainUnit(''))).toBe(true);
    expect(textMatchesValue('12,0', 12, plainUnit(''))).toBe(true);
    expect(textMatchesValue('231', 110.555556, us.temperature)).toBe(true);
    expect(textMatchesValue('', null, plainUnit(''))).toBe(true);
  });

  it('detects outside changes', () => {
    expect(textMatchesValue('12', 13, plainUnit(''))).toBe(false);
    expect(textMatchesValue('abc', 1, plainUnit(''))).toBe(false);
    expect(textMatchesValue('', 3, plainUnit(''))).toBe(false);
    expect(textMatchesValue('110', 110, us.temperature)).toBe(false);
  });
});

describe('describeBound', () => {
  it('phrases limits in the display unit', () => {
    expect(describeBound({ kind: 'max', value: 150, inclusive: true }, us.temperature)).toBe(
      'Must be at most 302 °F',
    );
    expect(describeBound({ kind: 'min', value: 0.5, inclusive: true }, metric.speed)).toBe(
      'Must be at least 0.5 km/h',
    );
    expect(describeBound({ kind: 'min', value: 0, inclusive: false }, plainUnit(''))).toBe(
      'Must be above 0',
    );
    expect(describeBound({ kind: 'max', value: 1, inclusive: false }, PERCENT)).toBe(
      'Must be below 100%',
    );
  });
});
