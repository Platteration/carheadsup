import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HudFrame } from '@carheadsup/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKLIGHT_MIN_INTERVAL_MS,
  BacklightSink,
  nodeBacklightFs,
  type BacklightFs,
} from '../../src/outputs/backlight.ts';
import {
  PWM_DEFAULT_HZ,
  PWM_EXPORT_WAIT_MS,
  PwmBacklightDriver,
  pwmDutyNs,
  pwmPeriodNs,
} from '../../src/outputs/backlight-pwm.ts';
import { parseBacklightSpec } from '../../src/outputs/backlight-spec.ts';
import { createFrameSinks } from '../../src/outputs/index.ts';
import { FakeClock, memoryLogger } from '../sensors/fakes.ts';

function frame(brightness: number, blanked = false): HudFrame {
  return { blanked, theme: { night: false, brightness } } as HudFrame;
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'carheadsup-pwm-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A PWM chip with `channels` channels; `exported` ones already have their directory. */
async function chip(n: number, channels: number, exported: number[] = []): Promise<string> {
  const dir = join(root, `pwmchip${n}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'npwm'), `${channels}\n`);
  await writeFile(join(dir, 'export'), '');
  for (const channel of exported) await channelFiles(dir, channel);
  return dir;
}

async function channelFiles(chipDir: string, channel: number, duty = 0): Promise<void> {
  const dir = join(chipDir, `pwm${channel}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'period'), '0\n');
  await writeFile(join(dir, 'duty_cycle'), `${duty}\n`);
  await writeFile(join(dir, 'enable'), '0\n');
}

/** The kernel's side of `export`: writing a channel number creates its directory. */
function exportingFs(log: string[] = []): BacklightFs {
  return {
    ...nodeBacklightFs,
    writeFile: async (path, data) => {
      log.push(`${path.slice(root.length + 1)}=${data}`);
      if (path.endsWith('/export')) {
        await channelFiles(path.slice(0, -'/export'.length), Number(data));
        return;
      }
      await nodeBacklightFs.writeFile(path, data);
    },
  };
}

const read = async (path: string): Promise<string> =>
  (await readFile(join(root, path), 'utf8')).trim();

function setup() {
  const clock = new FakeClock();
  const logger = memoryLogger();
  return { clock, logger, deps: { now: clock.now, timers: clock, logger } };
}

function driver(
  clock: FakeClock,
  options: Partial<ConstructorParameters<typeof PwmBacklightDriver>[0]> = {},
) {
  return new PwmBacklightDriver({
    chip: 0,
    channel: 0,
    frequencyHz: PWM_DEFAULT_HZ,
    minDuty: 0.01,
    inverted: false,
    timers: clock,
    root,
    fs: exportingFs(),
    ...options,
  });
}

describe('PWM duty cycle', () => {
  it('maps brightness through the gamma, above the minimum duty', () => {
    expect(pwmPeriodNs(25_000)).toBe(40_000);
    expect(pwmPeriodNs(1000)).toBe(1_000_000);
    expect(pwmDutyNs(1, 40_000, 0.01)).toBe(40_000);
    expect(pwmDutyNs(0, 40_000, 0.01)).toBe(400);
    expect(pwmDutyNs(0.5, 40_000, 0)).toBe(Math.round(40_000 * 0.5 ** 2.2));
    expect(pwmDutyNs(0.5, 40_000, 0.1)).toBe(Math.round(40_000 * (0.1 + 0.9 * 0.5 ** 2.2)));
    expect(pwmDutyNs(Number.NaN, 40_000, 0.01)).toBe(40_000);
    expect(pwmDutyNs(-1, 40_000, 0.05)).toBe(2000);
  });
});

