import type { ClockFormat } from '@carheadsup/core';

/**
 * Presentation-only formatting. Frames arrive already converted to the driver's units and
 * rounded, so these helpers only turn numbers into glanceable strings — no unit conversion.
 */

/** Typographic minus (U+2212): as wide as the plus sign and centred on the digits, unlike '-'. */
export const MINUS = '\u2212';
/** Shown in place of a missing value (en dash). */
export const MISSING = '\u2013';
/** Thin space (U+2009) used as the thousands separator. */
const THIN_SPACE = '\u2009';

export interface ClockParts {
  /** "14:05" or "2:05". */
  time: string;
  /** "AM" / "PM" for 12-hour clocks, else null. */
  suffix: 'AM' | 'PM' | null;
}

/** Local wall-clock time of `epochMs` in the given format. */
export function formatClock(epochMs: number, format: ClockFormat): ClockParts {
  const date = new Date(epochMs);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  if (format === '24h') {
    return { time: `${String(hours).padStart(2, '0')}:${minutes}`, suffix: null };
  }
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return { time: `${h12}:${minutes}`, suffix: hours < 12 ? 'AM' : 'PM' };
}

/** `formatClock` as a single string, e.g. "2:05 PM". */
export function formatClockText(epochMs: number, format: ClockFormat): string {
  const { time, suffix } = formatClock(epochMs, format);
  return suffix ? `${time} ${suffix}` : time;
}

/** Call timer: "0:07", "12:34", "1:02:03". Negative or non-finite input shows "0:00". */
export function formatTimer(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = String(s % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** Remaining time for ETA / trip durations: "45 min", "1 h 05 min", "0 min". */
export function formatMinutes(totalMinutes: number): string {
  const m = Number.isFinite(totalMinutes) ? Math.max(0, Math.round(totalMinutes)) : 0;
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  return `${hours} h ${String(m % 60).padStart(2, '0')} min`;
}

/**
 * A traffic delay, signed and short enough for the hazard widget next to the distance: "+8 min",
 * "+95 min", and whole hours from 100 minutes ("+2 h").
 */
export function formatDelay(totalMinutes: number): string {
  const m = Number.isFinite(totalMinutes) ? Math.max(0, Math.round(totalMinutes)) : 0;
  return m < 100 ? `+${m} min` : `+${Math.round(m / 60)} h`;
}

/** `formatMinutes` for a duration in seconds (rounded to whole minutes). */
export function formatDurationS(totalSeconds: number): string {
  return formatMinutes(totalSeconds / 60);
}

/**
 * Fixed-decimal number with a typographic minus and thin-space thousands grouping.
 * Never prints "-0"; non-finite values print the missing-value dash.
 */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  const fixed = Math.abs(value).toFixed(Math.max(0, decimals));
  const negative = value < 0 && Number(fixed) !== 0;
  const [int = '0', frac] = fixed.split('.');
  const grouped = int.length > 4 ? int.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE) : int;
  return `${negative ? MINUS : ''}${grouped}${frac !== undefined ? `.${frac}` : ''}`;
}

/** Like `formatNumber` but always signed: "+0.8", "−0.4", "0.0". */
export function formatSigned(value: number | null | undefined, decimals = 0): string {
  const text = formatNumber(value, decimals);
  if (text === MISSING || text.startsWith(MINUS)) return text;
  // Only non-zero values get a sign; "0.0" stays unsigned.
  return /[1-9]/.test(text) ? `+${text}` : text;
}

/**
 * Money in the given ISO 4217 currency ("$5.58", "€5.58"). Falls back to "5.58 XYZ" when the
 * runtime does not know the currency code.
 */
export function formatCurrency(value: number, currency: string, locale = 'en-US'): string {
  if (!Number.isFinite(value)) return MISSING;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`.trim();
  }
}
