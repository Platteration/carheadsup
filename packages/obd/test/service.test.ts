import type { HudEvent, ObdConfig, ObdLinkState } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { ObdService, type ObdServiceDeps } from '../src/service.ts';
import { Elm327Emulator, SIM_TPMS_PIDS } from '../src/sim/elm327-emulator.ts';
import { VehicleSimulator } from '../src/sim/vehicle-sim.ts';
import { TransportEvents, type Transport } from '../src/transport.ts';
import { FakeClock } from './helpers.ts';

const CONFIG: ObdConfig = {
  transport: 'serial',
  serialPath: '/dev/rfcomm0',
  baudRate: 38_400,
  tcpHost: '192.168.0.10',
  tcpPort: 35_000,
  protocol: '0',
  timeoutMs: 1000,
  reconnectDelayMs: 3000,
  dtcIntervalMs: 30_000,
  customPids: [],
  recordTranscript: false,
};

/** A transport that cannot be opened (no such device). */
class DeadTransport implements Transport {
  readonly description = 'serial /dev/rfcomm0 @ 38400';
  private readonly events = new TransportEvents();
  async open(): Promise<void> {
    throw new Error("ENOENT: no such file or directory, open '/dev/rfcomm0'");
  }
  async write(): Promise<void> {
    throw new Error('not open');
  }
  onData(cb: (chunk: string) => void): () => void {
    return this.events.onData(cb);
  }
  onClose(cb: (err?: Error) => void): () => void {
    return this.events.onClose(cb);
  }
  async close(): Promise<void> {}
}

function harness(config: Partial<ObdConfig> = {}, deps: Partial<ObdServiceDeps> = {}) {
  const clock = new FakeClock(1_000_000);
  const events: HudEvent[] = [];
  const service = new ObdService(
    { ...CONFIG, ...config },
    {
      now: clock.now,
      setTimeout: (cb, ms) => clock.setTimeout(cb, ms),
      clearTimeout: (handle) => clock.clearTimeout(handle),
      driver: { resetTimeoutMs: 500, searchTimeoutMs: 2000, settleMs: 10 },
      poller: { cycleIntervalMs: 100 },
      ...deps,
    },
  );
  service.onEvent((event) => events.push(event));
  const links = (): Array<{
    state: ObdLinkState;
    at: number;
    message: string | null | undefined;
  }> =>
    events.flatMap((e) =>
      e.type === 'obd/link' ? [{ state: e.state, at: e.at, message: e.message }] : [],
    );
  return { clock, events, service, links };
}

