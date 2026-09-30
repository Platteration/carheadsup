import type { HudFrame, WidgetFrame } from '@carheadsup/core';
import { DEMO_SCENARIO } from '@carheadsup/obd/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoEngine } from '../../src/demo/engine.ts';
import { SAMPLE_INTERVAL_MS, snapshotSamples } from '../../src/demo/obd-feed.ts';
import { VehicleSimulator } from '@carheadsup/obd/sim';

/**
 * The in-browser demo's engine in virtual time: the server's engine and simulation with the OBD
 * feed standing in for the adapter, driven through the scripted drive by fake timers.
 */

const T0 = Date.UTC(2026, 8, 30, 7, 30);
const LOOP_S = DEMO_SCENARIO.reduce((sum, step) => sum + step.durationS, 0);

interface Sample {
  t: number;
  step: string | null;
  frame: HudFrame;
}

let demo: DemoEngine | null = null;

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});

afterEach(() => {
  demo?.stop();
  demo = null;
  vi.useRealTimers();
});

function startDemo(): { engine: DemoEngine; samples: Sample[] } {
  const clock = () => Date.now();
  const engine = new DemoEngine({ now: clock, monotonic: clock });
  demo = engine;
  const samples: Sample[] = [];
  engine.onFrame((frame) => {
    samples.push({
      t: (Date.now() - T0) / 1000,
      step: engine.status().script?.step ?? null,
      frame,
    });
  });
  engine.start();
  return { engine, samples };
}

function run(seconds: number): void {
  for (let s = 0; s < seconds; s += 10) vi.advanceTimersByTime(Math.min(10, seconds - s) * 1000);
}

const find = <I extends WidgetFrame['id']>(frame: HudFrame, id: I) =>
  frame.widgets.find((w): w is Extract<WidgetFrame, { id: I }> => w.id === id);

