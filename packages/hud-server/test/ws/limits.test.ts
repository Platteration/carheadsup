import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { connect } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { HudFrame } from '@carheadsup/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { limitConnections } from '../../src/http/connections.ts';
import {
  MAX_REMOTE_RENDERER_CLIENTS,
  MAX_RENDERER_CLIENTS_PER_ADDRESS,
  RendererChannel,
} from '../../src/ws/renderer-channel.ts';
import { FakeClock, memoryLogger } from '../sensors/fakes.ts';
import { TestSocket, startTestServer, testConfig } from '../helpers.ts';
import type { TestServer } from '../helpers.ts';

class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  closeCode: number | null = null;

  send(): void {}

  close(code: number): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.closeCode = code;
    this.emit('close', code, Buffer.from(''));
  }

  terminate(): void {
    this.close(1006);
  }
}

function renderer(): {
  channel: RendererChannel;
  open: (address: string) => FakeSocket;
} {
  const clock = new FakeClock();
  const config = testConfig();
  const channel = new RendererChannel({
    engine: {
      frame: {} as HudFrame,
      onFrame: () => () => {},
      dispatch: () => {},
    },
    getConfig: () => config,
    simulated: false,
    authorize: () => true,
    now: clock.now,
    timers: clock,
    logger: memoryLogger(),
  });
  const open = (address: string): FakeSocket => {
    const socket = new FakeSocket();
    channel.accept(socket as unknown as WebSocket, { remoteAddress: address, token: null });
    return socket;
  };
  return { channel, open };
}

describe('RendererChannel client limits', () => {
  it('limits display clients per remote address', () => {
    const { channel, open } = renderer();
    const sockets = Array.from({ length: MAX_RENDERER_CLIENTS_PER_ADDRESS + 1 }, () =>
      open('10.42.0.23'),
    );
    expect(sockets.map((s) => s.closeCode)).toEqual([
      ...Array<null>(MAX_RENDERER_CLIENTS_PER_ADDRESS).fill(null),
      1013,
    ]);
    expect(channel.canAccept('10.42.0.23')).toBe(false);
    expect(channel.canAccept('10.42.0.24')).toBe(true);
    // A client that leaves frees its slot.
    sockets[0]!.close(1000);
    expect(channel.canAccept('10.42.0.23')).toBe(true);
  });

  it('limits remote display clients in total, but never the HUD’s own display', () => {
    const { channel, open } = renderer();
    for (let i = 0; i < MAX_REMOTE_RENDERER_CLIENTS; i += 1) open(`10.42.0.${100 + i}`);
    expect(open('10.42.0.99').closeCode).toBe(1013);
    for (let i = 0; i < 20; i += 1) expect(open('127.0.0.1').closeCode).toBeNull();
    expect(channel.clientCount).toBe(MAX_REMOTE_RENDERER_CLIENTS + 20);
  });
});

describe('limitConnections', () => {
  let server: Server | null = null;
  const clients: Socket[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.destroy();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });

  async function listen(limits: Parameters<typeof limitConnections>[1]): Promise<number> {
    server = createServer((_req, res) => res.end('ok'));
    limitConnections(server, limits);
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  /** Open a raw TCP connection; resolves with whether the server closed it right away. */
  async function openIdle(port: number): Promise<boolean> {
    const socket = connect(port, '127.0.0.1');
    clients.push(socket);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 200);
      socket.once('close', () => {
        clearTimeout(timer);
        resolve(true);
      });
      socket.on('error', () => {});
    });
  }

  it('closes connections beyond the per-address and total limits', async () => {
    const refused: string[] = [];
    const port = await listen({
      maxPerAddress: 2,
      maxRemote: 10,
      exempt: () => false, // treat the test's loopback connections as remote
      onRefused: (address) => refused.push(address),
    });
    expect(await openIdle(port)).toBe(false);
    expect(await openIdle(port)).toBe(false);
    expect(await openIdle(port)).toBe(true);
    expect(refused).toHaveLength(1);
    // A closed connection frees its slot.
    clients[0]!.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(await openIdle(port)).toBe(false);
  });

  it('never limits exempt (loopback) clients', async () => {
    const port = await listen({ maxPerAddress: 1, maxRemote: 1 });
    for (let i = 0; i < 5; i += 1) expect(await openIdle(port)).toBe(false);
  });

  it('gives clients 10 s to send their request', async () => {
    await listen({});
    expect(server?.headersTimeout).toBe(10_000);
  });
});

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return null;
}
const lan = lanAddress();

describe('/ws/hud from other devices', () => {
  let current: TestServer | null = null;
  const sockets: TestSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await current?.stop();
    current = null;
  });

  it.skipIf(lan === null)('refuses display upgrades beyond the per-device limit', async () => {
    const t = (current = await startTestServer({ host: '0.0.0.0' }));
    for (let i = 0; i < MAX_RENDERER_CLIENTS_PER_ADDRESS; i += 1) {
      const socket = new TestSocket(`ws://${lan}:${t.port}/ws/hud`);
      sockets.push(socket);
      await socket.opened;
    }
    const extra = new TestSocket(`ws://${lan}:${t.port}/ws/hud`);
    sockets.push(extra);
    await expect(extra.opened).rejects.toThrow(/503/);
    // The HUD's own display still connects.
    const local = new TestSocket(`${t.wsBase}/ws/hud`);
    sockets.push(local);
    await local.opened;
  });
});
