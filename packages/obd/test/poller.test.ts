import type { CustomPidConfig, HudEvent } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { ElmError } from '../src/errors.ts';
import { ObdPoller, type PollerOptions } from '../src/poller.ts';
import { FakeClock, FakeDriver, flush } from './helpers.ts';

/** Engine ECU answers (data bytes per PID). */
const ENGINE: Record<number, number[]> = {
  0x04: [0x40],
  0x05: [0x7b],
  0x06: [0x80],
  0x07: [0x82],
  0x0b: [0x21],
  0x0c: [0x1a, 0xf8],
  0x0d: [0x32],
  0x0e: [0x90],
  0x0f: [0x46],
  0x10: [0x01, 0xf4],
  0x11: [0x26],
  0x1c: [0x06], // OBD standard: supported but not decoded → never polled
  0x1f: [0x00, 0x3c],
  0x2f: [0x80],
  0x33: [0x65],
  0x46: [0x3a],
  0x49: [0x2e],
  0x5c: [0x82],
  0x5e: [0x00, 0x50],
  0xa6: [0x00, 0x07, 0x5b, 0xcd],
};
const TRANSMISSION: Record<number, number[]> = { 0xa4: [0x01, 0x30, 0x03, 0xe8] };
const START = 1_000_000;

function make(options: Partial<PollerOptions> = {}, engine = ENGINE) {
  const clock = new FakeClock(START);
  const driver = new FakeDriver(clock.now).addEcu('7E8', engine).addEcu('7E9', TRANSMISSION);
  const events: HudEvent[] = [];
  const poller = new ObdPoller(
    driver,
    { now: clock.now, timers: clock, dtcIntervalMs: 30_000, ...options },
    (event) => events.push(event),
  );
  return { clock, driver, events, poller };
}

async function runFor(ctx: ReturnType<typeof make>, ms: number): Promise<void> {
  const running = ctx.poller.run();
  await ctx.clock.advance(ms);
  ctx.poller.stop();
  await running;
}

const intervals = (times: number[]): number[] => times.slice(1).map((t, i) => t - (times[i] ?? 0));
const ofType = <T extends HudEvent['type']>(events: HudEvent[], type: T) =>
  events.filter((e): e is Extract<HudEvent, { type: T }> => e.type === type);

describe('ObdPoller discovery', () => {
  it('walks the bitmap chain, unions ECUs and emits obd/supported', async () => {
    const tpms: CustomPidConfig = {
      signal: 'tirePressureFL',
      mode: '22',
      pid: '4001',
      header: '7C6',
      formula: '((A*256)+B)/10',
      intervalMs: 10_000,
    };
    const ctx = make({ customPids: [tpms] });
    const signals = await ctx.poller.discover();
    const bitmapQueries = ctx.driver.calls.filter(
      (c) => c.pids?.length === 1 && (c.pids[0] ?? 1) % 0x20 === 0,
    );
    expect(bitmapQueries.map((c) => c.pids?.[0])).toEqual([0x00, 0x20, 0x40, 0x60, 0x80, 0xa0]);
    expect(ctx.poller.supportedPids).toContain(0xa4); // only the transmission reports it
    expect(ctx.poller.supportedPids).not.toContain(0x20); // bitmap PIDs are not data PIDs
    expect(signals).toEqual(
      expect.arrayContaining([
        'speed',
        'rpm',
        'transmissionGear',
        'odometer',
        'batteryVoltage',
        'tirePressureFL',
      ]),
    );
    expect(ofType(ctx.events, 'obd/supported')).toEqual([
      { type: 'obd/supported', signals, at: START },
    ]);
  });

  it('fails with NO_RESPONSE when nothing answers 0100', async () => {
    const ctx = make();
    ctx.driver.silent = true;
    await expect(ctx.poller.discover()).rejects.toMatchObject({ code: 'NO_RESPONSE' });
  });

  it('retries a transient error during discovery', async () => {
    const ctx = make();
    ctx.driver.errors.push(new ElmError('BUS_BUSY', 'busy'));
    await expect(ctx.poller.discover()).resolves.toContain('speed');
  });

  it('falls back to one PID per request when the ECU ignores multi-PID requests', async () => {
    const ctx = make();
    ctx.driver.multiPid = false;
    await ctx.poller.discover();
    expect(ctx.poller.pidsPerRequest).toBe(1);
    await runFor(ctx, 300);
    expect(
      ctx.driver.calls.filter((c) => c.kind === 'mode01' && (c.pids?.length ?? 0) > 1),
    ).toHaveLength(1);
  });

  it('omits voltage from the supported signals when AT RV is unsupported', async () => {
    const ctx = make({ voltageSupported: false });
    expect(await ctx.poller.discover()).not.toContain('batteryVoltage');
  });
});

