import assert from 'node:assert/strict';
import { test } from 'node:test';
import { androidSettingsTransport } from '../../src/common/android-settings.ts';

test('native settings requests carry JSON, methods and bearer token; replies preserve HTTP errors', async () => {
  let token = 'initial-token';
  let request: unknown[] = [];
  const host = {
    CarheadsupSettings: {
      getToken: () => token,
      setToken: (next: string) => { token = next; },
      request: (...args: unknown[]) => { request = args; },
      cancel: () => {},
    },
    __carheadsupSettingsReply: undefined as ((id: number, raw: string) => void) | undefined,
  };
  const transport = androidSettingsTransport(host as typeof globalThis & typeof host)!;
  assert.equal(transport.tokens.get(), 'initial-token');
  transport.tokens.set(' rotated-token ');
  assert.equal(token, 'rotated-token');
  const response = transport.fetch('/api/config', {
    method: 'PATCH', headers: { Authorization: 'Bearer rotated-token' }, body: '{"units":{"clock":"12h"}}',
  });
  assert.deepEqual(request.slice(1), ['/api/config', 'PATCH', '{"units":{"clock":"12h"}}', 'rotated-token']);
  host.__carheadsupSettingsReply!(request[0] as number, JSON.stringify({ status: 422, text: '{"errors":["invalid"]}', type: 'application/json' }));
  const result = await response;
  assert.equal(result.status, 422);
  assert.equal(result.ok, false);
  assert.deepEqual(await result.json(), { errors: ['invalid'] });
});

test('abort cancels the native call and ignores a late response', async () => {
  let cancelled: number | null = null;
  let id = 0;
  const host = {
    CarheadsupSettings: {
      getToken: () => '', setToken: () => {},
      request: (next: number) => { id = next; },
      cancel: (next: number) => { cancelled = next; },
    },
    __carheadsupSettingsReply: undefined as ((id: number, raw: string) => void) | undefined,
  };
  const transport = androidSettingsTransport(host as typeof globalThis & typeof host)!;
  const controller = new AbortController();
  const result = transport.fetch('/api/info', { signal: controller.signal });
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(cancelled, id);
  host.__carheadsupSettingsReply!(id, JSON.stringify({ status: 200, text: '{}', type: 'application/json' }));
});

test('ordinary browsers retain normal fetch and token storage', () => {
  assert.equal(androidSettingsTransport({} as typeof globalThis), null);
});
