import { DEFAULT_CONFIG, type HudConfig, type PhoneToHud } from '@carheadsup/core';
import { VehicleSimulator } from '@carheadsup/obd';
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../src/sim/index.ts';
import {
  DEFAULT_SIM_LUX,
  SIM_ADAS_REPEAT_MS,
  SIM_LUX_PERIOD_MS,
  SIM_TTC_SECONDS,
  SimAdas,
  SimEnvironment,
} from '../../src/sim/peripherals.ts';
import type { PhoneMessageTranslator } from '../../src/sources/types.ts';
import { FakeClock, memoryLogger, recordingContext } from '../sensors/fakes.ts';

function setup(config: HudConfig = structuredClone(DEFAULT_CONFIG) as HudConfig) {
  const clock = new FakeClock();
  const logger = memoryLogger();
  const messages: PhoneToHud[] = [];
  const translate: PhoneMessageTranslator = (message) => {
    messages.push(message);
    return [];
  };
  const sim = createSimulation(config, { now: clock.now, timers: clock, logger }, { translate });
  const recorder = recordingContext(clock);
  const startAll = async (): Promise<void> => {
    sim.start();
    for (const source of sim.sources) await source.start(recorder.ctx);
  };
  const stopAll = async (): Promise<void> => {
    for (const source of sim.sources) await source.stop();
    await sim.stop();
  };
  return { clock, sim, messages, startAll, stopAll, ...recorder };
}

