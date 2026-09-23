/**
 * Physical parameters of the simulated car: a 1400 kg front-wheel-drive hatchback with a
 * 2.0 L naturally aspirated petrol engine and a six-speed automatic, on 205/55 R16 tyres.
 */

export const VEHICLE_MODEL = Object.freeze({
  massKg: 1400,
  /** Gearbox ratios, 1st … 6th. */
  gearRatios: Object.freeze([4.15, 2.37, 1.56, 1.16, 0.86, 0.69]),
  finalDrive: 3.2,
  /** 205/55 R16: 632 mm diameter. */
  tyreCircumferenceM: 1.985,
  drivelineEfficiency: 0.9,
  /** Drag coefficient × frontal area (0.30 × 2.2 m²). */
  dragAreaM2: 0.66,
  airDensityKgM3: 1.2,
  rollingResistance: 0.012,
  /** Deceleration at full brake pedal. */
  maxBrakeDecelMps2: 9,
  /** Front axle carries 60 % of the weight; tyre friction coefficient 0.9. */
  tractionLimitN: 0.9 * 1400 * 9.81 * 0.6,
  idleRpm: 750,
  redlineRpm: 6500,
  limiterRpm: 6800,
  /** Engine speed the torque converter lets the engine reach at full throttle from standstill. */
  converterStallRpm: 2300,
  /** Engine speed a driver slips the clutch at when launching with full throttle (held gear). */
  clutchLaunchRpm: 1800,
  displacementL: 2.0,
  volumetricEfficiency: 0.88,
  tankCapacityL: 50,
  baroKpa: 101,
  /** Gasoline: stoichiometric air/fuel ratio and density. */
  stoichAfr: 14.7,
  fuelDensityGPerL: 745,
});

export const GEAR_COUNT = VEHICLE_MODEL.gearRatios.length;

const G = 9.81;
export const GRAVITY_MPS2 = G;

/** Full-load torque curve (rpm, N·m): 200 N·m peak at 4500 rpm, ~150 kW at 6500 rpm. */
const TORQUE_CURVE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [600, 110],
  [1000, 145],
  [1500, 165],
  [2000, 180],
  [3000, 192],
  [4000, 198],
  [4500, 200],
  [5000, 196],
  [6000, 182],
  [6500, 170],
  [7000, 150],
];

/** Full-throttle engine torque at `rpm` (linear interpolation of the curve). */
export function wotTorqueNm(rpm: number): number {
  if (rpm <= 0) return 0;
  let prev = TORQUE_CURVE[0] ?? [0, 0];
  for (const point of TORQUE_CURVE) {
    if (rpm <= point[0]) {
      const span = point[0] - prev[0];
      return span <= 0 ? point[1] : prev[1] + ((point[1] - prev[1]) * (rpm - prev[0])) / span;
    }
    prev = point;
  }
  return prev[1];
}

/** Pumping and friction losses (N·m); what the engine absorbs on the overrun. */
export function frictionTorqueNm(rpm: number): number {
  return rpm <= 0 ? 0 : 8 + 0.006 * rpm;
}

/** Overall ratio (gearbox × final drive) for gear 1–6; 0 for neutral. */
export function overallRatio(gear: number): number {
  const ratio = VEHICLE_MODEL.gearRatios[gear - 1];
  return ratio === undefined ? 0 : ratio * VEHICLE_MODEL.finalDrive;
}

/** Engine rpm per km/h in `gear` (≈111 in 1st, ≈18.5 in 6th). */
export function rpmPerKph(gear: number): number {
  return (overallRatio(gear) * 1000) / 60 / VEHICLE_MODEL.tyreCircumferenceM;
}

/**
 * Throttle opening → fraction of full-load air. Torque rises steeply over the first part of
 * pedal travel, as on a real throttle body.
 */
export function airFractionForThrottle(throttle: number): number {
  const t = Math.min(1, Math.max(0, throttle));
  return t * (2 - t);
}

/** First-order approach of `value` towards `target` with time constant `tauS`. */
export function approach(value: number, target: number, dtS: number, tauS: number): number {
  if (tauS <= 0) return target;
  return value + (target - value) * (1 - Math.exp(-dtS / tauS));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