describe('ObdPoller scheduling', () => {
  it('polls the fast tier every cycle in one six-PID request', async () => {
    const ctx = make();
    await ctx.poller.discover();
    const discoveryCalls = ctx.driver.calls.length;
    await runFor(ctx, 1000);
    const fast = ctx.driver.calls.slice(discoveryCalls).filter((c) => c.pids?.includes(0x0d));
    expect(fast.length).toBeGreaterThanOrEqual(10);
    expect([...(fast[0]?.pids ?? [])].sort((a, b) => a - b)).toEqual([
      0x0c, 0x0d, 0x10, 0x11, 0x49, 0x5e,
    ]);
    expect(Math.max(...intervals(fast.map((c) => c.at)))).toBeLessThanOrEqual(100);
  });

  it('uses MAP in the fast tier only when there is no MAF', async () => {
    const withMaf = make();
    await runFor(withMaf, 3000);
    expect(withMaf.driver.pollsOf(0x0b).length).toBeLessThan(5);
    const { 0x10: _maf, ...noMaf } = ENGINE;
    const withoutMaf = make({}, noMaf);
    await runFor(withoutMaf, 3000);
    expect(withoutMaf.driver.pollsOf(0x0b).length).toBeGreaterThan(20);
  });

  it('polls medium, slow and very slow tiers at about 1 s, 5 s and 10 s', async () => {
    const ctx = make();
    await runFor(ctx, 60_000);
    const period = (pid: number): number => {
      const gaps = intervals(ctx.driver.pollsOf(pid).map((c) => c.at));
      return gaps.reduce((a, b) => a + b, 0) / gaps.length;
    };
    expect(period(0x05)).toBeGreaterThanOrEqual(1000); // coolant
    expect(period(0x05)).toBeLessThan(1300);
    expect(period(0x5c)).toBeGreaterThanOrEqual(5000); // oil temperature
    expect(period(0x5c)).toBeLessThan(5500);
    expect(period(0x2f)).toBeGreaterThanOrEqual(10_000); // fuel level
    expect(period(0x2f)).toBeLessThan(10_500);
    expect(ctx.driver.pollsOf(0x1c)).toHaveLength(0); // not decodable: never polled
  });

  it('never starves slow PIDs even when one PID per request makes the budget tight', async () => {
    const ctx = make({ maxPidsPerRequest: 1, tuning: { extraRequestsPerCycle: 1 } });
    await runFor(ctx, 60_000);
    for (const pid of [
      0x05, 0x0f, 0x04, 0x0e, 0xa4, 0x5c, 0x33, 0x06, 0x07, 0x1f, 0x2f, 0x46, 0xa6,
    ]) {
      const gaps = intervals(ctx.driver.pollsOf(pid).map((c) => c.at));
      expect(gaps.length, `PID ${pid.toString(16)}`).toBeGreaterThan(3);
      expect(Math.max(...gaps), `PID ${pid.toString(16)}`).toBeLessThanOrEqual(12_000);
    }
    expect(ctx.driver.calls.filter((c) => (c.pids?.length ?? 0) > 1)).toHaveLength(0);
  });

  it('spreads a burst of due PIDs over cycles (fast data is not delayed)', async () => {
    const ctx = make({ tuning: { extraRequestsPerCycle: 1 } });
    await ctx.poller.discover();
    const before = ctx.driver.calls.length;
    await runFor(ctx, 100);
    const firstCycle = ctx.driver.calls
      .slice(before)
      .filter((c) => c.kind === 'mode01' && c.at === START);
    expect(firstCycle).toHaveLength(2); // fast batch + one extra batch
  });

  it('puts at most one variable-length fuel trim PID in a request, last', async () => {
    const ctx = make();
    await runFor(ctx, 10_000);
    for (const call of ctx.driver.calls.filter((c) =>
      c.pids?.some((p) => p === 0x06 || p === 0x07),
    )) {
      const pids = call.pids ?? [];
      expect(pids.filter((p) => p === 0x06 || p === 0x07)).toHaveLength(1);
      expect([0x06, 0x07]).toContain(pids.at(-1));
    }
  });

  it('emits the values of each request as one obd/samples event as soon as it completes', async () => {
    const ctx = make();
    await runFor(ctx, 1000);
    const samples = ofType(ctx.events, 'obd/samples');
    const cycle = samples.filter((e) => e.at === START);
    // The fast batch (speed and rpm together), the extra batches and AT RV, each on its own.
    expect(cycle[0]?.samples).toEqual(
      expect.arrayContaining([
        { signal: 'speed', value: 50 },
        { signal: 'rpm', value: 1726 },
      ]),
    );
    expect(cycle.flatMap((e) => e.samples)).toEqual(
      expect.arrayContaining([
        { signal: 'batteryVoltage', value: 12.6 },
        { signal: 'transmissionGear', value: 3 },
      ]),
    );
    const speeds = samples.filter((e) => e.samples.some((x) => x.signal === 'speed'));
    expect(speeds.length).toBeGreaterThanOrEqual(10);
    expect(new Set(speeds.map((e) => e.at)).size).toBe(speeds.length);
    expect(ctx.poller.latest('speed')).toEqual({ value: 50, at: speeds.at(-1)?.at });
  });
});