describe('createSimulation', () => {
  it('builds a scenario-mode vehicle and the phone, light and ADAS sources', () => {
    const { sim } = setup();
    expect(sim.vehicle).toBeInstanceOf(VehicleSimulator);
    expect(sim.sources.map((s) => s.name)).toEqual(['sim-phone', 'sim-env', 'sim-adas']);
    expect(sim.status()).toMatchObject({
      mode: 'scenario',
      scenarioStep: 'warm-up',
      lux: DEFAULT_SIM_LUX,
      speedKph: 0,
    });
  });

  it('steps the vehicle in real time from the injected timers and halts on stop', async () => {
    const { clock, sim, startAll, stopAll } = setup();
    await startAll();
    await clock.advance(25_000, false);
    expect(sim.status().scenarioStep).toBe('city');
    expect(sim.vehicle.snapshot().timeS).toBeCloseTo(25, 1);
    await stopAll();
    const t = sim.vehicle.snapshot().timeS;
    await clock.advance(10_000, false);
    expect(sim.vehicle.snapshot().timeS).toBe(t);
    expect(clock.pendingTimers).toBe(0);
  });

  it('drives the phone from the scenario (guidance starts with the city step)', async () => {
    const { clock, messages, startAll, stopAll } = setup();
    await startAll();
    expect(messages.map((m) => m.t)).toEqual(['road', 'media', 'hazards']);
    await clock.advance(22_000, false);
    expect(messages.some((m) => m.t === 'nav' && m.active)).toBe(true);
    await stopAll();
  });

  it('applies vehicle controls and returns the merged status', async () => {
    const { sim, startAll, stopAll } = setup();
    await startAll();
    const status = sim.control({
      mode: 'manual',
      throttle: 0.4,
      brake: 0,
      engineRunning: true,
      gear: 3,
      dtcs: ['p0420', 'P0300', 'bogus'],
      ambientTempC: -2,
      lux: 12,
      tirePressuresKpa: null,
    });
    expect(status).toMatchObject({
      mode: 'manual',
      throttle: 0.4,
      engineRunning: true,
      dtcs: ['P0420', 'P0300'],
      ambientTempC: -2,
      lux: 12,
      scenarioStep: null,
    });
    expect(sim.vehicle.snapshot().tirePressuresKpa).toBeNull();
    expect(sim.vehicle.snapshot().lux).toBe(12);
    expect(sim.control({})).toEqual(sim.status());
    await stopAll();
  });

  it('reports the peripheral state the dev console controls, so a reload shows it', async () => {
    const { sim, startAll, stopAll } = setup();
    await startAll();
    expect(sim.status()).toMatchObject({
      coolantOverrideC: null,
      voltageOverrideV: null,
      fuelLevelOverridePct: null,
      adas: { blindSpotLeft: false, blindSpotRight: false, collision: 'none' },
      phone: { connected: true, steppedAside: false },
    });
    sim.control({
      coolantOverrideC: 118,
      voltageOverrideV: 11.6,
      fuelLevelOverridePct: 8,
      tirePressuresKpa: { fl: 230, fr: 230, rl: 165, rr: 230 },
      adas: { blindSpotRight: true, collision: 'caution' },
      phone: { kind: 'disconnect' },
      lux: 40,
    });
    // A second console (or the same one after a reload) reads it all back.
    expect(sim.status()).toMatchObject({
      coolantOverrideC: 118,
      voltageOverrideV: 11.6,
      fuelLevelOverridePct: 8,
      tirePressuresKpa: { fl: 230, fr: 230, rl: 165, rr: 230 },
      adas: { blindSpotLeft: false, blindSpotRight: true, collision: 'caution' },
      phone: { connected: false, steppedAside: false },
      lux: 40,
    });
    sim.control({ phone: { kind: 'connect' } });
    sim.setRealPhoneConnected(true);
    expect(sim.status().phone).toEqual({ connected: true, steppedAside: true });
    sim.setRealPhoneConnected(false);
    expect(sim.status().phone).toEqual({ connected: true, steppedAside: false });
    await stopAll();
  });

  it('reports simulated light immediately on change and periodically', async () => {
    const { clock, sim, ofType, startAll, stopAll } = setup();
    await startAll();
    expect(ofType('sensor/light').map((e) => e.lux)).toEqual([DEFAULT_SIM_LUX]);
    sim.control({ lux: 3 });
    expect(ofType('sensor/light').map((e) => e.lux)).toEqual([DEFAULT_SIM_LUX, 3]);
    await clock.advance(SIM_LUX_PERIOD_MS * 4, false);
    expect(ofType('sensor/light').map((e) => e.lux)).toEqual([DEFAULT_SIM_LUX, 3, 3, 3, 3, 3]);
    sim.control({ lux: Number.NaN });
    sim.control({ lux: -5 });
    expect(sim.status().lux).toBe(0);
    await stopAll();
  });

  it('routes ADAS controls, phone triggers and HUD messages to the peripherals', async () => {
    const { clock, sim, messages, ofType, startAll, stopAll } = setup();
    await startAll();
    expect(ofType('adas/link')).toEqual([expect.objectContaining({ connected: true })]);
    sim.control({ adas: { blindSpotLeft: true } });
    expect(ofType('adas/blind-spot').at(-1)).toMatchObject({ left: true, right: false });

    sim.control({ phone: { kind: 'incoming-call', name: 'Maria Lopez' } });
    const call = messages.at(-1);
    expect(call).toMatchObject({ t: 'call', state: 'ringing', callerName: 'Maria Lopez' });
    sim.deliverToPhone({
      t: 'call-action',
      callId: call?.t === 'call' ? call.id : '',
      action: 'accept',
    });
    expect(messages.at(-1)).toMatchObject({ t: 'call', state: 'active' });

    sim.control({ phone: { kind: 'disconnect' } });
    expect(ofType('phone/link').at(-1)).toMatchObject({ connected: false });
    await clock.advance(100, false);
    await stopAll();
  });

  it('restarting the scenario from the dev console takes the phone back to the start', async () => {
    const { clock, sim, messages, startAll, stopAll } = setup();
    await startAll();
    await clock.advance(30_000, false); // into the city, guidance on
    expect(messages.some((m) => m.t === 'nav' && m.active)).toBe(true);
    sim.control({ mode: 'manual' });
    sim.control({ mode: 'scenario' });
    expect(sim.status().scenarioStep).toBe('warm-up');
    expect(messages.at(-1)).toMatchObject({ t: 'nav', active: false });
    await stopAll();
  });

  it('passes readMessagesAloud from the config and follows config updates', async () => {
    const config = structuredClone(DEFAULT_CONFIG) as HudConfig;
    config.phone.readMessagesAloud = false;
    const { sim, messages, startAll, stopAll } = setup(config);
    await startAll();
    sim.control({ phone: { kind: 'message', sender: 'Alex' } });
    expect(messages.at(-1)).toMatchObject({ t: 'message', readingAloud: false });
    const updated = structuredClone(config);
    updated.phone.readMessagesAloud = true;
    for (const source of sim.sources) await source.updateConfig?.(updated);
    sim.control({ phone: { kind: 'message', sender: 'Alex' } });
    expect(messages.at(-1)).toMatchObject({ t: 'message', readingAloud: true });
    await stopAll();
  });
});

