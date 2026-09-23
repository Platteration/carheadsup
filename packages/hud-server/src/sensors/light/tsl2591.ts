/**
 * ams TSL2591 high-dynamic-range light sensor (I2C 0x29). Registers are addressed through a
 * command byte 0xA0 | register (CMD bit + "normal operation" transaction). Channel 0 sees the
 * full spectrum, channel 1 infrared only.
 *
 * Lux follows ams' recommended equation (as used by the Linux IIO driver):
 *   CPL = ATIME_ms × AGAIN / 408,  lux = (C0 − C1) × (1 − C1/C0) / CPL
 * with gain multipliers ×1 / ×25 / ×428 / ×9876. At 100 ms the ADC saturates at 37 888 counts,
 * otherwise at 65 535. Auto-ranging walks a gain × integration-time ladder.
 */
import type { I2cBus } from '../i2c.ts';
import { clampLux, type LightSensorDriver } from './driver.ts';
import { chooseRange, type RangePolicy, type RangeStep } from './ranging.ts';

export const TSL2591_ADDRESS = 0x29;
export const TSL2591_ID = 0x50;
/** Command bit (0x80) | normal-operation transaction (0x20). */
export const TSL2591_COMMAND = 0xa0;

export const TSL2591_REGISTERS = {
  ENABLE: 0x00,
  CONTROL: 0x01,
  ID: 0x12,
  STATUS: 0x13,
  C0DATAL: 0x14,
} as const;

export const TSL2591_ENABLE = { POWER_OFF: 0x00, PON: 0x01, AEN: 0x02 } as const;
/** STATUS bit: an integration completed since AEN was set. */
export const TSL2591_AVALID = 0x01;

export type Tsl2591Gain = 'low' | 'medium' | 'high' | 'max';

export const TSL2591_GAINS: Record<Tsl2591Gain, { bits: number; multiplier: number }> = {
  low: { bits: 0x00, multiplier: 1 },
  medium: { bits: 0x10, multiplier: 25 },
  high: { bits: 0x20, multiplier: 428 },
  max: { bits: 0x30, multiplier: 9876 },
};

/** Integration time in ms: 100, 200 … 600. */
export type Tsl2591IntegrationMs = 100 | 200 | 300 | 400 | 500 | 600;

export interface Tsl2591Setting {
  gain: Tsl2591Gain;
  integrationMs: Tsl2591IntegrationMs;
}

/** Lux coefficient ("device factor"). */
export const TSL2591_LUX_DF = 408;

/** Auto-ranging ladder, least to most sensitive. */
export const TSL2591_LADDER: readonly Tsl2591Setting[] = [
  { gain: 'low', integrationMs: 100 },
  { gain: 'medium', integrationMs: 100 },
  { gain: 'medium', integrationMs: 300 },
  { gain: 'high', integrationMs: 100 },
  { gain: 'high', integrationMs: 300 },
  { gain: 'max', integrationMs: 100 },
  { gain: 'max', integrationMs: 300 },
  { gain: 'max', integrationMs: 600 },
];
const START_INDEX = 1;

/** CONTROL register value (AGAIN bits 5:4, ATIME bits 2:0). */
export function tsl2591ControlByte(setting: Tsl2591Setting): number {
  return TSL2591_GAINS[setting.gain].bits | (setting.integrationMs / 100 - 1);
}

/** Largest ADC count at an integration time. */
export function tsl2591MaxCount(integrationMs: number): number {
  return integrationMs <= 100 ? 37_888 : 0xffff;
}

/** Counts per lux for a setting. */
export function tsl2591CountsPerLux(setting: Tsl2591Setting): number {
  return (setting.integrationMs * TSL2591_GAINS[setting.gain].multiplier) / TSL2591_LUX_DF;
}

/**
 * Lux from the two channels; 0 when there is no visible light (C1 ≥ C0 is pure infrared).
 * Callers must discard saturated readings first.
 */
