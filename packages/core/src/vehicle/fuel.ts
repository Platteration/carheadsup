import type { FuelType, VehicleConfig } from '../types/config.ts';
import { median } from './stats.ts';

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

/** Consumption accumulated over (up to) one `FUEL_BUCKET_KM` of driving. */
export interface FuelBucket {
  km: number;
  litres: number;
}

/** Tank-level smoother: median of recent readings followed by a slow time-based EMA. */
export interface FuelLevelFilter {
  /** Recent raw readings (at most one per second), oldest first. */
  samples: number[];
  lastSampleAt: number | null;
  /** Smoothed level, %; null until the first reading. */
  smoothed: number | null;
  smoothedAt: number | null;
  /** Since when a refuel-sized jump has been seen while stationary. */
  refuelSince: number | null;
}

/** Fuel state. Implementations add private smoothing/averaging fields. */
export interface FuelState {
  readings: FuelReadings;
  /** Previous sample, for trapezoidal integration. */
  last: { at: number; speedKph: number | null; rateLph: number | null } | null;
  /** Rolling consumption window, oldest first; the last bucket is being filled. */
  buckets: FuelBucket[];
  /** Prior average (from persistence) that fills the window until real data covers it. */
  seedLPer100km: number | null;
  level: FuelLevelFilter;
}

/** Stoichiometric air/fuel mass ratios. */
export const STOICH_AFR = { gasoline: 14.7, e85: 9.8, lpg: 15.5, ethanol: 9.0 } as const;
/** Fuel densities, g/L. */
export const FUEL_DENSITY_G_PER_L = { gasoline: 745, e85: 785, lpg: 540, ethanol: 789 } as const;
/** Specific gas constant of dry air, J/(kg·K). */
const R_AIR = 287.05;

/** Instantaneous consumption is shown only at or above this speed. */
export const INSTANT_MIN_SPEED_KPH = 5;
/** Consumption figures are capped here (display limit; idling at walking pace is "absurd"). */
export const MAX_L_PER_100KM = 99.9;
/** The rolling average covers roughly this distance. */
export const FUEL_AVERAGE_WINDOW_KM = 20;
const FUEL_BUCKET_KM = 1;
const MAX_BUCKETS = FUEL_AVERAGE_WINDOW_KM / FUEL_BUCKET_KM + 1;
/** Without a seed, the average needs at least this much real driving. */
const MIN_AVERAGE_KM = 1;
/** Samples further apart than this are not integrated across. */
export const FUEL_MAX_GAP_MS = 5000;

const LEVEL_SAMPLE_INTERVAL_MS = 1000;
const LEVEL_MEDIAN_SIZE = 15;
const LEVEL_TAU_MS = 60_000;
/** After this long without level readings, smoothing starts afresh. */
const LEVEL_RESTART_GAP_MS = 5 * 60_000;
/** A rise of at least this many points while stationary is treated as refuelling … */
export const REFUEL_JUMP_PCT = 10;
/** … once it has persisted this long (slosh from braking to a stop settles faster). */
export const REFUEL_CONFIRM_MS = 5000;
const STATIONARY_KPH = 1;

const isNum = (v: number | null | undefined): v is number =>
  v !== null && v !== undefined && Number.isFinite(v);

/**
 * Stoichiometric AFR and density for the configured fuel. When the ethanol content (PID 0x52)
 * is known for a gasoline/flex-fuel vehicle, both are blended linearly with ethanol
 * (AFR 14.7·(1−e) + 9.0·e).
 */
export function fuelProperties(
  fuelType: FuelType,
  ethanolPct: number | null,
): { stoichAfr: number; densityGPerL: number } {
  if (fuelType === 'lpg') {
    return { stoichAfr: STOICH_AFR.lpg, densityGPerL: FUEL_DENSITY_G_PER_L.lpg };
  }
  if ((fuelType === 'gasoline' || fuelType === 'e85') && isNum(ethanolPct)) {
    const e = Math.min(100, Math.max(0, ethanolPct)) / 100;
    return {
      stoichAfr: STOICH_AFR.gasoline * (1 - e) + STOICH_AFR.ethanol * e,
      densityGPerL: FUEL_DENSITY_G_PER_L.gasoline * (1 - e) + FUEL_DENSITY_G_PER_L.ethanol * e,
    };
  }
  if (fuelType === 'e85') {
    return { stoichAfr: STOICH_AFR.e85, densityGPerL: FUEL_DENSITY_G_PER_L.e85 };
  }
  // Diesel never reaches here for air-based estimates; gasoline is the default.
  return { stoichAfr: STOICH_AFR.gasoline, densityGPerL: FUEL_DENSITY_G_PER_L.gasoline };
}