describe('ObdService reconnection', () => {
  it('emits error and retries with exponential backoff capped at 30 s', async () => {
    const { clock, service, links } = harness({}, { createTransport: () => new DeadTransport() });
    service.start();
    await clock.advance(120_000);
    const states = links();
    const errors = states.filter((l) => l.state === 'error');
    const connecting = states.filter((l) => l.state === 'connecting');
    expect(errors[0]?.message).toBe(
      "Cannot open serial /dev/rfcomm0 @ 38400: ENOENT: no such file or directory, open '/dev/rfcomm0'",
    );
    const delays = connecting.slice(1).map((c, i) => c.at - (errors[i]?.at ?? 0));
    expect(delays.slice(0, 6)).toEqual([3000, 6000, 12_000, 24_000, 30_000, 30_000]);
    expect(states.map((s) => s.state).slice(0, 4)).toEqual([
      'connecting',
      'error',
      'connecting',
      'error',
    ]);
    await service.stop();
    expect(links().at(-1)?.state).toBe('disconnected');
    const count = links().length;
    await clock.advance(120_000);
    expect(links()).toHaveLength(count); // no more attempts after stop()
  });

  it('connects, and resets the backoff after a successful session', async () => {
    const sim = new VehicleSimulator({ mode: 'manual', engineTempC: 90 });
    let attempts = 0;
    let lastEmulator: Elm327Emulator | null = null;
    const { clock, service, links, events } = harness(
      {},
      {
        createTransport: () => {
          attempts += 1;
          if (attempts <= 3) return new DeadTransport();
          lastEmulator = new Elm327Emulator(sim, { latencyMs: 0 });
          return lastEmulator;
        },
      },
    );
    service.start();
    await clock.advance(3000 + 6000 + 12_000 + 5000);
    expect(service.status.state).toBe('connected');
    expect(service.status.adapter).toBe('ELM327 v1.5');
    expect(service.status.protocol).toBe('ISO 15765-4 (CAN 11/500)');
    const connectedAt = links().find((l) => l.state === 'connected')?.at ?? 0;
    expect(
      links()
        .filter((l) => l.at <= connectedAt)
        .map((l) => l.state)
        .slice(-3),
    ).toEqual(['connecting', 'initializing', 'connected']);
    expect(events.some((e) => e.type === 'obd/samples')).toBe(true);

    // Lose the link: the next attempt comes after the base delay again, not 24 s.
    (lastEmulator as Elm327Emulator | null)?.injectFault('disconnect');
    await clock.advance(200);
    const lostAt =
      links()
        .filter((l) => l.state === 'error')
        .at(-1)?.at ?? 0;
    expect(service.status.state).toBe('error');
    expect(service.status.message).toContain('Connection to the adapter lost');
    await clock.advance(5000);
    const retryAt = links().filter((l) => l.state === 'connecting' && l.at > lostAt)[0]?.at;
    expect(retryAt).toBe(lostAt + 3000);
    await service.stop();
  });

  it('reports a silent vehicle (ignition off) and keeps trying it on the open link', async () => {
    const { clock, service, links } = harness(
      { transport: 'simulator' },
      {
        simulator: new VehicleSimulator({ mode: 'manual' }),
        emulator: { latencyMs: 0, ecuOnline: false },
      },
    );
    service.start();
    await clock.advance(10_000);
    const error = links().find((l) => l.state === 'error');
    expect(error?.message).toContain('vehicle did not answer');
    // One connection: no reopening, no adapter reset, no growing delay.
    expect(links().filter((l) => l.state === 'connecting')).toHaveLength(1);
    const log = service.emulator?.commandLog ?? [];
    expect(log.filter((c) => c === 'ATZ')).toHaveLength(1);
    expect(log.filter((c) => c === '0100').length).toBeGreaterThanOrEqual(3);
    await service.stop();
  });
});

