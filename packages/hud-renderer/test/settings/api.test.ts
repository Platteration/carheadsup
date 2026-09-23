import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  API_TOKEN_STORAGE_KEY,
  HudApiError,
  createHudApi,
  describeError,
  isAbortError,
  localStorageTokenStore,
  memoryTokenStore,
} from '../../src/common/api.ts';
import { MockHud } from './mock-hud.ts';

interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch that records calls and answers with `respond`. */
function stubFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function failure(promise: Promise<unknown>): Promise<HudApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HudApiError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('requests', () => {
  it('calls every endpoint with the right method, path and body', async () => {
    const hud = new MockHud({ simulated: true });
    const api = createHudApi({ fetch: hud.fetch, tokens: memoryTokenStore() });
    await api.getInfo();
    await api.getConfig();
    await api.patchConfig({ units: { clock: '12h' } });
    await api.putConfig(hud.config);
    await api.getDiagnostics();
    await api.clearDtcs();
    await api.getTrips({ limit: 2, before: 1234.9 });
    await api.getTrips();
    await api.getTripsCsv();
    await api.deleteTrip('trip 1/2');
    await api.getMaintenance();
    await api.markMaintenanceDone('oil', 58_000);
    await api.markMaintenanceDone('brake-fluid');
    await api.setOdometer(58_100);
    await api.sendInput('next-page');
    await api.getSim();
    await api.controlSim({ throttle: 0.5 });
    expect(hud.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /api/info',
      'GET /api/config',
      'PATCH /api/config',
      'PUT /api/config',
      'GET /api/diagnostics',
      'POST /api/diagnostics/clear-dtcs',
      'GET /api/trips?limit=2&before=1234',
      'GET /api/trips',
      'GET /api/trips.csv',
      'DELETE /api/trips/trip%201%2F2',
      'GET /api/maintenance',
      'POST /api/maintenance/oil/done',
      'POST /api/maintenance/brake-fluid/done',
      'POST /api/odometer',
      'POST /api/input',
      'GET /api/sim',
      'POST /api/sim',
    ]);
    const bodies = hud.requests.map((r) => r.body);
    expect(bodies[2]).toEqual({ units: { clock: '12h' } });
    expect(bodies[11]).toEqual({ odometerKm: 58_000 });
    expect(bodies[12]).toEqual({});
    expect(bodies[13]).toEqual({ odometerKm: 58_100 });
    expect(bodies[14]).toEqual({ action: 'next-page' });
    expect(bodies[16]).toEqual({ throttle: 0.5 });
  });

  it('returns parsed, typed results', async () => {
    const hud = new MockHud();
    const api = createHudApi({ fetch: hud.fetch, tokens: memoryTokenStore() });
    expect((await api.getInfo()).name).toBe('carheadsup');
    const result = await api.patchConfig({ display: { brightness: { minLevel: 2 } } });
    expect(result.errors).toEqual(['display.brightness.minLevel: expected number <= 1']);
    expect(result.config.display.brightness.minLevel).toBe(hud.config.display.brightness.minLevel);
    expect((await api.getTripsCsv()).startsWith('id,startedAt')).toBe(true);
    expect(await api.getSim()).toBeNull();
  });

  it('uses the base URL and sends JSON headers', async () => {
    const { fetch, calls } = stubFetch(() => json(200, { ok: true }));
    const api = createHudApi({
      fetch,
      baseUrl: 'http://192.168.4.1:8080/',
      tokens: memoryTokenStore(),
    });
    await api.sendInput('primary');
    expect(calls[0]?.url).toBe('http://192.168.4.1:8080/api/input');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Accept).toBe('application/json');
    expect(headers.Authorization).toBeUndefined();
    expect(calls[0]?.init.method).toBe('POST');
  });
});

describe('bearer token', () => {
  it('is sent on every request once set, and not before', async () => {
    const hud = new MockHud({ token: 's3cret' });
    const tokens = memoryTokenStore();
    const api = createHudApi({ fetch: hud.fetch, tokens });
    const refused = await failure(api.getInfo());
    expect(refused.kind).toBe('unauthorized');
    expect(refused.status).toBe(401);
    expect(refused.message).toBe('Missing or invalid API token');
    tokens.set('  s3cret ');
    await api.getInfo();
    await api.getTripsCsv();
    await api.sendInput('primary');
    expect(hud.requests.slice(1).map((r) => r.authorization)).toEqual([
      'Bearer s3cret',
      'Bearer s3cret',
      'Bearer s3cret',
    ]);
  });

  it('is kept in localStorage, and in memory when storage fails', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const tokens = localStorageTokenStore(storage);
    expect(tokens.get()).toBe('');
    tokens.set('abc');
    expect(store.get(API_TOKEN_STORAGE_KEY)).toBe('abc');
    expect(localStorageTokenStore(storage).get()).toBe('abc');
    tokens.set('');
    expect(store.has(API_TOKEN_STORAGE_KEY)).toBe(false);

    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const fallback = localStorageTokenStore(broken);
    expect(fallback.get()).toBe('');
    fallback.set('xyz');
    expect(fallback.get()).toBe('xyz');
    expect(localStorageTokenStore(null).get()).toBe('');
  });
});