describe('ObdPoller back-off and silence', () => {
  it('backs off a PID that keeps answering NO DATA and recovers when it answers', async () => {
    const ctx = make();
    ctx.driver.noData.add(0x5c);
    await runFor(ctx, 120_000);
    const gaps = intervals(ctx.driver.pollsOf(0x5c).map((c) => c.at));
    expect(gaps.slice(0, 2).every((g) => g >= 5000 && g < 5500)).toBe(true);
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(20_000);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(60_000 + 200);

    ctx.driver.noData.delete(0x5c);
    const lastPoll = ctx.driver.pollsOf(0x5c).at(-1)?.at ?? 0;
    await runFor(ctx, 150_000);
    const after = ctx.driver.pollsOf(0x5c).filter((c) => c.at > lastPoll);
    const recovered = intervals(after.map((c) => c.at)).slice(-3);
    expect(recovered.every((g) => g >= 5000 && g < 5500)).toBe(true);
  });

  it('backs off a missing fast PID without slowing the other fast PIDs', async () => {
    const ctx = make();
    ctx.driver.noData.add(0x5e);
    await runFor(ctx, 10_000);
    expect(ctx.driver.pollsOf(0x5e).length).toBeLessThan(15);
    expect(ctx.driver.pollsOf(0x0d).length).toBeGreaterThan(90);
  });

  it('switches to a slow probe when the vehicle stops answering and reports it', async () => {
    const ctx = make({ link: { adapter: 'ELM327 v1.5', protocol: 'ISO 15765-4 (CAN 11/500)' } });
    const running = ctx.poller.run();
    await ctx.clock.advance(2000);
    ctx.driver.silent = true;
    const silentFrom = ctx.clock.now();
    await ctx.clock.advance(10_000);
    const link = ofType(ctx.events, 'obd/link');
    expect(link).toEqual([
      {
        type: 'obd/link',
        state: 'connected',
        adapter: 'ELM327 v1.5',
        protocol: 'ISO 15765-4 (CAN 11/500)',
        message: 'No response from the vehicle (ignition off?)',
        at: expect.any(Number),
      },
    ]);
    const probeTimes = ctx.driver.calls
      .filter((c) => c.kind === 'mode01' && c.at > silentFrom + 1000)
      .map((c) => c.at);
    expect(Math.min(...intervals(probeTimes))).toBeGreaterThanOrEqual(2000);
    // Nothing got backed off while the whole vehicle was silent.
    ctx.driver.silent = false;
    await ctx.clock.advance(2500);
    expect(ofType(ctx.events, 'obd/link').at(-1)?.message).toBeNull();
    const resumed = ctx.clock.now();
    await ctx.clock.advance(1500);
    expect(
      ctx.driver.pollsOf(0x05).filter((c) => c.at >= resumed - 2500).length,
    ).toBeGreaterThanOrEqual(1);
    ctx.poller.stop();
    await running;
  });

  it('treats "vehicle silent" adapter errors like unanswered requests', async () => {
    const ctx = make();
    const running = ctx.poller.run();
    await ctx.clock.advance(500);
    for (let i = 0; i < 20; i++) ctx.driver.errors.push(new ElmError('CAN_ERROR', 'CAN ERROR'));
    await ctx.clock.advance(1000);
    expect(ofType(ctx.events, 'obd/link').at(-1)?.message).toContain('ignition off');
    ctx.poller.stop();
    await expect(running).resolves.toBeUndefined();
  });
});

