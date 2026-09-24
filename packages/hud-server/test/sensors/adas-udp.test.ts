import { createSocket, type RemoteInfo, type Socket, type SocketType } from 'node:dgram';
import { DEFAULT_CONFIG, type HudConfig } from '@carheadsup/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADAS_MAX_DATAGRAMS_PER_S,
  ADAS_MAX_TRACKED_SENDERS,
  ADAS_SILENCE_MS,
  AdasUdpSource,
  adasMessageToEvents,
  defaultUdpSocketFactory,
  type UdpSocketFactory,
  type UdpSocketLike,
} from '../../src/sensors/adas-udp.ts';
import { FakeClock, recordingContext } from './fakes.ts';

/** By default only the test's own loopback client may send, as a configured HUD would have it. */
function adasConfig(port: number | null, senders: string[] = ['127.0.0.1']): HudConfig {
  const config = structuredClone(DEFAULT_CONFIG) as HudConfig;
  config.sensors = { ...config.sensors, adasUdpPort: port, adasAllowedSenders: senders };
  return config;
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Whether a UDP socket can bind `address` here (loopback aliases and IPv6 vary by host). */
function canBind(type: SocketType, address: string): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: Socket;
    try {
      socket = createSocket(type);
    } catch {
      resolve(false);
      return;
    }
    socket.once('error', () => {
      socket.close();
      resolve(false);
    });
    socket.bind(0, address, () => socket.close(() => resolve(true)));
  });
}

/** Linux routes all of 127/8 to loopback, so a second sender can use 127.0.0.2; macOS cannot. */
const HAS_LOOPBACK_ALIAS = await canBind('udp4', '127.0.0.2');
const HAS_IPV6 = await canBind('udp6', '::1');

/** A client socket, bound to `address` when given (to send from a second loopback address). */
async function client(address?: string, type: SocketType = 'udp4'): Promise<Socket> {
  const socket = createSocket(type);
  cleanups.push(() => new Promise<void>((resolve) => socket.close(() => resolve())));
  if (address !== undefined) {
    await new Promise<void>((resolve) => socket.bind(0, address, () => resolve()));
  }
  return socket;
}

function send(
  socket: Socket,
  port: number,
  payload: string | Buffer,
  host = '127.0.0.1',
): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(payload, port, host, (err) => (err ? reject(err) : resolve()));
  });
}

/** Let datagrams already sent over loopback be received and handled. */
const settle = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function startSource(
  port: number | null = 0,
  senders?: string[],
  socket: { createSocket: UdpSocketFactory; bindAddress: string } = {
    createSocket: defaultUdpSocketFactory,
    bindAddress: '127.0.0.1',
  },
) {
  const clock = new FakeClock();
  const src = new AdasUdpSource(adasConfig(port, senders), socket);
  const recorder = recordingContext(clock);
  await src.start(recorder.ctx);
  cleanups.push(() => src.stop());
  return { clock, src, ...recorder };
}

/**
 * A socket whose datagrams, and the source addresses they come from, the test supplies — for
 * address forms the host cannot produce (IPv6 here, dozens of senders).
 */
function scriptedSocket() {
  let onMessage: ((msg: Buffer, rinfo: RemoteInfo) => void) | null = null;
  const socket: UdpSocketLike = {
    on(event: string, listener: (...args: never[]) => void) {
      if (event === 'message') onMessage = listener as (msg: Buffer, rinfo: RemoteInfo) => void;
      return socket;
    },
    bind(_port: number, _address: string, callback: () => void) {
      setImmediate(callback);
      return socket;
    },
    address: () => ({ port: 5005 }),
    close(callback?: () => void) {
      if (callback) setImmediate(callback);
      return socket;
    },
  };
  return {
    createSocket: () => socket,
    bindAddress: '0.0.0.0',
    deliver(payload: string, address: string): void {
      const family = address.includes(':') ? 'IPv6' : 'IPv4';
      onMessage?.(Buffer.from(payload), { address, family, port: 40_000, size: payload.length });
    },
  };
}

