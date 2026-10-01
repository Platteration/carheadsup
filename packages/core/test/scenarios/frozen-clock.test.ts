import { describe, expect, it } from 'vitest';
import { extractPersisted } from '../../src/state/reducer.ts';
import { wallNow } from '../../src/state/selectors.ts';
import { RESUME_CONFIRM_MS } from '../../src/trip/trip.ts';
import type { PersistedState, TripRecord } from '../../src/types/records.ts';
import { Harness, T0, makeConfig, persisted, widget } from '../state/fixtures.ts';

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * A Pi without a real-time clock or network time, under a read-only root: the time saved by
 * fake-hwclock is thrown away with the overlay, so every boot starts at the same system time.
 * These scenarios replay a few such boots through the real reducer the way the server runs it:
 * it starts the wall clock no earlier than the time it last saved (`lastWallMs`) and marks it
 * untrusted when the system clock read earlier, and the phone fetches what it missed with
 * `trips-request.sinceSeq`.
 */
describe('scenario: a frozen system clock across boots', () => {
  const config = makeConfig({
    display: {
      layout: {
        preset: 'custom',
        widgets: [
          { id: 'clock', zone: 'bottom-right', contexts: ['parked', 'stopped', 'city', 'highway'] },
        ],
      },
    },
  });
  const FROZEN = T0; // what the system clock reads at every boot

  interface Boot {
    h: Harness;
    trips: TripRecord[];
  }

  /** Start the HUD as the server does: never earlier than the saved wall time. */
  function boot(saved: PersistedState, systemNow = FROZEN): Boot {
    const floor = saved.lastWallMs ?? null;
    const behind = floor !== null && systemNow < floor;
    const h = new Harness(config, saved, behind ? floor : systemNow, { clockTrusted: !behind });
    return { h, trips: [] };
  }

  /** Drive for `minutes`, park, and lose power 20 s later; returns what was saved. */
  function driveAndPowerDown(b: Boot, minutes: number, startDelayMs = 21_000): PersistedState {
    const { h } = b;
    h.idle(h.now + startDelayMs);
    h.send({ type: 'obd/link', state: 'connected', at: h.now });
    h.run(h.now + minutes * MINUTE, { speed: 50, rpm: 2000 }, 1000);
    h.run(h.now + 5000, { speed: 0, rpm: 800 }, 1000);
    h.send({ type: 'obd/link', state: 'error', at: h.now + 1000 });
    h.idle(h.now + 20_000);
    collect(b);
    return { ...extractPersisted(h.state), lastWallMs: wallNow(h.state) };
  }

  function collect(b: Boot): void {
    for (const effect of b.h.effects) {
      if (effect.type === 'trip/completed' && !b.trips.includes(effect.trip)) {
        b.trips.push(effect.trip);
      }
    }
  }

  /** The phone's catch-up: trips after its cursor, by sequence number. */
  function sync(cursor: number, log: readonly TripRecord[]): TripRecord[] {
    return log.filter((t) => (t.seq ?? 0) > cursor).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  }

  it('records every drive once, with distinct ids, and the phone gets them all', () => {
    let saved = persisted();
    const log: TripRecord[] = [];
    const drives = [40, 10, 25, 5];
    for (const minutes of drives) {
      const b = boot(saved);
      saved = driveAndPowerDown(b, minutes);
      log.push(...b.trips);
    }
    // A last start completes the fourth drive: nobody drives, the real time never comes.
    const last = boot(saved);
    last.h.idle(last.h.now + RESUME_CONFIRM_MS + 1000, 10_000);
    collect(last);
    log.push(...last.trips);

    expect(log.map((t) => t.seq)).toEqual([1, 2, 3, 4]);
    expect(new Set(log.map((t) => t.id)).size).toBe(4);
    expect(log.map((t) => Math.round(t.distanceKm))).toEqual([33, 8, 21, 4]);
    // The wall clock never ran backwards across boots, so neither do the trips' times …
    for (let i = 1; i < log.length; i += 1) {
      expect(log[i]?.startedAt).toBeGreaterThan(log[i - 1]?.endedAt ?? Infinity);
    }
    // … and a phone that synced after the first trip catches up on all the others, in order.
    expect(sync(1, log).map((t) => t.seq)).toEqual([2, 3, 4]);
    // The clock stayed hidden: only a lower bound of the time was ever known.
    expect(widget(last.h.frame(), 'clock')).toBeUndefined();
  });

  it('numbers trips apart even from a state file without a saved wall time', () => {
    // Written before `lastWallMs` existed: every trip is "in the future" of the frozen boot.
    let saved = persisted();
    const log: TripRecord[] = [];
    for (const minutes of [12, 12, 12]) {
      const b = boot({ ...saved, lastWallMs: null });
      saved = driveAndPowerDown(b, minutes);
      log.push(...b.trips);
    }
    expect(log.map((t) => t.seq)).toEqual([1, 2]);
    expect(log[0]?.startedAt).toBe(log[1]?.startedAt); // the same frozen start …
    expect(log[0]?.id).not.toBe(log[1]?.id); // … yet distinct trips
  });

  it('uses the phone’s time once it connects: the last drive is completed, the clock shows', () => {
    let saved = persisted();
    for (const minutes of [30, 15]) saved = driveAndPowerDown(boot(saved), minutes);
    // The third boot: the HUD starts from its saved time; the phone connects 40 s later and
    // says it is really 200 days after the frozen time.
    const b = boot(saved);
    const { h } = b;
    expect(h.state.clock.trusted).toBe(false);
    h.send({ type: 'obd/link', state: 'connected', at: h.now + 20_000 });
    h.run(h.now + 20_000, { speed: 30, rpm: 1500 }, 1000);
    const realNow = FROZEN + 200 * DAY;
    h.send({
      type: 'clock/sync',
      wallOffsetMs: realNow - h.now,
      trusted: true,
      at: h.now,
    });
    collect(b);
    expect(b.trips.map((t) => t.seq)).toEqual([2]); // the second drive, with its saved times
    expect(b.trips[0]?.endedAt).toBeLessThan(FROZEN + DAY);
    expect(h.state.trip.current?.startedAt).toBeGreaterThan(realNow - MINUTE);
    expect(widget(h.frame(), 'clock')?.epochMs).toBe(realNow);
    // Today's drive is recorded on the real clock.
    const next = driveAndPowerDown(b, 10, 0);
    expect(next.lastWallMs).toBeGreaterThan(realNow);
    const after = boot(next, FROZEN);
    after.h.idle(after.h.now + RESUME_CONFIRM_MS + 1000, 10_000);
    collect(after);
    expect(after.trips).toEqual([
      expect.objectContaining({ seq: 3, startedAt: expect.any(Number) as unknown }),
    ]);
    expect(after.trips[0]?.startedAt).toBeGreaterThan(realNow - MINUTE);
  });
});
