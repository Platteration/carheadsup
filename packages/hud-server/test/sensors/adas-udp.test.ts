import { createSocket, type Socket } from 'node:dgram';
import { DEFAULT_CONFIG, type HudConfig } from '@carheadsup/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADAS_MAX_DATAGRAMS_PER_S,
  ADAS_SILENCE_MS,
  AdasUdpSource,
  adasMessageToEvents,
  defaultUdpSocketFactory,
} from '../../src/sensors/adas-udp.ts';
import { FakeClock, recordingContext } from './fakes.ts';

function adasConfig(port: number | null): HudConfig {
  const config = structuredClone(DEFAULT_CONFIG) as HudConfig;
  config.sensors = { ...config.sensors, adasUdpPort: port };
  return config;
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function client(): Socket {
  const socket = createSocket('udp4');
  cleanups.push(() => new Promise<void>((resolve) => socket.close(() => resolve())));
  return socket;
}

function send(socket: Socket, port: number, payload: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(payload, port, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
}

async function startSource(port: number | null = 0) {
  const clock = new FakeClock();
  const src = new AdasUdpSource(adasConfig(port), {
    createSocket: defaultUdpSocketFactory,
    bindAddress: '127.0.0.1',
  });
  const recorder = recordingContext(clock);
  await src.start(recorder.ctx);
  cleanups.push(() => src.stop());
  return { clock, src, ...recorder };
}

describe('adasMessageToEvents', () => {
  it('maps messages to events (heartbeats carry none)', () => {
    expect(adasMessageToEvents({ t: 'blind-spot', left: true, right: false }, 5)).toEqual([
      { type: 'adas/blind-spot', left: true, right: false, at: 5 },
    ]);
    expect(adasMessageToEvents({ t: 'collision', level: 'warning', ttcSeconds: 1.5 }, 5)).toEqual([
      { type: 'adas/collision', level: 'warning', ttcSeconds: 1.5, at: 5 },
    ]);
    expect(adasMessageToEvents({ t: 'collision', level: 'caution' }, 5)).toEqual([
      { type: 'adas/collision', level: 'caution', ttcSeconds: null, at: 5 },
    ]);
    expect(adasMessageToEvents({ t: 'heartbeat' }, 5)).toEqual([]);
  });
});

describe('AdasUdpSource', () => {
  it('stays idle without a configured port', async () => {
    const { src, clock } = await startSource(null);
    expect(src.boundPort).toBeNull();
    expect(clock.pendingTimers).toBe(0);
  });

  it('connects on the first valid datagram and emits blind-spot and collision events', async () => {
    const { src, events, logger } = await startSource();
    const port = src.boundPort!;
    expect(port).toBeGreaterThan(0);
    expect(logger.lines('info').join('\n')).toMatch(
      new RegExp(`listening on UDP 127.0.0.1:${port}`),
    );
    const socket = client();
    await send(socket, port, '{"t":"blind-spot","left":true,"right":false}\n');
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events.map((e) => e.type)).toEqual(['adas/link', 'adas/blind-spot']);
    expect(events[0]).toMatchObject({ type: 'adas/link', connected: true });
    expect(events[1]).toMatchObject({ left: true, right: false });

    // Several newline-delimited messages in one datagram, CRLF tolerated, blank lines skipped.
    await send(
      socket,
      port,
      '{"t":"collision","level":"warning","ttcSeconds":1.2}\r\n\n{"t":"heartbeat"}\n',
    );
    await vi.waitFor(() => expect(events).toHaveLength(3));
    expect(events[2]).toMatchObject({ type: 'adas/collision', level: 'warning', ttcSeconds: 1.2 });
  });

  it('disconnects after 2 s of silence and reconnects on new traffic', async () => {
    const { src, clock, events, ofType } = await startSource();
    const socket = client();
    await send(socket, src.boundPort!, '{"t":"heartbeat"}');
    await vi.waitFor(() => expect(events).toHaveLength(1));
    await clock.advance(ADAS_SILENCE_MS - 1);
    await send(socket, src.boundPort!, '{"t":"blind-spot","left":false,"right":false}');
    await vi.waitFor(() => expect(ofType('adas/blind-spot')).toHaveLength(1));
    await clock.advance(ADAS_SILENCE_MS - 1); // that message re-armed the timer
    expect(ofType('adas/link').map((e) => e.connected)).toEqual([true]);
    await clock.advance(1);
    expect(ofType('adas/link').map((e) => e.connected)).toEqual([true, false]);
    await send(socket, src.boundPort!, '{"t":"heartbeat"}');
    await vi.waitFor(() =>
      expect(ofType('adas/link').map((e) => e.connected)).toEqual([true, false, true]),
    );
  });

  it('ignores invalid, oversize and over-long datagrams, warning at most every 10 s', async () => {
    const { src, events, logger } = await startSource();
    const socket = client();
    const port = src.boundPort!;
    await send(socket, port, 'not json');
    await send(socket, port, '{"t":"collision","level":"panic"}');
    await send(socket, port, '{"t":"unknown"}');
    await send(socket, port, Buffer.alloc(5000, 0x20));
    await send(socket, port, `{"t":"heartbeat","pad":"${'x'.repeat(1100)}"}`); // over the 1 KiB line limit
    await send(socket, port, '{"t":"blind-spot","left":false,"right":true}');
    await vi.waitFor(() =>
      expect(events.map((e) => e.type)).toEqual(['adas/link', 'adas/blind-spot']),
    );
    expect(logger.lines('warn')).toHaveLength(1);
    expect(logger.lines('warn')[0]).toMatch(/invalid message from 127\.0\.0\.1: invalid JSON/);

    // Only the first 8 messages of a datagram are used.
    const many = Array.from(
      { length: 12 },
      () => '{"t":"blind-spot","left":true,"right":true}',
    ).join('\n');
    await send(socket, port, many);
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'adas/blind-spot')).toHaveLength(9),
    );
  });

  it('rate-limits datagrams', async () => {
    const { src, clock, events } = await startSource();
    const socket = client();
    const port = src.boundPort!;
    for (let i = 0; i < ADAS_MAX_DATAGRAMS_PER_S + 30; i++) {
      await send(socket, port, '{"t":"collision","level":"caution"}');
    }
    // The fake clock does not move, so the bucket never refills.
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'adas/collision')).toHaveLength(
        ADAS_MAX_DATAGRAMS_PER_S,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events.filter((e) => e.type === 'adas/collision')).toHaveLength(
      ADAS_MAX_DATAGRAMS_PER_S,
    );
    await clock.advance(1000);
    await send(socket, port, '{"t":"collision","level":"none"}');
    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({ type: 'adas/collision', level: 'none' }),
    );
  });

  it('rebinds only when the port changes', async () => {
    const { src, ofType } = await startSource();
    const socket = client();
    const first = src.boundPort!;
    await send(socket, first, '{"t":"heartbeat"}');
    await vi.waitFor(() => expect(ofType('adas/link')).toHaveLength(1));

    const probe = createSocket('udp4');
    await new Promise<void>((resolve) => probe.bind(0, '127.0.0.1', () => resolve()));
    const second = probe.address().port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    await src.updateConfig(adasConfig(0)); // 0 → 0: unchanged
    expect(src.boundPort).toBe(first);
    await src.updateConfig(adasConfig(second));
    expect(src.boundPort).toBe(second);
    // Moving ports ends the old link.
    expect(ofType('adas/link').map((e) => e.connected)).toEqual([true, false]);
    await send(socket, second, '{"t":"heartbeat"}');
    await vi.waitFor(() =>
      expect(ofType('adas/link').map((e) => e.connected)).toEqual([true, false, true]),
    );
    await src.updateConfig(adasConfig(null));
    expect(src.boundPort).toBeNull();
  });

  it('logs a busy port once and retries until it is free', async () => {
    const blocker = createSocket('udp4');
    await new Promise<void>((resolve) => blocker.bind(0, '127.0.0.1', () => resolve()));
    const port = blocker.address().port;
    const { src, clock, logger } = await startSource(port);
    expect(src.boundPort).toBeNull();
    expect(logger.lines('warn')).toEqual([
      expect.stringMatching(/cannot listen on UDP 127\.0\.0\.1:\d+ \(EADDRINUSE\)/),
    ]);
    await clock.advance(10_000);
    // The retry fails asynchronously and schedules the next attempt.
    await vi.waitFor(() => expect(clock.pendingTimers).toBe(1));
    expect(logger.lines('warn')).toHaveLength(1);
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await clock.advance(10_000);
    await vi.waitFor(() => expect(src.boundPort).toBe(port));
    await src.stop();
    expect(clock.pendingTimers).toBe(0);
  });

  it('stops listening on stop()', async () => {
    const { src, events, clock } = await startSource();
    const port = src.boundPort!;
    await src.stop();
    expect(src.boundPort).toBeNull();
    const socket = client();
    await send(socket, port, '{"t":"heartbeat"}');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(events).toEqual([]);
    expect(clock.pendingTimers).toBe(0);
  });
});
