import {
  DEFAULT_CONFIG,
  type Ads1115FullScaleV,
  type HudConfig,
  type SwcWindow,
} from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import type { I2cOpener } from '../../src/sensors/i2c.ts';
import {
  ADS1115_REGISTERS as R,
  ADS1115_RESET_CONFIG,
  ads1115Config,
  conversionToVolts,
  registerValue,
  registerWrite,
  toSigned16,
} from '../../src/sensors/swc/ads1115.ts';
import { LadderDetector, classifyVoltage, sameZone } from '../../src/sensors/swc/ladder.ts';
import { Ads1115Reader, SWC_POLL_MS, SwcButtonSource } from '../../src/sensors/swc/source.ts';
import { FakeClock, FakeI2cBus, recordingContext } from './fakes.ts';

// ---------------------------------------------------------------------------------------------
// ADS1115 registers

describe('ADS1115 register math', () => {
  it('builds config words (MUX, PGA, MODE, DR, comparator off)', () => {
    // AIN0 vs GND, ±4.096 V, continuous, 128 SPS: 0100 0010 1000 0011.
    expect(ads1115Config({ channel: 0, fullScaleV: 4.096, continuous: true, dataRate: 128 })).toBe(
      0x4283,
    );
    // AIN3, ±6.144 V, single-shot started, 860 SPS: 1111 0001 1110 0011.
    expect(
      ads1115Config({ channel: 3, fullScaleV: 6.144, continuous: false, dataRate: 860 }, true),
    ).toBe(0xf1e3);
    // The power-up default is single-shot AIN0−AIN1 ±2.048 V 128 SPS; the same bits but MUX
    // single-ended give 0xC583 once started.
    expect(
      ads1115Config({ channel: 0, fullScaleV: 2.048, continuous: false, dataRate: 128 }, true),
    ).toBe(ADS1115_RESET_CONFIG | 0x4000);
    const gains: Array<[Ads1115FullScaleV, number]> = [
      [6.144, 0],
      [4.096, 1],
      [2.048, 2],
      [1.024, 3],
      [0.512, 4],
      [0.256, 5],
    ];
    for (const [fullScaleV, bits] of gains) {
      const word = ads1115Config({ channel: 1, fullScaleV, continuous: true, dataRate: 8 });
      expect((word >> 9) & 0b111, String(fullScaleV)).toBe(bits);
      expect((word >> 12) & 0b111).toBe(0b101); // AIN1 vs GND
      expect((word >> 5) & 0b111).toBe(0); // 8 SPS
    }
  });

  it('writes and reads registers big-endian', () => {
    expect(registerWrite(R.CONFIG, 0x4283)).toEqual([0x01, 0x42, 0x83]);
    expect(registerValue([0x42, 0x83])).toBe(0x4283);
    expect(registerValue(new Uint8Array([0xff, 0xfe]))).toBe(0xfffe);
  });

  it('scales signed conversion results to volts', () => {
    expect(toSigned16(0x7fff)).toBe(32767);
    expect(toSigned16(0x8000)).toBe(-32768);
    expect(toSigned16(0xffff)).toBe(-1);
    expect(conversionToVolts(16384, 4.096)).toBe(2.048);
    expect(conversionToVolts(32767, 4.096)).toBeCloseTo(4.096, 3);
    expect(conversionToVolts(-16, 4.096)).toBe(-0.002);
    expect(conversionToVolts(8000, 0.256)).toBeCloseTo(0.0625, 6);
  });
});

// ---------------------------------------------------------------------------------------------
// Window matching and the detector

const idle = { minV: 3, maxV: 3.6 };
const win = (minV: number, maxV: number, overrides: Partial<SwcWindow> = {}): SwcWindow => ({
  minV,
  maxV,
  action: 'next-page',
  longPressAction: null,
  ...overrides,
});
/** A typical ladder: next, previous, accept (hold = blank), decline. */
const LADDER: SwcWindow[] = [
  win(0, 0.3, { action: 'next-page' }),
  win(0.7, 1.0, { action: 'prev-page' }),
  win(1.4, 1.8, { action: 'primary', longPressAction: 'toggle-blank' }),
  win(2.2, 2.6, { action: 'secondary' }),
];

