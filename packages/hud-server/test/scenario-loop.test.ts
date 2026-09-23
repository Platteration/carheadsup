import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ApiDiagnostics,
  HudFrame,
  HudToPhone,
  SimStatus,
  TripRecord,
  WidgetFrame,
} from '@carheadsup/core';
import { DEMO_SCENARIO } from '@carheadsup/obd';
import { afterEach, describe, expect, it } from 'vitest';
import { createHudServer } from '../src/app.ts';
import type { HudServer } from '../src/app.ts';
import { FakeClock } from './sensors/fakes.ts';
import { MemoryLogger, makeTempDir, testConfig } from './helpers.ts';

/**
 * The production composition in `--sim` mode — simulation, ELM327 emulator, ObdService, the
 * simulated phone, light sensor and ADAS module, engine and composer — driven through the
 * whole demo drive in virtual time. Only the host-specific modules (hardware sensors,
 * backlight, mDNS) are left out. This is what the dev console and the README screenshots show,
 * so every step of the scenario must produce the display it is meant to demonstrate.
 */

const T0 = Date.UTC(2026, 8, 23, 7, 30);
const LOOP_S = DEMO_SCENARIO.reduce((sum, step) => sum + step.durationS, 0);

interface Sample {
  /** Virtual seconds since start. */
  t: number;
  step: string | null;
  frame: HudFrame;
}

interface Run {
  server: HudServer;
  clock: FakeClock;
  samples: Sample[];
  toPhone: HudToPhone[];
  logger: MemoryLogger;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function startSimulatedHud(): Promise<Run> {
  const temp = await makeTempDir();
  const clock = new FakeClock(T0);
  const logger = new MemoryLogger();
  await writeFile(
    join(temp.dir, 'config.json'),
    JSON.stringify(testConfig({ server: { mdns: false } })),
  );
  const server = createHudServer({
    dataDir: temp.dir,
    rendererDir: temp.dir,
    sim: true,
    port: 0,
    host: '127.0.0.1',
    now: clock.now,
    timers: clock,
    logger,
    createSensorSources: () => [],
    createFrameSinks: () => [],
    advertiseHud: () => null,
  });
  cleanups.push(async () => {
    await server.stop();
    await temp.cleanup();
  });
  await server.start();
  const simulation = server.simulation;
  if (simulation === null) throw new Error('no simulation');
  const toPhone: HudToPhone[] = [];
  const deliver = simulation.deliverToPhone.bind(simulation);
  simulation.deliverToPhone = (message) => {
    toPhone.push(message);
    deliver(message);
  };
  const samples: Sample[] = [];
  server.engine.onFrame((frame) => {
    const status: SimStatus = simulation.status();
    samples.push({ t: (clock.now() - T0) / 1000, step: status.scenarioStep, frame });
  });
  return { server, clock, samples, toPhone, logger };
}

/** Advance virtual time in slices, flushing I/O between timers (the OBD link is async). */
async function run(clock: FakeClock, seconds: number): Promise<void> {
  for (let s = 0; s < seconds; s += 10) await clock.advance(Math.min(10, seconds - s) * 1000);
}

/**
 * Await `promise` while advancing virtual time in small steps: a request that reaches the OBD
 * adapter (clearing codes) waits for the emulator's response timers.
 */
async function settle<T>(clock: FakeClock, promise: Promise<T>): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  for (let i = 0; !done && i < 600; i++) await clock.advance(50);
  return tracked;
}

const find = <I extends WidgetFrame['id']>(frame: HudFrame, id: I) =>
  frame.widgets.find((w): w is Extract<WidgetFrame, { id: I }> => w.id === id);
const ids = (frame: HudFrame): string[] => frame.widgets.map((w) => w.id);

