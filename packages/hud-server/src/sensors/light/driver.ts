import type { I2cBus } from '../i2c.ts';

/** One ambient-light chip. Drivers keep their own ranging state between readings. */
export interface LightSensorDriver {
  /** Chip name for log lines, e.g. "BH1750". */
  readonly chip: string;
  /** Probe and configure the chip; throws when it does not answer. */
  init(bus: I2cBus, now: number): Promise<void>;
  /**
   * Take one reading. Returns lux (before the window gain), or null when no valid sample is
   * available yet — right after power-up or a range change, while the chip integrates.
   */
  read(bus: I2cBus, now: number): Promise<number | null>;
  /** Power the chip down (best effort). */
  shutdown(bus: I2cBus): Promise<void>;
}

/** Upper bound reported by any driver: bright direct sunlight is ~120 klx. */
export const MAX_REPORTED_LUX = 150_000;

export function clampLux(lux: number): number {
  if (!Number.isFinite(lux) || lux <= 0) return 0;
  return Math.min(lux, MAX_REPORTED_LUX);
}
