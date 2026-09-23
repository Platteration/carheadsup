import { describe, expect, it } from 'vitest';
import { SimulationClock } from '../src/sim/clock.ts';
import { rpmPerKph } from '../src/sim/model.ts';
import { DEMO_SCENARIO } from '../src/sim/scenario.ts';
import { VehicleSimulator } from '../src/sim/vehicle-sim.ts';
import { FakeClock } from './helpers.ts';

const warm = (options: ConstructorParameters<typeof VehicleSimulator>[0] = {}) =>
  new VehicleSimulator({ mode: 'manual', engineTempC: 90, ...options });

/** Step in 10 ms increments until `done` or `maxMs`; returns elapsed ms. */
function stepUntil(sim: VehicleSimulator, done: () => boolean, maxMs: number, dtMs = 10): number {
  let t = 0;
  while (t < maxMs && !done()) {
    sim.step(dtMs);
    t += dtMs;
  }
  return t;
}

describe('VehicleSimulator dynamics', () => {
  it('accelerates from 0 to 100 km/h in a plausible 8–12 s at full throttle', () => {
    const sim = warm();
    sim.setControls({ throttle: 1 });
    const ms = stepUntil(sim, () => sim.snapshot().speedKph >= 100, 20_000);
    expect(ms / 1000).toBeGreaterThanOrEqual(8);
    expect(ms / 1000).toBeLessThanOrEqual(12);
  });

  it('shifts up through the gears near the redline at full throttle, and never over-revs', () => {
    const sim = warm();
    sim.setControls({ throttle: 1 });
    const shifts: Array<{ from: number; to: number; rpm: number }> = [];
    let gear = sim.snapshot().gear;
    let lastRpm = 0;
    let maxRpm = 0;
    for (let t = 0; t < 30_000; t += 10) {
      sim.step(10);
      const s = sim.snapshot();
      if (s.gear !== gear) {
        shifts.push({ from: gear, to: s.gear, rpm: lastRpm });
        gear = s.gear;
      }
      lastRpm = s.rpm;
      maxRpm = Math.max(maxRpm, s.rpm);
    }
    expect(shifts.slice(0, 3).map((s) => [s.from, s.to])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
    for (const shift of shifts.slice(0, 3)) expect(shift.rpm).toBeGreaterThan(5500);
    expect(maxRpm).toBeLessThanOrEqual(6800);
  });

  it('upshifts early at light throttle and cruises in top gear on the highway', () => {
    const sim = warm();
    sim.setControls({ throttle: 0.25 });
    stepUntil(sim, () => sim.snapshot().gear >= 2, 20_000);
    expect(sim.snapshot().rpm).toBeLessThan(3000);
    sim.setControls({ mode: 'scenario' });
    // Run the demo into the highway step and check the cruise.
    for (let i = 0; i < 160; i++) sim.step(1000);
    const s = sim.snapshot();
    expect(s.scenarioStep).toBe('highway');
    expect(s.gear).toBe(6);
    expect(s.speedKph).toBeGreaterThan(105);
    expect(s.speedKph).toBeLessThan(125);
    expect(s.rpm).toBeGreaterThan(1800);
    expect(s.rpm).toBeLessThan(2600);
  });

  it('ties engine speed to road speed with realistic rpm per km/h', () => {
    const sim = warm();
    sim.setControls({ throttle: 0.3, gear: 3 });
    sim.step(15_000);
    const s = sim.snapshot();
    expect(s.gear).toBe(3);
    expect(s.rpm / s.speedKph).toBeCloseTo(rpmPerKph(3), 1);
    expect(rpmPerKph(1)).toBeCloseTo(111.5, 0);
    expect(rpmPerKph(6)).toBeCloseTo(18.5, 0);
  });

  it('holds a commanded gear, including neutral (free revving, no drive)', () => {
    const sim = warm();
    sim.setControls({ gear: 2, throttle: 1 });
    sim.step(8000);
    expect(sim.snapshot().gear).toBe(2);
    sim.setControls({ gear: 0, throttle: 0.5, brake: 0 });
    const speedBefore = sim.snapshot().speedKph;
    sim.step(3000);
    const s = sim.snapshot();
    expect(s.gear).toBe(0);
    expect(s.speedKph).toBeLessThan(speedBefore); // coasting
    expect(s.rpm).toBeGreaterThan(3000); // revving freely on half throttle
    sim.setControls({ gear: null });
    sim.step(2000);
    expect(sim.snapshot().gear).toBeGreaterThan(0);
  });

  it('idles at about 750 rpm when warm, faster when cold', () => {
    const sim = warm();
    sim.setControls({ brake: 0.5 });
    sim.step(10_000);
    expect(sim.snapshot().rpm).toBeCloseTo(750, -1);
    expect(sim.snapshot().speedKph).toBe(0);
    const cold = new VehicleSimulator({ mode: 'manual', ambientTempC: 5 });
    cold.setControls({ brake: 0.5 });
    cold.step(5000);
    expect(cold.snapshot().rpm).toBeGreaterThan(850);
  });

  it('creeps in gear without brake (torque converter) and brakes to a stop', () => {
    const sim = warm();
    sim.step(20_000);
    expect(sim.snapshot().speedKph).toBeGreaterThan(2);
    expect(sim.snapshot().speedKph).toBeLessThan(10);
    sim.setControls({ throttle: 0.6 });
    sim.step(10_000);
    sim.setControls({ throttle: 0, brake: 1 });
    const ms = stepUntil(sim, () => sim.snapshot().speedKph === 0, 20_000);
    expect(ms).toBeLessThan(6000);
  });

  it('coasts down with the engine off and reports rpm 0', () => {
    const sim = warm();
    sim.setControls({ throttle: 0.5 });
    sim.step(8000);
    sim.setControls({ engineRunning: false, throttle: 0 });
    sim.step(3000);
    const s = sim.snapshot();
    expect(s.rpm).toBe(0);
    expect(s.speedKph).toBeGreaterThan(0);
    expect(s.fuelRateLph).toBe(0);
    expect(s.mafGps).toBe(0);
    expect(s.mapKpa).toBe(s.baroKpa);
  });

  it('cuts fuel on the overrun and enriches at full load', () => {
    const sim = warm();
    sim.setControls({ throttle: 1 });
    sim.step(5000);
    const wot = sim.snapshot();
    expect(wot.commandedLambda).toBeLessThan(0.9);
    expect(wot.mapKpa).toBeGreaterThan(90);
    expect(wot.engineLoadPct).toBeGreaterThan(85);
    sim.setControls({ throttle: 0 });
    sim.step(500);
    const overrun = sim.snapshot();
    expect(overrun.fuelRateLph).toBe(0);
    expect(overrun.mapKpa).toBeLessThan(30);
  });
});

describe('VehicleSimulator engine and body signals', () => {
  it('warms the coolant from ambient to the thermostat (~90 °C) and holds it there', () => {
    const sim = new VehicleSimulator({ mode: 'manual', ambientTempC: 15 });
    sim.setControls({ throttle: 0.2 });
    const samples: number[] = [];
    for (let minute = 0; minute < 25; minute++) {
      sim.step(60_000);
      samples.push(sim.snapshot().coolantTempC);
      if (sim.snapshot().speedKph > 70) sim.setControls({ throttle: 0.1 });
    }
    expect(samples[0]).toBeGreaterThan(15);
    const rising = samples.slice(0, 6);
    expect(rising.every((t, i) => i === 0 || t > (rising[i - 1] ?? 0))).toBe(true);
    expect(samples.findIndex((t) => t >= 80)).toBeLessThan(15); // warm within ~15 min
    const settled = samples.slice(-5);
    expect(Math.min(...settled)).toBeGreaterThan(84);
    expect(Math.max(...settled)).toBeLessThan(97);
    expect(sim.snapshot().oilTempC).toBeGreaterThan(70);
  });

  it('burns fuel: the level falls with distance and fuel rate is plausible', () => {
    const sim = warm({ fuelLevelPct: 50 });
    sim.setControls({ mode: 'scenario' });
    const start = sim.snapshot();
    sim.step(5 * 60_000);
    const end = sim.snapshot();
    expect(end.fuelLevelPct).toBeLessThan(start.fuelLevelPct);
    const litres = ((start.fuelLevelPct - end.fuelLevelPct) / 100) * 50;
    const km = end.odometerKm - start.odometerKm;
    expect(km).toBeGreaterThan(3);
    const lPer100 = (litres / km) * 100;
    expect(lPer100).toBeGreaterThan(4);
    expect(lPer100).toBeLessThan(15);
  });

  it('charges at ~14.2 V running and rests at ~12.6 V off', () => {
    const sim = warm();
    sim.setControls({ throttle: 0.2 });
    sim.step(30_000);
    expect(sim.snapshot().batteryVoltage).toBeCloseTo(14.2, 1);
    sim.setControls({ engineRunning: false, throttle: 0, brake: 1 });
    sim.step(300_000);
    expect(sim.snapshot().batteryVoltage).toBeCloseTo(12.6, 1);
  });

  it('applies and releases coolant, voltage and fuel overrides', () => {
    const sim = warm();
    sim.setControls({ coolantOverrideC: 118, voltageOverrideV: 11.2, fuelLevelOverridePct: 4 });
    let s = sim.snapshot();
    expect([s.coolantTempC, s.batteryVoltage, s.fuelLevelPct]).toEqual([118, 11.2, 4]);
    expect(s.controlModuleVoltage).toBeCloseTo(11.0);
    sim.setControls({ coolantOverrideC: null, voltageOverrideV: null, fuelLevelOverridePct: null });
    s = sim.snapshot();
    expect(s.coolantTempC).toBeCloseTo(90, 0);
    expect(s.fuelLevelPct).toBeCloseTo(64, 0);
  });

  it('clamps and ignores invalid control values', () => {
    const sim = warm();
    sim.setControls({ throttle: 7, brake: -1, gear: 12, lux: -5, fuelLevelOverridePct: 250 });
    const status = sim.status();
    expect(status.throttle).toBe(1);
    expect(status.brake).toBe(0);
    expect(status.lux).toBe(0);
    expect(sim.snapshot().heldGear).toBe(6);
    expect(sim.snapshot().fuelLevelPct).toBe(100);
    sim.setControls({ throttle: Number.NaN });
    expect(sim.status().throttle).toBe(1);
  });

  it('injects, lists and clears trouble codes (MIL follows stored codes)', () => {
    const sim = warm();
    sim.setControls({ dtcs: ['p0420', 'P0420', 'bogus', 'U0100'] });
    expect(sim.status().dtcs).toEqual(['P0420', 'U0100']);
    expect(sim.snapshot().milOn).toBe(true);
    sim.setDtcs({ pending: ['P0171'], permanent: ['P0420'] });
    expect(sim.clearDtcs()).toBe(true);
    const s = sim.snapshot();
    expect(s.dtcs).toEqual({ stored: [], pending: [], permanent: ['P0420'] });
    expect(s.milOn).toBe(false);
    expect(s.distanceSinceClearKm).toBe(0);
  });

  it('accumulates distance with the MIL on', () => {
    const sim = warm();
    sim.setControls({ dtcs: ['P0300'], throttle: 0.4 });
    sim.step(60_000);
    const s = sim.snapshot();
    expect(s.distanceWithMilKm).toBeGreaterThan(0.5);
    expect(s.distanceWithMilKm).toBeCloseTo(s.distanceSinceClearKm - 1523.6, 5);
  });

  it('reports tyre pressures that rise a little as the tyres warm, or none without TPMS', () => {
    const sim = warm();
    sim.setControls({ tirePressuresKpa: { fl: 230, fr: 232, rl: 180, rr: 228 } });
    expect(sim.snapshot().tirePressuresKpa).toEqual({ fl: 230, fr: 232, rl: 180, rr: 228 });
    sim.setControls({ throttle: 0.3 });
    sim.step(20 * 60_000);
    const hot = sim.snapshot().tirePressuresKpa;
    expect(hot?.fl).toBeGreaterThan(232);
    expect(hot?.fl).toBeLessThan(260);
    sim.setControls({ tirePressuresKpa: null });
    expect(sim.snapshot().tirePressuresKpa).toBeNull();
    expect(new VehicleSimulator({ tirePressuresKpa: null }).snapshot().tirePressuresKpa).toBeNull();
  });

  it('exposes the vehicle part of SimStatus with every field', () => {
    const sim = warm({ lux: 1500, ambientTempC: 3 });
    expect(sim.status()).toEqual({
      mode: 'manual',
      throttle: 0,
      brake: 0,
      engineRunning: true,
      gear: 1,
      speedKph: 0,
      rpm: 750,
      dtcs: [],
      lux: 1500,
      ambientTempC: 3,
      scenarioStep: null,
      coolantOverrideC: null,
      voltageOverrideV: null,
      fuelLevelOverridePct: null,
      tirePressuresKpa: { fl: 235, fr: 235, rl: 230, rr: 230 },
    });
    sim.setControls({ lux: 20, ambientTempC: -2 });
    expect(sim.status()).toMatchObject({ lux: 20, ambientTempC: -2 });
  });

  it('reports the overrides and tyre pressures as set, so a reloaded console shows them', () => {
    const sim = warm();
    sim.setControls({
      coolantOverrideC: 121,
      voltageOverrideV: 11.4,
      fuelLevelOverridePct: 140,
      tirePressuresKpa: { fl: 230, fr: 228, rl: 165, rr: 231 },
    });
    for (let i = 0; i < 60; i++) sim.step(1000); // the tyres warm up; the setting does not move
    expect(sim.status()).toMatchObject({
      coolantOverrideC: 121,
      voltageOverrideV: 11.4,
      fuelLevelOverridePct: 100, // clamped
      tirePressuresKpa: { fl: 230, fr: 228, rl: 165, rr: 231 },
    });
    sim.setControls({
      coolantOverrideC: null,
      voltageOverrideV: null,
      fuelLevelOverridePct: null,
      tirePressuresKpa: null,
    });
    expect(sim.status()).toMatchObject({
      coolantOverrideC: null,
      voltageOverrideV: null,
      fuelLevelOverridePct: null,
      tirePressuresKpa: null,
    });
  });
});

describe('VehicleSimulator scenario', () => {
  it('runs the named steps in order, loops, and notifies step changes', () => {
    const sim = new VehicleSimulator();
    const steps: Array<[string, number, number]> = [];
    sim.onStep((name, info) => steps.push([name, info.index, info.loop]));
    expect(sim.status().scenarioStep).toBe('warm-up');
    const loopS = DEMO_SCENARIO.reduce((sum, s) => sum + s.durationS, 0);
    for (let t = 0; t < loopS + 30; t++) sim.step(1000);
    expect(steps.map(([name]) => name)).toEqual([
      'city',
      'red-light',
      'on-ramp',
      'highway',
      'exit',
      'arriving',
      'parked',
      'warm-up',
      'city',
    ]);
    expect(steps.at(-2)).toEqual(['warm-up', 0, 1]);
  });

  it('parks with the engine off and restarts it on the next loop', () => {
    const sim = new VehicleSimulator();
    const seen: Record<string, { speed: number; engine: boolean }> = {};
    sim.onStep((name) => {
      seen[`enter:${name}`] = {
        speed: sim.snapshot().speedKph,
        engine: sim.snapshot().engineRunning,
      };
    });
    const loopS = DEMO_SCENARIO.reduce((sum, s) => sum + s.durationS, 0);
    for (let t = 0; t < loopS - 5; t++) sim.step(1000);
    const parked = sim.snapshot();
    expect(parked.scenarioStep).toBe('parked');
    expect(parked.engineRunning).toBe(false);
    expect(parked.speedKph).toBe(0);
    expect(seen['enter:parked']?.speed).toBeLessThan(1);
    for (let t = 0; t < 10; t++) sim.step(1000);
    expect(sim.snapshot().engineRunning).toBe(true);
    expect(sim.status().scenarioStep).toBe('warm-up');
  });

  it('switches between manual and scenario control', () => {
    const sim = new VehicleSimulator();
    sim.step(40_000);
    expect(sim.snapshot().speedKph).toBeGreaterThan(20);
    sim.setControls({ mode: 'manual', throttle: 0, brake: 1 });
    sim.step(10_000);
    expect(sim.status()).toMatchObject({ mode: 'manual', speedKph: 0, scenarioStep: null });
    const steps: string[] = [];
    sim.onStep((name) => steps.push(name));
    sim.setControls({ mode: 'scenario' });
    expect(steps).toEqual(['warm-up']);
  });

  it('is deterministic: identical inputs give identical outputs', () => {
    const drive = (): unknown[] => {
      const sim = new VehicleSimulator({ ambientTempC: 7 });
      const out: unknown[] = [];
      for (let i = 0; i < 400; i++) {
        if (i === 150) sim.setControls({ mode: 'manual', throttle: 0.8, gear: 3 });
        if (i === 250) sim.setControls({ throttle: 0, brake: 0.4, gear: null, dtcs: ['P0301'] });
        sim.step(i % 3 === 0 ? 250 : 125);
        out.push(sim.snapshot());
      }
      return out;
    };
    expect(drive()).toEqual(drive());
  });

  it('gives the same result for one big step as for many small ones', () => {
    const a = warm();
    const b = warm();
    a.setControls({ throttle: 0.5 });
    b.setControls({ throttle: 0.5 });
    a.step(3000);
    for (let i = 0; i < 150; i++) b.step(20);
    expect(a.snapshot().speedKph).toBeCloseTo(b.snapshot().speedKph, 6);
  });

  it('ignores non-positive and non-finite steps', () => {
    const sim = warm();
    const before = sim.snapshot();
    sim.step(0);
    sim.step(-100);
    sim.step(Number.NaN);
    expect(sim.snapshot()).toEqual(before);
  });
});

describe('SimulationClock', () => {
  it('steps the simulation by the real elapsed time, capped per tick', async () => {
    const clock = new FakeClock(0);
    const sim = warm();
    const stepped: number[] = [];
    const original = sim.step.bind(sim);
    sim.step = (dt: number) => {
      stepped.push(dt);
      original(dt);
    };
    const driver = new SimulationClock(sim, {
      stepMs: 50,
      now: clock.now,
      timers: clock,
      maxStepMs: 200,
      timeScale: 2,
    });
    driver.start();
    expect(driver.running).toBe(true);
    await clock.advance(200);
    expect(stepped).toEqual([100, 100, 100, 100]);
    driver.stop();
    await clock.advance(500);
    expect(stepped).toHaveLength(4);
    expect(driver.running).toBe(false);
  });
});

describe('VehicleSimulator regressions', () => {
  it('applies the engine switch sent together with the switch to manual (obd-15)', () => {
    const sim = new VehicleSimulator(); // the demo script, engine running
    sim.step(1000);
    expect(sim.snapshot().engineRunning).toBe(true);
    sim.setControls({ mode: 'manual', engineRunning: false });
    sim.step(3000);
    expect(sim.snapshot()).toMatchObject({ engineRunning: false, rpm: 0 });
  });

  it('keeps the engine switch set while scripted for when manual mode resumes (obd-15)', () => {
    const sim = new VehicleSimulator();
    sim.setControls({ engineRunning: false });
    sim.step(1000);
    expect(sim.snapshot().engineRunning).toBe(true); // the script drives the engine
    sim.setControls({ mode: 'manual' });
    sim.step(3000);
    expect(sim.snapshot()).toMatchObject({ engineRunning: false, rpm: 0 });
  });

  it('continues as the script left the engine when the switch was not touched', () => {
    const sim = new VehicleSimulator({ engineRunning: false }); // the script starts it anyway
    sim.step(1000);
    sim.setControls({ mode: 'manual' });
    sim.step(1000);
    expect(sim.snapshot().engineRunning).toBe(true);
  });
});