describe('classifyVoltage', () => {
  it('finds the window (ends included), else idle, else none', () => {
    expect(classifyVoltage(0.85, idle, LADDER)).toEqual({ kind: 'button', index: 1 });
    expect(classifyVoltage(1.4, idle, LADDER)).toEqual({ kind: 'button', index: 2 });
    expect(classifyVoltage(1.8, idle, LADDER)).toEqual({ kind: 'button', index: 2 });
    expect(classifyVoltage(3.3, idle, LADDER)).toEqual({ kind: 'idle' });
    expect(classifyVoltage(2.0, idle, LADDER)).toEqual({ kind: 'none' });
    expect(classifyVoltage(4.0, idle, LADDER)).toEqual({ kind: 'none' });
    expect(classifyVoltage(0.1, idle, [])).toEqual({ kind: 'none' });
  });

  it('compares zones by kind and window', () => {
    expect(sameZone({ kind: 'button', index: 1 }, { kind: 'button', index: 1 })).toBe(true);
    expect(sameZone({ kind: 'button', index: 1 }, { kind: 'button', index: 2 })).toBe(false);
    expect(sameZone({ kind: 'idle' }, { kind: 'idle' })).toBe(true);
    expect(sameZone({ kind: 'idle' }, { kind: 'none' })).toBe(false);
    expect(sameZone(null, null)).toBe(true);
    expect(sameZone({ kind: 'idle' }, null)).toBe(false);
  });
});

/** Feed readings 20 ms apart; returns "time kind action" lines. */
function feed(detector: LadderDetector, readings: number[], start = 0) {
  const out: string[] = [];
  readings.forEach((v, i) => {
    const at = start + i * SWC_POLL_MS;
    for (const a of detector.sample(v, at).actions) out.push(`${at} ${a.kind} ${a.action}`);
  });
  return out;
}

const repeat = (v: number, n: number) => new Array<number>(n).fill(v);