/**
 * Intake air mass flow from the speed-density method, g/s:
 * MAP[Pa] × displacement[m³] × VE × (rpm / 120) / (R_air × T[K]) × 1000.
 * (A four-stroke engine inhales its displacement once every two revolutions.)
 */
export function speedDensityAirGps(
  mapKpa: number,
  intakeAirTempC: number,
  rpm: number,
  displacementL: number,
  volumetricEfficiency: number,
): number {
  const pa = mapKpa * 1000;
  const m3 = displacementL / 1000;
  const kelvin = intakeAirTempC + 273.15;
  return ((pa * m3 * volumetricEfficiency * (rpm / 120)) / (R_AIR * kelvin)) * 1000;
}

/** Commanded λ is used when plausible (0.5–2); otherwise stoichiometric (λ = 1) is assumed. */
function lambdaOf(commanded: number | null): number {
  return isNum(commanded) && commanded >= 0.5 && commanded <= 2 ? commanded : 1;
}

/**
 * Estimate fuel flow in L/h from whatever the vehicle provides, in priority order:
 * PID 0x5E → MAF (air mass / (stoich AFR × λ) / density) → speed-density (MAP, IAT, rpm,
 * displacement, VE). Diesel only supports the PID source (air mass does not determine fuel).
 * With the engine stopped (rpm 0) the flow is 0 L/h whichever source is available.
 */
export function estimateFuelRate(
  input: FuelInput,
  vehicle: VehicleConfig,
): { lph: number; source: FuelRateSource } | null {
  const { rpm } = input;
  const engineStopped = rpm === 0;

  if (isNum(input.fuelRateLph) && input.fuelRateLph >= 0) {
    return { lph: engineStopped ? 0 : input.fuelRateLph, source: 'pid' };
  }
  if (vehicle.fuelType === 'diesel') return null;

  const { stoichAfr, densityGPerL } = fuelProperties(vehicle.fuelType, input.ethanolPct);
  const toLph = (airGps: number): number =>
    ((airGps / (stoichAfr * lambdaOf(input.commandedLambda))) * 3600) / densityGPerL;

  if (isNum(input.mafGps) && input.mafGps >= 0) {
    return { lph: engineStopped ? 0 : toLph(input.mafGps), source: 'maf' };
  }
  if (
    isNum(input.mapKpa) &&
    input.mapKpa > 0 &&
    isNum(input.intakeAirTempC) &&
    input.intakeAirTempC > -273.15 &&
    isNum(rpm) &&
    rpm >= 0
  ) {
    if (engineStopped) return { lph: 0, source: 'speed-density' };
    const air = speedDensityAirGps(
      input.mapKpa,
      input.intakeAirTempC,
      rpm,
      vehicle.displacementL,
      vehicle.volumetricEfficiency,
    );
    return { lph: toLph(air), source: 'speed-density' };
  }
  return null;
}

/** `seedAvgLPer100km` comes from `PersistedState.avgLPer100km` so range is available at startup. */
export function createFuelState(seedAvgLPer100km: number | null): FuelState {
  const seed = isNum(seedAvgLPer100km) && seedAvgLPer100km > 0 ? seedAvgLPer100km : null;
  return {
    readings: {
      rateLph: null,
      rateSource: null,
      instantLPer100km: null,
      averageLPer100km: seed,
      levelPct: null,
      rangeKm: null,
    },
    last: null,
    buckets: [],
    seedLPer100km: seed,
    level: { samples: [], lastSampleAt: null, smoothed: null, smoothedAt: null, refuelSince: null },
  };
}

/**
 * Advance fuel readings by one sample. Distance and fuel are integrated trapezoidally between
 * consecutive samples using their timestamps (gaps > 5 s are not bridged) into ≈ 1 km buckets;
 * the average is distance-weighted over the last ≈ 20 km, with the startup seed filling whatever
 * part of the window real data does not yet cover. Idle fuel counts towards the average, as on
 * a trip computer, because it is fuel the remaining range will not have.
 */
