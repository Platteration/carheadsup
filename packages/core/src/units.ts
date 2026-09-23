import type { FuelEconomyUnit, PressureUnit, TemperatureUnit, UnitSystem } from './types/config.ts';
import type {
  DisplayDistance,
  PressureUnitLabel,
  SpeedUnitLabel,
  TemperatureUnitLabel,
} from './types/frame.ts';

export const KM_PER_MI = 1.609344;
export const M_PER_FT = 0.3048;
export const L_PER_US_GAL = 3.785411784;
export const L_PER_UK_GAL = 4.54609;
export const KPA_PER_PSI = 6.894757293168;

export const kphToMph = (kph: number): number => kph / KM_PER_MI;
export const mphToKph = (mph: number): number => mph * KM_PER_MI;
export const kmToMi = (km: number): number => km / KM_PER_MI;
export const miToKm = (mi: number): number => mi * KM_PER_MI;
export const mToFt = (m: number): number => m / M_PER_FT;
export const cToF = (c: number): number => (c * 9) / 5 + 32;
export const fToC = (f: number): number => ((f - 32) * 5) / 9;
export const kpaToPsi = (kpa: number): number => kpa / KPA_PER_PSI;
export const kpaToBar = (kpa: number): number => kpa / 100;
export const litresToUsGal = (l: number): number => l / L_PER_US_GAL;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Round to a number of decimals without floating-point noise like 0.30000000000000004. */
export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Round to the nearest multiple of `step`. */
export function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function speedUnitLabel(system: UnitSystem): SpeedUnitLabel {
  return system === 'imperial' ? 'mph' : 'km/h';
}

/** Canonical km/h → display units, rounded to a whole number. */
export function displaySpeed(kph: number, system: UnitSystem): number {
  return Math.round(system === 'imperial' ? kphToMph(kph) : kph);
}

export function temperatureUnitLabel(unit: TemperatureUnit): TemperatureUnitLabel {
  return unit === 'F' ? '°F' : '°C';
}

export function displayTemperature(c: number, unit: TemperatureUnit): number {
  return Math.round(unit === 'F' ? cToF(c) : c);
}

export function pressureUnitLabel(unit: PressureUnit): PressureUnitLabel {
  return unit;
}

/** kPa → display pressure; bar keeps two decimals, psi one, kPa none. */
export function displayPressure(kpa: number, unit: PressureUnit): number {
  switch (unit) {
    case 'psi':
      return roundTo(kpaToPsi(kpa), 1);
    case 'bar':
      return roundTo(kpaToBar(kpa), 2);
    default:
      return Math.round(kpa);
  }
}

/**
 * Convert litres per 100 km to the requested economy unit, one decimal.
 * Returns null for non-positive or non-finite input (no meaningful economy).
 */
export function convertEconomy(lPer100km: number | null, unit: FuelEconomyUnit): number | null {
  if (lPer100km === null || !Number.isFinite(lPer100km) || lPer100km <= 0) return null;
  switch (unit) {
    case 'L/100km':
      return roundTo(lPer100km, 1);
    case 'km/L':
      return roundTo(100 / lPer100km, 1);
    case 'mpg-us':
      return roundTo((100 * L_PER_US_GAL) / (KM_PER_MI * lPer100km), 1);
    case 'mpg-uk':
      return roundTo((100 * L_PER_UK_GAL) / (KM_PER_MI * lPer100km), 1);
  }
}

/** Canonical km → display distance unit for totals like range and trip distance. */
export function displayLongDistance(km: number, system: UnitSystem, decimals = 0): number {
  return roundTo(system === 'imperial' ? kmToMi(km) : km, decimals);
}

/**
 * Format a navigation distance the way turn-by-turn apps do:
 *   metric:   < 100 m → 10 m steps, < 1 km → 50 m steps, < 10 km → 0.1 km, else whole km
 *   imperial: < 0.1 mi → 50 ft steps (min 50 ft), < 10 mi → 0.1 mi, else whole miles
 */
export function formatNavDistance(meters: number, system: UnitSystem): DisplayDistance {
  const m = Math.max(0, meters);
  if (system === 'imperial') {
    const miles = m / (KM_PER_MI * 1000);
    if (miles < 0.1) {
      const ft = Math.max(50, roundToStep(mToFt(m), 50));
      return { value: ft, unit: 'ft', text: `${ft} ft` };
    }
    if (miles < 10) {
      const v = roundTo(miles, 1);
      return { value: v, unit: 'mi', text: `${v.toFixed(1)} mi` };
    }
    const v = Math.round(miles);
    return { value: v, unit: 'mi', text: `${v} mi` };
  }
  if (m < 100) {
    const v = roundToStep(m, 10);
    return { value: v, unit: 'm', text: `${v} m` };
  }
  if (m < 1000) {
    const v = roundToStep(m, 50);
    if (v >= 1000) return { value: 1, unit: 'km', text: '1.0 km' };
    return { value: v, unit: 'm', text: `${v} m` };
  }
  const km = m / 1000;
  if (km < 10) {
    const v = roundTo(km, 1);
    return { value: v, unit: 'km', text: `${v.toFixed(1)} km` };
  }
  const v = Math.round(km);
  return { value: v, unit: 'km', text: `${v} km` };
}
