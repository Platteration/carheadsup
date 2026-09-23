import type { HudEvent } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { Elm327 } from '../src/elm327.ts';
import { ElmError } from '../src/errors.ts';
import { ObdPoller } from '../src/poller.ts';
import { Elm327Emulator, SIM_TPMS_PIDS } from '../src/sim/elm327-emulator.ts';
import { VehicleSimulator } from '../src/sim/vehicle-sim.ts';

const DRIVER = { timeoutMs: 80, settleMs: 5, resetTimeoutMs: 300, searchTimeoutMs: 500 } as const;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function setup(simOptions: ConstructorParameters<typeof VehicleSimulator>[0] = {}) {
  const sim = new VehicleSimulator({ mode: 'manual', engineTempC: 90, ...simOptions });
  const emulator = new Elm327Emulator(sim, { latencyMs: 0 });
  await emulator.open();
  const elm = new Elm327(emulator, DRIVER);
  const info = await elm.initialize({ protocol: '0' });
  return { sim, emulator, elm, info };
}

describe('Elm327 driver against the emulator', () => {
  it('initialises and identifies the emulated adapter', async () => {
    const { info, emulator } = await setup();
    expect(info).toMatchObject({
      adapter: 'ELM327 v1.5',
      description: 'OBDII to RS232 Interpreter',
      stn: null,
      protocolId: '6',
      protocol: 'ISO 15765-4 (CAN 11/500)',
      family: 'can11',
      headers: true,
      voltageSupported: true,
      maxPidsPerRequest: 6,
    });
    expect(emulator.commandLog.slice(0, 7)).toEqual([
      'ATZ',
      'ATE0',
      'ATL0',
      'ATS0',
      'ATH1',
      'ATSP0',
      'ATAT1',
    ]);
  });

  it('reads live values that match the simulation', async () => {
    const { sim, elm } = await setup();
    sim.setControls({ throttle: 0.4 });
    sim.step(6000);
    const truth = sim.snapshot();
    const { values } = await elm.queryMode01([0x0d, 0x0c, 0x05, 0x10, 0x11, 0x5e]);
    expect(values.speed).toBe(Math.round(truth.speedKph));
    expect(values.rpm).toBeCloseTo(truth.rpm, 0);
    expect(values.coolantTemp).toBe(Math.round(truth.coolantTempC));
    expect(values.maf).toBeCloseTo(truth.mafGps, 1);
    expect(values.fuelRate).toBeCloseTo(truth.fuelRateLph, 1);
    const gear = await elm.queryMode01([0xa4]);
    expect(gear.values.transmissionGear).toBe(truth.gear);
    expect(gear.answers.get(0xa4)?.[0]?.ecu).toBe('7E9');
  });

  it('reads stored, pending and permanent codes and the MIL', async () => {
    const { sim, elm } = await setup();
    sim.setDtcs({
      stored: ['P0420', 'P0171', 'P0300', 'U0100'],
      pending: ['P0133'],
      permanent: ['P0420'],
    });
    expect(await elm.readDtcs()).toEqual({
      milOn: true,
      stored: ['P0420', 'P0171', 'P0300', 'U0100'],
      pending: ['P0133'],
      permanent: ['P0420'],
    });
  });

  it('clears codes when stopped (permanent codes remain)', async () => {
    const { sim, elm } = await setup();
    sim.setDtcs({ stored: ['P0420'], permanent: ['P0420'] });
    expect(await elm.clearDtcs()).toEqual({
      ok: true,
      message: 'Trouble codes cleared (2 control units)',
    });
    expect(await elm.readDtcs()).toEqual({
      milOn: false,
      stored: [],
      pending: [],
      permanent: ['P0420'],
    });
  });

  it('reports the refusal to clear codes while moving', async () => {
    const { sim, elm } = await setup();
    sim.setControls({ dtcs: ['P0420'], throttle: 0.5 });
    sim.step(3000);
    const result = await elm.clearDtcs();
    // The transmission acknowledges but the engine ECU refuses: not a success.
    expect(result).toEqual({
      ok: false,
      message:
        'Codes only partly cleared: control unit 7E8 refused (conditions not correct (0x22))',
    });
    expect((await elm.readDtcs()).stored).toEqual(['P0420']);
  });

  it('reads the VIN (multi-frame) and the battery voltage', async () => {
    const { sim, elm } = await setup();
    expect(await elm.readVin()).toBe(sim.vin);
    expect(await elm.readVoltage()).toBe(Math.round(sim.snapshot().batteryVoltage * 10) / 10);
  });

  it('reads a custom service 22 PID from the TPMS module via AT SH / AT CRA', async () => {
    const { sim, elm, emulator } = await setup();
    sim.setControls({ tirePressuresKpa: { fl: 236.5, fr: 235, rl: 179, rr: 230 } });
    const fl = SIM_TPMS_PIDS[0];
    if (!fl) throw new Error('missing TPMS PID');
    const answers = await elm.raw(fl.mode, fl.pid, fl.header);
    expect(answers).toHaveLength(1);
    expect(answers[0]?.ecu).toBe('7CE');
    const data = answers[0]?.data ?? new Uint8Array();
    expect(((data[0] ?? 0) * 256 + (data[1] ?? 0)) / 10).toBeCloseTo(236.5, 1);
    expect(emulator.commandLog.slice(-5)).toEqual([
      'ATSH7C6',
      'ATCRA7CE',
      '224001',
      'ATSH7DF',
      'ATCRA',
    ]);
    // Back on the default header, the engine answers again.
    expect((await elm.queryMode01([0x0d])).answers.get(0x0d)?.[0]?.ecu).toBe('7E8');
  });

  it('recovers from a lost response and from line noise', async () => {
    const { elm, emulator } = await setup();
    emulator.injectFault('drop');
    await expect(elm.queryMode01([0x0d])).rejects.toMatchObject({ code: 'TIMEOUT' });
    // The next command waits for the resynchronisation (an AT RV probe) to finish.
    expect((await elm.queryMode01([0x0d])).answers.has(0x0d)).toBe(true);
    expect(emulator.commandLog.slice(-3)).toEqual(['010D', 'ATRV', '010D']);
    emulator.injectFault('garbage');
    await expect(elm.queryMode01([0x0d])).rejects.toMatchObject({ code: 'MALFORMED' });
    expect((await elm.queryMode01([0x0d])).answers.has(0x0d)).toBe(true);
    expect(elm.closed).toBe(false);
  });

  it('fails the session on an adapter reset or a dropped link', async () => {
    const reset = await setup();
    reset.emulator.injectFault('reset');
    await expect(reset.elm.queryMode01([0x0d])).rejects.toMatchObject({ code: 'LV_RESET' });
    expect(reset.elm.closed).toBe(true);

    const spontaneous = await setup();
    spontaneous.emulator.powerCycle();
    await sleep(5);
    expect(spontaneous.elm.closed).toBe(true);

    const dropped = await setup();
    dropped.emulator.injectFault('disconnect');
    const err = await dropped.elm.queryMode01([0x0d]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ElmError);
    expect((err as ElmError).code).toBe('CLOSED');
  });
});