describe('ObdService time to data', () => {
  /** The audit's slow clone: ATZ 1 s, a full protocol search 2.5 s (10 s when it fails). */
  const SLOW = { latencyMs: 40, resetLatencyMs: 1000, searchLatencyMs: 2500 } as const;

  function memoryCache(initial: Record<string, string> = {}) {
    const saved = new Map(Object.entries(initial));
    return {
      saved,
      cache: {
        get: (connection: string) => saved.get(connection) ?? null,
        set: (connection: string, id: string) => void saved.set(connection, id),
      },
    };
  }

  function firstSpeedAt(events: HudEvent[]): number | null {
    for (const e of events) {
      if (e.type === 'obd/samples' && e.samples.some((s) => s.signal === 'speed')) return e.at;
    }
    return null;
  }

  for (const offFor of [20_000, 45_000, 90_000, 150_000]) {
    it(`delivers speed within 5 s of the ECU waking up (off for ${offFor / 1000} s)`, async () => {
      const { cache } = memoryCache({ simulator: '6' });
      const { clock, service, events, links } = harness(
        { transport: 'simulator' },
        {
          simulator: new VehicleSimulator({ mode: 'manual' }),
          emulator: { ...SLOW, ecuOnline: false },
          driver: { resetTimeoutMs: 3000, searchTimeoutMs: 20_000, settleMs: 150 },
          protocolCache: cache,
        },
      );
      service.start();
      await clock.advance(offFor);
      service.emulator?.setEcuOnline(true);
      const onlineAt = clock.now();
      await clock.advance(10_000);
      const first = firstSpeedAt(events);
      expect(first).not.toBeNull();
      expect((first ?? Infinity) - onlineAt).toBeLessThan(5000);
      expect(links().filter((l) => l.state === 'connecting')).toHaveLength(1);
      await service.stop();
    });
  }

  it('without a remembered protocol searches every time, still without resetting', async () => {
    const { clock, service, events } = harness(
      { transport: 'simulator' },
      {
        simulator: new VehicleSimulator({ mode: 'manual' }),
        emulator: { ...SLOW, ecuOnline: false },
        driver: { resetTimeoutMs: 3000, searchTimeoutMs: 20_000, settleMs: 150 },
      },
    );
    service.start();
    await clock.advance(40_000);
    const log = service.emulator?.commandLog ?? [];
    expect(log.filter((c) => c === 'ATZ')).toHaveLength(1);
    expect(log.some((c) => c.startsWith('ATTP'))).toBe(false);
    service.emulator?.setEcuOnline(true);
    const onlineAt = clock.now();
    await clock.advance(20_000);
    // A failing search takes 10 s here: within one search plus the retry delay.
    expect((firstSpeedAt(events) ?? Infinity) - onlineAt).toBeLessThan(10_000 + 3000 + 3000);
    await service.stop();
  });

  it('remembers the protocol, starts the search with it and searches fully every fifth try', async () => {
    const { cache, saved } = memoryCache();
    const sim = new VehicleSimulator({ mode: 'manual' });
    const first = harness(
      { transport: 'simulator' },
      { simulator: sim, emulator: { latencyMs: 0 }, protocolCache: cache },
    );
    first.service.start();
    await first.clock.advance(2000);
    expect(first.service.status.state).toBe('connected');
    expect(saved.get('simulator')).toBe('6');
    expect(first.service.emulator?.commandLog).toContain('ATSP0');
    await first.service.stop();

    const second = harness(
      { transport: 'simulator' },
      { simulator: sim, emulator: { latencyMs: 0, ecuOnline: false }, protocolCache: cache },
    );
    second.service.start();
    await second.clock.advance(3000 * 6 + 1000);
    const log = second.service.emulator?.commandLog ?? [];
    expect(log).toContain('ATSPA6');
    const protocolCommands = log.filter((c) => /^AT(SP|TP)/.test(c));
    expect(protocolCommands.slice(0, 7)).toEqual([
      'ATSPA6', // initialize
      'ATTP6',
      'ATTP6',
      'ATTP6',
      'ATTP6',
      'ATSPA6', // every fifth try: a full search
      'ATTP6',
    ]);
    await second.service.stop();
  });

  it('searches instead when the adapter does not know AT TP', async () => {
    const { cache } = memoryCache({ 'serial:/dev/rfcomm0': '6' });
    let emulator: Elm327Emulator | null = null;
    class NoTryProtocol extends Elm327Emulator {
      override async write(data: string): Promise<void> {
        if (data.startsWith('ATTP')) {
          // Like a clone that answers "?" to a command it lacks.
          await super.write('ATXX\r');
          return;
        }
        await super.write(data);
      }
    }
    const { clock, service } = harness(
      {},
      {
        createTransport: () => {
          emulator = new NoTryProtocol(new VehicleSimulator({ mode: 'manual' }), {
            latencyMs: 0,
            ecuOnline: false,
          });
          return emulator;
        },
        protocolCache: cache,
      },
    );
    service.start();
    await clock.advance(10_000);
    const log = (emulator as Elm327Emulator | null)?.commandLog ?? [];
    expect(log.filter((c) => c === 'ATXX')).toHaveLength(1);
    expect(log.filter((c) => c === 'ATSPA6').length).toBeGreaterThanOrEqual(2);
    (emulator as Elm327Emulator | null)?.setEcuOnline(true);
    await clock.advance(4000);
    expect(service.status.state).toBe('connected');
    await service.stop();
  });

  it('reuses the discovered PIDs and the VIN after reconnecting to the same vehicle', async () => {
    const sim = new VehicleSimulator({ mode: 'manual', engineTempC: 90 });
    let created = 0;
    let latest: Elm327Emulator | null = null;
    const { clock, service, events } = harness(
      {},
      {
        createTransport: () => {
          created += 1;
          latest = new Elm327Emulator(sim, { latencyMs: 0 });
          return latest;
        },
      },
    );
    service.start();
    await clock.advance(2000);
    const firstLog = [...((latest as Elm327Emulator | null)?.commandLog ?? [])];
    expect(firstLog.filter((c) => /^01(20|40|60|80|A0)$/.test(c)).length).toBeGreaterThan(0);
    expect(firstLog).toContain('0902');
    (latest as Elm327Emulator | null)?.injectFault('disconnect');
    await clock.advance(5000);
    expect(created).toBe(2);
    expect(service.status.state).toBe('connected');
    const secondLog = (latest as Elm327Emulator | null)?.commandLog ?? [];
    // No bitmap walk past 0100, no VIN read: straight to polling.
    expect(secondLog.filter((c) => /^01(20|40|60|80|A0)$/.test(c))).toEqual([]);
    expect(secondLog).not.toContain('0902');
    const supported = events.filter((e) => e.type === 'obd/supported');
    expect(supported).toHaveLength(2);
    expect(supported[1]).toEqual({ ...supported[0], at: expect.any(Number) });
    await service.stop();
  });
});

