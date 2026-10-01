import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { wallNow } from '@carheadsup/core';
import type { PersistedState, TripRecord } from '@carheadsup/core';
import { afterEach, describe, expect, it } from 'vitest';
import { connectTestPhone, startTestServer, waitFor } from './helpers.ts';
import type { TestServer, TestServerOptions } from './helpers.ts';

const DAY = 86_400_000;

let current: TestServer | null = null;
const closers: Array<() => void> = [];

async function start(options: TestServerOptions = {}): Promise<TestServer> {
  current = await startTestServer(options);
  return current;
}

afterEach(async () => {
  for (const close of closers.splice(0)) close();
  await current?.stop();
  current = null;
});

/** A system clock that restored a time 200 days ago at boot (and runs on from there). */
const frozenSystemClock = (): (() => number) => {
  const offset = -200 * DAY;
  return () => Date.now() + offset;
};

/** The HUD's wall clock now, as the core sees it. */
const hudWall = (t: TestServer): number => wallNow(t.server.engine.state);

function trip(seq: number): TripRecord {
  const startedAt = 1_790_000_000_000 + seq * 3_600_000;
  return {
    id: `trip-${seq}`,
    seq,
    startedAt,
    endedAt: startedAt + 600_000,
    distanceKm: 1,
    durationS: 600,
    movingS: 500,
    idleS: 100,
    fuelUsedL: null,
    avgLPer100km: null,
    maxSpeedKph: 50,
    avgMovingSpeedKph: 30,
    cost: null,
    currency: 'EUR',
    startOdometerKm: null,
    endOdometerKm: null,
  };
}

describe('the HUD wall clock on a Pi without network time', () => {
  it('starts from the time it last saved when the system clock went back, until the phone gives the real time', async () => {
    const saved = Date.now() - 100 * DAY;
    const t = await start({
      now: frozenSystemClock(),
      files: { 'state.json': JSON.stringify({ lastWallMs: saved }) },
    });
    const engine = t.server.engine;
    expect(engine.state.clock.trusted).toBe(false);
    expect(Math.abs(hudWall(t) - saved)).toBeLessThan(5000);
    expect(t.logger.text('warn')).toContain('earlier than the time the HUD last saved');

    // The phone connects and sends its clock with the hello.
    const { socket } = await connectTestPhone(t.phoneBase, { time: Date.now() });
    closers.push(() => socket.close());
    await waitFor(() => engine.state.clock.trusted, 2000, 'a trusted clock');
    expect(Math.abs(hudWall(t) - Date.now())).toBeLessThan(2000);
    expect(t.logger.text('info')).toContain('the HUD follows the phone');

    // What the HUD saves now is the real time: the next start's floor.
    engine.dispatch({ type: 'odometer/set', odometerKm: 1000, at: 0 });
    await engine.flushPersistence();
    const file = JSON.parse(
      await readFile(join(t.dataDir, 'state.json'), 'utf8'),
    ) as PersistedState;
    expect(Math.abs((file.lastWallMs ?? 0) - Date.now())).toBeLessThan(5000);
  });

  it('keeps following the phone through its pings', async () => {
    const t = await start({ now: frozenSystemClock() });
    expect(t.server.engine.state.clock.trusted).toBe(true); // no reason for doubt yet
    const { socket } = await connectTestPhone(t.phoneBase);
    closers.push(() => socket.close());
    socket.send({ t: 'ping', id: 1, time: Date.now() });
    await socket.nextOfType('pong');
    await waitFor(() => Math.abs(hudWall(t) - Date.now()) < 2000, 2000, 'the phone time');
  });

  it('takes neither the saved time nor the phone’s once the system clock has network time', async () => {
    const system = Date.now();
    const t = await start({
      clockSynchronized: () => true,
      files: { 'state.json': JSON.stringify({ lastWallMs: system + 30 * DAY }) },
    });
    const engine = t.server.engine;
    expect(engine.state.clock.trusted).toBe(true);
    expect(Math.abs(engine.state.clock.wallOffsetMs)).toBeLessThan(1000); // no correction
    const { socket } = await connectTestPhone(t.phoneBase, { time: system + 7 * DAY });
    closers.push(() => socket.close());
    await waitFor(() => engine.state.phone.connected, 2000, 'the phone');
    expect(Math.abs(hudWall(t) - Date.now())).toBeLessThan(2000);
  });

  it('numbers trips after the highest in the trip log, even without a saved number', async () => {
    const t = await start({
      files: {
        'trips.jsonl': [3, 7, 5].map((n) => `${JSON.stringify(trip(n))}\n`).join(''),
        'state.json': JSON.stringify({ tripSeq: 4 }),
      },
    });
    expect(t.server.engine.state.trip.lastSeq).toBe(7);
    // A phone that knows trip 5 asks for what it is missing.
    const { socket } = await connectTestPhone(t.phoneBase);
    closers.push(() => socket.close());
    socket.send({ t: 'trips-request', since: 0, sinceSeq: 5 });
    const answer = await socket.nextOfType('trips');
    expect((answer['trips'] as TripRecord[]).map((x) => x.seq)).toEqual([7]);
  });
});
