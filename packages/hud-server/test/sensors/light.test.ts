import { DEFAULT_CONFIG, type HudConfig, type LightSensorKind } from '@carheadsup/core';
import { describe, expect, it, vi } from 'vitest';
import { I2cUnavailableError, openI2cBus, type I2cOpener } from '../../src/sensors/i2c.ts';
import {
  BH1750_OPCODES,
  Bh1750Driver,
  bh1750Lux,
  bh1750MeasurementMs,
  bh1750MtregOpcodes,
} from '../../src/sensors/light/bh1750.ts';
import { MAX_REPORTED_LUX } from '../../src/sensors/light/driver.ts';
import { chooseRange, type RangeStep } from '../../src/sensors/light/ranging.ts';
import { LIGHT_POLL_MS, LightSensorSource } from '../../src/sensors/light/source.ts';
import {
  TSL2591_ADDRESS,
  TSL2591_COMMAND,
  Tsl2591Driver,
  tsl2591ControlByte,
  tsl2591CountsPerLux,
  tsl2591Lux,
  tsl2591MaxCount,
} from '../../src/sensors/light/tsl2591.ts';
import {
  VEML7700_ADDRESS,
  Veml7700Driver,
  veml7700ConfigWord,
  veml7700CorrectLux,
  veml7700Lux,
  veml7700Resolution,
} from '../../src/sensors/light/veml7700.ts';
import { FakeClock, FakeI2cBus, recordingContext } from './fakes.ts';

function configWith(sensors: Partial<HudConfig['sensors']>): HudConfig {
  const config = structuredClone(DEFAULT_CONFIG) as HudConfig;
  config.sensors = { ...config.sensors, ...sensors };
  return config;
}

// ---------------------------------------------------------------------------------------------
// Chip math

describe('BH1750 math', () => {
  it('converts counts to lux (÷1.2 at the default measurement time, scaled by 69/MTreg)', () => {
    expect(bh1750Lux(120, 69)).toBeCloseTo(100, 6);
    expect(bh1750Lux(65_535, 69)).toBeCloseTo(54_612.5, 1);
    expect(bh1750Lux(254, 254)).toBeCloseTo(57.5, 6);
    expect(bh1750Lux(65_535, 31)).toBeCloseTo(121_557, 0);
  });

  it('encodes MTreg as 01000_MT[7:5] and 011_MT[4:0]', () => {
    expect(bh1750MtregOpcodes(69)).toEqual([0x42, 0x65]);
    expect(bh1750MtregOpcodes(254)).toEqual([0x47, 0x7e]);
    expect(bh1750MtregOpcodes(31)).toEqual([0x40, 0x7f]);
    // Clamped to the datasheet range.
    expect(bh1750MtregOpcodes(5)).toEqual(bh1750MtregOpcodes(31));
    expect(bh1750MtregOpcodes(999)).toEqual(bh1750MtregOpcodes(254));
  });

  it('scales the worst-case measurement time with MTreg', () => {
    expect(bh1750MeasurementMs(69)).toBe(180);
    expect(bh1750MeasurementMs(254)).toBe(663);
    expect(bh1750MeasurementMs(31)).toBe(81);
  });
});

describe('VEML7700 math', () => {
  it('uses 0.0042 lx/count at gain 2 / 800 ms, scaling with gain and integration time', () => {
    expect(veml7700Resolution(2, 800)).toBeCloseTo(0.0042, 10);
    expect(veml7700Resolution(1, 100)).toBeCloseTo(0.0672, 10);
    expect(veml7700Resolution(0.125, 25)).toBeCloseTo(2.1504, 10);
  });

  it('encodes gain (bits 12:11), integration time (bits 9:6) and shutdown (bit 0)', () => {
    expect(veml7700ConfigWord({ gain: 0.125, integrationMs: 100 })).toBe(0x1000);
    expect(veml7700ConfigWord({ gain: 2, integrationMs: 800 })).toBe(0x08c0);
    expect(veml7700ConfigWord({ gain: 0.25, integrationMs: 25 })).toBe(0x1b00);
    expect(veml7700ConfigWord({ gain: 1, integrationMs: 50 }, true)).toBe(0x0201);
  });

  it("applies Vishay's non-linearity correction (application-note example 1500 → ~1658 lx)", () => {
    expect(veml7700CorrectLux(1500)).toBeCloseTo(1658.1, 0);
    expect(veml7700CorrectLux(0)).toBe(0);
  });

  it('corrects above 1000 lx and at gains 1/8 and 1/4 only', () => {
    // Gain 1, 100 ms: 0.0672 lx/count → 500 lx stays linear, 2000 lx is corrected.
    expect(veml7700Lux(500 / 0.0672, { gain: 1, integrationMs: 100 })).toBeCloseTo(500, 6);
    expect(veml7700Lux(2000 / 0.0672, { gain: 1, integrationMs: 100 })).toBeCloseTo(
      veml7700CorrectLux(2000),
      6,
    );
    const lowGain = { gain: 0.25, integrationMs: 100 } as const;
    expect(veml7700Lux(100, lowGain)).toBeCloseTo(veml7700CorrectLux(100 * 0.2688), 6);
  });
});