describe('ObdPoller DTCs, VIN, voltage and custom PIDs', () => {
  it('reads DTCs right away, then every dtcIntervalMs, and on request', async () => {
    const ctx = make({ dtcIntervalMs: 10_000 });
    ctx.driver.dtcs = { milOn: true, stored: ['P0420'], pending: [], permanent: [] };
    const running = ctx.poller.run();
    await ctx.clock.advance(25_000);
    const reads = ctx.driver.calls.filter((c) => c.kind === 'dtcs').map((c) => c.at - START);
    expect(reads).toEqual([0, 10_000, 20_000]);
    expect(ofType(ctx.events, 'obd/dtcs')[0]).toEqual({
      type: 'obd/dtcs',
      milOn: true,
      stored: ['P0420'],
      pending: [],
      permanent: [],
      at: START,
    });
    ctx.poller.requestDtcRead();
    await ctx.clock.advance(150);
    expect(ctx.driver.calls.filter((c) => c.kind === 'dtcs')).toHaveLength(4);
    ctx.poller.updateOptions({ dtcIntervalMs: 2000 });
    await ctx.clock.advance(2100);
    expect(ctx.driver.calls.filter((c) => c.kind === 'dtcs')).toHaveLength(5);
    ctx.poller.stop();
    await running;
  });

  it('retries a failed DTC read soon rather than after the full interval', async () => {
    const ctx = make({ dtcIntervalMs: 60_000, tuning: { dtcRetryMs: 5000 } });
    const readDtcs = ctx.driver.readDtcs.bind(ctx.driver);
    let failuresLeft = 1;
    ctx.driver.readDtcs = async () => {
      const report = await readDtcs();
      if (failuresLeft-- > 0) throw new ElmError('BUS_BUSY', 'busy');
      return report;
    };
    await runFor(ctx, 12_000);
    expect(ctx.driver.calls.filter((c) => c.kind === 'dtcs').map((c) => c.at - START)).toEqual([
      0, 5000,
    ]);
    expect(ofType(ctx.events, 'obd/dtcs')).toHaveLength(1);
  });

  it('reads the VIN once; retries only on errors, up to the attempt limit', async () => {
    const ok = make();
    await runFor(ok, 5000);
    expect(ok.driver.calls.filter((c) => c.kind === 'vin')).toHaveLength(1);
    expect(ofType(ok.events, 'obd/vin')).toEqual([
      { type: 'obd/vin', vin: 'WP0ZZZ99ZTS392124', at: START },
    ]);

    const none = make();
    none.driver.vin = null;
    await runFor(none, 5000);
    expect(none.driver.calls.filter((c) => c.kind === 'vin')).toHaveLength(1);
    expect(ofType(none.events, 'obd/vin')).toEqual([]);

    const failing = make({ tuning: { vinRetryMs: 1000, vinAttempts: 3 } });
    const originalReadVin = failing.driver.readVin.bind(failing.driver);
    failing.driver.readVin = async () => {
      await originalReadVin();
      throw new ElmError('TIMEOUT', 'timeout');
    };
    await runFor(failing, 10_000);
    expect(failing.driver.calls.filter((c) => c.kind === 'vin')).toHaveLength(3);
  });

  it('reads the battery voltage every 2 s, and never when unsupported', async () => {
    const ctx = make();
    await runFor(ctx, 10_000);
    const times = ctx.driver.calls.filter((c) => c.kind === 'voltage').map((c) => c.at - START);
    expect(times).toEqual([0, 2000, 4000, 6000, 8000, 10_000]);
    const off = make({ voltageSupported: false });
    await runFor(off, 5000);
    expect(off.driver.calls.filter((c) => c.kind === 'voltage')).toHaveLength(0);
  });

  it('polls custom PIDs at their interval and evaluates their formulas', async () => {
    const custom: CustomPidConfig = {
      signal: 'tirePressureFL',
      mode: '22',
      pid: '4001',
      header: '7C6',
      formula: '((A*256)+B)/10',
      intervalMs: 3000,
    };
    const ctx = make({ customPids: [custom] });
    ctx.driver.raws.set('7C6:224001', [0x08, 0xfc]);
    await runFor(ctx, 10_000);
    expect(ctx.driver.calls.filter((c) => c.kind === 'raw').map((c) => c.at - START)).toEqual([
      0, 3000, 6000, 9000,
    ]);
    expect(ctx.poller.latest('tirePressureFL')?.value).toBeCloseTo(230);
  });

  it('lets a custom PID replace the standard PID for the same signal', async () => {
    const custom: CustomPidConfig = {
      signal: 'fuelLevel',
      mode: '22',
      pid: 'F42F',
      header: null,
      formula: 'A*100/255',
      intervalMs: 5000,
    };
    const ctx = make({ customPids: [custom] });
    ctx.driver.raws.set(':22F42F', [0xff]);
    await runFor(ctx, 12_000);
    expect(ctx.driver.pollsOf(0x2f)).toHaveLength(0);
    expect(ctx.poller.latest('fuelLevel')?.value).toBe(100);
  });

  it('backs off a custom PID the module rejects, and skips invalid formulas', async () => {
    const rejected: CustomPidConfig = {
      signal: 'tirePressureRR',
      mode: '22',
      pid: '4004',
      header: '7C6',
      formula: 'A',
      intervalMs: 1000,
    };
    const broken: CustomPidConfig = {
      ...rejected,
      signal: 'tirePressureRL',
      pid: '4003',
      formula: 'A +* B',
    };
    const ctx = make({ customPids: [rejected, broken] });
    ctx.driver.raws.set('7C6:224004', 'negative');
    await runFor(ctx, 30_000);
    const times = ctx.driver.calls.filter((c) => c.kind === 'raw').map((c) => c.at);
    expect(times.length).toBeLessThan(12); // 1 s interval, backed off after 3 refusals
    expect(await ctx.poller.discover()).not.toContain('tirePressureRL');
  });

  it('applies new custom PIDs without a restart', async () => {
    const ctx = make();
    await ctx.poller.discover();
    const custom: CustomPidConfig = {
      signal: 'tirePressureFR',
      mode: '22',
      pid: '4002',
      header: '7C6',
      formula: '((A*256)+B)/10',
      intervalMs: 1000,
    };
    ctx.driver.raws.set('7C6:224002', [0x09, 0x00]);
    ctx.poller.updateOptions({ customPids: [custom] });
    await runFor(ctx, 2500);
    expect(ctx.poller.latest('tirePressureFR')?.value).toBeCloseTo(230.4);
  });
});

