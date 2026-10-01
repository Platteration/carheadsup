import { EMPTY_PERSISTED_STATE, createInitialState } from '@carheadsup/core';
import type { HudState } from '@carheadsup/core';
import { SIM_TPMS_PIDS, SILENT_LOGGER, SYSTEM_TIMERS } from '@carheadsup/obd';
import type { ClearDtcsOutcome } from '@carheadsup/obd';
import { describe, expect, it } from 'vitest';
import { parseSimControl } from '../src/http/sim-control.ts';
import { Router } from '../src/http/router.ts';
import { HttpError, isJsonContentType } from '../src/http/respond.ts';
import { ObdLink, clearDtcsRefusal } from '../src/obd/obd-link.ts';
import { effectiveConfig, withSimTpmsPids } from '../src/runtime-config.ts';
import { TokenBucket } from '../src/ws/rate-limit.ts';
import { FakeObdService, testConfig } from './helpers.ts';

describe('TokenBucket', () => {
  it('allows a burst, then refills at the configured rate', () => {
    let now = 1000;
    const bucket = new TokenBucket(10, 3, () => now);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    now += 100; // one token at 10/s
    expect([bucket.take(), bucket.take()]).toEqual([true, false]);
    now += 10_000; // never more than the burst
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('neither refills nor stalls when the clock steps backwards', () => {
    let now = 1_000_000;
    const bucket = new TokenBucket(10, 1, () => now);
    expect(bucket.take()).toBe(true);
    now = 0;
    expect(bucket.take()).toBe(false);
    now = 100;
    expect(bucket.take()).toBe(true);
  });
});

describe('Router', () => {
  const router = new Router()
    .add('GET', '/api/trips', () => ({ json: 'list' }))
    .add('DELETE', '/api/trips/:id', () => ({ json: 'delete' }))
    .add('POST', '/api/maintenance/:itemId/done', () => ({ json: 'done' }));

  it('matches exact segments and decodes parameters', () => {
    const match = router.match('DELETE', '/api/trips/a%20b%2Fc');
    expect(match).toMatchObject({ kind: 'found', params: { id: 'a b/c' } });
    expect(router.match('POST', '/api/maintenance/oil/done')).toMatchObject({
      kind: 'found',
      params: { itemId: 'oil' },
    });
    expect(router.match('HEAD', '/api/trips').kind).toBe('found');
  });

  it('distinguishes unknown paths from unsupported methods', () => {
    expect(router.match('GET', '/api/trips/x/y')).toEqual({ kind: 'not-found' });
    expect(router.match('GET', '/api/trips/')).toEqual({ kind: 'not-found' });
    expect(router.match('DELETE', '/api/trips//')).toEqual({ kind: 'not-found' });
    expect(router.match('PUT', '/api/trips')).toEqual({
      kind: 'method-not-allowed',
      allow: ['GET', 'HEAD'],
    });
  });

  it('rejects malformed percent-encoding with a 400', () => {
    expect(() => router.match('DELETE', '/api/trips/%E0%A4%A')).toThrow(HttpError);
  });

  it('recognises JSON media types', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('Application/JSON; charset=utf-8')).toBe(true);
    expect(isJsonContentType('application/merge-patch+json')).toBe(true);
    expect(isJsonContentType('text/plain')).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
  });
});

describe('parseSimControl', () => {
  it('keeps valid fields and drops unknown ones', () => {
    expect(
      parseSimControl({
        mode: 'manual',
        throttle: 0.5,
        brake: 0,
        engineRunning: true,
        gear: null,
        dtcs: [' p0420 ', 'U0100'],
        coolantOverrideC: null,
        voltageOverrideV: 11.6,
        fuelLevelOverridePct: 8,
        lux: 50,
        ambientTempC: -5,
        phone: { kind: 'message', sender: 'Alex' },
        adas: { blindSpotLeft: true, collision: 'warning' },
        tirePressuresKpa: { fl: 230, fr: 230, rl: 150, rr: 230 },
        extra: 1,
      }),
    ).toEqual({
      ok: true,
      value: {
        mode: 'manual',
        throttle: 0.5,
        brake: 0,
        engineRunning: true,
        gear: null,
        dtcs: ['P0420', 'U0100'],
        coolantOverrideC: null,
        voltageOverrideV: 11.6,
        fuelLevelOverridePct: 8,
        lux: 50,
        ambientTempC: -5,
        phone: { kind: 'message', sender: 'Alex' },
        adas: { blindSpotLeft: true, collision: 'warning' },
        tirePressuresKpa: { fl: 230, fr: 230, rl: 150, rr: 230 },
      },
    });
    expect(parseSimControl({})).toEqual({ ok: true, value: {} });
    expect(
      parseSimControl({ tirePressuresKpa: null, phone: { kind: 'nav-start', name: 'x' } }),
    ).toEqual({
      ok: true,
      value: { tirePressuresKpa: null, phone: { kind: 'nav-start' } },
    });
    expect(parseSimControl({ phone: { kind: 'traffic-jam' } })).toEqual({
      ok: true,
      value: { phone: { kind: 'traffic-jam' } },
    });
  });

  it.each([
    [[], 'expected a JSON object'],
    [{ mode: 'auto' }, 'mode'],
    [{ throttle: Number.NaN }, 'throttle'],
    [{ brake: -0.1 }, 'brake'],
    [{ engineRunning: 'yes' }, 'engineRunning'],
    [{ gear: 11 }, 'gear'],
    [{ dtcs: 'P0420' }, 'dtcs'],
    [{ dtcs: Array.from({ length: 40 }, () => 'P0420') }, 'dtcs'],
    [{ lux: -1 }, 'lux'],
    [{ phone: { kind: 'incoming-call', name: 'a\nb' } }, 'phone.name'],
    [{ phone: 'ring' }, 'phone'],
    [{ adas: { collision: 'boom' } }, 'adas.collision'],
    [{ tirePressuresKpa: { fl: 1, fr: 1, rl: 1 } }, 'tirePressuresKpa.rr'],
  ])('rejects %j', (input, field) => {
    const result = parseSimControl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(field);
  });
});