describe('TSL2591 math', () => {
  it('computes counts-per-lux and lux with the ams equation', () => {
    const setting = { gain: 'medium', integrationMs: 100 } as const;
    expect(tsl2591CountsPerLux(setting)).toBeCloseTo((100 * 25) / 408, 10);
    // (1000 − 200) × (1 − 0.2) / 6.127… ≈ 104.4 lx
    expect(tsl2591Lux(1000, 200, setting)).toBeCloseTo(104.448, 2);
  });

  it('reports 0 lx for darkness or pure infrared', () => {
    const setting = { gain: 'max', integrationMs: 600 } as const;
    expect(tsl2591Lux(0, 0, setting)).toBe(0);
    expect(tsl2591Lux(500, 500, setting)).toBe(0);
    expect(tsl2591Lux(400, 600, setting)).toBe(0);
  });

  it('encodes gain and integration time and knows the 100 ms ADC limit', () => {
    expect(tsl2591ControlByte({ gain: 'low', integrationMs: 100 })).toBe(0x00);
    expect(tsl2591ControlByte({ gain: 'medium', integrationMs: 300 })).toBe(0x12);
    expect(tsl2591ControlByte({ gain: 'max', integrationMs: 600 })).toBe(0x35);
    expect(tsl2591MaxCount(100)).toBe(37_888);
    expect(tsl2591MaxCount(200)).toBe(65_535);
  });
});

