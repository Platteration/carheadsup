import {
  M_PER_FT,
  cToF,
  fToC,
  kmToMi,
  kpaToBar,
  kpaToPsi,
  kphToMph,
  miToKm,
  mphToKph,
  mToFt,
  roundTo,
  KPA_PER_PSI,
} from '@carheadsup/core';
import type { UnitsConfig } from '@carheadsup/core';
import type { IssueBound } from './validation.ts';

/**
 * How a canonical config value (km/h, °C, kPa, km, m, ms, 0–1 …) is shown and typed in the
 * settings form. The config always stores canonical units; only the form converts, using the
 * core conversion helpers.
 */
export interface UnitSpec {
  /** Suffix shown next to the input, e.g. "°F". Empty for unitless values. */
  label: string;
  /** Decimals shown for this unit. */
  decimals: number;
  toDisplay: (canonical: number) => number;
  fromDisplay: (display: number) => number;
}

const identity = (v: number): number => v;

export function plainUnit(label: string, decimals = 0): UnitSpec {
  return { label, decimals, toDisplay: identity, fromDisplay: identity };
}

/** 0–1 fractions shown as percent. */
export const PERCENT: UnitSpec = {
  label: '%',
  decimals: 0,
  toDisplay: (v) => v * 100,
  fromDisplay: (v) => v / 100,
};

/** Milliseconds shown as seconds. */
export const SECONDS_FROM_MS: UnitSpec = {
  label: 's',
  decimals: 1,
  toDisplay: (ms) => ms / 1000,
  fromDisplay: (s) => s * 1000,
};

/** Milliseconds shown as minutes. */
export const MINUTES_FROM_MS: UnitSpec = {
  label: 'min',
  decimals: 1,
  toDisplay: (ms) => ms / 60_000,
  fromDisplay: (min) => min * 60_000,
};

export const MILLISECONDS = plainUnit('ms');
export const RPM = plainUnit('rpm');
export const VOLTS = plainUnit('V', 1);
export const LUX = plainUnit('lx');
export const DEGREES = plainUnit('°', 1);
export const LITRES = plainUnit('L', 1);
export const DAYS = plainUnit('days');

/** Unit specs that follow the driver's unit preferences. */
export interface DriverUnits {
  temperature: UnitSpec;
  /** A temperature difference (hysteresis): scaled, never offset. */
  temperatureDelta: UnitSpec;
  speed: UnitSpec;
  /** A speed difference (tolerance). */
  speedDelta: UnitSpec;
  pressure: UnitSpec;
  /** Long distances (odometer, service intervals): km or mi. */
  distance: UnitSpec;
  /** Short distances (reveal ranges): m or ft. */
  shortDistance: UnitSpec;
}

export function driverUnits(units: UnitsConfig): DriverUnits {
  const imperial = units.system === 'imperial';
  const fahrenheit = units.temperature === 'F';
  const pressure: UnitSpec =
    units.pressure === 'psi'
      ? { label: 'psi', decimals: 1, toDisplay: kpaToPsi, fromDisplay: (psi) => psi * KPA_PER_PSI }
      : units.pressure === 'bar'
        ? { label: 'bar', decimals: 2, toDisplay: kpaToBar, fromDisplay: (bar) => bar * 100 }
        : plainUnit('kPa');
  const speed: UnitSpec = imperial
    ? { label: 'mph', decimals: 0, toDisplay: kphToMph, fromDisplay: mphToKph }
    : plainUnit('km/h');
  return {
    temperature: fahrenheit
      ? { label: '°F', decimals: 0, toDisplay: cToF, fromDisplay: fToC }
      : plainUnit('°C'),
    temperatureDelta: fahrenheit
      ? { label: '°F', decimals: 1, toDisplay: (c) => c * 1.8, fromDisplay: (f) => f / 1.8 }
      : plainUnit('°C', 1),
    speed,
    speedDelta: { ...speed, decimals: 1 },
    pressure,
    distance: imperial
      ? { label: 'mi', decimals: 0, toDisplay: kmToMi, fromDisplay: miToKm }
      : plainUnit('km'),
    shortDistance: imperial
      ? { label: 'ft', decimals: 0, toDisplay: mToFt, fromDisplay: (ft) => ft * M_PER_FT }
      : plainUnit('m'),
  };
}

