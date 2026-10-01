import type { HudFrame } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { createSystemdWatchdog, watchdogPingIntervalMs } from '../../src/system/watchdog.ts';
import type { WatchdogEnv } from '../../src/system/watchdog.ts';
import type { FrameSink } from '../../src/sources/types.ts';
import { startTestServer } from '../helpers.ts';
import { FakeClock, fakeSpawn, flush, memoryLogger, respond } from '../sensors/fakes.ts';
import type { FakeChild } from '../sensors/fakes.ts';

const SYSTEMD: WatchdogEnv = {
  NOTIFY_SOCKET: '/run/systemd/notify',
  WATCHDOG_USEC: '20000000',
  WATCHDOG_PID: '321',
};

const frame = {} as HudFrame;

function setup(env: WatchdogEnv = SYSTEMD, script: (child: FakeChild) => void = respondOk) {
  const clock = new FakeClock(0);
  const spawn = fakeSpawn(script);
  const logger = memoryLogger();
  const sink = createSystemdWatchdog({
    env,
    pid: 321,
    spawn,
    monotonic: clock.now,
    timers: clock,
    logger,
  });
  return { clock, spawn, logger, sink };
}

function respondOk(child: FakeChild): void {
  respond(child, '');
}

describe('watchdogPingIntervalMs', () => {
  it('pings at a quarter of the timeout systemd set for this process', () => {
    expect(watchdogPingIntervalMs(SYSTEMD, 321)).toBe(5000);
    expect(watchdogPingIntervalMs({ ...SYSTEMD, WATCHDOG_PID: undefined }, 321)).toBe(5000);
    expect(watchdogPingIntervalMs({ ...SYSTEMD, WATCHDOG_USEC: '1000' }, 321)).toBe(500);
    expect(watchdogPingIntervalMs({ ...SYSTEMD, WATCHDOG_USEC: '600000000' }, 321)).toBe(15_000);
  });

  it('is off without a watchdog for this process', () => {
    expect(watchdogPingIntervalMs({}, 321)).toBeNull();
    expect(watchdogPingIntervalMs({ ...SYSTEMD, NOTIFY_SOCKET: '' }, 321)).toBeNull();
    expect(watchdogPingIntervalMs({ ...SYSTEMD, WATCHDOG_USEC: undefined }, 321)).toBeNull();
    expect(watchdogPingIntervalMs({ ...SYSTEMD, WATCHDOG_USEC: 'soon' }, 321)).toBeNull();
    expect(watchdogPingIntervalMs({ ...SYSTEMD, WATCHDOG_USEC: '0' }, 321)).toBeNull();
    // Inherited by a child of the service, not meant for it.
    expect(watchdogPingIntervalMs(SYSTEMD, 999)).toBeNull();
  });
});

describe('createSystemdWatchdog', () => {
  it('is no sink at all without a watchdog', () => {
    expect(setup({}).sink).toBeNull();
  });

  it('pings systemd from frames, at most once per interval', async () => {
    const { clock, spawn, sink } = setup();
    if (sink === null) throw new Error('expected a watchdog');
    sink.onFrame(frame);
    await flush();
    expect(spawn.children.map((c) => [c.command, ...c.args])).toEqual([
      ['systemd-notify', 'WATCHDOG=1'],
    ]);
    // 15 frames a second for almost 5 s: no more pings.
    for (let t = 0; t < 4900; t += 67) {
      await clock.advance(67, false);
      sink.onFrame(frame);
    }
    await flush();
    expect(spawn.children).toHaveLength(1);
    await clock.advance(200, false);
    sink.onFrame(frame);
    await flush();
    expect(spawn.children).toHaveLength(2);
  });

  it('sends nothing while no frames are composed (a stuck event loop or composer)', async () => {
    const { clock, spawn, sink } = setup();
    sink?.onFrame(frame);
    await clock.advance(60_000);
    expect(spawn.children).toHaveLength(1);
  });

  it('never runs two pings at once, and logs a failing ping once', async () => {
    const hanging: FakeChild[] = [];
    const { clock, spawn, sink, logger } = setup(SYSTEMD, (child) => {
      if (spawn.children.length <= 1) hanging.push(child);
      else respond(child, '', 1, 'No such file or directory');
    });
    sink?.onFrame(frame);
    await flush();
    await clock.advance(4999);
    sink?.onFrame(frame);
    await flush();
    expect(spawn.children).toHaveLength(1);
    // The hung systemd-notify is killed after one interval; the next frame pings again.
    await clock.advance(1);
    expect(hanging[0]?.signals).toEqual(['SIGKILL']);
    expect(logger.lines('error').join('\n')).toMatch(/pinging systemd failed .*did not finish/);
    sink?.onFrame(frame);
    await flush();
    await clock.advance(5000);
    sink?.onFrame(frame);
    await flush();
    expect(spawn.children).toHaveLength(3);
    // Still failing: no new log line.
    expect(logger.lines('error')).toHaveLength(1);
  });

  it('says so when systemd-notify is missing, and when pings work again', async () => {
    let missing = true;
    const { clock, sink, logger } = setup(SYSTEMD, (child) => {
      if (missing) child.failToStart('ENOENT');
      else respond(child, '');
    });
    sink?.onFrame(frame);
    await flush();
    await flush();
    expect(logger.lines('error').join('\n')).toContain('systemd-notify is not installed');
    missing = false;
    await clock.advance(5000);
    sink?.onFrame(frame);
    await flush();
    await flush();
    expect(logger.lines('info').join('\n')).toContain('systemd takes the pings again');
  });
});

describe('the server', () => {
  it('pings the watchdog from its frame loop', async () => {
    const frames: number[] = [];
    const t = await startTestServer({
      createWatchdog: (options): FrameSink => {
        expect(options.monotonic()).toBeGreaterThan(0);
        return { name: 'test watchdog', onFrame: () => frames.push(1), stop: async () => {} };
      },
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(frames.length).toBeGreaterThanOrEqual(2);
    } finally {
      await t.stop();
    }
  });
});
