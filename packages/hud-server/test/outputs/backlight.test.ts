import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HudFrame } from '@carheadsup/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKLIGHT_MIN_INTERVAL_MS,
  BacklightSink,
  backlightLevel,
  frameBacklightBrightness,
  nodeBacklightFs,
  type BacklightFs,
} from '../../src/outputs/backlight.ts';
import { createFrameSinks } from '../../src/outputs/index.ts';
import { FakeClock, memoryLogger } from '../sensors/fakes.ts';

function frame(brightness: number, blanked = false): HudFrame {
  return { blanked, theme: { night: false, brightness } } as HudFrame;
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'carheadsup-backlight-'));
});
afterEach(async () => {
  await chmod(root, 0o755).catch(() => {});
  await rm(root, { recursive: true, force: true });
});

async function device(name: string, max: number | string, current = '0'): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'max_brightness'), `${max}\n`);
  await writeFile(join(dir, 'brightness'), `${current}\n`);
  return dir;
}

const readLevel = async (dir: string): Promise<string> =>
  (await readFile(join(dir, 'brightness'), 'utf8')).trim();

function setup() {
  const clock = new FakeClock();
  const logger = memoryLogger();
  return { clock, logger, deps: { now: clock.now, timers: clock, logger } };
}

describe('backlightLevel', () => {
  it('maps perceived brightness through a 2.2 gamma onto the device range', () => {
    expect(backlightLevel(1, 255)).toBe(255);
    expect(backlightLevel(0.5, 255)).toBe(Math.round(255 * 0.5 ** 2.2)); // 55
    expect(backlightLevel(0.1, 1000)).toBe(6);
    expect(backlightLevel(0.5, 100, 1)).toBe(50);
  });

  it('never returns 0 and survives bad input', () => {
    expect(backlightLevel(0, 255)).toBe(1);
    expect(backlightLevel(0.01, 255)).toBe(1);
    expect(backlightLevel(-1, 255)).toBe(1);
    expect(backlightLevel(Number.NaN, 255)).toBe(255); // unknown → never dark
    expect(backlightLevel(3, 255)).toBe(255);
    expect(backlightLevel(0.5, 1)).toBe(1);
    expect(backlightLevel(0.5, 0)).toBe(1);
  });

  it('reads the brightness a frame asks for (minimum while blanked)', () => {
    expect(frameBacklightBrightness(frame(0.7))).toBe(0.7);
    expect(frameBacklightBrightness(frame(0.7, true))).toBe(0);
    expect(frameBacklightBrightness(frame(1.5))).toBe(1);
    expect(frameBacklightBrightness(frame(Number.NaN))).toBeNull();
  });
});

