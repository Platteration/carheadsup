import { mkdir, readFile, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, INPUT_ACTIONS, parseConfig } from '@carheadsup/core';
import type {
  ApiConfigResult,
  ApiDiagnostics,
  ApiInfo,
  HudConfig,
  MaintenanceItemStatus,
  PersistedState,
  SimStatus,
  TripRecord,
} from '@carheadsup/core';
import { SIM_TPMS_PIDS } from '@carheadsup/obd';
import { afterEach, describe, expect, it } from 'vitest';
import { createHudServer } from '../../src/app.ts';
import { HUD_VERSION } from '../../src/meta.ts';
import {
  FakeObdService,
  FakeSimulation,
  FakeSource,
  MemoryLogger,
  TestSocket,
  answerChallenge,
  makeTempDir,
  sleep,
  startTestServer,
  waitFor,
} from '../helpers.ts';
import type { TestServer, TestServerOptions } from '../helpers.ts';

let current: TestServer | null = null;

async function start(options: TestServerOptions = {}): Promise<TestServer> {
  current = await startTestServer(options);
  return current;
}

afterEach(async () => {
  await current?.stop();
  current = null;
});

interface Json {
  status: number;
  headers: Headers;
  body: unknown;
}

async function call(
  t: TestServer,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Json> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] ??= 'application/json';
  }
  const res = await fetch(`${t.base}${path}`, init);
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    // keep the text
  }
  return { status: res.status, headers: res.headers, body: parsed };
}

function trip(n: number): TripRecord {
  const startedAt = 1_790_000_000_000 + n * 3_600_000;
  return {
    id: `trip-${n}`,
    startedAt,
    endedAt: startedAt + 600_000,
    distanceKm: n,
    durationS: 600,
    movingS: 500,
    idleS: 100,
    fuelUsedL: null,
    avgLPer100km: null,
    maxSpeedKph: 80,
    avgMovingSpeedKph: 40,
    cost: null,
    currency: 'USD',
    startOdometerKm: null,
    endOdometerKm: null,
  };
}

const tripsFile = (...ns: number[]) => ns.map((n) => `${JSON.stringify(trip(n))}\n`).join('');

/** A non-loopback IPv4 address of this machine (to exercise remote-client rules), if any. */
function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return null;
}

describe('REST API basics', () => {
  it('reports info', async () => {
    const t = await start();
    const res = await call(t, 'GET', '/api/info');
    expect(res.status).toBe(200);
    const info = res.body as ApiInfo;
    expect(info).toMatchObject({
      name: 'carheadsup',
      version: HUD_VERSION,
      simulated: false,
      phoneConnected: false,
      obd: { state: 'disconnected' },
    });
    expect(info.uptimeS).toBeGreaterThanOrEqual(0);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('sends security headers on every response', async () => {
    const t = await start();
    for (const path of ['/api/info', '/api/nope', '/', '/missing']) {
      const res = await fetch(`${t.base}${path}`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain('connect-src');
      expect(csp).toContain('img-src');
      await res.arrayBuffer();
    }
  });

  it('answers unknown endpoints with 404 and wrong methods with 405 + Allow', async () => {
    const t = await start();
    expect(await call(t, 'GET', '/api/nope')).toMatchObject({
      status: 404,
      body: { error: expect.stringContaining('/api/nope') as unknown },
    });
    expect((await call(t, 'GET', '/api')).status).toBe(404);
    expect((await call(t, 'GET', '/api/info/')).status).toBe(404);
    const res = await call(t, 'DELETE', '/api/info');
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
    const config = await call(t, 'POST', '/api/config', {});
    expect(config.status).toBe(405);
    expect(config.headers.get('allow')).toBe('GET, HEAD, PATCH, PUT');
  });

  it('supports HEAD on GET endpoints', async () => {
    const t = await start();
    const res = await fetch(`${t.base}/api/info`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(10);
    expect(await res.text()).toBe('');
  });

  it('refuses state-changing requests from other sites (CSRF)', async () => {
    const t = await start();
    const res = await call(
      t,
      'POST',
      '/api/input',
      { action: 'toggle-blank' },
      {
        Origin: 'http://evil.example',
      },
    );
    expect(res).toMatchObject({ status: 403, body: { error: expect.any(String) as unknown } });
    expect(t.server.engine.state.ui.blanked).toBe(false);
    // Same-origin browser requests are fine.
    const ok = await call(
      t,
      'POST',
      '/api/input',
      { action: 'toggle-blank' },
      {
        Origin: t.base,
      },
    );
    expect(ok.status).toBe(200);
    // Cross-site reads are not blocked here (the browser's same-origin policy hides them).
    expect(
      (await call(t, 'GET', '/api/info', undefined, { Origin: 'http://evil.example' })).status,
    ).toBe(200);
  });

  it('answers plain HTTP requests to WebSocket endpoints with 426', async () => {
    const t = await start();
    const res = await call(t, 'GET', '/ws/hud');
    expect(res.status).toBe(426);
    expect(res.headers.get('upgrade')).toBe('websocket');
  });
});

describe('request bodies', () => {
  it('rejects bodies over 256 KiB with 413', async () => {
    const t = await start();
    const big = JSON.stringify({ vehicle: { name: 'x'.repeat(300 * 1024) } });
    const res = await call(t, 'PATCH', '/api/config', big);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: expect.stringContaining('too large') as unknown });
  });

  it('rejects oversized chunked bodies while streaming', async () => {
    const t = await start();
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: t.port,
          method: 'PATCH',
          path: '/api/config',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      const chunk = 'x'.repeat(64 * 1024);
      for (let i = 0; i < 5; i += 1) req.write(chunk);
      req.end();
    });
    expect(status).toBe(413);
  });

  it('requires JSON bodies', async () => {
    const t = await start();
    expect(
      (
        await call(t, 'POST', '/api/input', 'action=primary', {
          'Content-Type': 'application/x-www-form-urlencoded',
        })
      ).status,
    ).toBe(415);
    expect((await call(t, 'POST', '/api/input', '{"action":', {})).status).toBe(400);
    expect((await call(t, 'POST', '/api/input')).status).toBe(400);
    expect((await call(t, 'POST', '/api/input', [1, 2])).status).toBe(400);
    expect(
      (
        await call(
          t,
          'POST',
          '/api/input',
          { action: 'primary' },
          { 'Content-Type': 'application/json; charset=utf-8' },
        )
      ).status,
    ).toBe(200);
  });
});