describe('runtime overrides', () => {
  it('puts OBD on the simulator with TPMS PIDs in sim mode, without mutating the stored config', () => {
    const stored = testConfig({
      obd: {
        customPids: [
          {
            signal: 'oilTemp',
            mode: '22',
            pid: '1310',
            header: '7E0',
            formula: 'A-40',
            intervalMs: 5000,
          },
          {
            signal: 'tirePressureFL',
            mode: '22',
            pid: 'AAAA',
            header: null,
            formula: 'A',
            intervalMs: 5000,
          },
        ],
      },
    });
    const snapshot = JSON.stringify(stored);
    const effective = effectiveConfig(stored, { sim: true, port: 0, host: '127.0.0.1' });
    expect(JSON.stringify(stored)).toBe(snapshot);
    expect(effective.obd.transport).toBe('simulator');
    expect(effective.vehicle.hasTpms).toBe(true);
    expect(effective.server).toMatchObject({ port: 0, host: '127.0.0.1' });
    expect(effective.obd.customPids.map((p) => p.signal)).toEqual([
      'oilTemp',
      ...SIM_TPMS_PIDS.map((p) => p.signal),
    ]);
  });

  it('records the OBD traffic with --record, without saving it', () => {
    const stored = testConfig();
    const effective = effectiveConfig(stored, { sim: false, record: true });
    expect(effective.obd.recordTranscript).toBe(true);
    expect(stored.obd.recordTranscript).toBe(false);
    expect(effectiveConfig(stored, { sim: false, record: false }).obd.recordTranscript).toBe(false);
  });

  it('changes nothing without overrides', () => {
    const stored = testConfig();
    expect(effectiveConfig(stored, { sim: false })).toEqual(stored);
    expect(withSimTpmsPids([])).toEqual(SIM_TPMS_PIDS.map((p) => ({ ...p })));
  });
});

describe('clearing trouble codes', () => {
  function state(
    signals: HudState['vehicle']['signals'],
    context: HudState['context']['context'],
  ): HudState {
    const base = createInitialState(testConfig(), EMPTY_PERSISTED_STATE, 10_000);
    return {
      ...base,
      vehicle: { ...base.vehicle, signals },
      context: { ...base.context, context },
    };
  }

  it('is allowed only when parked with the engine off', () => {
    expect(clearDtcsRefusal(state({}, 'parked'))).toBeNull();
    expect(clearDtcsRefusal(state({ rpm: { value: 100, at: 10_000 } }, 'parked'))).toBeNull();
    expect(clearDtcsRefusal(state({ rpm: { value: 800, at: 10_000 } }, 'parked'))).toMatch(
      /engine off/,
    );
    // A stale rpm reading does not count as running.
    expect(clearDtcsRefusal(state({ rpm: { value: 800, at: 1_000 } }, 'parked'))).toBeNull();
    for (const context of ['stopped', 'city', 'highway'] as const) {
      expect(clearDtcsRefusal(state({}, context))).toMatch(/parked/);
    }
  });

  it('runs one clear at a time', async () => {
    let service: FakeObdService | null = null;
    let release: (outcome: ClearDtcsOutcome) => void = () => {};
    const link = new ObdLink({
      config: testConfig(),
      simulator: null,
      deps: { now: Date.now, timers: SYSTEM_TIMERS, logger: SILENT_LOGGER },
      onEvent: () => {},
      factory: (config, deps) => {
        service = new FakeObdService(config, deps);
        service.clearDtcs = () => new Promise((resolve) => (release = resolve));
        return service;
      },
    });
    const first = link.clearDtcs();
    expect(await link.clearDtcs()).toEqual({
      ok: false,
      message: 'Clearing trouble codes is already in progress.',
    });
    release({ ok: true, message: 'done' });
    expect(await first).toEqual({ ok: true, message: 'done' });
    // Free again afterwards.
    const again = link.clearDtcs();
    release({ ok: true, message: 'again' });
    expect(await again).toEqual({ ok: true, message: 'again' });
    expect(service).not.toBeNull();
  });

  it('forwards service events and unsubscribes on stop', async () => {
    const events: string[] = [];
    let service: FakeObdService | null = null;
    const link = new ObdLink({
      config: testConfig(),
      simulator: null,
      deps: { now: Date.now, timers: SYSTEM_TIMERS, logger: SILENT_LOGGER },
      onEvent: (event) => events.push(event.type),
      factory: (config, deps) => (service = new FakeObdService(config, deps)),
    });
    const fake = service as unknown as FakeObdService;
    link.start();
    fake.emit({ type: 'obd/vin', vin: 'X', at: 0 });
    link.updateConfig(testConfig({ obd: { timeoutMs: 700 } }));
    await link.stop();
    fake.emit({ type: 'obd/vin', vin: 'Y', at: 0 });
    expect(events).toEqual(['obd/vin']);
    expect(fake.configs.map((c) => c.timeoutMs)).toEqual([700]);
    expect([fake.started, fake.stopped]).toEqual([1, 1]);
  });
});