describe('the demo engine', () => {
  it('drives the scripted loop: city, highway, a ringing call, the dashboard at the stop', () => {
    const { samples } = startDemo();
    expect(LOOP_S).toBe(300);
    run(LOOP_S);

    // Live from the first frame, at the configured 15 fps, marked as simulated.
    expect(samples[0]?.frame.status).toMatchObject({ obd: 'connected', simulated: true });
    expect(samples.length / LOOP_S).toBeGreaterThan(14.5);
    expect(samples.length / LOOP_S).toBeLessThan(15.5);

    const inStep = (step: string) => samples.filter((s) => s.step === step);
    const city = inStep('city').find((s) => s.frame.context === 'city' && s.t > 40);
    expect(city).toBeDefined();
    expect(find(city!.frame, 'speedLimit')?.value).toBe(50);
    expect(find(city!.frame, 'nav')).toBeDefined();

    const highway = inStep('highway').filter((s) => s.frame.context === 'highway');
    expect(highway.length).toBeGreaterThan(30 * 15);
    expect(highway.some((s) => (find(s.frame, 'speed')?.value ?? 0) >= 110)).toBe(true);

    const ringing = inStep('red-light').find((s) => s.frame.call?.state === 'ringing');
    expect(ringing?.frame.call).toMatchObject({ name: 'Sam Taylor', canAccept: true });

    // Engine off at the end of the drive: the phone's remote opens the dashboard at once.
    const parked = inStep('parked');
    expect(parked.length).toBeGreaterThan(0);
    expect(parked.every((s) => s.frame.context === 'stopped')).toBe(true);
    expect(parked.at(-1)?.frame.diagnostics?.page).toBe('overview');
  });

  it("accepts a ringing call with 'primary', long before the phone would answer by itself", () => {
    const { engine } = startDemo();
    let waited = 0;
    while (engine.frame.call?.state !== 'ringing' && waited < 120) {
      vi.advanceTimersByTime(250);
      waited += 0.25;
    }
    expect(engine.frame.call?.state).toBe('ringing');
    engine.input('primary');
    vi.advanceTimersByTime(500);
    expect(engine.frame.call?.state).toBe('active');
    expect(engine.status().script?.step).toBe('red-light');
  });

  it('declines a manually triggered call with the phone, and shows messages by sender', () => {
    const { engine } = startDemo();
    run(5);
    engine.control({ phone: { kind: 'incoming-call', name: 'Maria Lopez' } });
    vi.advanceTimersByTime(300);
    expect(engine.frame.call).toMatchObject({ state: 'ringing', name: 'Maria Lopez' });
    engine.input('secondary');
    vi.advanceTimersByTime(300);
    expect(engine.frame.call?.state ?? 'ended').toBe('ended');
    engine.control({ phone: { kind: 'message', sender: 'Alex Chen' } });
    vi.advanceTimersByTime(300);
    expect(engine.frame.toast).toMatchObject({ kind: 'message', title: 'Alex Chen' });
  });

  it('applies config changes as config events (units, layout, shift light)', () => {
    const { engine } = startDemo();
    run(45);
    expect(find(engine.frame, 'speed')?.unit).toBe('km/h');
    const errors = engine.configure({
      units: { system: 'imperial', temperature: 'F', pressure: 'psi', fuelEconomy: 'mpg-us' },
      display: { layout: { preset: 'sport' } },
      shiftLight: { enabled: true },
    });
    expect(errors).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(find(engine.frame, 'speed')?.unit).toBe('mph');
    expect(find(engine.frame, 'tachometer')).toBeDefined();
    expect(engine.config.shiftLight.enabled).toBe(true);
    expect(engine.configure({ display: { layout: { preset: 'huge' as 'sport' } } })).not.toEqual(
      [],
    );
    expect(engine.config.display.layout.preset).toBe('sport');
  });

  it('reports injected faults to the HUD within one sampling period', () => {
    const { engine } = startDemo();
    run(2);
    engine.control({ dtcs: ['P0420'], voltageOverrideV: 11.6 });
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS + 20);
    expect(engine.hudState.vehicle.dtcs.map((d) => d.code)).toEqual(['P0420']);
    expect(engine.hudState.vehicle.milOn).toBe(true);
    expect(engine.hudState.vehicle.signals.batteryVoltage?.value).toBe(11.6);
    engine.control({ dtcs: [], voltageOverrideV: null });
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS + 20);
    expect(engine.hudState.vehicle.dtcs).toEqual([]);
  });

  it('switches to manual driving and back to the start of the script', () => {
    const { engine } = startDemo();
    run(30);
    expect(engine.status().script).toMatchObject({ step: 'city', index: 1, count: 8 });
    expect(engine.control({ mode: 'manual', throttle: 0.4 }).script).toBeNull();
    run(10);
    expect(engine.status()).toMatchObject({ mode: 'manual', throttle: 0.4 });
    engine.control({ mode: 'scenario' });
    run(1);
    expect(engine.status().script).toMatchObject({ step: 'warm-up', index: 0 });
    expect(engine.status().script!.elapsedS).toBeGreaterThan(0.5);
    expect(engine.status().script!.elapsedS).toBeLessThan(1.5);
  });

  it('stops every timer', () => {
    const { engine } = startDemo();
    run(3);
    engine.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the OBD feed', () => {
  it('reads every simulated quantity the poller would, in canonical units', () => {
    const vehicle = new VehicleSimulator({ mode: 'manual' });
    vehicle.setControls({ throttle: 0.5 });
    vehicle.step(8000);
    const samples = new Map(snapshotSamples(vehicle.snapshot()).map((s) => [s.signal, s.value]));
    const snapshot = vehicle.snapshot();
    expect(samples.get('speed')).toBe(Math.round(snapshot.speedKph));
    expect(samples.get('rpm')).toBeCloseTo(snapshot.rpm);
    expect(samples.get('coolantTemp')).toBeCloseTo(snapshot.coolantTempC);
    expect(samples.get('transmissionGear')).toBe(snapshot.gear);
    expect(samples.get('tirePressureFL')).toBeGreaterThan(200);
    expect(samples.size).toBe(33);

    vehicle.setControls({ tirePressuresKpa: null });
    expect(snapshotSamples(vehicle.snapshot()).some((s) => s.signal.startsWith('tire'))).toBe(
      false,
    );
  });
});