describe('PwmBacklightDriver', () => {
  it('exports the channel, sets the period and enables it', async () => {
    await chip(0, 2);
    const { clock } = setup();
    const log: string[] = [];
    const result = await driver(clock, { fs: exportingFs(log) }).open();
    expect('output' in result && result.output.description).toBe(
      'PWM channel 0 of pwmchip0 (25000 Hz, min 1 %)',
    );
    expect(log).toEqual([
      'pwmchip0/export=0',
      'pwmchip0/pwm0/period=40000',
      'pwmchip0/pwm0/enable=1',
    ]);
    expect(await read('pwmchip0/pwm0/period')).toBe('40000');
    expect(await read('pwmchip0/pwm0/enable')).toBe('1');
  });

  it('uses an exported channel as it is, lowering a duty cycle the new period cannot hold', async () => {
    const dir = await chip(1, 2);
    await channelFiles(dir, 1, 900_000);
    const { clock } = setup();
    const log: string[] = [];
    const result = await driver(clock, { chip: 1, channel: 1, fs: exportingFs(log) }).open();
    expect('output' in result).toBe(true);
    expect(log).toEqual([
      'pwmchip1/pwm1/duty_cycle=400',
      'pwmchip1/pwm1/period=40000',
      'pwmchip1/pwm1/enable=1',
    ]);
  });

  it('explains a missing chip, a missing channel and a refused export', async () => {
    const { clock } = setup();
    expect(await driver(clock).open()).toEqual({
      problem: expect.stringMatching(
        /pwmchip0 is not there \(ENOENT\).*dtoverlay=pwm,pin=18,func=2/,
      ),
    });
    await chip(0, 1);
    expect(await driver(clock, { channel: 1 }).open()).toEqual({
      problem: 'pwmchip0 has 1 channel(s), no channel 1',
    });
    const refusing: BacklightFs = {
      ...nodeBacklightFs,
      writeFile: async () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
    };
    expect(await driver(clock, { fs: refusing }).open()).toEqual({
      problem: expect.stringMatching(
        /cannot export channel 0 of pwmchip0 \(EACCES\).*99-carheadsup-backlight\.rules/,
      ),
    });
  });

  it('waits for udev to make an exported channel writable', async () => {
    await chip(0, 1);
    const { clock } = setup();
    let writableAfter = 3;
    const fs: BacklightFs = {
      ...exportingFs(),
      checkWritable: async (path) => {
        if (path.endsWith('duty_cycle') && writableAfter-- > 0) {
          throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
        }
        await nodeBacklightFs.checkWritable(path);
      },
    };
    let settled = false;
    const opening = driver(clock, { fs })
      .open()
      .finally(() => {
        settled = true;
      });
    // The driver's file reads are real I/O: let them finish between the fake clock's steps.
    for (let i = 0; i < 50 && !settled; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      await clock.advance(PWM_EXPORT_WAIT_MS);
    }
    expect('output' in (await opening)).toBe(true);
    expect(writableAfter).toBe(-1);
  });
});

describe('BacklightSink over PWM', () => {
  it('drives the duty cycle from the frames, inverted when asked to', async () => {
    await chip(0, 1, [0]);
    const { clock, deps, logger } = setup();
    const spec = 'pwm:0/0,hz=20000,min=5,inverted';
    const [sink] = createFrameSinks({ backlight: spec }, deps, { pwmRoot: root });
    const backlight = sink as BacklightSink;
    await backlight.whenReady();
    expect(logger.lines('info')).toEqual([
      'Backlight: controlling PWM channel 0 of pwmchip0 (20000 Hz, min 5 %, inverted)',
    ]);
    expect(await read('pwmchip0/pwm0/period')).toBe('50000');
    backlight.onFrame(frame(1));
    await backlight.whenIdle();
    expect(await read('pwmchip0/pwm0/duty_cycle')).toBe('0');
    await clock.advance(BACKLIGHT_MIN_INTERVAL_MS);
    backlight.onFrame(frame(0.4, true));
    await backlight.whenIdle();
    // Blanked: the minimum duty (5 % of 50 000 ns), inverted.
    expect(await read('pwmchip0/pwm0/duty_cycle')).toBe(String(50_000 - 2500));
    await backlight.stop();
    expect(clock.pendingTimers).toBe(0);
  });

  it('parses the PWM setting', () => {
    expect(parseBacklightSpec('pwm:0/0')).toEqual({
      kind: 'pwm',
      chip: 0,
      channel: 0,
      frequencyHz: 25_000,
      minDuty: 0.01,
      inverted: false,
    });
    expect(parseBacklightSpec('PWM:pwmchip2/pwm1, hz=1000, min=2.5%, invert')).toEqual({
      kind: 'pwm',
      chip: 2,
      channel: 1,
      frequencyHz: 1000,
      minDuty: 0.025,
      inverted: true,
    });
    for (const bad of ['pwm:0', 'pwm:a/b', 'pwm:0/0,hz=0', 'pwm:0/0,min=51', 'pwm:0/0,loud']) {
      expect(typeof parseBacklightSpec(bad), bad).toBe('string');
    }
  });
});
