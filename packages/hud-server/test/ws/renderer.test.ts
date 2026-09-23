import { networkInterfaces } from 'node:os';
import { DEFAULT_CONFIG } from '@carheadsup/core';
import type { HudFrame, RendererDisplayMessage } from '@carheadsup/core';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeSimulation, TestSocket, startTestServer, waitFor } from '../helpers.ts';
import type { TestServer, TestServerOptions } from '../helpers.ts';

let current: TestServer | null = null;
const sockets: TestSocket[] = [];

async function start(options: TestServerOptions = {}): Promise<TestServer> {
  current = await startTestServer(options);
  return current;
}

function connect(url: string, options?: ConstructorParameters<typeof TestSocket>[1]): TestSocket {
  const socket = new TestSocket(url, options);
  sockets.push(socket);
  return socket;
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await current?.stop();
  current = null;
});

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return null;
}

async function patch(
  t: TestServer,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<number> {
  const res = await fetch(`${t.base}/api/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  await res.arrayBuffer();
  return res.status;
}

describe('/ws/hud', () => {
  it('sends the display settings, then the latest frame, then a stream of frames', async () => {
    const t = await start();
    const socket = connect(`${t.wsBase}/ws/hud`);
    await socket.opened;
    const display = (await socket.next()) as unknown as RendererDisplayMessage;
    expect(display).toEqual({
      t: 'display',
      projection: DEFAULT_CONFIG.display.projection,
      simulated: false,
    });
    const first = await socket.next();
    expect(first['t']).toBe('frame');
    const frame = first['frame'] as HudFrame;
    expect(frame.context).toBe('parked');
    expect(frame.status.simulated).toBe(false);
    // Frames keep coming at server.frameRate (15 fps by default).
    const started = Date.now();
    for (let i = 0; i < 5; i += 1) await socket.nextOfType('frame', 1000);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('reports simulation in the display message', async () => {
    const t = await start({ sim: true, simulation: new FakeSimulation() });
    const socket = connect(`${t.wsBase}/ws/hud`);
    expect(await socket.nextOfType('display')).toMatchObject({ simulated: true });
    const frame = (await socket.nextOfType('frame'))['frame'] as HudFrame;
    expect(frame.status.simulated).toBe(true);
  });

  it('turns input messages into input events and ignores invalid ones', async () => {
    const t = await start();
    const socket = connect(`${t.wsBase}/ws/hud`);
    await socket.opened;
    socket.send('not json');
    socket.send({ t: 'input', action: 'launch-missiles' });
    socket.send({ t: 'frame' });
    socket.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    socket.send({ t: 'input', action: 'toggle-blank' });
    await waitFor(() => t.server.engine.state.ui.blanked, 2000, 'blanking');
    // Still connected, and the frames now show the blanked HUD.
    await socket.next((m) => m['t'] === 'frame' && (m['frame'] as HudFrame).blanked);
    expect(socket.ws.readyState).toBe(socket.ws.OPEN);
  });

  it('re-sends the display message when the projection changes (only then)', async () => {
    const t = await start();
    const socket = connect(`${t.wsBase}/ws/hud`);
    await socket.nextOfType('display');
    expect(await patch(t, { vehicle: { name: 'Other' } })).toBe(200);
    // Frames keep flowing, but an unrelated change sends no display message.
    const frames = socket.messages.filter((m) => m['t'] === 'frame').length;
    await waitFor(
      () => socket.messages.filter((m) => m['t'] === 'frame').length >= frames + 3,
      2000,
      'frames after the change',
    );
    expect(socket.messages.filter((m) => m['t'] === 'display')).toEqual([]);
    expect(await patch(t, { display: { projection: { mirrorX: false, scale: 0.9 } } })).toBe(200);
    const display = await socket.nextOfType('display');
    expect(display['projection']).toMatchObject({ mirrorX: false, scale: 0.9 });
  });

  it('rejects unknown paths and cross-site upgrades', async () => {
    const t = await start();
    await expect(connect(`${t.wsBase}/ws/nope`).opened).rejects.toThrow(/404/);
    await expect(connect(`${t.wsBase}/`).opened).rejects.toThrow(/404/);
    await expect(
      connect(`${t.wsBase}/ws/hud`, { headers: { Origin: 'http://evil.example' } }).opened,
    ).rejects.toThrow(/403/);
    await connect(`${t.wsBase}/ws/hud`, { headers: { Origin: t.base } }).opened;
  });

  it('closes oversized messages (64 KiB limit)', async () => {
    const t = await start();
    const socket = connect(`${t.wsBase}/ws/hud`);
    await socket.opened;
    socket.send('x'.repeat(65 * 1024));
    expect(await socket.closed).toBe(1009);
  });

  it('drops clients that stop answering pings', async () => {
    const t = await start({ tuning: { heartbeatIntervalMs: 50 } });
    const healthy = connect(`${t.wsBase}/ws/hud`);
    const dead = connect(`${t.wsBase}/ws/hud`, { autoPong: false });
    await Promise.all([healthy.opened, dead.opened]);
    expect(await dead.closed).toBe(1006);
    expect(healthy.ws.readyState).toBe(healthy.ws.OPEN);
  });

  it('closes clients on shutdown with 1001', async () => {
    const t = await start();
    const socket = connect(`${t.wsBase}/ws/hud`);
    await socket.opened;
    await t.server.stop();
    expect(await socket.closed).toBe(1001);
  });

  const lan = lanAddress();

  it.skipIf(lan === null)('requires the API token from remote clients', async () => {
    const t = await start({ host: '0.0.0.0', config: { server: { apiToken: 's3cret' } } });
    const remote = `ws://${lan}:${t.port}/ws/hud`;
    await expect(connect(remote).opened).rejects.toThrow(/401/);
    await expect(connect(`${remote}?token=wrong`).opened).rejects.toThrow(/401/);
    const byQuery = connect(`${remote}?token=s3cret`);
    await byQuery.opened;
    const byHeader = connect(remote, { headers: { Authorization: 'Bearer s3cret' } });
    await byHeader.opened;
    const local = connect(`${t.wsBase}/ws/hud`);
    await local.opened;
    // A new token disconnects remote clients holding the old one; loopback stays.
    expect(await patch(t, { server: { apiToken: 'rotated' } })).toBe(200);
    expect(await byQuery.closed).toBe(4001);
    expect(await byHeader.closed).toBe(4001);
    await local.nextOfType('frame');
    expect(local.ws.readyState).toBe(local.ws.OPEN);
  });
});