describe('chooseRange', () => {
  // Three rungs: 10, 1 and 0.1 lux per count.
  const ladder: RangeStep[] = [
    { luxPerCount: 10, saturation: 1000 },
    { luxPerCount: 1, saturation: 1000 },
    { luxPerCount: 0.1, saturation: 1000 },
  ];
  const policy = { low: 20, high: 800, target: 400 };

  it('stays put inside the band', () => {
    expect(chooseRange(ladder, 1, 20, policy)).toBe(1);
    expect(chooseRange(ladder, 1, 800, policy)).toBe(1);
  });

  it('jumps to the most sensitive rung that keeps the count under the target', () => {
    expect(chooseRange(ladder, 0, 1, policy)).toBe(2); // 10 lx → 100 counts at 0.1 lx/count
    expect(chooseRange(ladder, 0, 0, policy)).toBe(2); // darkness → most sensitive
    expect(chooseRange(ladder, 2, 900, policy)).toBe(1); // 90 lx → 90 counts at rung 1 (900 at 2 is over target)
  });

  it('falls back to the least sensitive rung when a reading clips', () => {
    expect(chooseRange(ladder, 2, 1000, policy)).toBe(0);
    expect(chooseRange(ladder, 0, 5000, policy)).toBe(0);
  });

  it('never leaves the ladder', () => {
    expect(chooseRange(ladder, 2, 5, policy)).toBe(2);
    expect(chooseRange(ladder, 0, 950, policy)).toBe(0);
    expect(chooseRange(ladder, 7, 10, policy)).toBe(2);
    expect(chooseRange(ladder, 1, Number.NaN, policy)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Drivers on a fake bus

/** A BH1750 that answers with a lux level for whatever measurement time is set. */
function fakeBh1750(bus: FakeI2cBus, address: number, lux: () => number): { mtreg: () => number } {
  let high = 0x42;
  let low = 0x65;
  const mtreg = (): number => ((high & 0x07) << 5) | (low & 0x1f);
  bus.devices.set(address, {
    i2cWrite: ([op]) => {
      if (op === undefined) return;
      if ((op & 0xf8) === 0x40) high = op;
      else if ((op & 0xe0) === 0x60) low = op;
    },
    i2cRead: () => {
      const counts = Math.min(0xffff, Math.round(lux() * 1.2 * (mtreg() / 69)));
      return [counts >> 8, counts & 0xff];
    },
  });
  return { mtreg };
}

describe('Bh1750Driver', () => {
  it('probes 0x23 then 0x5C, powers on, sets MTreg 69 and continuous high-res mode', async () => {
    const bus = new FakeI2cBus();
    fakeBh1750(bus, 0x5c, () => 100);
    const driver = new Bh1750Driver();
    await driver.init(bus, 0);
    expect(driver.i2cAddress).toBe(0x5c);
    expect(
      bus.ops.map((o) =>
        o.op === 'i2cWrite' ? `${o.address.toString(16)}:${o.bytes[0]!.toString(16)}` : o.op,
      ),
    ).toEqual([
      '23:1', // no answer at 0x23
      '5c:1',
      '5c:42',
      '5c:65',
      '5c:10',
    ]);
  });

  it('fails init when no chip answers', async () => {
    const driver = new Bh1750Driver();
    await expect(driver.init(new FakeI2cBus(), 0)).rejects.toThrow(/no BH1750/);
  });

  it('returns null until the first measurement is complete, then lux', async () => {
    const bus = new FakeI2cBus();
    fakeBh1750(bus, 0x23, () => 250);
    const driver = new Bh1750Driver();
    await driver.init(bus, 0);
    expect(await driver.read(bus, 100)).toBeNull();
    expect(await driver.read(bus, 200)).toBeCloseTo(250, 0);
  });

  it('switches to the longest measurement time in the dark and back in daylight', async () => {
    const bus = new FakeI2cBus();
    let lux = 3;
    const chip = fakeBh1750(bus, 0x23, () => lux);
    const driver = new Bh1750Driver();
    await driver.init(bus, 0);
    // 3 lx is 4 counts at MTreg 69: still reported, and MTreg goes to 254 for the next reading.
    expect(await driver.read(bus, 200)).toBeCloseTo(3.3, 1);
    expect(driver.mtreg).toBe(254);
    expect(chip.mtreg()).toBe(254);
    expect(await driver.read(bus, 400)).toBeNull(); // settling (663 ms measurement)
    const dark = await driver.read(bus, 900);
    expect(Math.abs((dark ?? 0) - 3)).toBeLessThan(0.23); // 0.23 lx resolution
    lux = 20_000;
    // 20 klx clips at MTreg 254: not reported, back to the least sensitive setting.
    expect(await driver.read(bus, 1000)).toBeNull();
    expect(driver.mtreg).toBe(31);
    expect(await driver.read(bus, 1200)).toBeCloseTo(20_000, -1);
  });

  it('reports direct sunlight beyond the range as the clipped maximum at the lowest sensitivity', async () => {
    const bus = new FakeI2cBus();
    fakeBh1750(bus, 0x23, () => 500_000);
    const driver = new Bh1750Driver();
    await driver.init(bus, 0);
    expect(await driver.read(bus, 200)).toBeNull();
    const lux = await driver.read(bus, 400);
    expect(lux).toBeGreaterThan(120_000);
    expect(lux).toBeLessThanOrEqual(MAX_REPORTED_LUX);
  });
});

/** A VEML7700 whose ALS counts follow the configured gain / integration time. */
function fakeVeml7700(bus: FakeI2cBus, lux: () => number): { config: () => number } {
  let config = 0x0001;
  const gains = [1, 2, 0.125, 0.25] as const;
  const its: Record<number, number> = { 12: 25, 8: 50, 0: 100, 1: 200, 2: 400, 3: 800 };
  bus.devices.set(VEML7700_ADDRESS, {
    writeWord: (register, value) => {
      if (register === 0) config = value;
    },
    readWord: (register) => {
      if (register !== 4 || (config & 1) === 1) return 0;
      const gain = gains[(config >> 11) & 3]!;
      const it = its[(config >> 6) & 0xf]!;
      return Math.min(0xffff, Math.round(lux() / (0.0042 * (800 / it) * (2 / gain))));
    },
  });
  return { config: () => config };
}

describe('Veml7700Driver', () => {
  it('starts at gain 1/8, 100 ms (application note), powered up, power saving off', async () => {
    const bus = new FakeI2cBus();
    const chip = fakeVeml7700(bus, () => 300);
    const driver = new Veml7700Driver();
    await driver.init(bus, 0);
    expect(driver.setting).toEqual({ gain: 0.125, integrationMs: 100 });
    expect(chip.config()).toBe(0x1000);
    expect(bus.ops[0]).toEqual({ op: 'writeWord', address: 0x10, register: 3, value: 0 });
  });

  it('auto-ranges up in the dark and reports lux close to the truth', async () => {
    const bus = new FakeI2cBus();
    fakeVeml7700(bus, () => 2);
    const driver = new Veml7700Driver();
    await driver.init(bus, 0);
    expect(await driver.read(bus, 100)).toBeNull(); // integrating
    const first = await driver.read(bus, 300); // 2 lx ≈ 4 counts at 1/8: coarse but reported
    expect(first).not.toBeNull();
    expect(driver.setting).toEqual({ gain: 2, integrationMs: 800 });
    expect(await driver.read(bus, 1000)).toBeNull(); // settling after the jump
    expect(await driver.read(bus, 2000)).toBeCloseTo(2, 2);
  });

  it('shortens the integration time in bright light and applies the correction', async () => {
    const bus = new FakeI2cBus();
    fakeVeml7700(bus, () => 30_000);
    const driver = new Veml7700Driver();
    await driver.init(bus, 0);
    // 30 klx at 1/8, 100 ms = 55 804 counts: above 10 000 → 25 ms.
    await driver.read(bus, 300);
    expect(driver.setting).toEqual({ gain: 0.125, integrationMs: 25 });
    const lux = await driver.read(bus, 400);
    expect(lux).toBeCloseTo(Math.min(MAX_REPORTED_LUX, veml7700CorrectLux(13_951 * 2.1504)), -2);
  });

  it('powers down on shutdown', async () => {
    const bus = new FakeI2cBus();
    const chip = fakeVeml7700(bus, () => 100);
    const driver = new Veml7700Driver();
    await driver.init(bus, 0);
    await driver.shutdown(bus);
    expect(chip.config() & 1).toBe(1);
  });
});

/** A TSL2591 with an AVALID flag that clears whenever the ADC is re-enabled. */
function fakeTsl2591(
  bus: FakeI2cBus,
  lux: () => number,
  irFraction = 0.2,
): { control: () => number } {
  let control = 0;
  let enable = 0;
  let validAfterReads = 0;
  const gains: Record<number, number> = { 0: 1, 1: 25, 2: 428, 3: 9876 };
  bus.devices.set(TSL2591_ADDRESS, {
    readByte: (register) => {
      if (register === (TSL2591_COMMAND | 0x12)) return 0x50;
      if (register === (TSL2591_COMMAND | 0x13)) {
        validAfterReads -= 1;
        return (enable & 2) !== 0 && validAfterReads < 0 ? 1 : 0;
      }
      return 0;
    },
    writeByte: (register, value) => {
      if (register === (TSL2591_COMMAND | 0x00)) {
        enable = value;
        validAfterReads = 1;
      }
      if (register === (TSL2591_COMMAND | 0x01)) control = value;
    },
    readBlock: () => {
      const gain = gains[(control >> 4) & 3]!;
      const it = ((control & 7) + 1) * 100;
      const max = it === 100 ? 37_888 : 0xffff;
      const cpl = (it * gain) / 408;
      // Invert lux = (c0 − c1)(1 − c1/c0)/cpl with c1 = f·c0: lux = c0 (1 − f)² / cpl.
      const c0 = Math.min(max, Math.round((lux() * cpl) / (1 - irFraction) ** 2));
      const c1 = Math.min(max, Math.round(c0 * irFraction));
      return [c0 & 0xff, c0 >> 8, c1 & 0xff, c1 >> 8];
    },
  });
  return { control: () => control };
}

describe('Tsl2591Driver', () => {
  it('checks the chip id', async () => {
    const bus = new FakeI2cBus();
    bus.devices.set(TSL2591_ADDRESS, { readByte: () => 0x12 });
    await expect(new Tsl2591Driver().init(bus, 0)).rejects.toThrow(/unexpected TSL2591 id/);
  });

  it('waits for AVALID, reads both channels in one block and computes lux', async () => {
    const bus = new FakeI2cBus();
    fakeTsl2591(bus, () => 150);
    const driver = new Tsl2591Driver();
    await driver.init(bus, 0);
    expect(await driver.read(bus, 50)).toBeNull(); // integration still running
    expect(await driver.read(bus, 200)).toBeNull(); // AVALID not yet set
    expect(await driver.read(bus, 400)).toBeCloseTo(150, 0);
    expect(
      bus.ops.some(
        (o) => o.op === 'readBlock' && o.register === (TSL2591_COMMAND | 0x14) && o.length === 4,
      ),
    ).toBe(true);
  });

  it('ranges down to low gain in sunlight and up to maximum gain at night', async () => {
    const bus = new FakeI2cBus();
    let lux = 80_000;
    const chip = fakeTsl2591(bus, () => lux);
    const driver = new Tsl2591Driver();
    await driver.init(bus, 0);
    let t = 0;
    const settle = async (): Promise<number | null> => {
      let result: number | null = null;
      for (let i = 0; i < 20 && result === null; i++) {
        t += 700;
        result = await driver.read(bus, t);
      }
      return result;
    };
    expect(await settle()).toBeCloseTo(80_000, -2);
    expect(driver.setting.gain).toBe('low');
    expect(chip.control()).toBe(0x00);
    lux = 0.05;
    await settle(); // coarse reading that triggers the range change
    expect(await settle()).toBeCloseTo(0.05, 2);
    expect(driver.setting).toEqual({ gain: 'max', integrationMs: 600 });
  });
});

// ---------------------------------------------------------------------------------------------
// The source

function source(kind: LightSensorKind, open: I2cOpener, gain = 1) {
  return new LightSensorSource(configWith({ lightSensor: kind, lightSensorGain: gain }), {
    open,
    retryMs: 1000,
  });
}

describe('LightSensorSource', () => {
  it('does nothing when no sensor is configured', async () => {
    const clock = new FakeClock();
    const open = vi.fn<I2cOpener>();
    const src = source('none', open);
    const { ctx, events } = recordingContext(clock);
    await src.start(ctx);
    await clock.advance(5000);
    expect(open).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(clock.pendingTimers).toBe(0);
    await src.stop();
  });

  it('polls at ~5 Hz and emits lux × the window gain', async () => {
    const clock = new FakeClock();
    const bus = new FakeI2cBus();
    fakeBh1750(bus, 0x23, () => 500);
    const src = source(
      'bh1750',
      async (n) => {
        expect(n).toBe(1);
        return bus;
      },
      1.5,
    );
    const { ctx, ofType, logger } = recordingContext(clock);
    await src.start(ctx);
    await clock.advance(1000);
    const readings = ofType('sensor/light');
    expect(readings.length).toBeGreaterThanOrEqual(3);
    expect(readings.length).toBeLessThanOrEqual(1000 / LIGHT_POLL_MS);
    for (const r of readings) expect(r.lux).toBeCloseTo(750, 0);
    expect(logger.lines('info').join('\n')).toMatch(/BH1750 light sensor: ready on I2C bus 1/);
    await src.stop();
    expect(bus.closed).toBe(true);
    // Powered down before closing.
    expect(bus.ops.at(-2)).toEqual({
      op: 'i2cWrite',
      address: 0x23,
      bytes: [BH1750_OPCODES.POWER_DOWN],
    });
    expect(clock.pendingTimers).toBe(0);
  });

  it('keeps reporting when the wall clock steps back during a measurement', async () => {
    const clock = new FakeClock();
    const bus = new FakeI2cBus();
    fakeBh1750(bus, 0x23, () => 500);
    const src = source('bh1750', async () => bus);
    const recording = recordingContext(clock);
    // Timers run on a monotonic base; only the wall clock (`now`) steps.
    let offset = 0;
    const ctx = { ...recording.ctx, now: () => clock.now() + offset };
    await src.start(ctx);
    await clock.advance(0); // initialised: the first measurement completes 190 ms from now
    offset = -60_000;
    await clock.advance(1000);
    expect(recording.ofType('sensor/light').length).toBeGreaterThanOrEqual(3);
    await src.stop();
  });

  it('applies a new gain without re-initialising the chip, and restarts on a new chip or bus', async () => {
    const clock = new FakeClock();
    const buses: FakeI2cBus[] = [];
    const open: I2cOpener = async () => {
      const bus = new FakeI2cBus();
      fakeBh1750(bus, 0x23, () => 100);
      fakeVeml7700(bus, () => 100);
      buses.push(bus);
      return bus;
    };
    const config = configWith({ lightSensor: 'bh1750' });
    const src = new LightSensorSource(config, { open });
    const { ctx, ofType } = recordingContext(clock);
    await src.start(ctx);
    await clock.advance(1000);
    const inits = (): number =>
      buses[0]!.ops.filter((o) => o.op === 'i2cWrite' && o.bytes[0] === 0x01).length;
    expect(inits()).toBe(1);

    await src.updateConfig(configWith({ lightSensor: 'bh1750', lightSensorGain: 2 }));
    const before = ofType('sensor/light').length;
    await clock.advance(1000);
    expect(
      ofType('sensor/light')
        .slice(before)
        .every((e) => Math.abs(e.lux - 200) < 1),
    ).toBe(true);
    expect(inits()).toBe(1);
    expect(buses).toHaveLength(1);

    await src.updateConfig(configWith({ lightSensor: 'veml7700', lightSensorGain: 2 }));
    expect(buses[0]!.closed).toBe(true);
    await clock.advance(1000);
    expect(buses).toHaveLength(2);
    expect(buses[1]!.ops.some((o) => o.op === 'writeWord' && o.address === VEML7700_ADDRESS)).toBe(
      true,
    );

    await src.updateConfig(configWith({ lightSensor: 'none' }));
    expect(buses[1]!.closed).toBe(true);
    expect(clock.pendingTimers).toBe(0);
    await src.stop();
  });

  it('logs an unplugged sensor once, keeps retrying and recovers', async () => {
    const clock = new FakeClock();
    const bus = new FakeI2cBus();
    const src = source('bh1750', async () => bus);
    const { ctx, ofType, logger } = recordingContext(clock);
    await src.start(ctx);
    await clock.advance(5500); // init fails at 0, 1000, 2000 … (retryMs 1000)
    expect(logger.lines('warn')).toHaveLength(1);
    expect(logger.lines('warn')[0]).toMatch(/not responding on I2C bus 1.*retrying/);
    expect(ofType('sensor/light')).toEqual([]);

    fakeBh1750(bus, 0x23, () => 42);
    await clock.advance(2000);
    expect(logger.lines('info').join('\n')).toMatch(/working again/);
    expect(ofType('sensor/light').length).toBeGreaterThan(0);

    // The chip falls off the bus mid-drive: one warning, then recovery.
    bus.unplugged = true;
    await clock.advance(3000);
    expect(logger.lines('warn')).toHaveLength(2);
    expect(logger.lines('warn')[1]).toMatch(/read failed/);
    bus.unplugged = false;
    const count = ofType('sensor/light').length;
    await clock.advance(2000);
    expect(ofType('sensor/light').length).toBeGreaterThan(count);
    await src.stop();
    expect(clock.pendingTimers).toBe(0);
  });

  it('stays idle after one log line when the i2c-bus package is missing', async () => {
    const clock = new FakeClock();
    const open = vi.fn<I2cOpener>(async () => {
      throw new I2cUnavailableError("the optional 'i2c-bus' package is not available");
    });
    const src = source('tsl2591', open);
    const { ctx, logger } = recordingContext(clock);
    await src.start(ctx);
    await clock.advance(60_000);
    expect(open).toHaveBeenCalledTimes(1);
    expect(logger.lines('warn')).toEqual([
      "TSL2591 light sensor: disabled — the optional 'i2c-bus' package is not available",
    ]);
    expect(clock.pendingTimers).toBe(0);
    await src.stop();
  });

  it('survives the real i2c-bus opener on a bus that does not exist', async () => {
    const clock = new FakeClock();
    const config = configWith({ lightSensor: 'bh1750', i2cBus: 250 });
    const src = new LightSensorSource(config, { open: openI2cBus, retryMs: 1000 });
    const { ctx, events, logger } = recordingContext(clock);
    await src.start(ctx);
    await clock.advance(1);
    // Real native / module I/O completes outside the fake clock.
    await vi.waitFor(() => expect(logger.lines('warn').length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    expect(logger.lines('warn')[0]).toMatch(/BH1750 light sensor/);
    await clock.advance(3000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(logger.lines('warn')).toHaveLength(1);
    expect(events).toEqual([]);
    await src.stop();
  });
});
