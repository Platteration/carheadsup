import type { ServerToRenderer } from '@carheadsup/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IDLE_TIMEOUT_MS,
  hudSocketUrl,
  openHudConnection,
  parseServerMessage,
  reconnectDelayMs,
  withToken,
} from '../../src/common/connection.ts';
import { SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';
import { FakeSocket } from './fake-socket.ts';

const FRAME = SAMPLE_FRAMES['highway-cruise']!;

const PROJECTION = {
  mirrorX: true,
  mirrorY: false,
  rotation: 0 as const,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  corners: {
    tl: [0, 0] as [number, number],
    tr: [1, 0] as [number, number],
    br: [1, 1] as [number, number],
    bl: [0, 1] as [number, number],
  },
  showGrid: false,
};

describe('hudSocketUrl', () => {
  it('uses the page host with ws: or wss:', () => {
    expect(hudSocketUrl({ protocol: 'http:', host: 'hud.local:8080' })).toBe(
      'ws://hud.local:8080/ws/hud',
    );
    expect(hudSocketUrl({ protocol: 'https:', host: 'hud.local' })).toBe('wss://hud.local/ws/hud');
  });

  it('carries the API token as ?token=, encoded, only when there is one', () => {
    expect(withToken('ws://hud.local:8080/ws/hud', '')).toBe('ws://hud.local:8080/ws/hud');
    expect(withToken('ws://hud.local:8080/ws/hud', 'abc')).toBe(
      'ws://hud.local:8080/ws/hud?token=abc',
    );
    expect(withToken('ws://hud/ws/hud?x=1', 'a&b=c d')).toBe(
      'ws://hud/ws/hud?x=1&token=a%26b%3Dc+d',
    );
    expect(withToken('', 'abc')).toBe('');
  });
});

describe('reconnectDelayMs', () => {
  it('backs off exponentially from 0.5 s and caps at 5 s', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map((n) => reconnectDelayMs(n))).toEqual([
      500, 1000, 2000, 4000, 5000, 5000, 5000,
    ]);
  });

  it('stays finite for huge attempt counts and sane for negative ones', () => {
    expect(reconnectDelayMs(10_000)).toBe(5000);
    expect(reconnectDelayMs(-3)).toBe(500);
    expect(reconnectDelayMs(1.7)).toBe(1000);
  });

  it('honours custom bounds', () => {
    expect(reconnectDelayMs(0, 100, 300)).toBe(100);
    expect(reconnectDelayMs(5, 100, 300)).toBe(300);
  });
});

describe('parseServerMessage', () => {
  it('accepts frame and display messages', () => {
    expect(parseServerMessage(JSON.stringify({ t: 'frame', frame: FRAME }))).toEqual({
      t: 'frame',
      frame: FRAME,
    });
    expect(
      parseServerMessage(
        JSON.stringify({
          t: 'display',
          projection: PROJECTION,
          simulated: true,
          hardwareBrightness: true,
        }),
      ),
    ).toEqual({ t: 'display', projection: PROJECTION, simulated: true, hardwareBrightness: true });
  });

  it('reads a display message without hardwareBrightness (older server) as dimming in CSS', () => {
    expect(
      parseServerMessage(JSON.stringify({ t: 'display', projection: PROJECTION, simulated: true })),
    ).toEqual({ t: 'display', projection: PROJECTION, simulated: true, hardwareBrightness: false });
    expect(
      parseServerMessage(
        JSON.stringify({
          t: 'display',
          projection: PROJECTION,
          simulated: false,
          hardwareBrightness: 'yes',
        }),
      ),
    ).toMatchObject({ hardwareBrightness: false });
  });

  it('round-trips every fixture', () => {
    for (const [name, frame] of Object.entries(SAMPLE_FRAMES)) {
      expect(parseServerMessage(JSON.stringify({ t: 'frame', frame })), name).toEqual({
        t: 'frame',
        frame,
      });
    }
  });

  it('rejects non-strings, bad JSON, non-objects and unknown types', () => {
    expect(parseServerMessage(new ArrayBuffer(4))).toBeNull();
    expect(parseServerMessage('{not json')).toBeNull();
    expect(parseServerMessage('[1,2]')).toBeNull();
    expect(parseServerMessage('null')).toBeNull();
    expect(parseServerMessage(JSON.stringify({ t: 'pong' }))).toBeNull();
  });

  it('rejects structurally broken frames', () => {
    const broken: unknown[] = [
      { ...FRAME, at: 'now' },
      { ...FRAME, widgets: 'speed' },
      { ...FRAME, widgets: [{ id: 'speed' }] },
      { ...FRAME, theme: null },
      { ...FRAME, theme: { night: false } },
      { ...FRAME, alerts: undefined },
      { ...FRAME, status: undefined },
    ];
    for (const frame of broken) {
      expect(parseServerMessage(JSON.stringify({ t: 'frame', frame }))).toBeNull();
    }
  });

  it('rejects broken display messages', () => {
    const bad = [
      { t: 'display', projection: PROJECTION },
      {
        t: 'display',
        projection: { ...PROJECTION, corners: { ...PROJECTION.corners, tl: [0] } },
        simulated: false,
      },
      { t: 'display', projection: { ...PROJECTION, mirrorX: 'yes' }, simulated: false },
      { t: 'display', projection: null, simulated: false },
    ];
    for (const message of bad) expect(parseServerMessage(JSON.stringify(message))).toBeNull();
  });
});

