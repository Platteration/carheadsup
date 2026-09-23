/**
 * ROHM BH1750FVI ambient light sensor (I2C 0x23 with ADDR low, 0x5C with ADDR high).
 *
 * Runs in continuous high-resolution mode (1 lx/count at the default measurement time). The
 * measurement-time register MTreg (31–254, default 69) scales sensitivity: 254 gives 0.23 lx
 * resolution for night driving, 31 extends the range to ~120 klx for direct sun.
 * lux = counts / 1.2 × (69 / MTreg). Opcodes are plain one-byte writes; data is 2 bytes MSB first.
 */
import type { I2cBus } from '../i2c.ts';
import { clampLux, type LightSensorDriver } from './driver.ts';
import { chooseRange, type RangePolicy, type RangeStep } from './ranging.ts';

export const BH1750_ADDRESSES = [0x23, 0x5c] as const;

export const BH1750_OPCODES = {
  POWER_DOWN: 0x00,
  POWER_ON: 0x01,
  RESET: 0x07,
  CONTINUOUS_HIGH_RES: 0x10,
} as const;

export const BH1750_MTREG_DEFAULT = 69;
export const BH1750_MTREG_MIN = 31;
export const BH1750_MTREG_MAX = 254;
/** Counts per lux at the default measurement time (datasheet "measurement accuracy" 1.2). */
export const BH1750_COUNTS_PER_LUX = 1.2;

/** Measurement times used for auto-ranging, least to most sensitive. */
export const BH1750_MTREG_LADDER: readonly number[] = [
  BH1750_MTREG_MIN,
  BH1750_MTREG_DEFAULT,
  BH1750_MTREG_MAX,
];

/** Lux for a high-resolution-mode reading taken with measurement time `mtreg`. */
export function bh1750Lux(counts: number, mtreg: number): number {
  return (counts / BH1750_COUNTS_PER_LUX) * (BH1750_MTREG_DEFAULT / mtreg);
}

/** The two opcodes that set MTreg: 01000_MT[7:5] then 011_MT[4:0]. */
export function bh1750MtregOpcodes(mtreg: number): [number, number] {
  const mt = Math.min(BH1750_MTREG_MAX, Math.max(BH1750_MTREG_MIN, Math.round(mtreg)));
  return [0x40 | (mt >> 5), 0x60 | (mt & 0x1f)];
}

/** Worst-case high-resolution measurement time in ms (datasheet max 180 ms at MTreg 69). */
export function bh1750MeasurementMs(mtreg: number): number {
  return Math.ceil((180 * mtreg) / BH1750_MTREG_DEFAULT);
}

const SATURATION = 0xffff;
const LADDER: readonly RangeStep[] = BH1750_MTREG_LADDER.map((mt) => ({
  luxPerCount: bh1750Lux(1, mt),
  saturation: SATURATION,
}));
const POLICY: RangePolicy = { low: 100, high: 50_000, target: 20_000 };

export class Bh1750Driver implements LightSensorDriver {
  readonly chip = 'BH1750';
  private address: number | null = null;
  private range = 1;
  private readyAt = 0;

  /** The address the chip answered on, once initialised. */
  get i2cAddress(): number | null {
    return this.address;
  }

  /** Current measurement time register value. */
  get mtreg(): number {
    return BH1750_MTREG_LADDER[this.range] ?? BH1750_MTREG_DEFAULT;
  }

  async init(bus: I2cBus, now: number): Promise<void> {
    this.address = null;
    let lastError: unknown = null;
    for (const candidate of BH1750_ADDRESSES) {
      try {
        await bus.i2cWrite(candidate, [BH1750_OPCODES.POWER_ON]);
        this.address = candidate;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (this.address === null) {
      const reason = lastError instanceof Error ? `: ${lastError.message}` : '';
      throw new Error(`no BH1750 at 0x23 or 0x5C${reason}`);
    }
    await this.configure(bus, now);
  }

  async read(bus: I2cBus, now: number): Promise<number | null> {
    const address = this.address;
    if (address === null || now < this.readyAt) return null;
    const data = await bus.i2cRead(address, 2);
    const counts = ((data[0] ?? 0) << 8) | (data[1] ?? 0);
    const mt = this.mtreg;
    const clipped = counts >= SATURATION;
    const next = chooseRange(LADDER, this.range, counts, POLICY);
    const leastSensitive = this.range === 0;
    if (next !== this.range) {
      this.range = next;
      await this.configure(bus, now);
    }
    // A clipped reading is only meaningful (as "at least this bright") at the lowest sensitivity.
    if (clipped && !leastSensitive) return null;
    return clampLux(bh1750Lux(counts, mt));
  }

  async shutdown(bus: I2cBus): Promise<void> {
    if (this.address !== null) await bus.i2cWrite(this.address, [BH1750_OPCODES.POWER_DOWN]);
  }

  private async configure(bus: I2cBus, now: number): Promise<void> {
    const address = this.address;
    if (address === null) return;
    const [high, low] = bh1750MtregOpcodes(this.mtreg);
    await bus.i2cWrite(address, [high]);
    await bus.i2cWrite(address, [low]);
    // Re-issuing the mode starts a fresh measurement with the new measurement time.
    await bus.i2cWrite(address, [BH1750_OPCODES.CONTINUOUS_HIGH_RES]);
    this.readyAt = now + bh1750MeasurementMs(this.mtreg) + 10;
  }
}