describe('the simulated HUD through the demo drive', () => {
  it('shows each scenario step as intended, in virtual time', async () => {
    const { clock, samples, logger } = await startSimulatedHud();
    await run(clock, LOOP_S + 40);

    // Frames at the configured rate (15 fps), through the whole loop.
    const perSecond = samples.length / (LOOP_S + 40);
    expect(perSecond).toBeGreaterThan(14.5);
    expect(perSecond).toBeLessThan(15.5);
    expect(samples.every((s) => s.frame.status.simulated)).toBe(true);
    const inStep = (step: string) => samples.filter((s) => s.step === step);

    // Start-up: parked (the dashboard) until the car moves off.
    const warmUp = inStep('warm-up').filter((s) => s.t < 20);
    expect(warmUp.length).toBeGreaterThan(0);
    expect(warmUp.every((s) => s.frame.context === 'parked')).toBe(true);
    expect(warmUp.at(-1)?.frame.diagnostics?.page).toBe('overview');
    expect(warmUp.at(-1)?.frame.status.obd).toBe('connected');

    // City: speed, the 50 limit, guidance onto Station Road, media; no dashboard.
    const city = inStep('city').find((s) => s.frame.context === 'city' && s.t > 30);
    expect(city).toBeDefined();
    const cityFrame = city!.frame;
    expect(cityFrame.diagnostics).toBeNull();
    expect(ids(cityFrame)).toEqual(expect.arrayContaining(['speed', 'speedLimit', 'nav', 'media']));
    expect(find(cityFrame, 'speedLimit')?.value).toBe(50);
    expect(find(cityFrame, 'nav')?.street).toBe('Station Road');
    // The first track change brings up the media toast while driving through town.
    expect(inStep('city').some((s) => s.frame.toast?.kind === 'media')).toBe(true);
    // Lane guidance for the left turn onto Bridge Avenue.
    expect(
      inStep('city').some(
        (s) => find(s.frame, 'nav')?.street === 'Bridge Avenue' && find(s.frame, 'lanes'),
      ),
    ).toBe(true);

    // Red light: the car stops and the scripted call rings, then auto-answers.
    const redLight = inStep('red-light');
    expect(redLight.some((s) => s.frame.context === 'stopped')).toBe(true);
    const ringing = redLight.find((s) => s.frame.call?.state === 'ringing');
    expect(ringing?.frame.call).toMatchObject({ name: 'Sam Taylor', canAccept: true });
    expect(redLight.some((s) => s.frame.call?.state === 'active')).toBe(true);

    // Highway: clutter drops to the essentials, the 120 limit, then the camera in the 100 zone.
    const highway = inStep('highway').filter((s) => s.frame.context === 'highway');
    expect(highway.length).toBeGreaterThan(0);
    for (const { frame } of highway) {
      expect(ids(frame)).not.toContain('media');
      expect(ids(frame)).not.toContain('fuel');
      expect(ids(frame)).not.toContain('clock');
    }
    expect(highway.some((s) => find(s.frame, 'speedLimit')?.value === 120)).toBe(true);
    const camera = highway.map((s) => find(s.frame, 'hazard')).find((h) => h !== undefined);
    expect(camera).toMatchObject({ type: 'speed-camera', speedLimit: 100 });
    // Guidance for the exit reappears in time, with lane advice before the exit.
    expect(
      samples.some(
        (s) =>
          s.frame.context === 'highway' &&
          find(s.frame, 'nav')?.maneuver.type === 'exit-right' &&
          find(s.frame, 'lanes') !== undefined,
      ),
    ).toBe(true);

    // Arriving: the scripted message shows its sender only.
    const message = inStep('arriving').find((s) => s.frame.toast?.kind === 'message');
    expect(message?.frame.toast?.title).toBe('Robin Park');

    // Parked with the engine off: back to the parked dashboard before the next loop starts.
    const parked = inStep('parked');
    expect(parked.length).toBeGreaterThan(0);
    const dashboard = parked.filter((s) => s.frame.context === 'parked');
    expect(dashboard.length).toBeGreaterThan(5 * 15);
    expect(dashboard.every((s) => s.frame.diagnostics !== null)).toBe(true);

    // The next loop drives off again with fresh guidance from the start of the route.
    const again = samples.filter((s) => s.t > LOOP_S && s.frame.context === 'city');
    expect(again.length).toBeGreaterThan(0);
    expect(find(again[0]!.frame, 'nav')?.street).toBe('Station Road');

    expect(logger.text('error')).toBe('');
  }, 60_000);

  it('answers the ringing call from the HUD before the phone auto-answers', async () => {
    const { server, clock, samples, toPhone } = await startSimulatedHud();
    // Warm-up and city (75 s), then into the red-light step where the call rings.
    await run(clock, 77);
    const ringingAt = samples.findIndex((s) => s.frame.call?.state === 'ringing');
    expect(ringingAt).toBeGreaterThan(-1);
    expect(samples.at(-1)?.frame.call?.state).toBe('ringing');

    server.engine.dispatch({ type: 'input', action: 'primary', at: clock.now() });
    expect(toPhone).toEqual([
      { t: 'call-action', callId: expect.stringMatching(/^sim-call-/), action: 'accept' },
    ]);
    await clock.advance(500);
    // Picked up at once (the simulated phone would only auto-answer after 6 s).
    expect(samples.at(-1)?.frame.call).toMatchObject({ state: 'active', name: 'Sam Taylor' });
  }, 60_000);

  it('decodes injected codes, clears them only when parked, and logs the finished trip', async () => {
    const { server, clock, samples, toPhone } = await startSimulatedHud();
    const base = `http://127.0.0.1:${server.port}`;
    const api = (method: string, path: string, body?: unknown) =>
      settle(
        clock,
        (async () => {
          const res = await fetch(`${base}${path}`, {
            method,
            ...(body === undefined
              ? {}
              : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
          });
          const text = await res.text();
          return { status: res.status, text, json: (): unknown => JSON.parse(text) };
        })(),
      );
    const diagnostics = async () => (await api('GET', '/api/diagnostics')).json() as ApiDiagnostics;
    const context = () => samples.at(-1)?.frame.context;

    await run(clock, 5); // connected, first trouble-code read done
    expect((await diagnostics()).dtcsCheckedAt).not.toBeNull();
    const drive = { mode: 'manual', engineRunning: true, throttle: 0.4, brake: 0 };
    expect((await api('POST', '/api/sim', { ...drive, dtcs: ['P0301', 'p0420'] })).status).toBe(
      200,
    );
    await run(clock, 20);
    expect(context()).toBe('city');
    // Read at once, not at the next 30 s interval; decoded with descriptions.
    const found = await diagnostics();
    expect(found.milOn).toBe(true);
    expect(found.dtcs.map((d) => d.code).sort()).toEqual(['P0301', 'P0420']);
    expect(found.dtcs.find((d) => d.code === 'P0301')).toMatchObject({
      kind: 'stored',
      description: 'Cylinder 1 Misfire Detected',
    });

    const clear = () => api('POST', '/api/diagnostics/clear-dtcs');
    const moving = await clear();
    expect(moving.status).toBe(409);
    expect(moving.text).toMatch(/parked/);

    await api('POST', '/api/sim', { throttle: 0, brake: 1 });
    await run(clock, 20);
    expect(context()).toBe('stopped');
    await api('POST', '/api/sim', { engineRunning: false });
    await run(clock, 10);
    // Engine off but not parked yet (start-stop grace): still refused.
    expect(context()).toBe('stopped');
    expect((await clear()).status).toBe(409);
    // Parked once the car has stood still with the engine off long enough (the defaults'
    // display.context.engineOffParkedAfterMs / parkedAfterMs).
    for (let s = 0; s < 300 && context() !== 'parked'; s += 10) await run(clock, 10);
    expect(context()).toBe('parked');
    const cleared = await clear();
    expect(cleared.status).toBe(200);
    expect(cleared.json()).toMatchObject({ ok: true });
    await clock.advance(1000);
    expect(await diagnostics()).toMatchObject({ milOn: false, dtcs: [] });

    // Five minutes with the engine off end the trip: saved and pushed to the phone.
    await run(clock, 300);
    const completed = toPhone.filter((m) => m.t === 'trip-completed');
    expect(completed).toHaveLength(1);
    const trip = completed[0]!.t === 'trip-completed' ? completed[0]!.trip : null;
    expect(trip?.distanceKm).toBeGreaterThan(0.2);
    expect(trip?.maxSpeedKph).toBeGreaterThan(50);
    const stored = (await api('GET', '/api/trips')).json() as TripRecord[];
    expect(stored.map((t) => t.id)).toEqual([trip?.id]);
    const csv = (await api('GET', '/api/trips.csv')).text.trim().split('\n');
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain(trip?.id);
  }, 60_000);
});