describe('SimEnvironment', () => {
  it('clamps and validates the lux', () => {
    expect(new SimEnvironment(-3).lux).toBe(DEFAULT_SIM_LUX);
    expect(new SimEnvironment(Number.POSITIVE_INFINITY).lux).toBe(DEFAULT_SIM_LUX);
    const env = new SimEnvironment(50);
    env.setLux(Number.NaN);
    expect(env.lux).toBe(50);
    env.setLux(0);
    expect(env.lux).toBe(0);
  });
});

describe('SimAdas', () => {
  it('re-emits active warnings every 200 ms and clears them with one final message', async () => {
    const clock = new FakeClock();
    const adas = new SimAdas();
    const { ctx, ofType } = recordingContext(clock);
    adas.apply({ collision: 'warning' }); // before start: remembered
    await adas.start(ctx);
    expect(ofType('adas/link')).toHaveLength(1);
    expect(ofType('adas/collision')).toEqual([
      expect.objectContaining({ level: 'warning', ttcSeconds: SIM_TTC_SECONDS.warning }),
    ]);
    await clock.advance(SIM_ADAS_REPEAT_MS * 5);
    expect(ofType('adas/collision')).toHaveLength(6);

    adas.apply({ blindSpotRight: true, collision: 'none' });
    const collisions = ofType('adas/collision');
    expect(collisions.at(-1)).toMatchObject({ level: 'none', ttcSeconds: null });
    await clock.advance(SIM_ADAS_REPEAT_MS * 3);
    expect(ofType('adas/collision')).toHaveLength(collisions.length); // cleared: no repeats
    expect(ofType('adas/blind-spot')).toHaveLength(4);
    expect(ofType('adas/blind-spot').every((e) => !e.left && e.right)).toBe(true);

    adas.apply({ blindSpotRight: false });
    expect(ofType('adas/blind-spot').at(-1)).toMatchObject({ left: false, right: false });
    await clock.advance(SIM_ADAS_REPEAT_MS * 5);
    expect(ofType('adas/blind-spot')).toHaveLength(5);
    expect(clock.pendingTimers).toBe(0);
    expect(adas.state).toEqual({ blindSpotLeft: false, blindSpotRight: false, collision: 'none' });
    await adas.stop();
  });

  it('ignores invalid values and stops repeating on stop', async () => {
    const clock = new FakeClock();
    const adas = new SimAdas();
    const { ctx, events } = recordingContext(clock);
    await adas.start(ctx);
    adas.apply({ collision: 'boom' as never, blindSpotLeft: 'yes' as never });
    expect(adas.state).toEqual({ blindSpotLeft: false, blindSpotRight: false, collision: 'none' });
    expect(events).toHaveLength(1); // just the link
    adas.apply({ blindSpotLeft: true });
    await adas.stop();
    const count = events.length;
    await clock.advance(1000);
    expect(events).toHaveLength(count);
    expect(clock.pendingTimers).toBe(0);
  });
});