describe('ObdPoller failures', () => {
  it('rejects run() immediately on a link-fatal error', async () => {
    const ctx = make();
    await ctx.poller.discover();
    const caught = ctx.poller.run().catch((err: unknown) => err);
    ctx.driver.errors.push(new ElmError('CLOSED', 'Link lost'));
    await ctx.clock.advance(200);
    expect(await caught).toMatchObject({ code: 'CLOSED' });
  });

  it('gives up after too many consecutive adapter errors', async () => {
    const ctx = make({ tuning: { maxConsecutiveErrors: 4 } });
    await ctx.poller.discover();
    const caught = ctx.poller.run().catch((err: unknown) => err);
    for (let i = 0; i < 10; i++) ctx.driver.errors.push(new ElmError('STOPPED', 'STOPPED'));
    await ctx.clock.advance(1000);
    expect(await caught).toMatchObject({
      code: 'DESYNC',
      message: expect.stringContaining('4 errors in a row'),
    });
  });

  it('survives occasional errors', async () => {
    const ctx = make({ tuning: { maxConsecutiveErrors: 4 } });
    const running = ctx.poller.run();
    for (let i = 0; i < 5; i++) {
      ctx.driver.errors.push(new ElmError('DATA_ERROR', 'data error'));
      await ctx.clock.advance(300);
    }
    ctx.poller.stop();
    await expect(running).resolves.toBeUndefined();
    expect(ofType(ctx.events, 'obd/samples').length).toBeGreaterThan(5);
  });

  it('keeps polling when an event consumer throws', async () => {
    const clock = new FakeClock(START);
    const driver = new FakeDriver(clock.now).addEcu('7E8', ENGINE);
    let delivered = 0;
    const poller = new ObdPoller(driver, { now: clock.now, timers: clock }, () => {
      delivered += 1;
      throw new Error('consumer bug');
    });
    const running = poller.run();
    await clock.advance(1000);
    poller.stop();
    await expect(running).resolves.toBeUndefined();
    expect(delivered).toBeGreaterThan(10);
  });

  it('refuses to run twice', async () => {
    const ctx = make();
    const running = ctx.poller.run();
    await expect(ctx.poller.run()).rejects.toThrow('already running');
    ctx.poller.stop();
    await ctx.clock.advance(0);
    await running;
  });
});

describe('ObdPoller regressions', () => {
  /** Make a driver call take `ms` on the fake clock (a timeout plus resync, a slow module …). */
  const slow =
    <A extends unknown[], R>(clock: FakeClock, ms: number, fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await new Promise<void>((resolve) => clock.setTimeout(resolve, ms));
      return fn(...args);
    };

  it('stamps samples when their request completed, not when the cycle ends (obd-2)', async () => {
    const custom: CustomPidConfig = {
      signal: 'tirePressureFL',
      mode: '22',
      pid: '4001',
      header: '7C6',
      formula: '((A*256)+B)/10',
      intervalMs: 10_000,
    };
    const ctx = make({ customPids: [custom] });
    ctx.driver.raws.set('7C6:224001', [0x08, 0xfc]);
    await ctx.poller.discover();
    ctx.driver.raw = slow(ctx.clock, 2450, ctx.driver.raw.bind(ctx.driver));
    await runFor(ctx, 2500);
    const samples = ofType(ctx.events, 'obd/samples');
    const firstWith = (signal: string) =>
      samples.find((e) => e.samples.some((x) => x.signal === signal));
    expect(firstWith('speed')?.at).toBe(START);
    expect(firstWith('tirePressureFL')?.at).toBe(START + 2450);
  });

  it('polls the standard PID again when the custom PID replacing it is invalid (obd-4)', async () => {
    const speed: CustomPidConfig = {
      signal: 'speed',
      mode: '22',
      pid: 'F40D',
      header: '7E0',
      formula: 'A',
      intervalMs: 1000,
    };
    const tpms: CustomPidConfig = { ...speed, signal: 'tirePressureFL', pid: '4001' };
    // Both are planned, and found invalid, in the same cycle.
    const ctx = make({ customPids: [speed, tpms], tuning: { customRequestsPerCycle: 2 } });
    // E.g. an 11-bit header on a 29-bit CAN car, which the config cannot know about.
    ctx.driver.raw = async () => {
      throw new RangeError('Header 7E0 is not a 29-bit CAN id');
    };
    await runFor(ctx, 10_000);
    expect(ctx.driver.pollsOf(0x0d).length).toBeGreaterThan(50);
    expect(ctx.poller.latest('speed')?.value).toBe(50);
    const supported = ofType(ctx.events, 'obd/supported').at(-1)?.signals;
    expect(supported).toContain('speed');
    expect(supported).not.toContain('tirePressureFL'); // nothing provides it any more
  });

  it('gives up when vehicle requests keep failing, although AT RV still answers (obd-8)', async () => {
    const ctx = make();
    await ctx.poller.discover();
    const timeout = async (): Promise<never> => {
      throw new ElmError('TIMEOUT', 'No response within 1000 ms');
    };
    // Each failed request costs its timeout plus a resynchronisation.
    ctx.driver.queryMode01 = slow(ctx.clock, 1500, timeout);
    ctx.driver.readDtcs = slow(ctx.clock, 1500, timeout);
    ctx.driver.readVin = slow(ctx.clock, 1500, timeout);
    const caught = ctx.poller.run().catch((err: unknown) => err);
    await ctx.clock.advance(60_000);
    const outcome = await Promise.race([caught, flush().then(() => 'still polling')]);
    expect(outcome).toMatchObject({ code: 'DESYNC' });
  });

  it('keeps the fast tier going with many custom PIDs behind headers (obd-9)', async () => {
    const signals = ['tirePressureFL', 'tirePressureFR', 'tirePressureRL', 'tirePressureRR'];
    const customs: CustomPidConfig[] = Array.from({ length: 8 }, (_, i) => ({
      signal: signals[i % 4] as CustomPidConfig['signal'],
      mode: '22',
      pid: `400${i}`,
      header: '7B0',
      formula: 'A',
      intervalMs: 1000,
    }));
    const ctx = make({ customPids: customs });
    await ctx.poller.discover();
    // AT SH + AT CRA + request + AT SH + AT CRA at ~60 ms each over Bluetooth.
    ctx.driver.raw = slow(ctx.clock, 300, async () => [{ ecu: '7B8', data: Uint8Array.of(0x20) }]);
    const before = ctx.clock.now();
    const running = ctx.poller.run();
    await ctx.clock.advance(20_000);
    ctx.poller.stop();
    await ctx.clock.advance(5000); // let the requests in flight finish
    await running;
    const fast = ctx.driver.pollsOf(0x0d).filter((c) => c.at >= before);
    expect(Math.max(...intervals(fast.map((c) => c.at)))).toBeLessThanOrEqual(1000);
  });
});

