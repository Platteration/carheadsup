import type { SignalId, SignalMap } from './types/signals.ts';

/**
 * Safety rule: the HUD must never display a stale value as if it were live (a frozen
 * speed reading is worse than none). Fast-changing signals expire quickly.
 */
export const DEFAULT_STALE_MS = 10_000;

export const STALE_MS: Partial<Record<SignalId, number>> = {
  speed: 2_000,
  rpm: 2_000,
  throttle: 2_000,
  relativeThrottle: 2_000,
  acceleratorPedal: 2_000,
  engineLoad: 3_000,
  maf: 3_000,
  map: 3_000,
  fuelRate: 3_000,
  transmissionGear: 3_000,
  batteryVoltage: 15_000,
  controlModuleVoltage: 15_000,
  fuelLevel: 120_000,
  odometer: 120_000,
  ambientTemp: 120_000,
  tirePressureFL: 120_000,
  tirePressureFR: 120_000,
  tirePressureRL: 120_000,
  tirePressureRR: 120_000,
};

export function staleLimitMs(signal: SignalId): number {
  return STALE_MS[signal] ?? DEFAULT_STALE_MS;
}

/** The signal's value if present and fresh at `now`, else null. */
export function freshValue(signals: SignalMap, signal: SignalId, now: number): number | null {
  const sample = signals[signal];
  if (!sample || !Number.isFinite(sample.value)) return null;
  if (now - sample.at > staleLimitMs(signal)) return null;
  return sample.value;
}
