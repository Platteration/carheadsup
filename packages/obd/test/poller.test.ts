import type { CustomPidConfig, HudEvent } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { ElmError } from '../src/errors.ts';
import { ObdPoller, type PollerOptions } from '../src/poller.ts';
import { FakeClock, FakeDriver } from './helpers.ts';

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

  it('emits one obd/samples event per cycle with a single timestamp', async () => {
    const ctx = make();
    await runFor(ctx, 1000);
    const samples = ofType(ctx.events, 'obd/samples');
    expect(samples.length).toBeGreaterThanOrEqual(10);
    expect(new Set(samples.map((e) => e.at)).size).toBe(samples.length);
    const first = samples[0];
    expect(first?.samples).toEqual(
      expect.arrayContaining([
        { signal: 'speed', value: 50 },
        { signal: 'rpm', value: 1726 },
        { signal: 'batteryVoltage', value: 12.6 },
        { signal: 'transmissionGear', value: 3 },
      ]),
    );
    expect(ctx.poller.latest('speed')).toEqual({ value: 50, at: samples.at(-1)?.at });
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