describe('ObdPoller with adapters that cannot take multi-PID requests', () => {
  /** Expected bytes of one ECU's answer to a request for `pids` (service byte, PIDs, data). */
  const answerLength = (pids: readonly number[], table: Record<number, number[]>): number =>
    pids.reduce((n, pid) => n + (table[pid] ? 1 + (table[pid]?.length ?? 0) : 0), 1);

  it('keeps answers to one frame when long ones fail from the start', async () => {
    const ctx = make();
    ctx.driver.singleFrameOnly = true;
    await ctx.poller.discover();
    expect(ctx.poller.pidsPerRequest).toBe(3);
    const discoveryCalls = ctx.driver.calls.length;
    await runFor(ctx, 5000);
    const requests = ctx.driver.calls.slice(discoveryCalls).filter((c) => c.kind === 'mode01');
    for (const call of requests) {
      expect(answerLength(call.pids ?? [], ENGINE), JSON.stringify(call.pids)).toBeLessThanOrEqual(
        7,
      );
    }
    const speeds = ofType(ctx.events, 'obd/samples')
      .filter((e) => e.samples.some((s) => s.signal === 'speed'))
      .map((e) => e.at);
    expect(speeds.length).toBeGreaterThan(40);
    expect(Math.max(...intervals(speeds))).toBeLessThanOrEqual(200);
    // The link tells why.
    expect(ofType(ctx.events, 'obd/link').at(-1)?.message).toBe(
      'Polling up to 3 PIDs per request (long answers fail)',
    );
  });

  it('falls back to one PID per request when even two PIDs fail', async () => {
    const ctx = make();
    const query = ctx.driver.queryMode01.bind(ctx.driver);
    ctx.driver.queryMode01 = async (pids) => {
      if (pids.length > 1) {
        ctx.driver.calls.push({ at: ctx.clock.now(), kind: 'mode01', pids: [...pids] });
        throw new ElmError('UNSUPPORTED', 'The adapter did not understand the command');
      }
      return query(pids);
    };
    await ctx.poller.discover();
    expect(ctx.poller.pidsPerRequest).toBe(1);
    await runFor(ctx, 3000);
    expect(ctx.poller.latest('speed')?.value).toBe(50);
    expect(ofType(ctx.events, 'obd/link').at(-1)?.message).toBe(
      'Polling one PID per request (multi-PID requests fail)',
    );
  });

  it('makes requests smaller when multi-PID requests start failing while polling', async () => {
    const ctx = make({ link: { adapter: 'ELM327 v2.1', protocol: 'ISO 15765-4 (CAN 11/500)' } });
    await ctx.poller.discover();
    expect(ctx.poller.pidsPerRequest).toBe(6);
    const running = ctx.poller.run();
    await ctx.clock.advance(1000);
    ctx.driver.singleFrameOnly = true; // e.g. the adapter's flow control stops working
    const brokenAt = ctx.clock.now();
    await ctx.clock.advance(2000);
    expect(ctx.poller.pidsPerRequest).toBe(3);
    const speeds = ofType(ctx.events, 'obd/samples')
      .filter((e) => e.at > brokenAt && e.samples.some((s) => s.signal === 'speed'))
      .map((e) => e.at);
    expect(speeds[0]).toBeLessThan(brokenAt + 500);
    expect(Math.max(...intervals(speeds))).toBeLessThanOrEqual(200);
    expect(ofType(ctx.events, 'obd/link')).toEqual([
      expect.objectContaining({
        state: 'connected',
        message: 'Polling up to 3 PIDs per request (long answers fail)',
      }),
    ]);
    ctx.poller.stop();
    await running;
  });

  it('steps down when another ECU answers but a long answer loses its frames', async () => {
    // The transmission answers A4 in one frame while the engine's long answer is lost: the
    // result is incomplete rather than an error, and the engine's PIDs must not be backed off.
    const ctx = make();
    await ctx.poller.discover();
    const running = ctx.poller.run();
    await ctx.clock.advance(1000);
    ctx.driver.singleFrameOnly = true;
    await ctx.clock.advance(10_000);
    expect(ctx.poller.pidsPerRequest).toBeLessThanOrEqual(3);
    const recent = ctx.driver.pollsOf(0x05).filter((c) => c.at > ctx.clock.now() - 3000);
    expect(recent.length).toBeGreaterThanOrEqual(2); // coolant was not backed off
    ctx.poller.stop();
    await running;
  });

  it('keeps the batch size when lone requests fail too (a bad link, not the batching)', async () => {
    const ctx = make();
    await ctx.poller.discover();
    const caught = ctx.poller.run().catch((err: unknown) => err);
    await ctx.clock.advance(500);
    ctx.driver.queryMode01 = async () => {
      throw new ElmError('TIMEOUT', 'No response within 1000 ms');
    };
    await ctx.clock.advance(5000);
    expect(await caught).toMatchObject({ code: 'DESYNC' });
    expect(ctx.poller.pidsPerRequest).toBe(6);
  });

  it('does not count NO DATA or a silent vehicle as a batch failure', async () => {
    const ctx = make();
    const running = ctx.poller.run();
    await ctx.clock.advance(500);
    ctx.driver.silent = true;
    await ctx.clock.advance(10_000);
    for (let i = 0; i < 10; i++) ctx.driver.errors.push(new ElmError('CAN_ERROR', 'CAN ERROR'));
    await ctx.clock.advance(5000);
    expect(ctx.poller.pidsPerRequest).toBe(6);
    ctx.poller.stop();
    await running;
  });
});

