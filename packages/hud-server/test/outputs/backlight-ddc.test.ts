import type { HudFrame } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { BACKLIGHT_REPROBE_MS, BacklightSink } from '../../src/outputs/backlight.ts';
import {
  DDC_ACCESS_HINT,
  DDC_MIN_INTERVAL_MS,
  DDC_REPROBE_MS,
  DdcBacklightDriver,
  ddcLevel,
  parseDdcDetect,
  parseVcpBrightness,
} from '../../src/outputs/backlight-ddc.ts';
import { createFrameSinks } from '../../src/outputs/index.ts';
import { FakeClock, fakeSpawn, memoryLogger, respond, type FakeChild } from '../sensors/fakes.ts';

function frame(brightness: number, blanked = false): HudFrame {
  return { blanked, theme: { night: false, brightness } } as HudFrame;
}

const DETECT = `Display 1
   I2C bus:  /dev/i2c-20
   DRM connector:           card1-HDMI-A-1
   Monitor:                 RTK:HDMI:

Invalid display
   I2C bus:  /dev/i2c-21
   DRM connector:           card1-HDMI-A-2
   DDC communication failed

Display 2
   I2C bus:  /dev/i2c-22
   Monitor:                 DEL:DELL U2415:
`;

/**
 * A fake `ddcutil` in front of monitors on I²C buses: `detect`, `getvcp 10` and `setvcp 10`
 * (verifying by reading back unless `--noverify`), with switches for the ways real ones fail.
 */
class FakeDdc {
  readonly monitors = new Map<number, { current: number; max: number; appliesWrites: boolean }>();
  installed = true;
  detectOutput = DETECT;
  detectFails: string | null = null;
  setFails: string | null = null;
  readonly spawn = fakeSpawn((child) => this.answer(child));

  /** The setvcp values written to `bus`, in order. */
  writes(bus: number): number[] {
    return this.spawn.children
      .filter((c) => c.args.includes('setvcp') && c.args.includes(String(bus)))
      .map((c) => Number(c.args[c.args.indexOf('setvcp') + 2]));
  }

  count(command: string): number {
    return this.spawn.children.filter((c) => c.args.includes(command)).length;
  }

  private answer(child: FakeChild): void {
    if (!this.installed) {
      child.failToStart('ENOENT');
      return;
    }
    const args = child.args;
    if (args[0] === 'detect') {
      if (this.detectFails !== null) respond(child, '', 1, this.detectFails);
      else respond(child, this.detectOutput);
      return;
    }
    const bus = Number(args[args.indexOf('--bus') + 1]);
    const monitor = this.monitors.get(bus);
    if (monitor === undefined) {
      respond(child, '', 1, `No monitor detected on bus /dev/i2c-${bus}\n`);
      return;
    }
    if (args.includes('getvcp')) {
      respond(child, `VCP 10 C ${monitor.current} ${monitor.max}\n`);
      return;
    }
    if (this.setFails !== null) {
      respond(child, '', 1, this.setFails);
      return;
    }
    const value = Number(args[args.indexOf('setvcp') + 2]);
    if (monitor.appliesWrites) monitor.current = value;
    if (!args.includes('--noverify') && monitor.current !== value) {
      respond(child, '', 1, `Verification failed for feature 10\n`);
      return;
    }
    respond(child, '');
  }
}

function setup() {
  const clock = new FakeClock();
  const logger = memoryLogger();
  return { clock, logger, deps: { now: clock.now, timers: clock, logger } };
}

describe('ddcutil output', () => {
  it('lists the buses of the usable displays', () => {
    expect(parseDdcDetect(DETECT)).toEqual([20, 22]);
    expect(parseDdcDetect('No displays found.\n')).toEqual([]);
    expect(parseDdcDetect('')).toEqual([]);
  });

  it('reads the brightness in the brief and the long form', () => {
    expect(parseVcpBrightness('VCP 10 C 50 100\n')).toEqual({ current: 50, max: 100 });
    expect(
      parseVcpBrightness(
        'VCP code 0x10 (Brightness                    ): current value =    35, max value =   100',
      ),
    ).toEqual({ current: 35, max: 100 });
    expect(parseVcpBrightness('VCP 10 ERR\n')).toBeNull();
    expect(parseVcpBrightness('VCP 10 C 150 100\n')).toBeNull();
    expect(parseVcpBrightness('VCP 10 C 0 0\n')).toBeNull();
  });

  it('maps brightness through the gamma onto the display’s range, 0 included', () => {
    expect(ddcLevel(1, 100)).toBe(100);
    expect(ddcLevel(0.5, 100)).toBe(22);
    expect(ddcLevel(0, 100)).toBe(0);
    expect(ddcLevel(Number.NaN, 100)).toBe(100);
    expect(ddcLevel(2, 255)).toBe(255);
  });
});

