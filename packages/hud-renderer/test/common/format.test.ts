import { describe, expect, it } from 'vitest';
import {
  MINUS,
  MISSING,
  formatClock,
  formatClockText,
  formatCurrency,
  formatDelay,
  formatDurationS,
  formatMinutes,
  formatNumber,
  formatSigned,
  formatTimer,
} from '../../src/common/format.ts';

/** Epoch ms for a local wall-clock time, so the tests pass in any time zone. */
const local = (h: number, m: number) => new Date(2026, 4, 14, h, m).getTime();

describe('formatClock', () => {
  it('formats 24-hour time with leading zeros', () => {
    expect(formatClock(local(0, 5), '24h')).toEqual({ time: '00:05', suffix: null });
    expect(formatClock(local(15, 42), '24h')).toEqual({ time: '15:42', suffix: null });
  });

  it('formats 12-hour time with AM/PM, including midnight and noon', () => {
    expect(formatClock(local(0, 5), '12h')).toEqual({ time: '12:05', suffix: 'AM' });
    expect(formatClock(local(12, 30), '12h')).toEqual({ time: '12:30', suffix: 'PM' });
    expect(formatClock(local(23, 59), '12h')).toEqual({ time: '11:59', suffix: 'PM' });
    expect(formatClock(local(9, 7), '12h')).toEqual({ time: '9:07', suffix: 'AM' });
  });

  it('joins the parts for plain text', () => {
    expect(formatClockText(local(15, 42), '12h')).toBe('3:42 PM');
    expect(formatClockText(local(15, 42), '24h')).toBe('15:42');
  });
});

describe('formatTimer', () => {
  it('shows m:ss below an hour and h:mm:ss above', () => {
    expect(formatTimer(0)).toBe('0:00');
    expect(formatTimer(7)).toBe('0:07');
    expect(formatTimer(754)).toBe('12:34');
    expect(formatTimer(3723)).toBe('1:02:03');
    expect(formatTimer(59.9)).toBe('0:59');
  });

  it('clamps negative and non-finite input', () => {
    expect(formatTimer(-5)).toBe('0:00');
    expect(formatTimer(Number.NaN)).toBe('0:00');
  });
});

describe('formatDelay', () => {
  it('signs traffic delays, in whole hours from 100 minutes', () => {
    expect(formatDelay(7)).toBe('+7 min');
    expect(formatDelay(12.4)).toBe('+12 min');
    expect(formatDelay(65)).toBe('+65 min');
    expect(formatDelay(99)).toBe('+99 min');
    expect(formatDelay(100)).toBe('+2 h');
    expect(formatDelay(125)).toBe('+2 h');
    expect(formatDelay(150)).toBe('+3 h');
    expect(formatDelay(Number.NaN)).toBe('+0 min');
  });
});

describe('formatMinutes / formatDurationS', () => {
  it('uses minutes below an hour and h + padded minutes above', () => {
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h 00 min');
    expect(formatMinutes(125)).toBe('2 h 05 min');
    expect(formatMinutes(44.6)).toBe('45 min');
  });

  it('clamps negative and non-finite input', () => {
    expect(formatMinutes(-3)).toBe('0 min');
    expect(formatMinutes(Number.POSITIVE_INFINITY)).toBe('0 min');
  });

  it('converts seconds', () => {
    expect(formatDurationS(3120)).toBe('52 min');
    expect(formatDurationS(3720)).toBe('1 h 02 min');
  });
});

describe('formatNumber', () => {
  it('applies fixed decimals', () => {
    expect(formatNumber(6.8, 1)).toBe('6.8');
    expect(formatNumber(7, 1)).toBe('7.0');
    expect(formatNumber(42)).toBe('42');
    expect(formatNumber(41.6)).toBe('42');
  });

  it('uses a typographic minus and never prints negative zero', () => {
    expect(formatNumber(-0.4, 1)).toBe(`${MINUS}0.4`);
    expect(formatNumber(-0.04, 1)).toBe('0.0');
    expect(formatNumber(-0)).toBe('0');
  });

  it('groups thousands with a thin space only from five digits', () => {
    expect(formatNumber(6210)).toBe('6210');
    expect(formatNumber(12420)).toBe('12\u2009420');
    expect(formatNumber(1234567.5, 1)).toBe('1\u2009234\u2009567.5');
    expect(formatNumber(-56210)).toBe(`${MINUS}56\u2009210`);
  });

  it('shows a dash for missing values', () => {
    expect(formatNumber(null)).toBe(MISSING);
    expect(formatNumber(undefined)).toBe(MISSING);
    expect(formatNumber(Number.NaN)).toBe(MISSING);
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe(MISSING);
  });
});

describe('formatSigned', () => {
  it('signs non-zero values only', () => {
    expect(formatSigned(0.92, 2)).toBe('+0.92');
    expect(formatSigned(-0.4, 1)).toBe(`${MINUS}0.4`);
    expect(formatSigned(0, 1)).toBe('0.0');
    expect(formatSigned(0.001, 1)).toBe('0.0');
    expect(formatSigned(null)).toBe(MISSING);
  });
});

describe('formatCurrency', () => {
  it('formats known currencies', () => {
    expect(formatCurrency(5.58, 'EUR')).toBe('€5.58');
    expect(formatCurrency(12, 'USD')).toBe('$12.00');
  });

  it('falls back for codes the runtime rejects', () => {
    expect(formatCurrency(5.58, 'not-a-code')).toBe('5.58 not-a-code');
  });

  it('shows a dash for non-finite values', () => {
    expect(formatCurrency(Number.NaN, 'EUR')).toBe(MISSING);
  });
});