describe('ObdPoller with one PID per request (K-line)', () => {
  /** Every driver call takes a bus round trip on the fake clock, as on ISO 9141. */
  function kline(options: Partial<PollerOptions> = {}, engine = ENGINE, latencyMs = 250) {
    const ctx = make({ maxPidsPerRequest: 1, ...options }, engine);
    const { driver, clock } = ctx;
    const delay = (ms: number) => new Promise<void>((resolve) => clock.setTimeout(resolve, ms));
    const query = driver.queryMode01.bind(driver);
    const readDtcs = driver.readDtcs.bind(driver);
    const readVin = driver.readVin.bind(driver);
    const readVoltage = driver.readVoltage.bind(driver);
    driver.queryMode01 = async (pids) => (await delay(latencyMs), query(pids));
    driver.readDtcs = async () => (await delay(latencyMs * 4), readDtcs()); // 0101, 03, 07, 0A
    driver.readVin = async () => (await delay(latencyMs * 2), readVin());
    driver.readVoltage = async () => (await delay(30), readVoltage());
    return ctx;
  }
  const timesOf = (events: HudEvent[], signal: string): number[] =>
    ofType(events, 'obd/samples')
      .filter((e) => e.samples.some((s) => s.signal === signal))
      .map((e) => e.at);
  const STOPPED = { ...ENGINE, 0x0d: [0x00] };
  /** Like `runFor`, then let the request in flight finish (it waits on the fake clock). */
  async function runKline(ctx: ReturnType<typeof make>, ms: number): Promise<void> {
    const running = ctx.poller.run();
    await ctx.clock.advance(ms);
    ctx.poller.stop();
    await ctx.clock.advance(5000);
    await running;
  }

  it('keeps speed under 2 s old at 250 ms per request, also while reading codes and the VIN', async () => {
    const ctx = kline({}, STOPPED);
    await runKline(ctx, 100_000);
    const speed = timesOf(ctx.events, 'speed');
    expect(Math.max(...intervals(speed))).toBeLessThan(2000);
    expect(Math.max(...intervals(timesOf(ctx.events, 'rpm')))).toBeLessThan(2000);
    // The fuel flow (fuel rate PID) every cycle: 3 s stale limit.
    expect(Math.max(...intervals(timesOf(ctx.events, 'fuelRate')))).toBeLessThan(3000);
    // Coolant ahead of the other medium PIDs: 10 s stale limit.
    expect(Math.max(...intervals(timesOf(ctx.events, 'coolantTemp')))).toBeLessThan(6000);
    // Trouble codes every 30 s at a standstill, and the VIN once.
    expect(ctx.driver.calls.filter((c) => c.kind === 'dtcs').length).toBeGreaterThanOrEqual(4);
    expect(ofType(ctx.events, 'obd/vin')).toHaveLength(1);
    // Throttle and pedal moved to the medium tier: far fewer polls than speed.
    expect(ctx.driver.pollsOf(0x11).length).toBeLessThan(speed.length / 3);
    expect(ctx.driver.calls.filter((c) => (c.pids?.length ?? 0) > 1)).toHaveLength(0);
  });

  it('reads codes and the VIN with only speed and rpm in that cycle', async () => {
    const ctx = kline({}, STOPPED);
    await runKline(ctx, 40_000);
    const reads = ctx.driver.calls.filter((c) => c.kind === 'dtcs' || c.kind === 'vin');
    for (const read of reads) {
      // The requests between the previous cycle's last one and the read: speed and rpm only.
      const before = ctx.driver.calls.filter((c) => c.at < read.at && c.at > read.at - 900);
      const pids = before.filter((c) => c.kind === 'mode01').flatMap((c) => c.pids ?? []);
      expect(
        pids.every((pid) => pid === 0x0c || pid === 0x0d),
        JSON.stringify(pids),
      ).toBe(true);
    }
  });

  it('puts code and VIN reads off while moving, for at most maxReadDeferralMs', async () => {
    const ctx = kline({ tuning: { maxReadDeferralMs: 60_000 } });
    await runKline(ctx, 150_000);
    const dtcReads = ctx.driver.calls.filter((c) => c.kind === 'dtcs').map((c) => c.at - START);
    // Once on connecting (speed not known yet); the next one is due 30 s later but waits for
    // the deferral (60 s) to run out.
    expect(dtcReads).toHaveLength(2);
    expect(dtcReads[1]).toBeGreaterThan((dtcReads[0] ?? 0) + 30_000 + 60_000);
    expect(dtcReads[1]).toBeLessThan((dtcReads[0] ?? 0) + 30_000 + 63_000);
    // The VIN waited too, then came once.
    expect(ctx.driver.calls.filter((c) => c.kind === 'vin').map((c) => c.at - START)).toEqual([
      expect.toSatisfy((at: number) => at > 60_000),
    ]);
    expect(Math.max(...intervals(timesOf(ctx.events, 'speed')))).toBeLessThan(2000);
  });

  it('reads codes at once when asked to, even while moving', async () => {
    const ctx = kline();
    const running = ctx.poller.run();
    await ctx.clock.advance(10_000);
    const before = ctx.driver.calls.filter((c) => c.kind === 'dtcs').length;
    ctx.poller.requestDtcRead();
    await ctx.clock.advance(3000);
    expect(ctx.driver.calls.filter((c) => c.kind === 'dtcs')).toHaveLength(before + 1);
    ctx.poller.stop();
    await ctx.clock.advance(5000);
    await running;
  });

  it('does not put reads off on CAN', async () => {
    const ctx = make({ dtcIntervalMs: 10_000 });
    await runFor(ctx, 25_000);
    expect(ctx.driver.calls.filter((c) => c.kind === 'dtcs')).toHaveLength(3);
  });

  it('moves throttle and pedal to the medium tier after falling back to one PID', async () => {
    const ctx = make();
    ctx.driver.multiPid = false;
    await runFor(ctx, 10_000);
    expect(ctx.poller.pidsPerRequest).toBe(1);
    const speed = ctx.driver.pollsOf(0x0d).length;
    expect(ctx.driver.pollsOf(0x5e).length).toBeGreaterThan(speed * 0.9);
    expect(ctx.driver.pollsOf(0x11).length).toBeLessThan(speed / 3);
    expect(ctx.driver.pollsOf(0x49).length).toBeLessThan(speed / 3);
  });
});

