import { DEFAULT_CONFIG, type HudConfig } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import {
  APDS9960_ADDRESS,
  APDS9960_INIT_SEQUENCE,
  APDS9960_REGISTERS as R,
  GESTURE_ACTIONS,
  GestureAccumulator,
  decodeGesture,
  parseGestureFifo,
  type GestureSample,
} from '../../src/sensors/gesture/apds9960.ts';
import { Apds9960Device, GestureSensorSource } from '../../src/sensors/gesture/source.ts';
import type { I2cOpener } from '../../src/sensors/i2c.ts';
import { FakeClock, FakeI2cBus, recordingContext } from './fakes.ts';

/**
 * A synthetic swipe: each photodiode sees a bell-shaped reflection as the hand passes, peaking
 * earlier on the side the hand comes from (in the sensor's optical convention).
 */
function swipe(
  peaks: { u: number; d: number; l: number; r: number },
  count = 24,
  amplitude = 200,
): GestureSample[] {
  const samples: GestureSample[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const level = (peak: number): number =>
      Math.round(4 + amplitude * Math.exp(-(((t - peak) / 0.28) ** 2)));
    samples.push({ u: level(peaks.u), d: level(peaks.d), l: level(peaks.l), r: level(peaks.r) });
  }
  return samples;
}

const RIGHT = swipe({ u: 0.5, d: 0.5, l: 0.68, r: 0.32 });
const LEFT = swipe({ u: 0.5, d: 0.5, l: 0.32, r: 0.68 });
const UP = swipe({ u: 0.32, d: 0.68, l: 0.5, r: 0.5 });
const DOWN = swipe({ u: 0.68, d: 0.32, l: 0.5, r: 0.5 });

/** A left swipe as the FIFO delivers it (U, D, L, R bytes per dataset). */
const LEFT_FIFO_BYTES = [
  20, 18, 60, 15, 45, 40, 120, 30, 90, 85, 160, 70, 140, 130, 150, 140, 150, 145, 90, 170, 100, 95,
  40, 140, 50, 48, 18, 70, 22, 20, 12, 30,
];