describe('openHudConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.reset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function connect(overrides: Partial<Parameters<typeof openHudConnection>[0]> = {}) {
    const messages: ServerToRenderer[] = [];
    const states: boolean[] = [];
    const connection = openHudConnection({
      url: 'ws://hud/ws/hud',
      createSocket: FakeSocket.factory,
      onMessage: (m) => messages.push(m),
      onConnectionChange: (c) => states.push(c),
      ...overrides,
    });
    return { connection, messages, states };
  }

  it('connects immediately and reports the open socket', () => {
    const { connection, states } = connect();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.latest().url).toBe('ws://hud/ws/hud');
    expect(connection.connected).toBe(false);
    FakeSocket.latest().open();
    expect(connection.connected).toBe(true);
    expect(states).toEqual([true]);
  });

  it('delivers valid messages and ignores malformed ones', () => {
    const { messages } = connect();
    const socket = FakeSocket.latest();
    socket.open();
    socket.receiveJson({ t: 'frame', frame: FRAME });
    socket.receive('garbage');
    socket.receiveJson({ t: 'unknown' });
    socket.receiveJson({ t: 'display', projection: PROJECTION, simulated: false });
    expect(messages.map((m) => m.t)).toEqual(['frame', 'display']);
  });

  it('reconnects with exponential backoff while the server is down', () => {
    const { states } = connect();
    FakeSocket.latest().fail();
    expect(states).toEqual([]); // never connected, so no change to report
    const expectedDelays = [500, 1000, 2000, 4000, 5000, 5000];
    for (const delay of expectedDelays) {
      const before = FakeSocket.instances.length;
      vi.advanceTimersByTime(delay - 1);
      expect(FakeSocket.instances).toHaveLength(before);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.instances).toHaveLength(before + 1);
      FakeSocket.latest().fail();
    }
  });

  it('resets the backoff after a successful connection', () => {
    const { states } = connect();
    FakeSocket.latest().fail();
    vi.advanceTimersByTime(500);
    FakeSocket.latest().fail();
    vi.advanceTimersByTime(1000);
    FakeSocket.latest().open();
    FakeSocket.latest().drop();
    expect(states).toEqual([true, false]);
    vi.advanceTimersByTime(499);
    expect(FakeSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it('handles error+close pairs as a single loss', () => {
    const { states } = connect();
    FakeSocket.latest().open();
    FakeSocket.latest().fail();
    expect(states).toEqual([true, false]);
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('replaces a socket that goes silent', () => {
    const { states } = connect();
    const first = FakeSocket.latest();
    first.open();
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 100);
    first.receiveJson({ t: 'frame', frame: FRAME }); // re-arms the watchdog
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
    expect(first.closeCalls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(first.closeCalls).toBe(1);
    expect(states).toEqual([true, false]);
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('can disable the idle watchdog', () => {
    connect({ idleTimeoutMs: 0 });
    FakeSocket.latest().open();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.latest().closeCalls).toBe(0);
  });

  it('ignores events from sockets it has already abandoned', () => {
    const { messages, states } = connect();
    const first = FakeSocket.latest();
    first.open();
    first.drop();
    vi.advanceTimersByTime(500);
    first.receiveJson({ t: 'frame', frame: FRAME });
    first.open();
    expect(messages).toEqual([]);
    expect(states).toEqual([true, false]);
  });

  it('sends JSON only while open', () => {
    const { connection } = connect();
    expect(connection.send({ t: 'input', action: 'primary' })).toBe(false);
    FakeSocket.latest().open();
    expect(connection.send({ t: 'input', action: 'next-page' })).toBe(true);
    expect(FakeSocket.latest().sent).toEqual(['{"t":"input","action":"next-page"}']);
    FakeSocket.latest().drop();
    expect(connection.send({ t: 'input', action: 'primary' })).toBe(false);
  });

  it('reports a failed send instead of throwing', () => {
    const { connection } = connect();
    const socket = FakeSocket.latest();
    socket.open();
    socket.send = () => {
      throw new Error('buffer full');
    };
    expect(connection.send({ t: 'input', action: 'primary' })).toBe(false);
  });

  it('retries when the socket constructor throws', () => {
    let calls = 0;
    connect({
      createSocket: (url) => {
        calls += 1;
        if (calls === 1) throw new SyntaxError('bad url');
        return FakeSocket.factory(url);
      },
    });
    expect(FakeSocket.instances).toHaveLength(0);
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('stops for good on close()', () => {
    const { connection, states } = connect();
    const socket = FakeSocket.latest();
    socket.open();
    connection.close();
    connection.close();
    expect(socket.closeCalls).toBe(1);
    expect(connection.connected).toBe(false);
    expect(states).toEqual([true]);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('cancels a pending reconnect on close()', () => {
    const { connection } = connect();
    FakeSocket.latest().fail();
    connection.close();
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