describe('ObdPoller MIL when trouble codes cannot be read', () => {
  it('reports the MIL alone (an incomplete read) when the code read fails', async () => {
    const ctx = make();
    ctx.driver.addEcu('7E8', { ...ENGINE, 0x01: [0x83, 0x07, 0x65, 0x00] }); // MIL on, 3 codes
    ctx.driver.readDtcs = async () => {
      throw new ElmError('MALFORMED', 'Control unit 7E8 counts 3 trouble code(s) but sent none');
    };
    await runFor(ctx, 1000);
    expect(ofType(ctx.events, 'obd/dtcs')).toEqual([
      {
        type: 'obd/dtcs',
        complete: false,
        milOn: true,
        stored: [],
        pending: [],
        permanent: [],
        at: expect.any(Number),
      },
    ]);
    expect(ctx.driver.pollsOf(0x01)).toHaveLength(1);
  });

  it('reports the MIL off too, and nothing when the vehicle is silent', async () => {
    const ctx = make();
    ctx.driver.addEcu('7E8', { ...ENGINE, 0x01: [0x00, 0x07, 0x65, 0x00] });
    let error: Error = new ElmError('NEGATIVE_RESPONSE', 'busy, repeat request (0x21)');
    ctx.driver.readDtcs = async () => {
      throw error;
    };
    await runFor(ctx, 1000);
    expect(ofType(ctx.events, 'obd/dtcs').map((e) => [e.complete, e.milOn])).toEqual([
      [false, false],
    ]);
    error = new ElmError('NO_RESPONSE', 'no answer');
    const silent = make();
    silent.driver.readDtcs = async () => {
      throw error;
    };
    await runFor(silent, 1000);
    expect(ofType(silent.events, 'obd/dtcs')).toEqual([]);
    expect(silent.driver.pollsOf(0x01)).toHaveLength(0);
  });
});