describe('parseGestureFifo', () => {
  it('splits bytes into U/D/L/R datasets and drops a trailing partial dataset', () => {
    expect(parseGestureFifo([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([
      { u: 1, d: 2, l: 3, r: 4 },
      { u: 5, d: 6, l: 7, r: 8 },
    ]);
    expect(parseGestureFifo([])).toEqual([]);
  });
});

describe('decodeGesture', () => {
  it('decodes the four swipe directions', () => {
    expect(decodeGesture(RIGHT)).toBe('right');
    expect(decodeGesture(LEFT)).toBe('left');
    expect(decodeGesture(UP)).toBe('up');
    expect(decodeGesture(DOWN)).toBe('down');
  });

  it('decodes raw FIFO data', () => {
    expect(decodeGesture(parseGestureFifo(LEFT_FIFO_BYTES))).toBe('left');
  });

  it('picks the dominant axis of a diagonal swipe', () => {
    expect(decodeGesture(swipe({ u: 0.45, d: 0.55, l: 0.7, r: 0.3 }))).toBe('right');
    expect(decodeGesture(swipe({ u: 0.3, d: 0.7, l: 0.45, r: 0.55 }))).toBe('up');
  });

  it('ignores a hand moving straight towards the sensor (near/far)', () => {
    expect(decodeGesture(swipe({ u: 0.5, d: 0.5, l: 0.5, r: 0.5 }))).toBeNull();
  });

  it('ignores weak reflections, too few datasets and an empty gesture', () => {
    expect(decodeGesture(swipe({ u: 0.5, d: 0.5, l: 0.7, r: 0.3 }, 24, 5))).toBeNull();
    expect(decodeGesture(RIGHT.slice(10, 13))).toBeNull();
    expect(decodeGesture([])).toBeNull();
  });

  it('honours the sensitivity option', () => {
    const slight = swipe({ u: 0.5, d: 0.5, l: 0.51, r: 0.49 }); // balance shifts ~17 points
    expect(decodeGesture(slight)).toBeNull();
    expect(decodeGesture(slight, { sensitivity: 10 })).toBe('right');
  });

  it('maps swipes onto HUD inputs', () => {
    expect(GESTURE_ACTIONS).toEqual({
      right: 'primary',
      left: 'secondary',
      up: 'brightness-up',
      down: 'brightness-down',
    });
  });
});

describe('GestureAccumulator', () => {
  it('finishes a gesture when the engine goes idle', () => {
    const acc = new GestureAccumulator();
    expect(acc.finish(0, true)).toBeUndefined(); // nothing collected
    acc.add(RIGHT.slice(0, 12), 0);
    expect(acc.finish(40, false)).toBeUndefined(); // engine still running, data is fresh
    acc.add(RIGHT.slice(12), 40);
    expect(acc.finish(80, true)).toBe('right');
    expect(acc.active).toBe(false);
  });

  it('finishes after a quiet period even if the engine never reports idle', () => {
    const acc = new GestureAccumulator({ quietMs: 150 });
    acc.add(UP, 0);
    expect(acc.finish(100, false)).toBeUndefined();
    expect(acc.finish(150, false)).toBe('up');
  });

  it('discards a hovering hand', () => {
    const acc = new GestureAccumulator({ maxSamples: 50 });
    for (let t = 0; t < 10; t++) acc.add(RIGHT, t * 40);
    expect(acc.active).toBe(true);
    expect(acc.finish(1000, true)).toBeNull();
    // The next swipe is decoded normally.
    acc.add(LEFT, 2000);
    expect(acc.finish(2100, true)).toBe('left');
  });
});

/** Register-level APDS-9960 fake with a gesture FIFO the test fills. */
function fakeApds(bus: FakeI2cBus, id = 0xab) {
  const fifo: number[][] = [];
  const registers = new Map<number, number>();
  let gmode = false;
  /** A corrupted GFLVL reading (bus glitch). */
  let glitchLevel: number | null = null;
  bus.devices.set(APDS9960_ADDRESS, {
    readByte: (register) => {
      if (register === R.ID) return id;
      if (register === R.GSTATUS) return fifo.length >= 4 || glitchLevel !== null ? 1 : 0;
      if (register === R.GFLVL) return glitchLevel ?? fifo.length;
      if (register === R.GCONF4) return gmode ? 1 : 0;
      return registers.get(register) ?? 0;
    },
    writeByte: (register, value) => {
      registers.set(register, value);
      if (register === R.GCONF4 && (value & 0x04) !== 0) fifo.length = 0;
    },
    readBlock: (register, length) => {
      expect(register).toBe(R.GFIFO_U);
      expect(length).toBeLessThanOrEqual(32);
      const out: number[] = [];
      while (out.length < length) {
        const dataset = fifo.shift();
        if (dataset === undefined) break;
        out.push(...dataset);
      }
      while (out.length < length) out.push(0);
      return out;
    },
  });
  return {
    registers,
    push(samples: readonly GestureSample[]) {
      gmode = true;
      for (const s of samples) fifo.push([s.u, s.d, s.l, s.r]);
    },
    end() {
      gmode = false;
    },
    glitch(level: number | null) {
      glitchLevel = level;
    },
    get level() {
      return fifo.length;
    },
  };
}

describe('Apds9960Device', () => {
  it('writes the gesture configuration and enables the engine last', async () => {
    const bus = new FakeI2cBus();
    const chip = fakeApds(bus);
    const device = new Apds9960Device({ onSwipe: () => {} });
    await device.init(bus);
    const writes = bus.ops.filter((o) => o.op === 'writeByte');
    expect(writes.map((o) => [o.register, o.value])).toEqual(
      APDS9960_INIT_SEQUENCE.map(([r, v]) => [r, v]),
    );
    expect(chip.registers.get(R.ENABLE)).toBe(0x4d); // PON | PEN | WEN | GEN
  });

  it('reports an unknown chip id but keeps going (clones)', async () => {
    const bus = new FakeI2cBus();
    fakeApds(bus, 0x42);
    const ids: number[] = [];
    const device = new Apds9960Device({ onSwipe: () => {}, onUnknownId: (id) => ids.push(id) });
    await device.init(bus);
    expect(ids).toEqual([0x42]);
  });

  it('drains the FIFO in ≤ 32-byte reads and emits one action per swipe', async () => {
    const bus = new FakeI2cBus();
    const chip = fakeApds(bus);
    const actions: string[] = [];
    const device = new Apds9960Device({ onSwipe: (a) => actions.push(a) });
    await device.init(bus);
    chip.push(RIGHT.slice(0, 10));
    await device.poll(bus, 0);
    expect(chip.level).toBe(0);
    const reads = bus.ops.filter((o) => o.op === 'readBlock');
    expect(reads.map((o) => (o.op === 'readBlock' ? o.length : 0))).toEqual([32, 8]);
    chip.push(RIGHT.slice(10));
    await device.poll(bus, 40);
    await device.poll(bus, 80); // FIFO empty, engine still in gesture mode, data fresh
    expect(actions).toEqual([]);
    chip.end();
    await device.poll(bus, 120);
    expect(actions).toEqual(['primary']);
    // Idle polls only read the status register.
    const before = bus.ops.length;
    await device.poll(bus, 160);
    expect(bus.ops.slice(before).map((o) => o.op)).toEqual(['readByte']);
  });

  it('never reads more than the 32-dataset FIFO, whatever GFLVL claims', async () => {
    const bus = new FakeI2cBus();
    const chip = fakeApds(bus);
    const device = new Apds9960Device({ onSwipe: () => {} });
    await device.init(bus);
    chip.glitch(0xff);
    await device.poll(bus, 0);
    const reads = bus.ops.filter((o) => o.op === 'readBlock');
    expect(reads.map((o) => (o.op === 'readBlock' ? o.length : 0))).toEqual([32, 32, 32, 32]);
  });

  it('collects the tail of a gesture below the FIFO threshold', async () => {
    const bus = new FakeI2cBus();
    const chip = fakeApds(bus);
    const actions: string[] = [];
    const device = new Apds9960Device({ onSwipe: (a) => actions.push(a) });
    await device.init(bus);
    chip.push(DOWN.slice(0, 21));
    await device.poll(bus, 0);
    chip.push(DOWN.slice(21)); // 3 datasets: GVALID stays low
    chip.end();
    await device.poll(bus, 40);
    await device.poll(bus, 80);
    expect(actions).toEqual(['brightness-down']);
  });
});

function gestureConfig(kind: 'none' | 'apds9960', i2cBus = 1): HudConfig {
  const config = structuredClone(DEFAULT_CONFIG) as HudConfig;
  config.sensors = { ...config.sensors, gestureSensor: kind, i2cBus };
  return config;
}

describe('GestureSensorSource', () => {
  it('emits input events for swipes', async () => {
    const clock = new FakeClock();
    const bus = new FakeI2cBus();
    const chip = fakeApds(bus);
    const src = new GestureSensorSource(gestureConfig('apds9960'), { open: async () => bus });
    const { ctx, ofType } = recordingContext(clock);
    await src.start(ctx);
    await clock.advance(100);
    chip.push(LEFT);
    await clock.advance(100);
    chip.end();
    await clock.advance(200);
    chip.push(UP);
    await clock.advance(100);
    chip.end();
    await clock.advance(200);
    expect(ofType('input').map((e) => e.action)).toEqual(['secondary', 'brightness-up']);
    expect(ofType('input').every((e) => e.at === clock.now() || e.at < clock.now())).toBe(true);
    await src.stop();
    expect(bus.closed).toBe(true);
    expect(chip.registers.get(R.ENABLE)).toBe(0); // powered down
    expect(clock.pendingTimers).toBe(0);
  });

  it('stays idle when disabled and starts when enabled in the settings', async () => {
    const clock = new FakeClock();
    const opened: number[] = [];
    const open: I2cOpener = async (n) => {
      opened.push(n);
      const bus = new FakeI2cBus();
      fakeApds(bus);
      return bus;
    };
    const src = new GestureSensorSource(gestureConfig('none'), { open });
    const { ctx } = recordingContext(clock);
    await src.start(ctx);
    await clock.advance(1000);
    expect(opened).toEqual([]);
    await src.updateConfig(gestureConfig('none')); // unchanged: nothing happens
    await src.updateConfig(gestureConfig('apds9960', 3));
    await clock.advance(100);
    expect(opened).toEqual([3]);
    await src.updateConfig(gestureConfig('apds9960', 3)); // unchanged: no restart
    await clock.advance(100);
    expect(opened).toEqual([3]);
    await src.stop();
    expect(clock.pendingTimers).toBe(0);
  });

  it('logs a missing sensor once and keeps retrying quietly', async () => {
    const clock = new FakeClock();
    const bus = new FakeI2cBus();
    const src = new GestureSensorSource(gestureConfig('apds9960'), {
      open: async () => bus,
      retryMs: 500,
    });
    const { ctx, logger } = recordingContext(clock);
    await src.start(ctx);
    await clock.advance(5000);
    expect(logger.lines('warn')).toHaveLength(1);
    expect(logger.lines('warn')[0]).toMatch(/APDS-9960 gesture sensor: not responding/);
    await src.stop();
  });
});