describe('ObdService with the simulator', () => {
  it('streams vehicle events from the supplied simulator', async () => {
    const sim = new VehicleSimulator({ mode: 'manual', engineTempC: 90 });
    sim.setControls({ dtcs: ['P0420'] });
    const { clock, service, events } = harness(
      { transport: 'simulator', customPids: [...SIM_TPMS_PIDS] },
      { simulator: sim, emulator: { latencyMs: 0 } },
    );
    expect(service.getSimulator()).toBe(sim);
    service.start();
    await clock.advance(2000);
    sim.setControls({ throttle: 0.5 });
    for (let i = 0; i < 20; i++) {
      sim.step(100);
      await clock.advance(100);
    }
    const types = new Set(events.map((e) => e.type));
    expect(types).toEqual(
      new Set(['obd/link', 'obd/supported', 'obd/samples', 'obd/dtcs', 'obd/vin']),
    );
    const supported = events.find((e) => e.type === 'obd/supported');
    expect(supported?.type === 'obd/supported' && supported.signals).toEqual(
      expect.arrayContaining([
        'speed',
        'rpm',
        'transmissionGear',
        'tirePressureFL',
        'batteryVoltage',
      ]),
    );
    const lastSpeed = events
      .flatMap((e) =>
        e.type === 'obd/samples' ? e.samples.filter((s) => s.signal === 'speed') : [],
      )
      .at(-1);
    expect(lastSpeed?.value).toBeGreaterThan(5);
    expect(events.find((e) => e.type === 'obd/dtcs')).toMatchObject({
      milOn: true,
      stored: ['P0420'],
    });
    expect(service.emulator).toBeInstanceOf(Elm327Emulator);
    await service.stop();
    expect(service.emulator).toBeNull();
  });

  it('creates and steps its own simulator when none is supplied', async () => {
    let fake = 0; // monotonic clock seen by the simulation stepper
    const { clock, service } = harness(
      { transport: 'simulator' },
      { emulator: { latencyMs: 0 }, simulationClock: { now: () => fake } },
    );
    const sim = service.getSimulator();
    expect(sim).toBe(service.getSimulator());
    sim.setControls({ mode: 'manual', throttle: 0.6 });
    service.start();
    for (let i = 0; i < 40; i++) {
      fake += 100;
      await clock.advance(100);
    }
    expect(sim.snapshot().speedKph).toBeGreaterThan(10);
    await service.stop();
    const frozen = sim.snapshot().timeS;
    fake += 5000;
    await clock.advance(5000);
    expect(sim.snapshot().timeS).toBe(frozen); // stepping stops with the service
  });

  it('refuses to clear codes while driving or with the engine running, allows it parked', async () => {
    const sim = new VehicleSimulator({ mode: 'manual', engineTempC: 90 });
    sim.setControls({ dtcs: ['P0420'] });
    const { clock, service, events } = harness(
      { transport: 'simulator' },
      { simulator: sim, emulator: { latencyMs: 0 } },
    );
    expect(await service.clearDtcs()).toEqual({
      ok: false,
      message: 'The OBD adapter is not connected',
    });
    service.start();
    await clock.advance(2000);

    sim.setControls({ throttle: 0.5 });
    sim.step(5000);
    await clock.advance(300);
    expect((await service.clearDtcs()).message).toBe(
      'Trouble codes can only be cleared while parked',
    );

    sim.setControls({ throttle: 0, brake: 1 });
    sim.step(10_000);
    await clock.advance(300);
    expect((await service.clearDtcs()).message).toBe(
      'Switch the engine off (ignition on) before clearing trouble codes',
    );

    sim.setControls({ engineRunning: false });
    sim.step(3000);
    await clock.advance(300);
    const result = await service.clearDtcs();
    expect(result.ok).toBe(true);
    await clock.advance(300);
    expect(events.filter((e) => e.type === 'obd/dtcs').at(-1)).toMatchObject({
      milOn: false,
      stored: [],
    });
    await service.stop();
  });

  it('reads trouble codes on request instead of waiting for the DTC interval', async () => {
    const sim = new VehicleSimulator({ mode: 'manual', engineTempC: 90 });
    const { clock, service, events } = harness(
      { transport: 'simulator', dtcIntervalMs: 60_000 },
      { simulator: sim, emulator: { latencyMs: 0 } },
    );
    service.requestDtcRead(); // not connected yet: harmless no-op
    service.start();
    await clock.advance(2000);
    const reads = () => events.filter((e) => e.type === 'obd/dtcs');
    expect(reads()).toHaveLength(1); // right after connecting
    expect(reads()[0]).toMatchObject({ milOn: false, stored: [] });

    sim.setControls({ dtcs: ['P0301'] });
    await clock.advance(5000);
    expect(reads()).toHaveLength(1); // the next scheduled read is a minute away

    service.requestDtcRead();
    await clock.advance(300);
    expect(reads()).toHaveLength(2);
    expect(reads()[1]).toMatchObject({ milOn: true, stored: ['P0301'] });
    await service.stop();
    service.requestDtcRead(); // stopped: still harmless
  });

  it('reconnects immediately when connection settings change, in place otherwise', async () => {
    const sim = new VehicleSimulator({ mode: 'manual', engineTempC: 90 });
    const { clock, service, links } = harness(
      { transport: 'simulator' },
      { simulator: sim, emulator: { latencyMs: 0 } },
    );
    service.start();
    await clock.advance(2000);
    expect(service.status.state).toBe('connected');
    const before = links().length;

    service.updateConfig({
      ...CONFIG,
      transport: 'simulator',
      dtcIntervalMs: 5000,
      timeoutMs: 800,
    });
    await clock.advance(1000);
    expect(links()).toHaveLength(before); // no reconnect for in-place settings

    service.updateConfig({ ...CONFIG, transport: 'simulator', protocol: '6' });
    await clock.advance(2000);
    const after = links()
      .slice(before)
      .map((l) => l.state);
    expect(after).toEqual(['connecting', 'initializing', 'connected']);
    expect(service.emulator?.commandLog).toContain('ATSP6');
    await service.stop();
  });

  it('closes a link that finishes opening after stop()', async () => {
    let opened = false;
    let closedAfterOpen = false;
    let finishOpen: () => void = () => {};
    class SlowTransport extends DeadTransport {
      override async open(): Promise<void> {
        await new Promise<void>((resolve) => (finishOpen = resolve));
        opened = true;
      }
      override async close(): Promise<void> {
        // Like a TCP socket still connecting: closing before the open completes does nothing.
        if (opened) closedAfterOpen = true;
      }
    }
    const { clock, service } = harness({}, { createTransport: () => new SlowTransport() });
    service.start();
    await clock.advance(10);
    const stopping = service.stop();
    finishOpen();
    await stopping;
    expect(closedAfterOpen).toBe(true);
    expect(service.status.state).toBe('disconnected');
  });

  it('start() and stop() are idempotent', async () => {
    const { clock, service, links } = harness({}, { createTransport: () => new DeadTransport() });
    await service.stop();
    expect(links()).toEqual([]);
    service.start();
    service.start();
    await clock.advance(100);
    expect(links().filter((l) => l.state === 'connecting')).toHaveLength(1);
    await service.stop();
    await service.stop();
    expect(links().filter((l) => l.state === 'disconnected')).toHaveLength(1);
  });
});

