import type { VehicleConfig } from '../types/config.ts';
import { notImplemented } from '../todo.ts';

export type FuelRateSource = 'pid' | 'maf' | 'speed-density';

export interface FuelInput {
  at: number;
  speedKph: number | null;
  rpm: number | null;
  /** PID 0x5E, L/h. */
  fuelRateLph: number | null;
  /** PID 0x10, g/s. */
  mafGps: number | null;
  /** PID 0x0B, kPa absolute. */
  mapKpa: number | null;
  /** PID 0x0F, °C. */
  intakeAirTempC: number | null;
  /** PID 0x44, λ. */
  commandedLambda: number | null;
  /** PID 0x2F, %. */
  fuelLevelPct: number | null;
  /** PID 0x52, % — adjusts stoichiometric AFR for flex fuel. */
  ethanolPct: number | null;
}

export interface FuelReadings {
  /** Current fuel flow, L/h. */
  rateLph: number | null;
  rateSource: FuelRateSource | null;
  /** Instantaneous consumption; null when (nearly) stationary. */
  instantLPer100km: number | null;
  /** Rolling average over recent driving (≈ last 20 km), used for range. */
  averageLPer100km: number | null;
  /** Smoothed tank level, %. */
  levelPct: number | null;
  /** Remaining litres × average consumption, km. */
  rangeKm: number | null;
}

/** Fuel state. Implementations add private smoothing/averaging fields. */
export interface FuelState {
  readings: FuelReadings;
}

/**
 * Estimate fuel flow in L/h from whatever the vehicle provides, in priority order:
 * PID 0x5E → MAF (air mass / (stoich AFR × λ) / density) → speed-density (MAP, IAT, rpm,
 * displacement, VE). Diesel only supports the PID source (air mass does not determine fuel).
 */
export function estimateFuelRate(
  input: FuelInput,
  vehicle: VehicleConfig,
): { lph: number; source: FuelRateSource } | null {
  return notImplemented(`estimateFuelRate(${input.at}, ${vehicle.fuelType})`);
}

/** `seedAvgLPer100km` comes from `PersistedState.avgLPer100km` so range is available at startup. */
export function createFuelState(seedAvgLPer100km: number | null): FuelState {
  return notImplemented(`createFuelState(${String(seedAvgLPer100km)})`);
}

export function updateFuel(state: FuelState, input: FuelInput, vehicle: VehicleConfig): FuelState {
  return notImplemented(
    `updateFuel(${input.at}, ${vehicle.fuelType}, ${String(state.readings.rateLph)})`,
  );
}
