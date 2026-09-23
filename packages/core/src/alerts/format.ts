import type { HudConfig } from '../types/config.ts';
import {
  displayLongDistance,
  displayPressure,
  displayTemperature,
  pressureUnitLabel,
  temperatureUnitLabel,
} from '../units.ts';

/** Short text helpers for alert detail lines, always in the driver's units. */

/** "112 °C" / "234 °F". */
export function formatTemperature(celsius: number, config: HudConfig): string {
  const unit = config.units.temperature;
  return `${displayTemperature(celsius, unit)} ${temperatureUnitLabel(unit)}`;
}

/** "168 kPa" / "24.4 psi" / "1.68 bar". */
export function formatPressure(kpa: number, config: HudConfig): string {
  const unit = config.units.pressure;
  return `${displayPressure(kpa, unit)} ${pressureUnitLabel(unit)}`;
}

/** Whole kilometres or miles, e.g. "42 km" / "26 mi". */
export function formatLongDistance(km: number, config: HudConfig): string {
  const imperial = config.units.system === 'imperial';
  return `${displayLongDistance(km, config.units.system)} ${imperial ? 'mi' : 'km'}`;
}

/** "11.8 V". */
export function formatVoltage(volts: number): string {
  return `${volts.toFixed(1)} V`;
}

/** "1 day" / "12 days". */
export function formatDays(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** Clamp free text (e.g. adapter error messages) to a glanceable length. */
export function truncateText(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}
