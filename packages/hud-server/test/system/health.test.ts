import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ApiInfo } from '@carheadsup/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HEALTH_RECOVERY_READINGS,
  SystemHealthMonitor,
  findHealthPaths,
} from '../../src/system/health.ts';
import { makeTempDir, startTestServer, waitFor } from '../helpers.ts';
import { FakeClock, memoryLogger } from '../sensors/fakes.ts';

/** A fixture sysfs tree in a temporary directory. */
interface Sys {
  root: string;
  set(path: string, content: string): Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function sysfs(files: Record<string, string> = {}): Promise<Sys> {
  const temp = await makeTempDir('carheadsup-sysfs-');
  cleanups.push(temp.cleanup);
  const set = async (path: string, content: string): Promise<void> => {
    const full = join(temp.dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, `${content}\n`);
  };
  for (const [path, content] of Object.entries(files)) await set(path, content);
  return { root: temp.dir, set };
}

const THERMAL = 'class/thermal/thermal_zone0/temp';
const THROTTLED = 'devices/platform/soc/soc:firmware/get_throttled';

function monitor(root: string) {
  const clock = new FakeClock(0);
  const logger = memoryLogger();
  const health = new SystemHealthMonitor({ sysRoot: root, timers: clock, logger });
  return { clock, logger, health };
}

describe('SystemHealthMonitor', () => {
  it("reads a Raspberry Pi's temperature and firmware flags", async () => {
    const sys = await sysfs({ [THERMAL]: '54321', [THROTTLED]: '0' });
    const { health, logger } = monitor(sys.root);
    await health.start();
    expect(health.snapshot()).toEqual({
      socTempC: 54.3,
      underVoltage: false,
      underVoltageSeen: false,
      throttled: false,
      throttledSeen: false,
    });
    expect(logger.lines('info')).toEqual(['System: SoC 54.3 °C, supply OK, full speed']);
    expect(logger.lines('warn')).toEqual([]);
    await health.stop();
  });

  it('decodes the flags: now and since boot', async () => {
    const sys = await sysfs({ [THERMAL]: '83000', [THROTTLED]: '50005' });
    const { health, logger } = monitor(sys.root);
    await health.start();
    expect(health.snapshot()).toEqual({
      socTempC: 83,
      underVoltage: true,
      underVoltageSeen: true,
      throttled: true,
      throttledSeen: true,
    });
    const warnings = logger.lines('warn').join('\n');
    expect(warnings).toMatch(/under-voltage: the Pi's 5 V supply sags/);
    expect(warnings).toMatch(/the CPU is slowed down \(heat or supply\) \(SoC 83 °C\)/);
    expect(warnings).toMatch(/the SoC is at 83 °C/);
    await health.stop();
  });

  it('reports an under-voltage the firmware saw since boot', async () => {
    const sys = await sysfs({ [THROTTLED]: '0x10000' });
    const { health, logger } = monitor(sys.root);
    await health.start();
    expect(health.snapshot()).toMatchObject({ underVoltage: false, underVoltageSeen: true });
    expect(logger.lines('warn').join('\n')).toMatch(/under-voltage since boot/);
    await health.stop();
  });

  it('logs every change once, and recovery at info', async () => {
    const sys = await sysfs({ [THERMAL]: '60000', [THROTTLED]: '0' });
    const { health, logger, clock } = monitor(sys.root);
    await health.start();
    await sys.set(THROTTLED, '50005');
    await sys.set(THERMAL, '81000');
    await health.check();
    await health.check();
    expect(logger.lines('warn')).toHaveLength(3);
    // Back to normal, but 77 °C is not cool yet (hysteresis); the supply and the CPU count as
    // fine again once they have been for a while.
    await sys.set(THROTTLED, '50000');
    await sys.set(THERMAL, '77000');
    for (let i = 1; i < HEALTH_RECOVERY_READINGS; i += 1) await health.check();
    expect(logger.lines('info')).toHaveLength(1);
    await health.check();
    expect(logger.lines('info').slice(1)).toEqual([
      'System: the supply voltage is fine again',
      'System: the CPU runs at full speed again (SoC 77 °C)',
    ]);
    expect(health.snapshot()).toMatchObject({
      underVoltage: false,
      underVoltageSeen: true,
      throttled: false,
      throttledSeen: true,
    });
    await sys.set(THERMAL, '74000');
    // On its own timer (reading the files takes real I/O).
    await clock.advance(5000);
    await waitFor(
      () => logger.lines('info').at(-1) === 'System: the SoC has cooled down to 74 °C',
      2000,
      'the timed check',
    );
    expect(logger.lines('warn')).toHaveLength(3);
    await health.stop();
  });

  it('does not flood the log while the supply hovers at the threshold', async () => {
    // A weak converter under a changing load: the firmware's flags flip every few seconds. Each
    // flip would be a warning written to the card at once.
    const sys = await sysfs({ [THERMAL]: '60000', [THROTTLED]: '0' });
    const { health, logger } = monitor(sys.root);
    await health.start();
    for (let i = 0; i < 20; i += 1) {
      await sys.set(THROTTLED, i % 2 === 0 ? '50005' : '50000');
      await health.check();
    }
    expect(logger.lines('warn')).toEqual([
      "System: under-voltage: the Pi's 5 V supply sags — expect slowdowns, resets and SD card damage; check the converter and its wiring",
      'System: the CPU is slowed down (heat or supply) (SoC 60 °C)',
    ]);
    expect(logger.lines('info')).toHaveLength(1);
    // What /api/info reports stays the reading of the moment.
    expect(health.snapshot()).toMatchObject({ underVoltage: false, throttled: false });
    // Fine for long enough: said once.
    for (let i = 0; i < HEALTH_RECOVERY_READINGS; i += 1) await health.check();
    expect(logger.lines('info').slice(1)).toEqual([
      'System: the supply voltage is fine again',
      'System: the CPU runs at full speed again (SoC 60 °C)',
    ]);
    await sys.set(THROTTLED, '50005');
    await health.check();
    expect(logger.lines('warn')).toHaveLength(4);
    await health.stop();
  });

  it("uses the kernel's rpi_volt alarm without the firmware file", async () => {
    const sys = await sysfs({
      'class/hwmon/hwmon0/name': 'cpu_thermal',
      'class/hwmon/hwmon1/name': 'rpi_volt',
      'class/hwmon/hwmon1/in0_lcrit_alarm': '1',
    });
    const { health } = monitor(sys.root);
    await health.start();
    expect(health.snapshot()).toEqual({
      socTempC: null,
      underVoltage: true,
      underVoltageSeen: true,
      throttled: null,
      throttledSeen: null,
    });
    await sys.set('class/hwmon/hwmon1/in0_lcrit_alarm', '0');
    await health.check();
    // Seen stays: since the server started.
    expect(health.snapshot()).toMatchObject({ underVoltage: false, underVoltageSeen: true });
    await health.stop();
  });

  it('finds the firmware file where other models keep it', async () => {
    const sys = await sysfs({
      'devices/platform/axi/axi:firmware/get_throttled': '0',
      'devices/platform/axi/other/get_throttled': '0',
    });
    const paths = await findHealthPaths(sys.root);
    expect(paths.throttled).toBe(join(sys.root, 'devices/platform/axi/axi:firmware/get_throttled'));
  });

  it('reports nothing where nothing can be read, and ignores garbage', async () => {
    const empty = await sysfs();
    const nothing = monitor(empty.root);
    await nothing.health.start();
    expect(nothing.health.snapshot()).toBeNull();
    expect(nothing.logger.entries).toEqual([]);
    await nothing.health.stop();

    const garbage = await sysfs({ [THERMAL]: 'hot', [THROTTLED]: 'nope' });
    const odd = monitor(garbage.root);
    await odd.health.start();
    expect(odd.health.snapshot()).toBeNull();
    await odd.health.stop();
  });
});

describe('/api/info', () => {
  it('carries the system health', async () => {
    const sys = await sysfs({ [THERMAL]: '48000', [THROTTLED]: '0' });
    const t = await startTestServer({ sysRoot: sys.root });
    try {
      const info = (await (await fetch(`${t.base}/api/info`)).json()) as ApiInfo;
      expect(info.system).toEqual({
        socTempC: 48,
        underVoltage: false,
        underVoltageSeen: false,
        throttled: false,
        throttledSeen: false,
      });
    } finally {
      await t.stop();
    }
    const none = await startTestServer();
    try {
      const info = (await (await fetch(`${none.base}/api/info`)).json()) as ApiInfo;
      expect(info.system).toBeNull();
    } finally {
      await none.stop();
    }
  });
});
