import type {
  AlertSeverity,
  DisplayDistance,
  DtcSeverity,
  FuelEconomyUnit,
  GaugeStatus,
} from '@carheadsup/core';

/**
 * `table[key]` when `key` is the table's own entry, else `fallback`. Frames come from a server
 * that may be newer than this renderer, so unexpected enum strings (including ones such as
 * "constructor" that would hit Object.prototype) must fall back rather than crash the view.
 */
export function lookup<K extends string, V>(
  table: Readonly<Record<K, V>>,
  key: string,
  fallback: V,
): V {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key as K] : fallback;
}

/** Join class names, skipping falsy parts. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Clamp to 0–1, mapping NaN/±Infinity to 0. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** CSS percentage for a 0–1 fraction, e.g. 0.425 → "42.5%". */
export function pct(fraction: number): string {
  return `${Math.round(clamp01(fraction) * 1000) / 10}%`;
}

/**
 * Split a pre-formatted distance ("1.2 km", "500 ft") into number and unit so the unit can be
 * typeset smaller. Falls back to the whole text as the value when it does not end in the unit.
 */
export function splitDistance(distance: DisplayDistance): { value: string; unit: string } {
  const text = distance.text.trim();
  if (text.endsWith(distance.unit)) {
    const value = text.slice(0, text.length - distance.unit.length).trim();
    if (value !== '') return { value, unit: distance.unit };
  }
  return { value: text, unit: '' };
}

/** Display label for a fuel-economy unit. */
export function economyUnitLabel(unit: FuelEconomyUnit): string {
  switch (unit) {
    case 'L/100km':
      return 'L/100\u2009km';
    case 'km/L':
      return 'km/L';
    case 'mpg-us':
      return 'mpg';
    case 'mpg-uk':
      return 'mpg';
    default:
      // A unit from a newer server: show it as sent rather than nothing.
      return String(unit);
  }
}

/** Visual tone shared by alerts, trouble codes and gauges. */
export type Tone = 'neutral' | 'info' | 'caution' | 'warning' | 'critical' | 'unknown';

export function severityTone(severity: AlertSeverity | DtcSeverity): Tone {
  return severity;
}

export function gaugeTone(status: GaugeStatus): Tone {
  switch (status) {
    case 'ok':
      return 'neutral';
    case 'warn':
      return 'caution';
    case 'crit':
      return 'critical';
    case 'unknown':
      return 'unknown';
    default:
      // A status from a newer server: no claim either way.
      return 'unknown';
  }
}

/** Lowest content brightness ever applied, so the HUD cannot be dimmed into invisibility. */
export const MIN_BRIGHTNESS = 0.05;

/**
 * The CSS brightness factor for a frame's `theme.brightness`: clamped to [0.05, 1]; a missing or
 * non-finite value renders at full brightness rather than risking an invisible HUD.
 */
export function contentBrightness(brightness: number): number {
  if (!Number.isFinite(brightness)) return 1;
  return Math.min(1, Math.max(MIN_BRIGHTNESS, brightness));
}