export function tsl2591Lux(ch0: number, ch1: number, setting: Tsl2591Setting): number {
  if (!(ch0 > 0) || ch1 >= ch0) return 0;
  const cpl = tsl2591CountsPerLux(setting);
  return Math.max(0, ((ch0 - ch1) * (1 - ch1 / ch0)) / cpl);
}

const LADDER: readonly RangeStep[] = TSL2591_LADDER.map((s) => ({
  luxPerCount: 1 / tsl2591CountsPerLux(s),
  saturation: tsl2591MaxCount(s.integrationMs),
}));
const POLICY: RangePolicy = { low: 200, high: 30_000, target: 12_000 };

const reg = (register: number): number => TSL2591_COMMAND | register;

export class Tsl2591Driver implements LightSensorDriver {
  readonly chip = 'TSL2591';
  private range = START_INDEX;
  private readyAt = 0;
  private initialized = false;

  get setting(): Tsl2591Setting {
    return TSL2591_LADDER[this.range] ?? TSL2591_LADDER[START_INDEX]!;
  }

  async init(bus: I2cBus, now: number): Promise<void> {
    this.initialized = false;
    this.range = START_INDEX;
    const id = await bus.readByte(TSL2591_ADDRESS, reg(TSL2591_REGISTERS.ID));
    if (id !== TSL2591_ID) {
      throw new Error(`unexpected TSL2591 id 0x${id.toString(16)} (expected 0x50)`);
    }
    await this.configure(bus, now);
    this.initialized = true;
  }

  async read(bus: I2cBus, now: number): Promise<number | null> {
    if (!this.initialized || now < this.readyAt) return null;
    const status = await bus.readByte(TSL2591_ADDRESS, reg(TSL2591_REGISTERS.STATUS));
    if ((status & TSL2591_AVALID) === 0) return null;
    // One block read: reading C0DATAL latches all four data bytes consistently.
    const data = await bus.readBlock(TSL2591_ADDRESS, reg(TSL2591_REGISTERS.C0DATAL), 4);
    const ch0 = (data[0] ?? 0) | ((data[1] ?? 0) << 8);
    const ch1 = (data[2] ?? 0) | ((data[3] ?? 0) << 8);
    const setting = this.setting;
    const max = tsl2591MaxCount(setting.integrationMs);
    const clipped = ch0 >= max || ch1 >= max;
    const leastSensitive = this.range === 0;
    // Range on the full-spectrum channel; a clipped IR channel forces the least sensitive rung.
    const next = chooseRange(LADDER, this.range, clipped ? max : ch0, POLICY);
    if (next !== this.range) {
      this.range = next;
      await this.configure(bus, now);
    }
    if (clipped) return leastSensitive ? clampLux(tsl2591Lux(max, 0, setting)) : null;
    return clampLux(tsl2591Lux(ch0, ch1, setting));
  }

  async shutdown(bus: I2cBus): Promise<void> {
    await bus.writeByte(TSL2591_ADDRESS, reg(TSL2591_REGISTERS.ENABLE), TSL2591_ENABLE.POWER_OFF);
  }

  /** Disable the ADC, apply gain/time, re-enable: AVALID clears until a full integration. */
  private async configure(bus: I2cBus, now: number): Promise<void> {
    const setting = this.setting;
    await bus.writeByte(TSL2591_ADDRESS, reg(TSL2591_REGISTERS.ENABLE), TSL2591_ENABLE.PON);
    await bus.writeByte(
      TSL2591_ADDRESS,
      reg(TSL2591_REGISTERS.CONTROL),
      tsl2591ControlByte(setting),
    );
    await bus.writeByte(
      TSL2591_ADDRESS,
      reg(TSL2591_REGISTERS.ENABLE),
      TSL2591_ENABLE.PON | TSL2591_ENABLE.AEN,
    );
    this.readyAt = now + setting.integrationMs + 10;
  }
}