describe('BacklightSink', () => {
  it('writes the gamma-mapped level to <dir>/brightness', async () => {
    const dir = await device('panel', 255);
    const { clock, deps } = setup();
    const sink = new BacklightSink({ directory: dir }, deps);
    sink.onFrame(frame(0.5)); // arrives before the device is opened
    expect(await sink.whenReady()).toEqual({ directory: dir, maxBrightness: 255 });
    await sink.whenIdle();
    expect(await readLevel(dir)).toBe('55');
    await clock.advance(BACKLIGHT_MIN_INTERVAL_MS);
    sink.onFrame(frame(1));
    await sink.whenIdle();
    expect(await readLevel(dir)).toBe('255');
    await sink.stop();
  });

  it('drops to the minimum (never 0) while blanked', async () => {
    const dir = await device('panel', 1023);
    const { clock, deps } = setup();
    const sink = new BacklightSink({ directory: dir }, deps);
    await sink.whenReady();
    sink.onFrame(frame(0.8, true));
    await sink.whenIdle();
    expect(await readLevel(dir)).toBe('1');
    await clock.advance(BACKLIGHT_MIN_INTERVAL_MS);
    sink.onFrame(frame(0.8));
    await sink.whenIdle();
    expect(await readLevel(dir)).toBe(String(backlightLevel(0.8, 1023)));
    await sink.stop();
  });

  it('skips changes under 1 % but always reaches the ends of the range', async () => {
    const dir = await device('panel', 10_000);
    const writes: string[] = [];
    const fs: BacklightFs = {
      ...nodeBacklightFs,
      writeFile: async (path, data) => {
        writes.push(data);
        await nodeBacklightFs.writeFile(path, data);
      },
    };
    const { clock, deps } = setup();
    const sink = new BacklightSink({ directory: dir, fs }, deps);
    await sink.whenReady();
    sink.onFrame(frame(0.5));
    await sink.whenIdle();
    for (const b of [0.505, 0.509, 0.495]) {
      await clock.advance(BACKLIGHT_MIN_INTERVAL_MS);
      sink.onFrame(frame(b));
      await sink.whenIdle();
    }
    expect(writes).toHaveLength(1);
    await clock.advance(BACKLIGHT_MIN_INTERVAL_MS);
    sink.onFrame(frame(0.51));
    await sink.whenIdle();
    expect(writes).toHaveLength(2);
    await clock.advance(BACKLIGHT_MIN_INTERVAL_MS);
    sink.onFrame(frame(0.995));
    await sink.whenIdle();
    await clock.advance(BACKLIGHT_MIN_INTERVAL_MS);
    sink.onFrame(frame(1));
    await sink.whenIdle();
    expect(writes.at(-1)).toBe('10000');
    // The same level again is never rewritten.
    await clock.advance(BACKLIGHT_MIN_INTERVAL_MS);
    sink.onFrame(frame(1));
    await sink.whenIdle();
    expect(writes.filter((w) => w === '10000')).toHaveLength(1);
    await sink.stop();
  });

  it('writes at most 10 times per second and lands the latest value', async () => {
    const dir = await device('panel', 255);
    const writes: Array<{ at: number; data: string }> = [];
    const { clock, deps } = setup();
    const fs: BacklightFs = {
      ...nodeBacklightFs,
      writeFile: async (path, data) => {
        writes.push({ at: clock.now(), data });
        await nodeBacklightFs.writeFile(path, data);
      },
    };
    const sink = new BacklightSink({ directory: dir, fs }, deps);
    await sink.whenReady();
    // 60 frames per second for one second, brightness ramping up.
    for (let i = 0; i <= 60; i++) {
      sink.onFrame(frame(0.2 + i * 0.01));
      await clock.advance(1000 / 60);
      await sink.whenIdle();
    }
    await clock.advance(200);
    await sink.whenIdle();
    // ~1.2 s of frames at 60 fps: at most one write per 100 ms (61 frames otherwise).
    const spanMs = writes.at(-1)!.at - writes[0]!.at;
    expect(writes.length).toBeLessThanOrEqual(Math.floor(spanMs / BACKLIGHT_MIN_INTERVAL_MS) + 1);
    expect(writes.length).toBeGreaterThan(5);
    for (let i = 1; i < writes.length; i++) {
      expect(writes[i]!.at - writes[i - 1]!.at).toBeGreaterThanOrEqual(BACKLIGHT_MIN_INTERVAL_MS);
    }
    expect(await readLevel(dir)).toBe(String(backlightLevel(0.8, 255)));
    await sink.stop();
    expect(clock.pendingTimers).toBe(0);
  });

  it('auto-detects the first usable device', async () => {
    const broken = join(root, 'a-broken');
    await mkdir(broken);
    const good = await device('b-panel', 100);
    const { deps, logger } = setup();
    const [sink] = createFrameSinks({ backlight: null }, deps, { backlightRoot: root });
    expect(await (sink as BacklightSink).whenReady()).toEqual({
      directory: good,
      maxBrightness: 100,
    });
    expect(logger.lines('info').join('\n')).toMatch(/controlling .*b-panel/);
    await sink!.stop();
  });

  it('stays quiet when there is no backlight device at all', async () => {
    const { deps, logger } = setup();
    const [sink] = createFrameSinks({ backlight: null }, deps, {
      backlightRoot: join(root, 'missing'),
    });
    expect(await (sink as BacklightSink).whenReady()).toBeNull();
    expect(logger.lines('warn')).toEqual([]);
    expect(logger.lines('info').join('\n')).toMatch(/no backlight device found/);
    sink!.onFrame(frame(0.5));
    await sink!.stop();
  });

  it('disables itself with one hint when the device is not writable', async () => {
    const dir = await device('panel', 255);
    const { deps, logger } = setup();
    const fs: BacklightFs = {
      ...nodeBacklightFs,
      checkWritable: async () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
    };
    const [sink] = createFrameSinks({ backlight: null }, deps, { backlightRoot: root, fs });
    expect(await (sink as BacklightSink).whenReady()).toBeNull();
    expect(logger.lines('warn')).toHaveLength(1);
    expect(logger.lines('warn')[0]).toMatch(
      /panel brightness is not writable \(EACCES\).*udev rule/,
    );
    sink!.onFrame(frame(0.9));
    await (sink as BacklightSink).whenIdle();
    expect(await readLevel(dir)).toBe('0');
    await sink!.stop();
  });

  it('rejects an explicit directory without a valid max_brightness', async () => {
    const dir = await device('panel', 'zero');
    const { deps, logger } = setup();
    const sink = new BacklightSink({ directory: dir }, deps);
    expect(await sink.whenReady()).toBeNull();
    expect(logger.lines('warn')[0]).toMatch(/invalid max_brightness "zero"/);
    const missing = new BacklightSink({ directory: join(root, 'nope') }, deps);
    expect(await missing.whenReady()).toBeNull();
    expect(logger.lines('warn')[1]).toMatch(/no readable max_brightness \(ENOENT\)/);
  });

  it('disables itself once if a write fails (device unplugged)', async () => {
    const dir = await device('panel', 255);
    const { clock, deps, logger } = setup();
    let fail = false;
    let attempts = 0;
    const fs: BacklightFs = {
      ...nodeBacklightFs,
      writeFile: async (path, data) => {
        attempts += 1;
        if (fail) throw Object.assign(new Error('gone'), { code: 'ENODEV' });
        await nodeBacklightFs.writeFile(path, data);
      },
    };
    const sink = new BacklightSink({ directory: dir, fs }, deps);
    await sink.whenReady();
    sink.onFrame(frame(0.3));
    await sink.whenIdle();
    fail = true;
    for (const b of [0.6, 0.9, 0.2]) {
      await clock.advance(BACKLIGHT_MIN_INTERVAL_MS);
      sink.onFrame(frame(b));
      await sink.whenIdle();
    }
    expect(attempts).toBe(2);
    expect(logger.lines('warn')).toEqual([
      expect.stringMatching(/failed \(ENODEV\); backlight control disabled/),
    ]);
    await sink.stop();
  });

  it('is not created when disabled', () => {
    const { deps } = setup();
    expect(createFrameSinks({ backlight: false }, deps)).toEqual([]);
  });

  it('leaves the backlight as it is on stop', async () => {
    const dir = await device('panel', 255, '200');
    const { deps } = setup();
    const sink = new BacklightSink({ directory: dir }, deps);
    await sink.whenReady();
    sink.onFrame(frame(0.2));
    await sink.whenIdle();
    const level = await readLevel(dir);
    await sink.stop();
    sink.onFrame(frame(1));
    await sink.whenIdle();
    expect(await readLevel(dir)).toBe(level);
  });
});
