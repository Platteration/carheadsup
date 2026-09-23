import { request } from 'node:http';
import { hostname } from 'node:os';
import { PROTOCOL_VERSION } from '@carheadsup/core';
import { afterEach, describe, expect, it } from 'vitest';
import { TestSocket, startTestServer } from '../helpers.ts';
import type { TestServer } from '../helpers.ts';

/** DNS rebinding: a page on http://evil.example:<port> whose name now resolves to the HUD. */

let current: TestServer | null = null;
const sockets: TestSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await current?.stop();
  current = null;
});

interface Reply {
  status: number;
  body: string;
}

/** An HTTP request with full control over Host and Origin (fetch does not allow Host). */
function send(
  t: TestServer,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: t.port, method, path, headers, setHost: false },
      (res) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const rebound = (t: TestServer): Record<string, string> => ({
  host: `evil.example:${t.port}`,
  origin: `http://evil.example:${t.port}`,
});

describe('Host validation (DNS rebinding)', () => {
  it('refuses API reads and writes addressed to a foreign host name', async () => {
    const t = (current = await startTestServer({ config: { vehicle: { name: 'Golf' } } }));
    const patch = await send(
      t,
      'PATCH',
      '/api/config',
      { ...rebound(t), 'content-type': 'application/json' },
      JSON.stringify({ vehicle: { name: 'Owned' } }),
    );
    expect(patch.status).toBe(403);
    expect((await send(t, 'GET', '/api/config', rebound(t))).status).toBe(403);
    expect((await send(t, 'GET', '/settings', rebound(t))).status).toBe(403);
    expect(t.server.engine.config.vehicle.name).toBe('Golf');
  });

  it('refuses WebSocket upgrades addressed to a foreign host name', async () => {
    const t = (current = await startTestServer());
    for (const path of ['/ws/phone', '/ws/hud']) {
      const socket = new TestSocket(`${t.wsBase}${path}`, { headers: rebound(t) });
      sockets.push(socket);
      await expect(socket.opened).rejects.toThrow(/403/);
    }
    expect(t.server.engine.state.phone.connected).toBe(false);
  });

  it('answers to IP addresses, localhost and this machine’s names', async () => {
    const t = (current = await startTestServer());
    const name = hostname().toLowerCase();
    for (const host of [
      `127.0.0.1:${t.port}`,
      '127.0.0.1',
      `10.42.0.1:${t.port}`,
      `[::1]:${t.port}`,
      `[fe80::1]:${t.port}`,
      `localhost:${t.port}`,
      `LOCALHOST.:${t.port}`,
      `hud.localhost:${t.port}`,
      `${name}:${t.port}`,
      `${name}.local:${t.port}`,
    ]) {
      const reply = await send(t, 'GET', '/api/info', { host });
      expect({ host, status: reply.status }).toEqual({ host, status: 200 });
    }
    // Upgrades with a matching Origin still work.
    const phone = new TestSocket(`${t.wsBase}/ws/phone`, {
      headers: { host: `localhost:${t.port}`, origin: `http://localhost:${t.port}` },
    });
    sockets.push(phone);
    await phone.opened;
    phone.send({
      t: 'hello',
      v: PROTOCOL_VERSION,
      device: 'Pixel',
      app: 'carheadsup',
      appVersion: '1',
      token: '',
    });
    expect(await phone.nextOfType('welcome')).toMatchObject({ t: 'welcome' });
  });

  it('answers to extra names it was told about', async () => {
    const t = (current = await startTestServer({ allowedHosts: ['Car-HUD.fritz.box'] }));
    expect(
      (await send(t, 'GET', '/api/info', { host: `car-hud.fritz.box:${t.port}` })).status,
    ).toBe(200);
    expect((await send(t, 'GET', '/api/info', { host: `other.fritz.box:${t.port}` })).status).toBe(
      403,
    );
  });

  it('refuses malformed Host headers', async () => {
    const t = (current = await startTestServer());
    for (const host of ['evil.example:80:80', '[::1', 'fe80::1', '[evil.example]:80']) {
      expect({ host, status: (await send(t, 'GET', '/api/info', { host })).status }).toEqual({
        host,
        status: 403,
      });
    }
  });
});