export function updateFuel(state: FuelState, input: FuelInput, vehicle: VehicleConfig): FuelState {
  const rate = estimateFuelRate(input, vehicle);
  const rateLph = rate?.lph ?? null;
  const speedKph = isNum(input.speedKph) && input.speedKph >= 0 ? input.speedKph : null;

  let buckets = state.buckets;
  let last = state.last;
  if (last === null || input.at >= last.at) {
    if (last !== null) {
      const dt = input.at - last.at;
      if (
        dt > 0 &&
        dt <= FUEL_MAX_GAP_MS &&
        last.speedKph !== null &&
        speedKph !== null &&
        last.rateLph !== null &&
        rateLph !== null
      ) {
        const km = (((last.speedKph + speedKph) / 2) * dt) / 3_600_000;
        const litres = (((last.rateLph + rateLph) / 2) * dt) / 3_600_000;
        buckets = addToBuckets(buckets, km, litres);
      }
    }
    last = { at: input.at, speedKph, rateLph };
  }

  const averageLPer100km = rollingAverage(buckets, state.seedLPer100km);
  const level = updateLevel(state.level, input, speedKph);
  const levelPct = isNum(input.fuelLevelPct) ? level.smoothed : null;
  const instantLPer100km =
    rateLph !== null && speedKph !== null && speedKph >= INSTANT_MIN_SPEED_KPH
      ? Math.min(MAX_L_PER_100KM, (rateLph / speedKph) * 100)
      : null;
  const rangeKm =
    levelPct !== null &&
    averageLPer100km !== null &&
    averageLPer100km > 0 &&
    vehicle.tankCapacityL > 0
      ? (((levelPct / 100) * vehicle.tankCapacityL) / averageLPer100km) * 100
      : null;

  return {
    readings: {
      rateLph,
      rateSource: rate?.source ?? null,
      instantLPer100km,
      averageLPer100km,
      levelPct,
      rangeKm,
    },
    last,
    buckets,
    seedLPer100km: state.seedLPer100km,
    level,
  };
}

function addToBuckets(buckets: readonly FuelBucket[], km: number, litres: number): FuelBucket[] {
  const out = buckets.slice();
  const current = out[out.length - 1];
  if (current === undefined || current.km >= FUEL_BUCKET_KM) {
    out.push({ km, litres });
  } else {
    out[out.length - 1] = { km: current.km + km, litres: current.litres + litres };
  }
  return out.length > MAX_BUCKETS ? out.slice(out.length - MAX_BUCKETS) : out;
}

/** Distance-weighted average of the window, topped up with the seed to `FUEL_AVERAGE_WINDOW_KM`. */
function rollingAverage(buckets: readonly FuelBucket[], seed: number | null): number | null {
  let km = 0;
  let litres = 0;
  for (const b of buckets) {
    km += b.km;
    litres += b.litres;
  }
  if (seed !== null) {
    // The seed stands in for the part of the window not yet covered, so km + seedKm ≥ 20.
    const seedKm = Math.max(0, FUEL_AVERAGE_WINDOW_KM - km);
    return ((litres + (seed / 100) * seedKm) / (km + seedKm)) * 100;
  }
  return km >= MIN_AVERAGE_KM ? (litres / km) * 100 : null;
}

/**
 * Fuel sloshes, so raw tank-level readings swing by several percent while driving. Readings
 * (at most one per second) go through a 15-sample median and then a 60 s time-based EMA; until
 * the median window has filled, the median is used directly so startup converges quickly. A
 * rise of ≥ 10 points held for 5 s while stationary is a refuel and restarts the filter.
 */
function updateLevel(
  filter: FuelLevelFilter,
  input: FuelInput,
  speedKph: number | null,
): FuelLevelFilter {
  const rawInput = input.fuelLevelPct;
  if (!isNum(rawInput)) {
    return filter.refuelSince === null ? filter : { ...filter, refuelSince: null };
  }
  const raw = Math.min(100, Math.max(0, rawInput));
  const at = input.at;
  const restart = (): FuelLevelFilter => ({
    samples: [raw],
    lastSampleAt: at,
    smoothed: raw,
    smoothedAt: at,
    refuelSince: null,
  });

  if (
    filter.smoothed === null ||
    filter.smoothedAt === null ||
    at - filter.smoothedAt > LEVEL_RESTART_GAP_MS
  ) {
    return restart();
  }

  const stationary = speedKph !== null && speedKph < STATIONARY_KPH;
  let refuelSince: number | null = null;
  if (stationary && raw >= filter.smoothed + REFUEL_JUMP_PCT) {
    refuelSince = filter.refuelSince ?? at;
    if (at - refuelSince >= REFUEL_CONFIRM_MS) return restart();
  }

  let { samples, lastSampleAt } = filter;
  if (lastSampleAt === null || at - lastSampleAt >= LEVEL_SAMPLE_INTERVAL_MS) {
    samples = [...samples, raw].slice(-LEVEL_MEDIAN_SIZE);
    lastSampleAt = at;
  }
  const med = median(samples);
  const dt = at - filter.smoothedAt;
  let smoothed = filter.smoothed;
  let smoothedAt = filter.smoothedAt;
  if (samples.length < LEVEL_MEDIAN_SIZE) {
    smoothed = med;
    smoothedAt = Math.max(at, smoothedAt);
  } else if (dt > 0) {
    smoothed += (1 - Math.exp(-dt / LEVEL_TAU_MS)) * (med - smoothed);
    smoothedAt = at;
  }
  return { samples, lastSampleAt, smoothed, smoothedAt, refuelSince };
}