// ---------------------------------------------------------------------------------------------
// Form parsing

export type ParsedNumber = { ok: true; value: number | null } | { ok: false; error: string };

/** Minus sign, figure dash and en dash, as typed by some keyboards or pasted from documents. */
const UNICODE_MINUS = /[−‒–]/g;

/**
 * Digits grouped in thousands with commas ("48,210", "1,234,567", "12,345.6"). A single comma
 * followed by exactly three digits could be either a decimal comma or a thousands separator —
 * guessing wrong turns 48 210 km into 48.21 km — so such input is refused, not guessed.
 */
const THOUSANDS_GROUPED = /^[+-]?[1-9]\d{0,2}(?:,\d{3})+(?:\.\d*)?$/;

/**
 * Parse what a person typed into a number field. Accepts surrounding spaces, a leading "+",
 * typographic minus signs, and a single decimal comma ("12,5" — phone keyboards in many locales
 * offer only a comma). Thousands separators are refused (see {@link THOUSANDS_GROUPED}). Empty
 * input is null when `allowEmpty`, else an error.
 */
export function parseNumberText(
  text: string,
  options: { allowEmpty?: boolean; integer?: boolean } = {},
): ParsedNumber {
  const trimmed = text.trim().replace(UNICODE_MINUS, '-');
  if (trimmed === '') {
    return options.allowEmpty ? { ok: true, value: null } : { ok: false, error: 'Required' };
  }
  if (THOUSANDS_GROUPED.test(trimmed)) {
    return { ok: false, error: 'Leave out the thousands separator (decimals: 1.5 or 1,5)' };
  }
  const commas = (trimmed.match(/,/g) ?? []).length;
  const normalized = commas === 1 && !trimmed.includes('.') ? trimmed.replace(',', '.') : trimmed;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) {
    return { ok: false, error: 'Enter a number' };
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, error: 'Enter a number' };
  if (options.integer && !Number.isInteger(value)) {
    return { ok: false, error: 'Enter a whole number' };
  }
  return { ok: true, value };
}

/**
 * Display value → canonical value for storage. Integer fields are rounded after conversion
 * (e.g. 1.25 s → 1250 ms); others are rounded to 6 decimals to shed conversion noise.
 */
export function toCanonical(display: number, unit: UnitSpec, integer = false): number {
  const canonical = unit.fromDisplay(display);
  return integer ? Math.round(canonical) : roundTo(canonical, 6);
}

/** Canonical value → text for an input, rounded to the unit's decimals without trailing zeros. */
export function formatForInput(canonical: number | null, unit: UnitSpec): string {
  if (canonical === null || !Number.isFinite(canonical)) return '';
  const shown = roundTo(unit.toDisplay(canonical), unit.decimals);
  return String(Object.is(shown, -0) ? 0 : shown);
}

/**
 * Whether the text in an input already represents `canonical` (so an external update does not
 * need to overwrite what the person is typing, e.g. "12." while on the way to "12.5").
 */
export function textMatchesValue(
  text: string,
  canonical: number | null,
  unit: UnitSpec,
  integer = false,
): boolean {
  const parsed = parseNumberText(text, { allowEmpty: true });
  if (!parsed.ok) return false;
  if (parsed.value === null || canonical === null) return parsed.value === canonical;
  const typed = toCanonical(parsed.value, unit, integer);
  const tolerance = 0.5 * 10 ** -Math.max(unit.decimals, 0);
  return Math.abs(unit.toDisplay(typed) - unit.toDisplay(canonical)) <= tolerance;
}

/** "Must be at most 302 °F" — a violated bound phrased in the field's display unit. */
export function describeBound(bound: IssueBound, unit: UnitSpec): string {
  // Temperatures and other affine conversions keep their direction (all converters are increasing).
  // At least two decimals so small limits (0.5 km/h) are not rounded away.
  const shown = roundTo(unit.toDisplay(bound.value), Math.max(unit.decimals, 2));
  const words =
    bound.kind === 'max'
      ? bound.inclusive
        ? 'at most'
        : 'below'
      : bound.inclusive
        ? 'at least'
        : 'above';
  const suffix = unit.label === '' ? '' : unit.label === '%' ? '%' : ` ${unit.label}`;
  return `Must be ${words} ${shown}${suffix}`;
}