describe('errors', () => {
  it('turns a rejected fetch into a network error', async () => {
    const hud = new MockHud();
    hud.offline = true;
    const api = createHudApi({ fetch: hud.fetch, tokens: memoryTokenStore() });
    const error = await failure(api.getConfig());
    expect(error).toBeInstanceOf(HudApiError);
    expect(error.kind).toBe('network');
    expect(error.status).toBeNull();
    expect(error.method).toBe('GET');
    expect(error.path).toBe('/api/config');
    expect(describeError(error)).toMatch(/Can’t reach the HUD/);
  });

  it('times out', async () => {
    vi.useFakeTimers();
    const { fetch } = stubFetch(
      (call) =>
        new Promise<Response>((_, reject) => {
          call.init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const api = createHudApi({ fetch, timeoutMs: 500, tokens: memoryTokenStore() });
    const pending = failure(api.getInfo());
    await vi.advanceTimersByTimeAsync(501);
    const error = await pending;
    expect(error.kind).toBe('timeout');
    expect(describeError(error)).toBe('The HUD did not answer in time.');
  });

  it('reports caller cancellation as aborted', async () => {
    const { fetch } = stubFetch(
      (call) =>
        new Promise<Response>((_, reject) => {
          call.init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const api = createHudApi({ fetch, tokens: memoryTokenStore() });
    const controller = new AbortController();
    const pending = failure(api.getDiagnostics({ signal: controller.signal }));
    controller.abort();
    const error = await pending;
    expect(error.kind).toBe('aborted');
    expect(isAbortError(error)).toBe(true);

    const already = new AbortController();
    already.abort();
    expect((await failure(api.getInfo({ signal: already.signal }))).kind).toBe('aborted');
  });

  it('maps HTTP statuses and uses the server’s message', async () => {
    const responses: Record<string, Response> = {
      '/api/info': json(403, { error: 'Forbidden' }),
      '/api/config': json(500, { error: 'Disk full' }),
      '/api/diagnostics': new Response('', { status: 502 }),
      '/api/maintenance': new Response('Bad gateway page', { status: 502 }),
    };
    const { fetch } = stubFetch(
      (call) => responses[new URL(call.url, 'http://x').pathname] ?? json(404, {}),
    );
    const api = createHudApi({ fetch, tokens: memoryTokenStore() });
    expect((await failure(api.getInfo())).kind).toBe('unauthorized');
    const disk = await failure(api.getConfig());
    expect(disk).toMatchObject({
      kind: 'http',
      status: 500,
      message: 'Disk full',
      body: { error: 'Disk full' },
    });
    expect(describeError(disk)).toBe('Disk full');
    expect((await failure(api.getDiagnostics())).message).toBe(
      'The HUD answered HTTP 502 with no details',
    );
    expect((await failure(api.getMaintenance())).message).toBe('The HUD answered HTTP 502');
    const missing = await failure(api.getTrips());
    expect(missing.kind).toBe('not-found');
    expect(missing.message).toBe('/api/trips is not available on this HUD');
  });

  it('rejects 2xx bodies that are not what the endpoint returns', async () => {
    const { fetch } = stubFetch((call) =>
      call.url.endsWith('/api/info')
        ? new Response('<!doctype html><title>Captive portal</title>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          })
        : json(200, { name: 'something-else' }),
    );
    const api = createHudApi({ fetch, tokens: memoryTokenStore() });
    const html = await failure(api.getInfo());
    expect(html.kind).toBe('invalid-response');
    expect(html.message).toBe('GET /api/info did not return JSON');
    expect((await failure(api.getConfig())).message).toBe(
      'GET /api/config returned an unexpected shape',
    );
    expect(describeError(html)).toMatch(/unexpected response/);
  });

  it('returns a refused clear-codes result instead of throwing', async () => {
    const hud = new MockHud({ refuseClear: true });
    const api = createHudApi({ fetch: hud.fetch, tokens: memoryTokenStore() });
    expect(await api.clearDtcs()).toEqual({
      ok: false,
      message: 'Park and switch the engine off before clearing codes.',
    });
  });

  it('accepts a config result sent with an error status', async () => {
    const hud = new MockHud();
    const { fetch } = stubFetch(() =>
      json(422, { config: hud.config, errors: ['units.currency: bad'] }),
    );
    const api = createHudApi({ fetch, tokens: memoryTokenStore() });
    expect((await api.patchConfig({})).errors).toEqual(['units.currency: bad']);
  });

  it('treats a simulator 404 as "not simulating" for status but as an error for control', async () => {
    const hud = new MockHud();
    const api = createHudApi({ fetch: hud.fetch, tokens: memoryTokenStore() });
    expect(await api.getSim()).toBeNull();
    expect((await failure(api.controlSim({ engineRunning: false }))).kind).toBe('not-found');
  });

  it('describes non-client errors too', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('weird')).toBe('Something went wrong');
  });
});