describe('DdcBacklightDriver', () => {
  it('finds the first display that applies a brightness change, checked by reading it back', async () => {
    const { clock } = setup();
    const ddc = new FakeDdc();
    ddc.monitors.set(20, { current: 40, max: 100, appliesWrites: false });
    ddc.monitors.set(22, { current: 100, max: 100, appliesWrites: true });
    const driver = new DdcBacklightDriver({
      bus: null,
      required: false,
      now: clock.now,
      timers: clock,
      spawn: ddc.spawn,
    });
    const result = await driver.open();
    expect('output' in result && result.output.description).toBe(
      'the display on /dev/i2c-22 over DDC/CI (brightness 0–100)',
    );
    // Bus 20 ignored the probe write (41); bus 22 took one step down from full.
    expect(ddc.writes(20)).toEqual([41]);
    expect(ddc.writes(22)).toEqual([99]);
  });

  it('reports a display that does not apply the change, and checks again only after a minute', async () => {
    const { clock } = setup();
    const ddc = new FakeDdc();
    ddc.detectOutput = 'Display 1\n   I2C bus:  /dev/i2c-20\n';
    ddc.monitors.set(20, { current: 40, max: 100, appliesWrites: false });
    const driver = new DdcBacklightDriver({
      bus: null,
      required: false,
      now: clock.now,
      timers: clock,
      spawn: ddc.spawn,
    });
    expect(await driver.open()).toEqual({
      problem: expect.stringMatching(
        /^\/dev\/i2c-20 does not apply DDC\/CI brightness changes \(ddcutil .*Verification failed/,
      ),
    });
    const runs = ddc.spawn.children.length;
    await clock.advance(DDC_REPROBE_MS - 1, false);
    await driver.open();
    expect(ddc.spawn.children.length).toBe(runs);
    await clock.advance(1, false);
    await driver.open();
    expect(ddc.count('detect')).toBe(2);
  });

  it('takes an explicit bus without detecting', async () => {
    const { clock } = setup();
    const ddc = new FakeDdc();
    ddc.monitors.set(5, { current: 70, max: 255, appliesWrites: true });
    const driver = new DdcBacklightDriver({
      bus: 5,
      required: true,
      now: clock.now,
      timers: clock,
      spawn: ddc.spawn,
    });
    const result = await driver.open();
    expect('output' in result && result.output.level(1)).toBe(255);
    expect(ddc.count('detect')).toBe(0);
    const missing = new DdcBacklightDriver({
      bus: 6,
      required: true,
      now: clock.now,
      timers: clock,
      spawn: ddc.spawn,
    });
    expect(await missing.open()).toEqual({
      problem: expect.stringMatching(/^\/dev\/i2c-6 does not answer DDC\/CI brightness/),
    });
  });

  it('is merely absent without ddcutil when auto-detecting, and a problem when asked for', async () => {
    const { clock } = setup();
    const ddc = new FakeDdc();
    ddc.installed = false;
    const options = { bus: null, now: clock.now, timers: clock, spawn: ddc.spawn };
    const auto = new DdcBacklightDriver({ ...options, required: false });
    expect(await auto.open()).toEqual({
      absent: 'ddcutil is not installed, so no display is dimmed over DDC/CI',
    });
    // Never looked for again: installing it takes a restart.
    await clock.advance(10 * DDC_REPROBE_MS, false);
    await auto.open();
    expect(ddc.spawn.children).toHaveLength(1);
    const asked = new DdcBacklightDriver({ ...options, required: true });
    expect(await asked.open()).toEqual({
      problem: 'ddcutil is not installed, so no display is dimmed over DDC/CI',
      final: true,
    });
  });

  it('says that installing ddcutil takes a restart when it was asked for', async () => {
    const { deps, logger } = setup();
    const ddc = new FakeDdc();
    ddc.installed = false;
    const [sink] = createFrameSinks({ backlight: 'ddc' }, deps, { spawn: ddc.spawn });
    expect(await (sink as BacklightSink).whenReady()).toBeNull();
    expect(logger.lines('warn')).toEqual([
      'Backlight: ddcutil is not installed, so no display is dimmed over DDC/CI; brightness is ' +
        'applied by the renderer until that is fixed and the HUD restarted',
    ]);
    await sink!.stop();
  });

  it('says how to get access when the I²C devices are not usable', async () => {
    const { clock } = setup();
    const ddc = new FakeDdc();
    ddc.detectFails = 'No /dev/i2c devices exist.\nddcutil requires module i2c-dev.\n';
    const driver = new DdcBacklightDriver({
      bus: null,
      required: false,
      now: clock.now,
      timers: clock,
      spawn: ddc.spawn,
    });
    const result = await driver.open();
    expect('problem' in result && result.problem).toContain('No /dev/i2c devices exist');
    expect('problem' in result && result.problem).toContain(DDC_ACCESS_HINT);
  });
});

describe('BacklightSink over DDC/CI', () => {
  it('writes at most once a second, only for changes of 3 % or more, and 0 while blanked', async () => {
    const { clock, deps, logger } = setup();
    const ddc = new FakeDdc();
    ddc.monitors.set(20, { current: 100, max: 100, appliesWrites: true });
    const [sink] = createFrameSinks({ backlight: 'ddc' }, deps, { spawn: ddc.spawn });
    const backlight = sink as BacklightSink;
    await backlight.whenReady();
    expect(backlight.drivesBrightness).toBe(true);
    expect(logger.lines('info').join('\n')).toContain(
      'Backlight: controlling the display on /dev/i2c-20 over DDC/CI',
    );
    backlight.onFrame(frame(0.5));
    await backlight.whenIdle();
    // A burst of small changes within the second: none written.
    for (const b of [0.51, 0.52, 0.49]) {
      await clock.advance(100);
      backlight.onFrame(frame(b));
      await backlight.whenIdle();
    }
    // A big one within the second waits for its slot.
    backlight.onFrame(frame(0.3));
    await clock.advance(DDC_MIN_INTERVAL_MS);
    await backlight.whenIdle();
    backlight.onFrame(frame(0.3, true));
    await clock.advance(DDC_MIN_INTERVAL_MS);
    await backlight.whenIdle();
    // The probe (99), then 22 (0.5), 7 (0.3), 0 (blanked).
    expect(ddc.writes(20)).toEqual([99, 22, 7, 0]);
    expect(
      ddc.spawn.children
        .filter((c) => c.args.includes('setvcp'))
        .slice(1)
        .every((c) => c.args.includes('--noverify')),
    ).toBe(true);
    await backlight.stop();
    expect(clock.pendingTimers).toBe(0);
  });

  it('gives a failing display up, and the renderer dims again until it answers', async () => {
    const { clock, deps, logger } = setup();
    const ddc = new FakeDdc();
    ddc.monitors.set(20, { current: 50, max: 100, appliesWrites: true });
    const [sink] = createFrameSinks({ backlight: 'ddc:20' }, deps, { spawn: ddc.spawn });
    const backlight = sink as BacklightSink;
    await backlight.whenReady();
    ddc.setFails = 'DDC communication failed\n';
    backlight.onFrame(frame(0.9));
    await backlight.whenIdle();
    expect(backlight.drivesBrightness).toBe(false);
    expect(logger.lines('warn').join('\n')).toMatch(
      /writing the display on \/dev\/i2c-20 over DDC\/CI .* failed \(ddcutil .*DDC communication failed\)/,
    );
    ddc.setFails = null;
    await clock.advance(BACKLIGHT_REPROBE_MS);
    await backlight.whenIdle();
    expect(backlight.drivesBrightness).toBe(true);
    expect(ddc.monitors.get(20)?.current).toBe(ddcLevel(0.9, 100));
    await backlight.stop();
  });
});
