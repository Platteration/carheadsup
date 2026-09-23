/**
 * Vishay VEML7700 ambient light sensor (I2C 0x10). 16-bit registers, low byte first:
 * 0x00 ALS_CONF_0 (gain bits 12:11, integration time bits 9:6, shutdown bit 0),
 * 0x03 power saving, 0x04 ALS output.
 *
 * Resolution is 0.0042 lx/count at gain ×2 and 800 ms (datasheet rev. 1.7+, which revised the
 * older 0.0036), scaling inversely with gain and integration time. Auto-ranging follows Vishay's
 * application note "Designing the VEML7700 into an application": raise gain first, then
 * integration time, while counts ≤ 100; shorten integration time while counts > 10 000. Above
 * 1000 lx, and at gains ×1/8 and ×1/4, the response is non-linear and the note's polynomial
 * correction is applied.
 */
import type { I2cBus } from '../i2c.ts';
import { clampLux, type LightSensorDriver } from './driver.ts';
import { chooseRange, type RangePolicy, type RangeStep } from './ranging.ts';

export const VEML7700_ADDRESS = 0x10;

export const VEML7700_REGISTERS = {
  ALS_CONF: 0x00,
  POWER_SAVING: 0x03,
  ALS: 0x04,
} as const;

export type Veml7700Gain = 0.125 | 0.25 | 1 | 2;
export type Veml7700IntegrationMs = 25 | 50 | 100 | 200 | 400 | 800;

const GAIN_BITS: Record<Veml7700Gain, number> = { 1: 0b00, 2: 0b01, 0.125: 0b10, 0.25: 0b11 };
const IT_BITS: Record<Veml7700IntegrationMs, number> = {
  25: 0b1100,
  50: 0b1000,
  100: 0b0000,
  200: 0b0001,
  400: 0b0010,
  800: 0b0011,
};

/** lx/count at gain ×2 and 800 ms integration. */
export const VEML7700_MAX_RESOLUTION = 0.0042;

export interface Veml7700Setting {
  gain: Veml7700Gain;
  integrationMs: Veml7700IntegrationMs;
}

/** Auto-ranging ladder, least to most sensitive (application-note order). */
export const VEML7700_LADDER: readonly Veml7700Setting[] = [
  { gain: 0.125, integrationMs: 25 },
  { gain: 0.125, integrationMs: 50 },
  { gain: 0.125, integrationMs: 100 },
  { gain: 0.25, integrationMs: 100 },
  { gain: 1, integrationMs: 100 },
  { gain: 2, integrationMs: 100 },
  { gain: 2, integrationMs: 200 },
  { gain: 2, integrationMs: 400 },
  { gain: 2, integrationMs: 800 },
];
/** The application note's starting point: gain ×1/8, 100 ms. */
const START_INDEX = 2;

/** Lux per count for a gain / integration time. */
export function veml7700Resolution(
  gain: Veml7700Gain,
  integrationMs: Veml7700IntegrationMs,
): number {
  return VEML7700_MAX_RESOLUTION * (800 / integrationMs) * (2 / gain);
}

/** ALS_CONF_0 value for a setting (interrupts off, persistence 1). */
export function veml7700ConfigWord(setting: Veml7700Setting, shutdown = false): number {
  return (
    (GAIN_BITS[setting.gain] << 11) | (IT_BITS[setting.integrationMs] << 6) | (shutdown ? 1 : 0)
  );
}

/** Vishay's fourth-order correction of the high-illuminance non-linearity. */
export function veml7700CorrectLux(lux: number): number {
  return (((6.0135e-13 * lux - 9.3924e-9) * lux + 8.1488e-5) * lux + 1.0023) * lux;
}

/** Lux for an ALS reading, corrected where the application note requires it. */
export function veml7700Lux(counts: number, setting: Veml7700Setting): number {
  const lux = counts * veml7700Resolution(setting.gain, setting.integrationMs);
  return setting.gain <= 0.25 || lux > 1000 ? veml7700CorrectLux(lux) : lux;
}

const SATURATION = 0xffff;
const LADDER: readonly RangeStep[] = VEML7700_LADDER.map((s) => ({
  luxPerCount: veml7700Resolution(s.gain, s.integrationMs),
  saturation: SATURATION,
}));
const POLICY: RangePolicy = { low: 100, high: 10_000, target: 5000 };

export class Veml7700Driver implements LightSensorDriver {
  readonly chip = 'VEML7700';
  private range = START_INDEX;
  private readyAt = 0;
  private initialized = false;

  get setting(): Veml7700Setting {
    return VEML7700_LADDER[this.range] ?? VEML7700_LADDER[START_INDEX]!;
  }

  async init(bus: I2cBus, now: number): Promise<void> {
    this.initialized = false;
    this.range = START_INDEX;
    await bus.writeWord(VEML7700_ADDRESS, VEML7700_REGISTERS.POWER_SAVING, 0);
    await this.configure(bus, now);
    this.initialized = true;
  }

  async read(bus: I2cBus, now: number): Promise<number | null> {
    if (!this.initialized || now < this.readyAt) return null;
    const counts = await bus.readWord(VEML7700_ADDRESS, VEML7700_REGISTERS.ALS);
    const setting = this.setting;
    const clipped = counts >= SATURATION;
    const leastSensitive = this.range === 0;
    const next = chooseRange(LADDER, this.range, counts, POLICY);
    if (next !== this.range) {
      this.range = next;
      await this.configure(bus, now);
    }
    if (clipped && !leastSensitive) return null;
    return clampLux(veml7700Lux(counts, setting));
  }

  async shutdown(bus: I2cBus): Promise<void> {
    await bus.writeWord(
      VEML7700_ADDRESS,
      VEML7700_REGISTERS.ALS_CONF,
      veml7700ConfigWord(this.setting, true),
    );
  }

  /** Shut down, apply the setting, power up; the first complete integration follows. */
  private async configure(bus: I2cBus, now: number): Promise<void> {
    const setting = this.setting;
    await bus.writeWord(
      VEML7700_ADDRESS,
      VEML7700_REGISTERS.ALS_CONF,
      veml7700ConfigWord(setting, true),
    );
    await bus.writeWord(VEML7700_ADDRESS, VEML7700_REGISTERS.ALS_CONF, veml7700ConfigWord(setting));
    // Power-on plus one full integration; two cycles leave margin for the internal timing.
    this.readyAt = now + 2 * setting.integrationMs + 10;
  }
}