describe('ObdPoller against the emulator', () => {
  async function pollerSetup(simOptions: ConstructorParameters<typeof VehicleSimulator>[0] = {}) {
    const ctx = await setup(simOptions);
    const events: HudEvent[] = [];
    const poller = new ObdPoller(
      ctx.elm,
      {
        maxPidsPerRequest: ctx.info.maxPidsPerRequest,
        voltageSupported: ctx.info.voltageSupported,
        customPids: SIM_TPMS_PIDS,
        link: { adapter: ctx.info.adapter, protocol: ctx.info.protocol },
        tuning: {
          cycleIntervalMs: 5,
          mediumIntervalMs: 20,
          slowIntervalMs: 50,
          verySlowIntervalMs: 100,
        },
      },
      (event) => events.push(event),
    );
    return { ...ctx, poller, events };
  }

  it('discovers PIDs across both ECUs, including custom and voltage signals', async () => {
    const { poller, events } = await pollerSetup();
    const signals = await poller.discover();
    expect(signals).toEqual(
      expect.arrayContaining(['speed', 'rpm', 'coolantTemp', 'odometer', 'transmissionGear']),
    );
    expect(signals).toEqual(
      expect.arrayContaining(['batteryVoltage', 'tirePressureFL', 'tirePressureRR']),
    );
    expect(signals).not.toContain('shortFuelTrimB2'); // bank 2 does not exist on this engine
    expect(poller.supportedPids).toContain(0xa6);
    expect(events).toEqual([{ type: 'obd/supported', signals, at: expect.any(Number) }]);
  });

  it('polls samples, trouble codes and the VIN; tolerates faults', async () => {
    const { poller, events, sim, emulator } = await pollerSetup();
    sim.setControls({ throttle: 0.3, dtcs: ['P0420'] });
    const running = poller.run();
    for (let i = 0; i < 20; i++) {
      sim.step(100);
      await sleep(10);
      if (i === 5) emulator.injectFault('drop');
      if (i === 8) emulator.injectFault('garbage');
    }
    poller.stop();
    await running;

    const samples = events.filter((e) => e.type === 'obd/samples');
    expect(samples.length).toBeGreaterThan(5);
    const seen = new Set(
      samples.flatMap((e) => (e.type === 'obd/samples' ? e.samples.map((s) => s.signal) : [])),
    );
    for (const signal of [
      'speed',
      'rpm',
      'throttle',
      'maf',
      'coolantTemp',
      'transmissionGear',
      'batteryVoltage',
      'tirePressureFL',
      'fuelLevel',
      'odometer',
    ]) {
      expect(seen, signal).toContain(signal);
    }
    expect(events.find((e) => e.type === 'obd/dtcs')).toMatchObject({
      milOn: true,
      stored: ['P0420'],
    });
    expect(events.find((e) => e.type === 'obd/vin')).toMatchObject({ vin: sim.vin });
  });

  it('reports the vehicle going silent and coming back', async () => {
    const { poller, events, emulator } = await pollerSetup();
    await poller.discover();
    const running = poller.run();
    await sleep(30);
    emulator.setEcuOnline(false);
    for (let i = 0; i < 40 && !events.some((e) => e.type === 'obd/link'); i++) await sleep(5);
    expect(events.filter((e) => e.type === 'obd/link').at(-1)).toMatchObject({
      state: 'connected',
      message: expect.stringContaining('ignition off'),
    });
    poller.stop();
    await running;
  });

  it('rejects run() when the link drops', async () => {
    const { poller, emulator } = await pollerSetup();
    await poller.discover();
    const running = poller.run();
    await sleep(20);
    emulator.injectFault('disconnect');
    await expect(running).rejects.toMatchObject({ code: 'CLOSED' });
  });
});