describe('LadderDetector', () => {
  it('acts once per press after three readings in a window', () => {
    const detector = new LadderDetector({ idle, windows: LADDER });
    const out = feed(detector, [
      ...repeat(3.3, 5),
      ...repeat(0.12, 50), // next held for a second
      ...repeat(3.3, 5),
      ...repeat(0.85, 4), // previous
      ...repeat(3.3, 3),
    ]);
    expect(out).toEqual(['140 press next-page', '1240 press prev-page']);
  });

  it('ignores the windows a voltage passes through and single outliers', () => {
    const detector = new LadderDetector({ idle, windows: LADDER });
    const out = feed(detector, [
      ...repeat(3.3, 4),
      2.4, // sweeping down past "decline" …
      1.6, // … and "accept" …
      0.9, // … to "previous"
      0.88,
      0.87,
      0.9,
      0.1, // one-off glitch
      0.9,
      0.91,
      ...repeat(3.3, 4),
    ]);
    expect(out).toEqual(['160 press prev-page']);
  });

  it('with a long-press action: short presses act on release, long ones once while held', () => {
    const detector = new LadderDetector({ idle, windows: LADDER });
    const short = feed(detector, [...repeat(3.3, 3), ...repeat(1.6, 20), ...repeat(3.3, 3)]);
    expect(short).toEqual(['500 release primary']);
    const long = feed(detector, [...repeat(1.6, 60), ...repeat(3.3, 3)], 1000);
    // Settled at 1040, held 800 ms.
    expect(long).toEqual(['1840 long-press toggle-blank']);
  });

  it('releases on any other settled zone, including one outside every window', () => {
    const detector = new LadderDetector({ idle, windows: LADDER });
    const out = feed(detector, [
      ...repeat(3.3, 3),
      ...repeat(1.6, 5), // accept (acts on release)
      ...repeat(2.0, 3), // between windows: released
      ...repeat(0.2, 3), // next
      ...repeat(0.85, 3), // straight to previous: next released, previous pressed
    ]);
    expect(out).toEqual(['200 release primary', '260 press next-page', '320 press prev-page']);
    expect(detector.pressedWindow).toBe(1);
  });

  it('ignores a button held when readings start until it is released', () => {
    const detector = new LadderDetector({ idle, windows: LADDER });
    const first = detector.sample(0.1, 0);
    detector.sample(0.1, 20);
    const settled = detector.sample(0.1, 40);
    expect(first.heldAtStart).toBe(false);
    expect(settled).toMatchObject({ actions: [], heldAtStart: true });
    expect(settled.zone?.zone).toEqual({ kind: 'button', index: 0 });
    expect(feed(detector, [...repeat(0.1, 50), ...repeat(3.3, 3), ...repeat(0.1, 3)], 60)).toEqual([
      '1160 press next-page',
    ]);
  });

  it('reports the steady voltage when it moves by more than 50 mV (calibration)', () => {
    const detector = new LadderDetector({ idle, windows: [] });
    const steady: number[] = [];
    const readings = [
      3.301,
      3.302,
      3.3, // steady at 3.301
      3.28,
      3.29,
      3.285, // within 50 mV: not reported again
      1.2,
      0.6,
      0.61,
      0.62, // settling, then steady at 0.61
      0.605,
      0.6,
      0.64, // noisy (spread 40 mV > 25 mV): nothing
      2.15,
      2.16,
      2.15,
    ];
    readings.forEach((v, i) => {
      const s = detector.sample(v, i * SWC_POLL_MS).steadyV;
      if (s !== null) steady.push(Number(s.toFixed(3)));
    });
    expect(steady).toEqual([3.301, 0.61, 2.153]);
  });

  it('starts over with new windows, and skips readings that are not numbers', () => {
    const detector = new LadderDetector({ idle, windows: LADDER });
    feed(detector, [...repeat(3.3, 3), ...repeat(0.1, 3)]);
    expect(detector.pressedWindow).toBe(0);
    detector.configure({ idle, windows: [win(0.05, 0.2, { action: 'brightness-down' })] });
    expect(detector.pressedWindow).toBeNull();
    expect(detector.zone).toBeNull();
    expect(feed(detector, [0.1, Number.NaN, 0.1, 0.1, 3.3, 3.3, 3.3, 0.1, 0.1, 0.1])).toEqual([
      '180 press brightness-down',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// The driver and the source against a simulated ADS1115

const FULL_SCALE_BY_PGA: readonly number[] = [
  6.144, 4.096, 2.048, 1.024, 0.512, 0.256, 0.256, 0.256,
];

/** A simulated ADS1115: registers, and a wire voltage the test sets. */
function simulatedAds1115() {
  const chip = { config: ADS1115_RESET_CONFIG, volts: 3.3, writes: [] as number[][] };
  const handlers = {
    i2cWrite: (bytes: number[]) => {
      chip.writes.push(bytes);
      if (bytes[0] === R.CONFIG && bytes.length === 3) {
        chip.config = ((bytes[1] ?? 0) << 8) | (bytes[2] ?? 0);
      }
    },
    readBlock: (register: number) => {
      if (register === R.CONFIG) return [chip.config >> 8, chip.config & 0xff];
      if (register !== R.CONVERSION) return [0, 0];
      const fullScale = FULL_SCALE_BY_PGA[(chip.config >> 9) & 0b111] ?? 2.048;
      const raw = Math.max(-32768, Math.min(32767, Math.round((chip.volts / fullScale) * 32768)));
      const word = raw & 0xffff;
      return [word >> 8, word & 0xff];
    },
  };
  return { chip, handlers };
}

/** An ADS1115 on a fake bus. */
function fakeAds1115(bus: FakeI2cBus, address = 0x48) {
  const { chip, handlers } = simulatedAds1115();
  bus.devices.set(address, handlers);
  return chip;
}

describe('Ads1115Reader', () => {
  it('configures continuous conversions, checks the readback and reads volts', async () => {
    const bus = new FakeI2cBus();
    const chip = fakeAds1115(bus, 0x49);
    const readings: number[] = [];
    const reader = new Ads1115Reader({
      address: 0x49,
      setup: { channel: 2, fullScaleV: 4.096 },
      onReading: (v) => readings.push(v),
    });
    expect(reader.label).toBe('ADS1115 steering-wheel buttons (0x49, AIN2)');
    await reader.init(bus);
    expect(chip.writes).toEqual([[0x01, 0x62, 0x83]]);
    chip.volts = 1.234;
    expect(await reader.poll(bus, 0)).toBe(SWC_POLL_MS);
    expect(readings[0]).toBeCloseTo(1.234, 3);
    await reader.shutdown(bus);
    // Back to single-shot (MODE = 1): the chip powers down.
    expect(chip.config & 0x0100).toBe(0x0100);
  });

  it('refuses a chip that does not echo its configuration', async () => {
    const bus = new FakeI2cBus();
    bus.devices.set(0x48, { readBlock: () => [0x85, 0x83] });
    const reader = new Ads1115Reader({
      address: 0x48,
      setup: { channel: 0, fullScaleV: 4.096 },
      onReading: () => {},
    });
    await expect(reader.init(bus)).rejects.toThrow(
      /configuration did not stick \(wrote 0x4283, read 0x8583\); is this an ADS1115\?/,
    );
  });
});

function swcConfig(swcButtons: Partial<HudConfig['sensors']['swcButtons']>): HudConfig {
  const config = structuredClone(DEFAULT_CONFIG) as HudConfig;
  config.sensors.swcButtons = { ...config.sensors.swcButtons, ...swcButtons };
  return config;
}

function harness() {
  const clock = new FakeClock();
  const { chip, handlers } = simulatedAds1115();
  const buses: FakeI2cBus[] = [];
  const opened: number[] = [];
  /** Every open gets a fresh bus handle to the same chip, like the real /dev/i2c-N. */
  const open: I2cOpener = async (n) => {
    opened.push(n);
    const bus = new FakeI2cBus();
    bus.devices.set(0x48, handlers);
    buses.push(bus);
    return bus;
  };
  const recording = recordingContext(clock);
  /** Hold the wire at `volts` for `ms`. */
  const hold = async (volts: number, ms: number) => {
    chip.volts = volts;
    await clock.advance(ms);
  };
  /** The bus handle opened last. */
  const bus = (): FakeI2cBus => {
    const last = buses[buses.length - 1];
    if (last === undefined) throw new Error('no bus opened');
    return last;
  };
  return { clock, chip, open, opened, hold, bus, ...recording };
}

describe('SwcButtonSource', () => {
  it('polls the ADC at 50 Hz and turns ladder presses into inputs', async () => {
    const h = harness();
    const src = new SwcButtonSource(swcConfig({ enabled: true, windows: LADDER }), {
      open: h.open,
    });
    await src.start(h.ctx);
    await h.hold(3.3, 200);
    await h.hold(0.15, 300); // next
    await h.hold(3.3, 200);
    await h.hold(1.6, 1000); // accept held: blank
    await h.hold(3.3, 200);
    await h.hold(2.4, 100); // decline
    await h.hold(3.3, 200);
    expect(h.ofType('input').map((e) => e.action)).toEqual([
      'next-page',
      'toggle-blank',
      'secondary',
    ]);
    const polls = h.bus().ops.filter((op) => op.op === 'readBlock' && op.register === R.CONVERSION);
    expect(polls.length).toBeGreaterThanOrEqual(100); // 2.2 s at 50 Hz
    expect(h.logger.lines('info').join('\n')).toMatch(
      /ADS1115 steering-wheel buttons \(0x48, AIN0\): ready on I2C bus 1/,
    );
    await src.stop();
    expect(h.clock.pendingTimers).toBe(0);
    expect(h.bus().closed).toBe(true);
  });

  it('logs the steady voltage at debug level for calibration', async () => {
    const h = harness();
    const src = new SwcButtonSource(swcConfig({ enabled: true, windows: [] }), { open: h.open });
    await src.start(h.ctx);
    await h.hold(3.3, 200);
    await h.hold(0.52, 200);
    await h.hold(0.54, 200); // within 50 mV: not logged again
    await h.hold(1.87, 200);
    expect(h.logger.lines('info').join('\n')).toMatch(
      /no button windows configured; with debug logging \(--log-level debug or CARHEADSUP_LOG_LEVEL=debug\)/,
    );
    expect(h.logger.lines('debug').filter((l) => l.includes('steady'))).toEqual([
      'SWC buttons: steady at 3.300 V (idle)',
      'SWC buttons: steady at 0.520 V (no window)',
      'SWC buttons: steady at 1.870 V (no window)',
    ]);
    // Readings outside every window and the idle range: one warning pointing at the log.
    expect(h.logger.lines('warn')).toEqual([
      expect.stringMatching(
        /0\.520 V matches no button window and is outside the idle range \(3–3\.6 V\)/,
      ),
    ]);
    await src.stop();
  });

  it('warns once about a button held at start and ignores it until released', async () => {
    const h = harness();
    const src = new SwcButtonSource(swcConfig({ enabled: true, windows: LADDER }), {
      open: h.open,
    });
    h.chip.volts = 0.1;
    await src.start(h.ctx);
    await h.hold(0.1, 2000);
    expect(h.ofType('input')).toEqual([]);
    expect(h.logger.lines('warn')).toEqual([
      expect.stringMatching(
        /reads 0\.100 V \(window 1: next-page\) at start; ignoring it until the button is released/,
      ),
    ]);
    await h.hold(3.3, 100);
    await h.hold(0.1, 100);
    expect(h.ofType('input').map((e) => e.action)).toEqual(['next-page']);
    await src.stop();
  });

  it('stays idle while disabled and starts when enabled', async () => {
    const h = harness();
    const src = new SwcButtonSource(swcConfig({ enabled: false, windows: LADDER }), {
      open: h.open,
    });
    await src.start(h.ctx);
    await h.clock.advance(1000);
    expect(h.opened).toEqual([]);
    await src.updateConfig(swcConfig({ enabled: true, windows: LADDER }));
    await h.hold(3.3, 100);
    await h.hold(0.85, 100);
    expect(h.opened).toEqual([1]);
    expect(h.ofType('input').map((e) => e.action)).toEqual(['prev-page']);
    await src.updateConfig(swcConfig({ enabled: false, windows: LADDER }));
    expect(h.bus().closed).toBe(true);
    await src.stop();
    expect(h.clock.pendingTimers).toBe(0);
  });

  it('applies new windows without touching the ADC; a new input re-initialises it', async () => {
    const h = harness();
    const config = swcConfig({ enabled: true, windows: LADDER });
    const src = new SwcButtonSource(config, { open: h.open });
    await src.start(h.ctx);
    await h.hold(3.3, 100);
    const writes = h.chip.writes.length;
    await src.updateConfig(
      swcConfig({ enabled: true, windows: [win(0, 0.3, { action: 'brightness-up' })] }),
    );
    await h.hold(3.3, 100);
    await h.hold(0.1, 100);
    expect(h.ofType('input').map((e) => e.action)).toEqual(['brightness-up']);
    expect(h.chip.writes.length).toBe(writes);
    expect(h.opened).toEqual([1]);

    // Unrelated settings change nothing.
    const other = swcConfig({ enabled: true, windows: [win(0, 0.3, { action: 'brightness-up' })] });
    other.sensors.lightSensorGain = 3;
    await src.updateConfig(other);
    expect(h.chip.writes.length).toBe(writes);

    await src.updateConfig(
      swcConfig({ enabled: true, channel: 3, windows: [win(0, 0.3, { action: 'brightness-up' })] }),
    );
    await h.clock.advance(50);
    expect(h.opened).toEqual([1, 1]);
    expect(h.chip.config >> 12).toBe(0b0111); // AIN3 vs GND
    await src.stop();
  });

  it('recovers from bus errors without acting on the interrupted press', async () => {
    const h = harness();
    const config = swcConfig({ enabled: true, windows: LADDER });
    const src = new SwcButtonSource(config, { open: h.open, retryMs: 1000 });
    await src.start(h.ctx);
    await h.hold(3.3, 100);
    await h.hold(1.6, 100); // accept pressed (acts on release) …
    h.bus().failNext = new Error('Remote I/O error');
    await h.clock.advance(20);
    expect(h.logger.lines('warn').join('\n')).toMatch(
      /read failed: Remote I\/O error; retrying every 1 s/,
    );
    // … released while the bus was down; after re-init no stale release or long press.
    await h.hold(3.3, 2000);
    expect(h.ofType('input')).toEqual([]);
    expect(h.logger.lines('info').join('\n')).toMatch(/working again/);
    await h.hold(0.1, 100);
    expect(h.ofType('input').map((e) => e.action)).toEqual(['next-page']);
    await src.stop();
  });
});