describe('config API', () => {
  it('returns the stored config, without runtime overrides', async () => {
    const t = await start();
    const res = await call(t, 'GET', '/api/config');
    expect(res.status).toBe(200);
    // The server listens on an ephemeral port, but the stored config keeps its own value.
    expect((res.body as HudConfig).server.port).toBe(DEFAULT_CONFIG.server.port);
    expect(res.body).toEqual(parseConfig(DEFAULT_CONFIG).config);
  });

  it('PATCH merges, saves and applies the change everywhere', async () => {
    const source = new FakeSource();
    const t = await start({ createSensorSources: () => [source] });
    const res = await call(t, 'PATCH', '/api/config', {
      vehicle: { name: 'Golf' },
      obd: { timeoutMs: 1500 },
      display: { projection: { mirrorX: false } },
    });
    expect(res.status).toBe(200);
    const result = res.body as ApiConfigResult;
    expect(result.errors).toEqual([]);
    expect(result.config.vehicle.name).toBe('Golf');
    expect(result.config.display.projection.mirrorX).toBe(false);

    const saved = JSON.parse(await readFile(join(t.dataDir, 'config.json'), 'utf8')) as HudConfig;
    expect(saved.vehicle.name).toBe('Golf');
    expect(t.server.engine.config.vehicle.name).toBe('Golf');
    expect(t.obd.configs.at(-1)?.timeoutMs).toBe(1500);
    await waitFor(() => source.configs.length === 1, 1000, 'source config update');
    expect(source.configs[0]?.vehicle.name).toBe('Golf');
    expect((await call(t, 'GET', '/api/config')).body).toEqual(result.config);
  });

  it('PATCH with invalid fields answers 422, keeps those fields and applies the rest', async () => {
    const t = await start();
    const res = await call(t, 'PATCH', '/api/config', {
      vehicle: { name: 'Polo', redlineRpm: -5 },
    });
    expect(res.status).toBe(422);
    const result = res.body as ApiConfigResult;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^vehicle\.redlineRpm/);
    expect(result.config.vehicle.name).toBe('Polo');
    expect(result.config.vehicle.redlineRpm).toBe(DEFAULT_CONFIG.vehicle.redlineRpm);
  });

  it('PATCH with a non-object body is a validation error', async () => {
    const t = await start();
    const res = await call(t, 'PATCH', '/api/config', [1]);
    expect(res.status).toBe(422);
    expect((res.body as ApiConfigResult).errors[0]).toMatch(/expected object/);
    expect((await call(t, 'PATCH', '/api/config')).status).toBe(400);
  });

  it('PUT replaces the whole config and validates it', async () => {
    const t = await start();
    const next = parseConfig(DEFAULT_CONFIG).config;
    next.units.system = 'imperial';
    next.server.frameRate = 30;
    const ok = await call(t, 'PUT', '/api/config', next);
    expect(ok.status).toBe(200);
    expect((ok.body as ApiConfigResult).config).toEqual(next);
    expect(t.server.engine.config.server.frameRate).toBe(30);

    const bad = await call(t, 'PUT', '/api/config', {
      ...next,
      units: { ...next.units, system: 'furlongs' },
    });
    expect(bad.status).toBe(422);
    const result = bad.body as ApiConfigResult;
    expect(result.errors[0]).toMatch(/^units\.system/);
    expect(result.config.units.system).toBe('imperial');
  });

  it('does not rewrite the file for a no-op change', async () => {
    const t = await start();
    const before = await readFile(join(t.dataDir, 'config.json'), 'utf8');
    const res = await call(t, 'PATCH', '/api/config', {});
    expect(res.status).toBe(200);
    expect(t.obd.configs).toHaveLength(0);
    expect(await readFile(join(t.dataDir, 'config.json'), 'utf8')).toBe(before);
  });

  it('answers 500 and leaves the config alone when it cannot be saved', async () => {
    const t = await start();
    const path = join(t.dataDir, 'config.json');
    await rm(path);
    await mkdir(join(path, 'blocker'), { recursive: true });
    const res = await call(t, 'PATCH', '/api/config', { vehicle: { name: 'Nope' } });
    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toMatch(/could not be saved/);
    expect(t.server.engine.config.vehicle.name).toBe(DEFAULT_CONFIG.vehicle.name);
    expect(t.logger.text('error')).toMatch(/saving/);
  });

  it('serialises concurrent changes', async () => {
    const t = await start();
    const results = await Promise.all([
      call(t, 'PATCH', '/api/config', { vehicle: { name: 'A' } }),
      call(t, 'PATCH', '/api/config', { units: { currency: 'EUR' } }),
      call(t, 'PATCH', '/api/config', { vehicle: { tankCapacityL: 60 } }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const final = (await call(t, 'GET', '/api/config')).body as HudConfig;
    expect(final.vehicle.name).toBe('A');
    expect(final.units.currency).toBe('EUR');
    expect(final.vehicle.tankCapacityL).toBe(60);
  });

  it('switches the calibration grid off once the car moves, and saves that', async () => {
    const t = await start();
    const on = await call(t, 'PATCH', '/api/config', {
      display: { projection: { showGrid: true } },
    });
    expect(on.status).toBe(200);
    t.obd.emit({ type: 'obd/link', state: 'connected', at: 0 });
    for (let i = 0; i < 10; i += 1) {
      t.obd.emit({
        type: 'obd/samples',
        samples: [
          { signal: 'speed', value: 40 },
          { signal: 'rpm', value: 1800 },
        ],
        at: 0,
      });
      await sleep(60);
    }
    await waitFor(
      () => t.server.engine.config.display.projection.showGrid === false,
      2000,
      'grid switched off',
    );
    const saved = (await call(t, 'GET', '/api/config')).body as HudConfig;
    expect(saved.display.projection.showGrid).toBe(false);
    expect(t.logger.text('info')).toMatch(/switching the calibration grid off/);
  });
});

describe('diagnostics API', () => {
  it('reports link, signals, trouble codes and VIN', async () => {
    const t = await start();
    t.obd.emit({
      type: 'obd/link',
      state: 'connected',
      adapter: 'ELM327 v1.5',
      protocol: 'CAN',
      at: 0,
    });
    t.obd.emit({ type: 'obd/samples', samples: [{ signal: 'coolantTemp', value: 90 }], at: 0 });
    t.obd.emit({ type: 'obd/supported', signals: ['speed', 'rpm', 'coolantTemp'], at: 0 });
    t.obd.emit({
      type: 'obd/dtcs',
      milOn: true,
      stored: ['P0420'],
      pending: [],
      permanent: [],
      at: 0,
    });
    t.obd.emit({ type: 'obd/vin', vin: '1HGCM82633A004352', at: 0 });
    const res = await call(t, 'GET', '/api/diagnostics');
    expect(res.status).toBe(200);
    const d = res.body as ApiDiagnostics;
    expect(d.link).toMatchObject({ state: 'connected', adapter: 'ELM327 v1.5' });
    expect(d.milOn).toBe(true);
    expect(d.dtcs).toEqual([expect.objectContaining({ code: 'P0420', kind: 'stored' })]);
    expect(d.dtcsCheckedAt).toEqual(expect.any(Number));
    expect(d.supported).toEqual(['speed', 'rpm', 'coolantTemp']);
    expect(d.signals.coolantTemp).toEqual({ value: 90, at: expect.any(Number) as unknown });
    expect(d.vin).toBe('1HGCM82633A004352');
  });

  it('reports every time on the HUD’s wall clock, with its own now (regression: settings aging)', async () => {
    const DAY = 86_400_000;
    const clock = { step: 0 };
    const t = await start({
      now: () => Date.now() + clock.step,
      monotonic: () => performance.now(),
    });
    t.obd.emit({ type: 'obd/link', state: 'connected', at: 0 });
    t.obd.emit({ type: 'obd/samples', samples: [{ signal: 'coolantTemp', value: 90 }], at: 0 });
    // Network time steps the system clock three days forward.
    clock.step = 3 * DAY;
    await sleep(300); // a tick syncs the core's wall-clock offset
    const d = (await call(t, 'GET', '/api/diagnostics')).body as ApiDiagnostics;
    expect(Math.abs(d.now - (Date.now() + clock.step))).toBeLessThan(2000);
    // Ages are right on the HUD's clock: the sample is a few hundred ms old, not three days.
    const age = d.now - (d.signals.coolantTemp?.at ?? Number.NaN);
    expect(age).toBeGreaterThanOrEqual(250);
    expect(age).toBeLessThan(2000);
    expect(d.now - d.link.since).toBeLessThan(2000);
    const info = (await call(t, 'GET', '/api/info')).body as ApiInfo;
    expect(info.uptimeS).toBeLessThan(60);
    expect(info.obd.since).toBe(d.link.since);
  });

  it('clears codes only when parked with the engine off', async () => {
    const t = await start();
    const allowed = await call(t, 'POST', '/api/diagnostics/clear-dtcs');
    expect(allowed).toMatchObject({ status: 200, body: { ok: true } });
    expect(t.obd.clearCalls).toBe(1);

    t.obd.emit({ type: 'obd/link', state: 'connected', at: 0 });
    t.obd.emit({
      type: 'obd/samples',
      samples: [
        { signal: 'rpm', value: 800 },
        { signal: 'speed', value: 0 },
      ],
      at: 0,
    });
    const running = await call(t, 'POST', '/api/diagnostics/clear-dtcs');
    expect(running).toMatchObject({
      status: 409,
      body: { ok: false, message: expect.stringMatching(/engine off/) as unknown },
    });

    t.obd.emit({
      type: 'obd/samples',
      samples: [
        { signal: 'rpm', value: 2000 },
        { signal: 'speed', value: 60 },
      ],
      at: 0,
    });
    expect(t.server.engine.state.context.context).not.toBe('parked');
    const moving = await call(t, 'POST', '/api/diagnostics/clear-dtcs');
    expect(moving).toMatchObject({
      status: 409,
      body: { ok: false, message: expect.stringMatching(/parked/) as unknown },
    });
    expect(t.obd.clearCalls).toBe(1);
  });

  it('passes on a refusal from the OBD service as 409', async () => {
    const t = await start();
    t.obd.clearResult = { ok: false, message: 'The OBD adapter is not connected' };
    const res = await call(t, 'POST', '/api/diagnostics/clear-dtcs');
    expect(res).toEqual({
      status: 409,
      headers: expect.anything() as unknown,
      body: { ok: false, message: 'The OBD adapter is not connected' },
    });
  });
});

describe('trips API', () => {
  it('lists newest first with limit and before', async () => {
    const t = await start({ files: { 'trips.jsonl': tripsFile(1, 2, 3, 4) } });
    const all = await call(t, 'GET', '/api/trips');
    expect((all.body as TripRecord[]).map((x) => x.id)).toEqual([
      'trip-4',
      'trip-3',
      'trip-2',
      'trip-1',
    ]);
    const page = await call(t, 'GET', '/api/trips?limit=2');
    expect((page.body as TripRecord[]).map((x) => x.id)).toEqual(['trip-4', 'trip-3']);
    const older = await call(t, 'GET', `/api/trips?limit=2&before=${trip(3).startedAt}`);
    expect((older.body as TripRecord[]).map((x) => x.id)).toEqual(['trip-2', 'trip-1']);
    expect((await call(t, 'GET', '/api/trips?limit=100000')).status).toBe(200);
  });

  it('rejects bad paging parameters', async () => {
    const t = await start();
    for (const qs of ['limit=0', 'limit=-1', 'limit=abc', 'limit=1.5', 'before=yesterday']) {
      expect((await call(t, 'GET', `/api/trips?${qs}`)).status).toBe(400);
    }
  });

  it('exports CSV', async () => {
    const t = await start({ files: { 'trips.jsonl': tripsFile(2, 1) } });
    const res = await fetch(`${t.base}/api/trips.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename=".+\.csv"/);
    const lines = (await res.text()).split('\r\n');
    expect(lines[0]).toMatch(/^id,started_at,/);
    expect(lines[1]).toMatch(/^trip-1,/);
    expect(lines[2]).toMatch(/^trip-2,/);
  });

  it('deletes trips by id', async () => {
    const t = await start({ files: { 'trips.jsonl': tripsFile(1, 2) } });
    expect(await call(t, 'DELETE', '/api/trips/trip-1')).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(await call(t, 'DELETE', '/api/trips/trip-1')).toMatchObject({ status: 404 });
    expect((await call(t, 'DELETE', '/api/trips/%E0%A4%A')).status).toBe(400);
    const left = await call(t, 'GET', '/api/trips');
    expect((left.body as TripRecord[]).map((x) => x.id)).toEqual(['trip-2']);
    expect(await readFile(join(t.dataDir, 'trips.jsonl'), 'utf8')).not.toContain('trip-1');
  });

  it('stores trips completed while running and pushes them to the phone', async () => {
    const t = await start({ config: { trip: { endAfterEngineOffMs: 0, minDistanceKm: 0 } } });
    const phone = new TestSocket(`${t.wsBase}/ws/phone`);
    try {
      await phone.opened;
      phone.send(answerChallenge(await phone.nextOfType('challenge'), { device: 'P' }));
      await phone.nextOfType('welcome');
      t.obd.emit({ type: 'obd/link', state: 'connected', at: 0 });
      for (let i = 0; i < 5; i += 1) {
        t.obd.emit({
          type: 'obd/samples',
          samples: [
            { signal: 'speed', value: 36 },
            { signal: 'rpm', value: 1500 },
          ],
          at: 0,
        });
        await new Promise((r) => setTimeout(r, 30));
      }
      t.obd.emit({
        type: 'obd/samples',
        samples: [
          { signal: 'speed', value: 0 },
          { signal: 'rpm', value: 0 },
        ],
        at: 0,
      });
      const pushed = await phone.nextOfType('trip-completed');
      const id = (pushed['trip'] as TripRecord).id;
      const trips = (await call(t, 'GET', '/api/trips')).body as TripRecord[];
      expect(trips.map((x) => x.id)).toEqual([id]);
      await waitFor(() => t.server.engine.state.trip.completedCount === 1, 1000, 'completion');
      await t.server.stop();
      expect(await readFile(join(t.dataDir, 'trips.jsonl'), 'utf8')).toContain(id);
    } finally {
      phone.close();
    }
  });
});

describe('maintenance, odometer and input API', () => {
  it('lists maintenance status and records a service', async () => {
    const t = await start();
    const list = await call(t, 'GET', '/api/maintenance');
    expect(list.status).toBe(200);
    const items = list.body as MaintenanceItemStatus[];
    expect(items.map((m) => m.itemId)).toEqual(DEFAULT_CONFIG.maintenance.items.map((m) => m.id));
    expect(items.every((m) => m.status === 'unknown')).toBe(true);

    const done = await call(t, 'POST', '/api/maintenance/oil/done', { odometerKm: 42000 });
    expect(done.status).toBe(200);
    const oil = (done.body as MaintenanceItemStatus[]).find((m) => m.itemId === 'oil');
    expect(oil).toMatchObject({
      lastDoneKm: 42000,
      status: expect.not.stringMatching(/unknown/) as unknown,
    });

    // Without a body the HUD's own odometer is used (unknown here → null).
    const noBody = await call(t, 'POST', '/api/maintenance/oil/done');
    expect(noBody.status).toBe(200);
    expect(
      (noBody.body as MaintenanceItemStatus[]).find((m) => m.itemId === 'oil')?.lastDoneKm,
    ).toBeNull();
  });

  it('validates maintenance requests', async () => {
    const t = await start();
    expect((await call(t, 'POST', '/api/maintenance/warp-core/done', {})).status).toBe(404);
    expect((await call(t, 'POST', '/api/maintenance/oil/done', { odometerKm: -1 })).status).toBe(
      400,
    );
    expect(
      (await call(t, 'POST', '/api/maintenance/oil/done', { odometerKm: 'lots' })).status,
    ).toBe(400);
    expect((await call(t, 'POST', '/api/maintenance/oil/done', 'null')).status).toBe(400);
    expect((await call(t, 'POST', '/api/maintenance/oil/done', { odometerKm: null })).status).toBe(
      200,
    );
  });

  it('sets the odometer and persists it on shutdown', async () => {
    const t = await start();
    expect(await call(t, 'POST', '/api/odometer', { odometerKm: 12345.6 })).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(t.server.engine.state.odometer.km).toBe(12345.6);
    for (const bad of [{ odometerKm: -1 }, { odometerKm: 'x' }, { odometerKm: 1e12 }, {}]) {
      expect((await call(t, 'POST', '/api/odometer', bad)).status).toBe(400);
    }
    await t.server.stop();
    const state = JSON.parse(
      await readFile(join(t.dataDir, 'state.json'), 'utf8'),
    ) as PersistedState;
    expect(state.odometerKm).toBe(12345.6);
  });

  it('accepts every input action and rejects others', async () => {
    const t = await start();
    for (const action of INPUT_ACTIONS) {
      expect((await call(t, 'POST', '/api/input', { action })).status).toBe(200);
    }
    expect((await call(t, 'POST', '/api/input', { action: 'self-destruct' })).status).toBe(400);
    await call(t, 'POST', '/api/input', { action: 'toggle-blank' });
    expect(t.server.engine.state.ui.lastInputAt).toEqual(expect.any(Number));
  });
});

describe('simulator API', () => {
  it('is 404 unless simulating', async () => {
    const t = await start();
    expect((await call(t, 'GET', '/api/sim')).status).toBe(404);
    expect((await call(t, 'POST', '/api/sim', { throttle: 0.5 })).status).toBe(404);
  });

  it('reports and controls the simulation', async () => {
    const sim = new FakeSimulation();
    const t = await start({ sim: true, simulation: sim });
    const status = await call(t, 'GET', '/api/sim');
    expect(status.status).toBe(200);
    expect((status.body as SimStatus).mode).toBe('manual');
    const res = await call(t, 'POST', '/api/sim', {
      throttle: 0.4,
      phone: { kind: 'incoming-call', name: 'Maria' },
      unknownField: true,
    });
    expect(res.status).toBe(200);
    expect(sim.controls).toEqual([
      { throttle: 0.4, phone: { kind: 'incoming-call', name: 'Maria' } },
    ]);
    expect((res.body as SimStatus).throttle).toBe(0.4);
    for (const bad of [
      { throttle: 2 },
      { mode: 'turbo' },
      { dtcs: ['XYZ'] },
      { phone: { kind: 'x' } },
      { gear: 1.5 },
    ]) {
      expect((await call(t, 'POST', '/api/sim', bad)).status).toBe(400);
    }
    expect(sim.controls).toHaveLength(1);
    expect(((await call(t, 'GET', '/api/info')).body as ApiInfo).simulated).toBe(true);
  });

  it('re-reads trouble codes right away when the injected codes change', async () => {
    const sim = new FakeSimulation();
    const t = await start({ sim: true, simulation: sim });
    await call(t, 'POST', '/api/sim', { throttle: 0.2 });
    expect(t.obd.dtcReadRequests).toBe(0);
    expect((await call(t, 'POST', '/api/sim', { dtcs: ['p0420'] })).status).toBe(200);
    expect(sim.controls.at(-1)).toEqual({ dtcs: ['P0420'] });
    expect(t.obd.dtcReadRequests).toBe(1);
    expect((await call(t, 'POST', '/api/sim', { dtcs: [] })).status).toBe(200);
    expect(t.obd.dtcReadRequests).toBe(2);
    // A rejected control changes nothing.
    expect((await call(t, 'POST', '/api/sim', { dtcs: ['nope'] })).status).toBe(400);
    expect(t.obd.dtcReadRequests).toBe(2);
  });

  it('runs OBD against the simulator with TPMS, without touching config.json', async () => {
    const sim = new FakeSimulation();
    const t = await start({ sim: true, simulation: sim });
    expect(t.obd.config.transport).toBe('simulator');
    expect(t.obd.deps.simulator).toBe(sim.vehicle);
    expect(t.obd.config.customPids.map((p) => p.signal)).toEqual(
      SIM_TPMS_PIDS.map((p) => p.signal),
    );
    expect(t.server.engine.config.vehicle.hasTpms).toBe(true);
    expect(t.server.engine.state.simulated).toBe(true);
    expect(sim.started).toBe(1);
    const stored = JSON.parse(await readFile(join(t.dataDir, 'config.json'), 'utf8')) as HudConfig;
    expect(stored.obd.transport).toBe('serial');
    expect(stored.obd.customPids).toEqual([]);
    expect(stored.vehicle.hasTpms).toBe(false);
    // A config change keeps the overrides in force.
    await call(t, 'PATCH', '/api/config', { obd: { timeoutMs: 900 } });
    expect(t.obd.configs.at(-1)).toMatchObject({ transport: 'simulator', timeoutMs: 900 });
    await t.server.stop();
    expect(sim.stopped).toBe(1);
  });
});

describe('remote clients', () => {
  const lan = lanAddress();

  it.skipIf(lan === null)('need the API token once one is configured', async () => {
    const t = await start({ host: '0.0.0.0', config: { server: { apiToken: 'hunter2' } } });
    const remote = `http://${lan}:${t.port}`;
    const none = await fetch(`${remote}/api/info`);
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toMatch(/^Bearer/);
    expect(await none.json()).toEqual({ error: expect.any(String) as unknown });
    expect(
      (await fetch(`${remote}/api/info`, { headers: { Authorization: 'Bearer nope' } })).status,
    ).toBe(401);
    expect(
      (await fetch(`${remote}/api/info`, { headers: { Authorization: 'Bearer hunter2' } })).status,
    ).toBe(200);
    // Static files stay public (the settings app must load to ask for the token).
    expect((await fetch(`${remote}/settings`)).status).toBe(200);
    // Loopback needs no token.
    expect((await fetch(`${t.base}/api/info`)).status).toBe(200);
    // Changing the token applies to the very next request.
    const patched = await fetch(`${remote}/api/config`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer hunter2', 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: { apiToken: 'correct-horse' } }),
    });
    expect(patched.status).toBe(200);
    expect(
      (await fetch(`${remote}/api/info`, { headers: { Authorization: 'Bearer hunter2' } })).status,
    ).toBe(401);
    expect(
      (await fetch(`${remote}/api/info`, { headers: { Authorization: 'Bearer correct-horse' } }))
        .status,
    ).toBe(200);
  });

  it.skipIf(lan === null)('are open when no token is configured', async () => {
    const t = await start({ host: '0.0.0.0' });
    expect((await fetch(`http://${lan}:${t.port}/api/info`)).status).toBe(200);
  });
});

describe('server lifecycle', () => {
  it('stops idempotently and refuses to restart', async () => {
    const t = await start();
    await Promise.all([t.server.stop(), t.server.stop()]);
    await expect(t.server.start()).rejects.toThrow(/stopped/);
    await expect(fetch(`${t.base}/api/info`)).rejects.toThrow();
  });

  it('reports a busy port and cleans up after a failed start', async () => {
    const t = await start();
    const temp = await makeTempDir();
    const logger = new MemoryLogger();
    let obd: FakeObdService | null = null;
    const second = createHudServer({
      dataDir: temp.dir,
      port: t.port,
      host: '127.0.0.1',
      logger,
      createObdService: (config, deps) => (obd = new FakeObdService(config, deps)),
      createSensorSources: () => [],
      createFrameSinks: () => [],
      advertiseHud: () => null,
    });
    await expect(second.start()).rejects.toThrow(/Cannot listen on 127\.0\.0\.1/);
    expect((obd as FakeObdService | null)?.started ?? 0).toBe(0);
    await second.stop();
    await temp.cleanup();
  });

  it('keeps running when the trip log cannot be read, without touching it', async () => {
    // trips.jsonl is unreadable (here: a directory, EISDIR; on a car: EACCES or EIO).
    const t = await start({ directories: ['trips.jsonl/keep'] });
    expect((await call(t, 'GET', '/api/info')).status).toBe(200);
    expect((await call(t, 'GET', '/api/trips')).body).toEqual([]);
    const deleted = await call(t, 'DELETE', '/api/trips/trip-1');
    expect(deleted.status).toBe(503);
    expect(String((deleted.body as { error: string }).error)).toMatch(/could not be read/);
    expect(t.logger.text('error')).toMatch(/Trips: cannot read/);
  });

  it('keeps running with defaults when config.json cannot be read, and never overwrites it', async () => {
    const t = await start({ directories: ['config.json/keep'] });
    expect((await call(t, 'GET', '/api/info')).status).toBe(200);
    expect(t.server.engine.config.vehicle.name).toBe(DEFAULT_CONFIG.vehicle.name);
    const patched = await call(t, 'PATCH', '/api/config', { vehicle: { name: 'Golf' } });
    expect(patched.status).toBe(503);
    expect(String((patched.body as { error: string }).error)).toMatch(/could not be loaded/);
    expect(t.server.engine.config.vehicle.name).toBe(DEFAULT_CONFIG.vehicle.name);
    expect(t.logger.text('error')).toMatch(/Config: cannot read/);
  });

  it('applies config changes to a source one at a time, and stops it after the last', async () => {
    class SlowSource extends FakeSource {
      active = 0;
      maxActive = 0;
      readonly applied: string[] = [];
      stoppedDuringUpdate = false;

      override async updateConfig(config: HudConfig): Promise<void> {
        this.active += 1;
        this.maxActive = Math.max(this.maxActive, this.active);
        // Like LightSensorSource: stop the old runner, then launch a new one.
        await new Promise((r) => setTimeout(r, 30));
        this.applied.push(config.vehicle.name);
        this.active -= 1;
      }

      override async stop(): Promise<void> {
        if (this.active > 0) this.stoppedDuringUpdate = true;
        await super.stop();
      }
    }
    const source = new SlowSource('light');
    const t = await start({ createSensorSources: () => [source] });
    await Promise.all(
      ['A', 'B', 'C'].map((name) => call(t, 'PATCH', '/api/config', { vehicle: { name } })),
    );
    await waitFor(() => source.applied.at(-1) === 'C', 2000, 'last config applied');
    expect(source.maxActive).toBe(1);
    await call(t, 'PATCH', '/api/config', { vehicle: { name: 'D' } });
    await t.server.stop();
    expect(source.stoppedDuringUpdate).toBe(false);
    expect(source.stopped).toBe(1);
  });

  it('keeps the trip in progress across a shutdown and completes it on the next start', async () => {
    const t1 = await start({ config: { trip: { minDistanceKm: 0.2 } } });
    t1.obd.emit({ type: 'obd/link', state: 'connected', at: 0 });
    for (let i = 0; i < 30; i += 1) {
      t1.obd.emit({
        type: 'obd/samples',
        samples: [
          { signal: 'speed', value: 100 },
          { signal: 'rpm', value: 2500 },
        ],
        at: 0,
      });
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(t1.server.engine.state.trip.active).not.toBeNull();
    // SIGTERM from the ignition controller: the trip is still in progress.
    await t1.server.stop();
    const saved = JSON.parse(await readFile(join(t1.dataDir, 'state.json'), 'utf8')) as {
      activeTrip: { startedAt: number; lastActivityAt: number; last: { at: number } } | null;
    };
    expect(saved.activeTrip).not.toBeNull();
    await t1.stop();
    current = null;

    // Next boot, an hour later (as seen from the saved trip): it is completed and stored.
    const trip = saved.activeTrip!;
    const hour = 3_600_000;
    const earlier = {
      ...saved,
      activeTrip: {
        ...trip,
        startedAt: trip.startedAt - hour,
        lastActivityAt: trip.lastActivityAt - hour,
        distanceKm: 8.3,
        last: { ...trip.last, at: trip.last.at - hour },
      },
    };
    const t2 = await start({ files: { 'state.json': JSON.stringify(earlier) } });
    await waitFor(() => t2.server.engine.state.trip.lastCompleted !== null, 2000, 'trip completed');
    const trips = (await call(t2, 'GET', '/api/trips')).body as TripRecord[];
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ startedAt: trip.startedAt - hour, distanceKm: 8.3 });
    expect(t2.server.engine.state.trip.active).toBeNull();
  });

  it('saves the persisted state before stopping slow hardware', async () => {
    let t: TestServer | null = null;
    let seen: string | null = null;
    class SlowHardware extends FakeSource {
      override async stop(): Promise<void> {
        if (t !== null) seen = await readFile(join(t.dataDir, 'state.json'), 'utf8');
        await super.stop();
      }
    }
    t = await start({ createSensorSources: () => [new SlowHardware('gpio')] });
    t.server.engine.dispatch({ type: 'odometer/set', odometerKm: 12_345, at: 0 });
    await t.server.stop();
    expect(seen).not.toBeNull();
    expect((JSON.parse(seen ?? '{}') as PersistedState).odometerKm).toBe(12_345);
  });

  it('survives failing optional modules', async () => {
    const t = await start({
      createSensorSources: () => {
        throw new Error('i2c exploded');
      },
      createFrameSinks: () => {
        throw new Error('no backlight');
      },
      advertiseHud: () => {
        throw new Error('no multicast');
      },
    });
    expect((await call(t, 'GET', '/api/info')).status).toBe(200);
    const errors = t.logger.text();
    expect(errors).toContain('i2c exploded');
    expect(errors).toContain('no backlight');
    expect(errors).toContain('no multicast');
  });

  it('starts sources with an emit that feeds the engine and stops them on shutdown', async () => {
    const source = new FakeSource('light');
    const t = await start({ createSensorSources: () => [source] });
    source.ctx?.emit({ type: 'sensor/light', lux: 1234, at: 0 });
    expect(t.server.engine.state.env.lux).toBe(1234);
    await t.server.stop();
    expect(source.stopped).toBe(1);
    expect(t.obd.stopped).toBe(1);
  });
});
