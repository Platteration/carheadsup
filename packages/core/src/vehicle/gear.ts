import type { VehicleConfig } from '../types/config.ts';
import { notImplemented } from '../todo.ts';

export interface GearEstimate {
  /** Gear number (1 = first), 'N' when the rpm/speed ratio matches no gear (clutch in / coasting), null when unknown. */
  gear: number | 'N' | null;
  /** True when inferred from rpm/speed rather than reported by the vehicle (PID 0xA4). */
  inferred: boolean;
  /** 0–1. */
  confidence: number;
}

export interface GearInput {
  at: number;
  speedKph: number | null;
  rpm: number | null;
  throttlePct: number | null;
  /** Gear reported by PID 0xA4, if the vehicle supports it. */
  reportedGear: number | null;
}

/**
 * Gear estimator state. Implementations add private learner fields; `estimate` and
 * `learnedRatios` are the public surface.
 */
export interface GearState {
  estimate: GearEstimate;
  /** Learned overall ratios, rpm per km/h, 1st gear first; null until learned with confidence. */
  learnedRatios: number[] | null;
}

export function createGearState(learnedRatios: number[] | null): GearState {
  return notImplemented(`createGearState(${String(learnedRatios)})`);
}

/**
 * Update the estimate from a new sample. Uses `vehicle.gearRatiosRpmPerKph` when configured,
 * otherwise learned ratios; keeps learning from steady-state samples (not idling, not shifting,
 * speed above a floor). CVTs never report a gear. Reported gears (PID 0xA4) win over inference.
 */
export function updateGear(state: GearState, input: GearInput, vehicle: VehicleConfig): GearState {
  return notImplemented(
    `updateGear(${input.at}, ${vehicle.transmission}, ${String(state.estimate.gear)})`,
  );
}