const HEARTBEAT = '{"t":"heartbeat"}';
const BRAKE = '{"t":"collision","level":"warning","ttcSeconds":0.8}';
const ANY_SENDER_WARNING = /accepting datagrams from any device.*sensors\.adasAllowedSenders/;

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
    const socket = await client();
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
    const socket = await client();
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
    const socket = await client();
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
    const socket = await client();
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
    const socket = await client();
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
    const socket = await client();
    await send(socket, port, '{"t":"heartbeat"}');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(events).toEqual([]);
    expect(clock.pendingTimers).toBe(0);
  });
});

describe('AdasUdpSource sender allow-list', () => {
  it('warns once when the port is open to any sender, and then accepts every sender', async () => {
    const { src, events, logger } = await startSource(0, []);
    expect(logger.lines('warn')).toEqual([expect.stringMatching(ANY_SENDER_WARNING)]);
    const socket = await client();
    await send(socket, src.boundPort!, BRAKE);
    await vi.waitFor(() =>
      expect(events.map((e) => e.type)).toEqual(['adas/link', 'adas/collision']),
    );
    // Unrelated config changes do not repeat it.
    await src.updateConfig(adasConfig(0, []));
    expect(logger.lines('warn')).toHaveLength(1);
  });

  it('does not warn about any sender while the feed is off', async () => {
    const { logger } = await startSource(null, []);
    expect(logger.lines('warn')).toEqual([]);
  });

  it('names the accepted senders when it starts listening', async () => {
    const { src, logger } = await startSource(0, ['127.0.0.1', '2001:DB8::1']);
    expect(logger.lines('info')).toContain(
      `ADAS feed: listening on UDP 127.0.0.1:${src.boundPort}, accepting only 127.0.0.1, 2001:db8::1`,
    );
    expect(logger.lines('warn')).toEqual([]);
  });

  it('drops datagrams from other senders without connecting, in a rate-limited warning', async () => {
    const { src, clock, events, logger } = await startSource(0, ['127.0.0.2']);
    const socket = await client();
    const port = src.boundPort!;
    await send(socket, port, BRAKE);
    await vi.waitFor(() => expect(logger.lines('warn')).toHaveLength(1));
    expect(logger.lines('warn')[0]).toBe(
      'ADAS feed: ignoring datagrams from 127.0.0.1, which is not in sensors.adasAllowedSenders (1 ignored since the last warning)',
    );
    await send(socket, port, BRAKE);
    await send(socket, port, HEARTBEAT);
    await settle();
    expect(logger.lines('warn')).toHaveLength(1);
    // Ten seconds on, the next one is reported with the count of those dropped silently.
    await clock.advance(10_000);
    await send(socket, port, HEARTBEAT);
    await vi.waitFor(() => expect(logger.lines('warn')).toHaveLength(2));
    expect(logger.lines('warn')[1]).toMatch(/from 127\.0\.0\.1, .*\(3 ignored since the last/);
    // Neither a warning nor a link: the HUD never saw the module.
    expect(events).toEqual([]);
    expect(clock.pendingTimers).toBe(0);
  });

  it('treats an IPv4-mapped IPv6 entry as the IPv4 address', async () => {
    const { src, events, logger } = await startSource(0, ['::ffff:127.0.0.1']);
    expect(logger.lines('info').join('\n')).toMatch(/accepting only 127\.0\.0\.1$/m);
    const socket = await client();
    await send(socket, src.boundPort!, BRAKE);
    await vi.waitFor(() => expect(events.map((e) => e.type)).toContain('adas/collision'));
  });

  it.runIf(HAS_LOOPBACK_ALIAS)(
    'gives each sender its own rate budget, so a flood cannot starve the module',
    async () => {
      const { src, events, logger } = await startSource(0, ['127.0.0.1', '127.0.0.2']);
      const port = src.boundPort!;
      const flooder = await client('127.0.0.2');
      const module = await client('127.0.0.1');
      for (let i = 0; i < ADAS_MAX_DATAGRAMS_PER_S + 30; i++) {
        await send(flooder, port, '{"t":"collision","level":"none"}');
      }
      // The fake clock does not move, so the flooder's bucket never refills…
      await vi.waitFor(() => expect(logger.lines('warn')).toHaveLength(1));
      expect(logger.lines('warn')[0]).toMatch(/rate limit exceeded by 127\.0\.0\.2/);
      // …but the module still gets through.
      await send(module, port, BRAKE);
      await vi.waitFor(() =>
        expect(events.at(-1)).toMatchObject({ type: 'adas/collision', level: 'warning' }),
      );
      expect(events.filter((e) => e.type === 'adas/collision')).toHaveLength(
        ADAS_MAX_DATAGRAMS_PER_S + 1,
      );
    },
  );

  it.runIf(HAS_LOOPBACK_ALIAS)('accepts listed senders and drops the rest', async () => {
    const { src, events, logger } = await startSource(0, ['127.0.0.2']);
    const port = src.boundPort!;
    const stranger = await client('127.0.0.1');
    const module = await client('127.0.0.2');
    await send(stranger, port, BRAKE);
    await send(module, port, '{"t":"blind-spot","left":true,"right":false}');
    await vi.waitFor(() =>
      expect(events.map((e) => e.type)).toEqual(['adas/link', 'adas/blind-spot']),
    );
    expect(logger.lines('info')).toContain('ADAS feed: module connected (127.0.0.2)');
    expect(logger.lines('warn')).toEqual([
      expect.stringMatching(/from 127\.0\.0\.1, which is not/),
    ]);
  });

  it('matches IPv6 senders canonically, ignoring their zone index', async () => {
    const socket = scriptedSocket();
    const { events, logger } = await startSource(
      5005,
      ['2001:DB8:0::1', 'fe80::1', '10.42.0.50'],
      socket,
    );
    const collisions = () => events.filter((e) => e.type === 'adas/collision').length;
    socket.deliver(BRAKE, '2001:db8::1');
    socket.deliver(BRAKE, 'fe80::1%wlan0');
    socket.deliver(BRAKE, '::ffff:10.42.0.50'); // an IPv4 peer on a dual-stack socket
    expect(collisions()).toBe(3);
    socket.deliver(BRAKE, '2001:db8::2');
    socket.deliver(BRAKE, 'fe80::2%wlan0');
    socket.deliver(BRAKE, '::ffff:10.42.0.51');
    socket.deliver(BRAKE, '10.42.0.51');
    expect(collisions()).toBe(3);
    expect(logger.lines('warn')).toEqual([
      expect.stringMatching(/ignoring datagrams from 2001:db8::2, which is not/),
    ]);
  });

  it('keeps warning after the system clock steps back (the 10 s spacing does not become hours)', async () => {
    const socket = scriptedSocket();
    const { clock, logger } = await startSource(5005, ['10.42.0.50'], socket);
    socket.deliver(HEARTBEAT, '10.42.0.99');
    socket.deliver('not json', '10.42.0.50');
    expect(logger.lines('warn')).toHaveLength(2);
    clock.current -= 3_600_000; // network time sets the clock back an hour
    socket.deliver(HEARTBEAT, '10.42.0.99');
    socket.deliver('not json', '10.42.0.50');
    expect(logger.lines('warn')).toHaveLength(4);
    // … and the spacing holds from the new time on.
    clock.current += 1000;
    socket.deliver(HEARTBEAT, '10.42.0.99');
    socket.deliver('not json', '10.42.0.50');
    expect(logger.lines('warn')).toHaveLength(4);
  });

  it('keeps a bounded budget table, forgetting the sender silent for longest', async () => {
    const socket = scriptedSocket();
    const { events, logger } = await startSource(5005, [], socket);
    const accepted = () => events.filter((e) => e.type === 'adas/blind-spot').length;
    const BLIND_SPOT = '{"t":"blind-spot","left":false,"right":true}';
    // Two senders use up their budgets (the fake clock stands still, so nothing refills).
    for (let i = 0; i < ADAS_MAX_DATAGRAMS_PER_S; i++) {
      socket.deliver(HEARTBEAT, '10.0.0.1');
      socket.deliver(HEARTBEAT, '10.0.0.2');
    }
    socket.deliver(BLIND_SPOT, '10.0.0.2');
    socket.deliver(BLIND_SPOT, '10.0.0.1'); // 10.0.0.1 is now the more recently seen
    expect(accepted()).toBe(0);
    // Enough new senders to fill the table push out the sender silent for longest: 10.0.0.2.
    for (let i = 1; i < ADAS_MAX_TRACKED_SENDERS; i++) socket.deliver(HEARTBEAT, `10.0.1.${i}`);
    socket.deliver(BLIND_SPOT, '10.0.0.1');
    expect(accepted()).toBe(0); // still tracked, still over budget
    socket.deliver(BLIND_SPOT, '10.0.0.2');
    expect(accepted()).toBe(1); // forgotten, so it starts with a fresh budget
    expect(logger.lines('warn')).toEqual([
      expect.stringMatching(ANY_SENDER_WARNING),
      expect.stringMatching(/rate limit exceeded by 10\.0\.0\.2/),
    ]);
  });

  it('applies allow-list changes without rebinding, dropping a link it no longer allows', async () => {
    const { src, events, logger, ofType } = await startSource(0, ['127.0.0.1']);
    const port = src.boundPort!;
    const socket = await client();
    const links = () => ofType('adas/link').map((e) => e.connected);
    await send(socket, port, HEARTBEAT);
    await vi.waitFor(() => expect(links()).toEqual([true]));

    // Adding a sender keeps everyone accepted so far: no interruption.
    await src.updateConfig(adasConfig(0, ['127.0.0.1', '10.42.0.50']));
    expect(links()).toEqual([true]);
    // Removing the connected sender ends its link at once (its readings stop counting).
    await src.updateConfig(adasConfig(0, ['10.42.0.50']));
    expect(src.boundPort).toBe(port);
    expect(links()).toEqual([true, false]);
    expect(logger.lines('info').at(-1)).toBe('ADAS feed: now accepting only 10.42.0.50');
    await send(socket, port, BRAKE);
    await vi.waitFor(() => expect(logger.lines('warn')).toHaveLength(1));
    expect(ofType('adas/collision')).toEqual([]);
    // The same list written differently is no change.
    const infos = logger.lines('info').length;
    await src.updateConfig(adasConfig(0, ['::ffff:10.42.0.50']));
    expect(logger.lines('info')).toHaveLength(infos);

    // Emptying the list opens the feed to everyone, with the warning.
    await src.updateConfig(adasConfig(0, []));
    expect(logger.lines('warn').at(-1)).toMatch(ANY_SENDER_WARNING);
    await send(socket, port, BRAKE);
    await vi.waitFor(() => expect(ofType('adas/collision')).toHaveLength(1));
    expect(links()).toEqual([true, false, true]);
    // Any list at all narrows "any sender", so the link restarts; the module reconnects.
    await src.updateConfig(adasConfig(0, ['127.0.0.1']));
    expect(links()).toEqual([true, false, true, false]);
    await send(socket, port, HEARTBEAT);
    await vi.waitFor(() => expect(links()).toEqual([true, false, true, false, true]));
    expect(events.filter((e) => e.type === 'adas/collision')).toHaveLength(1);
  });

  it('warns again about any sender after the list is emptied or the port moves', async () => {
    const { src, logger } = await startSource(0, ['127.0.0.1']);
    const anySender = () => logger.lines('warn').filter((l) => ANY_SENDER_WARNING.test(l));
    await src.updateConfig(adasConfig(0, []));
    expect(anySender()).toHaveLength(1);
    await src.updateConfig(adasConfig(0, ['127.0.0.1']));
    await src.updateConfig(adasConfig(0, []));
    expect(anySender()).toHaveLength(2);
    const probe = createSocket('udp4');
    await new Promise<void>((resolve) => probe.bind(0, '127.0.0.1', () => resolve()));
    const other = probe.address().port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    await src.updateConfig(adasConfig(other, []));
    expect(src.boundPort).toBe(other);
    expect(anySender()).toHaveLength(3);
  });

  it.runIf(HAS_IPV6)('filters IPv6 senders on an IPv6 socket', async () => {
    const { src, events } = await startSource(0, ['::1'], {
      createSocket: () => createSocket('udp6'),
      bindAddress: '::1',
    });
    const socket = await client(undefined, 'udp6');
    await send(socket, src.boundPort!, BRAKE, '::1');
    await vi.waitFor(() => expect(events.map((e) => e.type)).toContain('adas/collision'));
  });
});