describe('ObdService regressions', () => {
  it('opens the new link only after the old one finished closing (obd-11)', async () => {
    const sim = new VehicleSimulator({ mode: 'manual', engineTempC: 90 });
    const log: string[] = [];
    let handles = 0;
    let maxHandles = 0;
    let clock: FakeClock | null = null;
    /** An emulator whose close takes 200 ms, like an rfcomm TTY draining its output. */
    class SlowClosing extends Elm327Emulator {
      private closing: Promise<void> | null = null;
      private readonly id: number;
      constructor(id: number) {
        super(sim, { latencyMs: 0 });
        this.id = id;
      }
      override async open(): Promise<void> {
        log.push(`open #${this.id}`);
        handles += 1;
        maxHandles = Math.max(maxHandles, handles);
        await super.open();
      }
      override close(): Promise<void> {
        this.closing ??= (async () => {
          log.push(`close #${this.id} start`);
          await new Promise<void>((resolve) => clock?.setTimeout(resolve, 200));
          await super.close();
          handles -= 1;
          log.push(`close #${this.id} done`);
        })();
        return this.closing;
      }
    }
    let created = 0;
    const h = harness({}, { createTransport: () => new SlowClosing(++created) });
    clock = h.clock;
    h.service.start();
    await h.clock.advance(2000);
    expect(h.service.status.state).toBe('connected');
    h.service.updateConfig({ ...CONFIG, protocol: '6' });
    await h.clock.advance(2000);
    expect(h.service.status.state).toBe('connected');
    expect(log.indexOf('close #1 done')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('close #1 done')).toBeLessThan(log.indexOf('open #2'));
    expect(maxHandles).toBe(1);
    const stopping = h.service.stop();
    await h.clock.advance(300);
    await stopping;
  });

  it('refuses to clear codes without recent speed and rpm data (obd-14)', async () => {
    const sim = new VehicleSimulator({ mode: 'manual', engineTempC: 90, engineRunning: false });
    const { clock, service } = harness(
      { transport: 'simulator' },
      { simulator: sim, emulator: { latencyMs: 0 } },
    );
    service.start();
    await clock.advance(2000);
    expect(service.status.state).toBe('connected');
    // The session stays up but no service 01 answer arrives any more.
    service.emulator?.setEcuOnline(false);
    await clock.advance(6000);
    expect(service.status.state).toBe('connected');
    expect(await service.clearDtcs()).toEqual({
      ok: false,
      message: 'Vehicle data unavailable: cannot confirm the car is parked with the engine off',
    });
    expect(service.emulator?.commandLog).not.toContain('04');
    await service.stop();
  });
});
