import { describe, expect, it } from 'vitest';
import { DATA_GAP_GRACE_MS, UNPARK_CREEP_MS } from '../../src/display/context.ts';
import { staleLimitMs } from '../../src/staleness.ts';
import {
  EMPTY_PERSISTED_STATE,
  createInitialState,
  extractActiveTrip,
  extractPersisted,
  reduce,
  type PersistedStateWithTrip,
} from '../../src/state/reducer.ts';
import { RESUME_CONFIRM_MS, tripId } from '../../src/trip/trip.ts';
import { TRACK_NOT_ANNOUNCED } from '../../src/state/phone.ts';
import {
  ENDED_CALL_SHOW_MS,
  HAZARD_TTL_MS,
  MAX_MESSAGES,
  MESSAGE_TTL_MS,
  PHONE_DATA_GRACE_MS,
  ROAD_TTL_MS,
  isDashboardShown,
  kmSinceConfirmed,
} from '../../src/state/selectors.ts';
import type { HudEvent } from '../../src/types/events.ts';
import type { Hazard } from '../../src/types/nav.ts';
import type { MessageInfo } from '../../src/types/phone.ts';
import {
  Harness,
  T0,
  callInfo,
  freezeDeep,
  makeConfig,
  mediaInfo,
  navInfo,
  persisted,
  roadInfo,
  samplesEvent,
  widget,
} from './fixtures.ts';

const DAY = 86_400_000;

function message(id: string, sender = 'Alex', overrides: Partial<MessageInfo> = {}): MessageInfo {
  return { id, sender, app: 'WhatsApp', receivedAt: 0, readingAloud: true, ...overrides };
}

function hazard(id: string, distanceM: number | null, overrides: Partial<Hazard> = {}): Hazard {
  return {
    id,
    type: 'speed-camera',
    distanceM,
    speedLimitKph: 100,
    delaySeconds: null,
    description: null,
    updatedAt: 0,
    ...overrides,
  };
}

/** A harness with the OBD link up, driving at `speed` for a couple of seconds. */
function driving(speed = 50, config = makeConfig()): Harness {
  const h = new Harness(config);
  h.obdConnected(T0);
  h.run(T0 + 2000, { speed, rpm: 2000 });
  return h;
}

describe('createInitialState', () => {
  it('seeds odometer, gear ratios, fuel average and maintenance records from persistence', () => {
    const config = makeConfig();
    const state = createInitialState(
      config,
      persisted({
        odometerKm: 48_500,
        learnedGearRatios: [120, 70, 48, 36, 29],
        avgLPer100km: 7.2,
        maintenanceRecords: [{ itemId: 'oil', odometerKm: 41_000, at: T0 - 200 * DAY }],
      }),
      T0,
      { simulated: true },
    );
    expect(state.now).toBe(T0);
    expect(state.simulated).toBe(true);
    expect(state.odometer).toEqual({
      km: 48_500,
      source: 'estimated',
      integratedKm: 0,
      lastSampleAt: null,
      lastSpeedKph: null,
      calibration: { confirmedKm: null, rawKmSince: 0, scale: 1 },
      gpsFix: null,
    });
    expect(state.gear.learnedRatios).toEqual([120, 70, 48, 36, 29]);
    expect(state.fuel.readings.averageLPer100km).toBeCloseTo(7.2);
    expect(state.maintenance.records).toEqual([
      { itemId: 'oil', odometerKm: 41_000, at: T0 - 200 * DAY },
    ]);
    // Status is derived right away: 48 500 − 41 000 = 7 500 km of an 8 000 km interval.
    const oil = state.maintenance.status.find((s) => s.itemId === 'oil');
    expect(oil?.status).toBe('due-soon');
    expect(oil?.remainingKm).toBe(500);
    expect(state.maintenance.checkedAt).toBe(T0);
    // …and so are the alerts that follow from it.
    expect(state.alerts.map((a) => a.key)).toEqual(['maintenance-due:oil']);
  });

  it('starts disconnected and empty', () => {
    const state = createInitialState(makeConfig(), EMPTY_PERSISTED_STATE, T0);
    expect(state.simulated).toBe(false);
    expect(state.vehicle.link).toEqual({
      state: 'disconnected',
      adapter: null,
      protocol: null,
      message: null,
      since: T0,
    });
    expect(state.vehicle.signals).toEqual({});
    expect(state.vehicle.supported).toBeNull();
    expect(state.vehicle.dtcs).toEqual([]);
    expect(state.context.context).toBe('parked');
    expect(state.odometer.km).toBeNull();
    expect(state.odometer.source).toBeNull();
    expect(state.nav).toBeNull();
    expect(state.road).toBeNull();
    expect(state.hazards).toEqual([]);
    expect(state.media).toBeNull();
    expect(state.call).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.phone.connected).toBe(false);
    expect(state.adas.moduleConnected).toBe(false);
    expect(state.alerts).toEqual([]);
    expect(state.pairing).toBeNull();
    expect(state.ui).toEqual({
      blanked: false,
      page: 0,
      dashboardRequested: false,
      pairingShownAt: null,
      brightnessOffset: 0,
      toastDismissedAt: null,
      lastInputAt: null,
    });
    // Engine time starts at the wall clock until the server says otherwise.
    expect(state.clock).toEqual({ wallOffsetMs: 0, trusted: true });
    expect(state.shiftFlash).toBe(false);
  });

  it('ignores an implausible persisted odometer', () => {
    for (const odometerKm of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      const state = createInitialState(makeConfig(), persisted({ odometerKm }), T0);
      expect(state.odometer.km).toBeNull();
      expect(state.odometer.source).toBeNull();
    }
  });
});

describe('a trip across a power-down', () => {
  /** 20 minutes at 60 km/h, stop, the ECU goes silent, the HUD powers down 20 s later. */
  function driveThenPowerDown(config = makeConfig()): Harness {
    const h = new Harness(config, persisted({ odometerKm: 1000 }));
    h.obdConnected(T0);
    h.run(T0 + 20 * 60_000, { speed: 60, rpm: 2000 }, 1000);
    h.run(h.now + 5000, { speed: 0, rpm: 800 }, 1000);
    h.send({ type: 'obd/link', state: 'error', message: 'No response', at: h.now + 1000 });
    h.idle(h.now + 20_000);
    expect(h.state.trip.active).not.toBeNull();
    expect(h.effects.filter((e) => e.type === 'trip/completed')).toEqual([]);
    return h;
  }

  /** What the server writes at shutdown and reads back at the next start-up. */
  function saved(h: Harness): PersistedStateWithTrip {
    return JSON.parse(
      JSON.stringify({ ...extractPersisted(h.state), activeTrip: extractActiveTrip(h.state) }),
    ) as PersistedStateWithTrip;
  }

  it('completes the trip on the first tick after the next start-up (regression: core-1)', () => {
    const before = driveThenPowerDown();
    const lastActivity = before.state.trip.active?.lastActivityAt;
    const boot = before.now + 2 * 3_600_000;
    const after = new Harness(makeConfig(), saved(before), boot);
    expect(after.state.trip.current?.distanceKm).toBeCloseTo(20, 0);
    after.tick(boot + 100);
    const completed = after.effects.filter((e) => e.type === 'trip/completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      trip: { id: tripId(1, T0 + 1000), endedAt: lastActivity, startOdometerKm: 1000 },
    });
    expect(after.state.trip.active).toBeNull();
  });

  it('carries on with the same trip after a short power blip', () => {
    const before = driveThenPowerDown();
    const boot = before.now + 60_000;
    const after = new Harness(makeConfig(), saved(before), boot);
    after.obdConnected(boot);
    after.run(boot + 60_000, { speed: 60, rpm: 2000 }, 1000);
    expect(after.state.trip.current?.startedAt).toBe(T0 + 1000);
    expect(after.state.trip.current?.distanceKm).toBeGreaterThan(20.9);
    expect(after.effects.filter((e) => e.type === 'trip/completed')).toEqual([]);
  });

  it('saves the trip with wall-clock times and resumes it in the next start’s engine time', () => {
    const before = driveThenPowerDown();
    const active = before.state.trip.active!;
    // Network time moved the wall clock 2 hours ahead of engine time during the drive.
    const offset = 2 * 3_600_000;
    before.send({ type: 'clock/sync', wallOffsetMs: offset, at: before.now });
    expect(before.lastEffects).toContainEqual({ type: 'persist' });
    const file = saved(before);
    expect(file.activeTrip).toMatchObject({
      startedAt: active.startedAt + offset,
      lastActivityAt: active.lastActivityAt + offset,
    });
    // The next start's engine time begins at its (right) wall clock, a minute later: resumed.
    const boot = before.now + offset + 60_000;
    const after = new Harness(makeConfig(), file, boot);
    expect(after.state.trip.active?.startedAt).toBe(active.startedAt + offset);
    after.obdConnected(boot);
    after.run(boot + 60_000, { speed: 60, rpm: 2000 }, 1000);
    expect(after.state.trip.current?.startedAt).toBe(T0 + 1000 + offset);
    expect(after.effects.filter((e) => e.type === 'trip/completed')).toEqual([]);
  });

  it('converts a saved trip with the offset the new state starts with', () => {
    const before = driveThenPowerDown();
    const file = saved(before);
    // Engine time of the new start runs 10 minutes behind its wall clock.
    const offset = 600_000;
    const wallBoot = before.now + 60_000;
    const state = createInitialState(makeConfig(), file, wallBoot - offset, {
      wallOffsetMs: offset,
    });
    expect(state.clock.wallOffsetMs).toBe(offset);
    expect(state.trip.active?.startedAt).toBe(T0 + 1000 - offset);
    expect(state.trip.current?.startedAt).toBe(T0 + 1000);
    expect(state.trip.endPending).toBe(false);
  });

  it('splits a resumed trip once network time shows the car was off for long (no real-time clock)', () => {
    const before = driveThenPowerDown();
    const lastActivity = before.state.trip.active?.lastActivityAt;
    // The Pi boots with the time fake-hwclock saved at shutdown: the break looks like a minute,
    // so the trip is continued …
    const boot = before.now + 60_000;
    const after = new Harness(makeConfig(), saved(before), boot);
    after.obdConnected(boot);
    after.run(boot + 60_000, { speed: 60, rpm: 2000 }, 1000);
    expect(after.effects.filter((e) => e.type === 'trip/completed')).toEqual([]);
    expect(after.state.trip.current?.distanceKm).toBeGreaterThan(20.9);
    // … until the phone's hotspot comes up and network time says it is a day later.
    const day = 24 * 3_600_000;
    after.send({ type: 'clock/sync', wallOffsetMs: day, at: after.now });
    expect(after.effects.filter((e) => e.type === 'trip/completed')).toEqual([
      {
        type: 'trip/completed',
        trip: expect.objectContaining({
          id: tripId(1, T0 + 1000),
          startedAt: T0 + 1000,
          endedAt: lastActivity,
          distanceKm: expect.closeTo(20, 0) as unknown,
        }) as unknown,
      },
    ]);
    expect(after.lastEffects).toContainEqual({ type: 'persist' });
    // Today's drive is a trip of its own, on the corrected clock.
    const active = after.state.trip.active;
    expect(active?.startedAt).toBeGreaterThanOrEqual(boot);
    expect(after.state.trip.current?.startedAt).toBe((active?.startedAt ?? 0) + day);
    expect(after.state.trip.current?.distanceKm).toBeLessThan(1.1);
    expect(extractActiveTrip(after.state)?.startedAt).toBe((active?.startedAt ?? 0) + day);
    // A later sync (drift) changes nothing more.
    after.send({ type: 'clock/sync', wallOffsetMs: day + 3000, at: after.now });
    expect(after.effects.filter((e) => e.type === 'trip/completed')).toHaveLength(1);
  });

  it('keeps a resumed trip together when network time shows the break was short after all', () => {
    const before = driveThenPowerDown();
    const boot = before.now + 60_000;
    const after = new Harness(makeConfig(), saved(before), boot);
    after.obdConnected(boot);
    after.run(boot + 60_000, { speed: 60, rpm: 2000 }, 1000);
    // The start-up clock was 2 minutes behind: a 3-minute break, shorter than the 5 it takes.
    after.send({ type: 'clock/sync', wallOffsetMs: 120_000, at: after.now });
    after.tick(after.now + 100);
    expect(after.effects.filter((e) => e.type === 'trip/completed')).toEqual([]);
    expect(after.state.trip.current?.startedAt).toBe(T0 + 1000 + 120_000);
    expect(after.state.trip.current?.distanceKm).toBeGreaterThan(20.9);
  });

  it('completes a trip saved "in the future" of an older boot clock (unclean power cut)', () => {
    const before = driveThenPowerDown();
    const lastActivity = before.state.trip.active?.lastActivityAt;
    // No real-time clock: the Pi boots with the time it saved an hour before the drive.
    const boot = T0 - 3_600_000;
    const after = new Harness(makeConfig(), saved(before), boot);
    expect(after.state.trip.endPending).toBe(true);
    after.tick(boot + 100);
    const completed = after.effects.filter((e) => e.type === 'trip/completed');
    expect(completed).toEqual([
      {
        type: 'trip/completed',
        trip: expect.objectContaining({
          id: tripId(1, T0 + 1000),
          startedAt: T0 + 1000,
          endedAt: lastActivity,
        }) as unknown,
      },
    ]);
    expect(after.state.trip.active).toBeNull();
    // Network time arrives later: nothing of the old trip is left to move.
    after.send({ type: 'clock/sync', wallOffsetMs: 3 * 3_600_000, at: boot + 5000 });
    expect(after.state.trip.lastCompleted?.startedAt).toBe(T0 + 1000);
  });

  describe('with an untrusted start-up clock (it went back; the HUD started from its saved time)', () => {
    /** Started a minute after the power-down by the HUD's clock, then a minute of driving. */
    function untrustedStart(): { h: Harness; boot: number; lastActivity: number | undefined } {
      const before = driveThenPowerDown();
      const lastActivity = before.state.trip.active?.lastActivityAt;
      const boot = before.now + 60_000;
      const h = new Harness(makeConfig(), saved(before), boot, { clockTrusted: false });
      h.obdConnected(boot);
      h.run(boot + 60_000, { speed: 60, rpm: 2000 }, 1000);
      expect(h.effects.filter((e) => e.type === 'trip/completed')).toEqual([]);
      expect(h.state.trip.current?.distanceKm).toBeGreaterThan(20.9);
      return { h, boot, lastActivity };
    }

    it('counts the break as long when the real time does not come in time', () => {
      const { h, boot, lastActivity } = untrustedStart();
      h.run(boot + RESUME_CONFIRM_MS, { speed: 60, rpm: 2000 }, 1000);
      expect(h.effects.filter((e) => e.type === 'trip/completed')).toEqual([
        {
          type: 'trip/completed',
          trip: expect.objectContaining({
            id: tripId(1, T0 + 1000),
            seq: 1,
            endedAt: lastActivity,
            distanceKm: expect.closeTo(20, 0) as unknown,
          }) as unknown,
        },
      ]);
      // Today's drive goes on as a trip of its own.
      expect(h.state.trip.current?.startedAt).toBeGreaterThanOrEqual(boot);
      expect(h.state.trip.current?.distanceKm).toBeCloseTo(3, 0);
    });

    it('keeps the trip together once the real time shows the break was short', () => {
      const { h, boot } = untrustedStart();
      // The phone's clock agrees with the HUD's: the break really was a minute.
      h.send({ type: 'clock/sync', wallOffsetMs: 0, trusted: true, at: h.now });
      h.run(boot + RESUME_CONFIRM_MS + 10_000, { speed: 60, rpm: 2000 }, 1000);
      expect(h.effects.filter((e) => e.type === 'trip/completed')).toEqual([]);
      expect(h.state.trip.current?.startedAt).toBe(T0 + 1000);
    });

    it('splits it at once when the real time shows a long break', () => {
      const { h } = untrustedStart();
      h.send({ type: 'clock/sync', wallOffsetMs: DAY, trusted: true, at: h.now });
      expect(h.effects.filter((e) => e.type === 'trip/completed')).toHaveLength(1);
      expect(h.state.trip.current?.distanceKm).toBeLessThan(1.1);
    });
  });

  it('numbers trips on from the persisted sequence number, and saves it', () => {
    const h = new Harness(makeConfig(), persisted({ tripSeq: 41 }));
    expect(extractPersisted(h.state).tripSeq).toBe(41);
    h.obdConnected(T0);
    h.run(T0 + 5 * 60_000, { speed: 60, rpm: 2000 }, 1000);
    h.send({ type: 'obd/link', state: 'error', at: h.now + 100 });
    h.idle(h.now + 6 * 60_000, 10_000);
    const trips = h.effects.filter((e) => e.type === 'trip/completed');
    expect(trips).toEqual([
      {
        type: 'trip/completed',
        trip: expect.objectContaining({ seq: 42, id: tripId(42, T0 + 1000) }) as unknown,
      },
    ]);
    expect(extractPersisted(h.state).tripSeq).toBe(42);
  });

  it('ignores a missing or corrupt saved trip', () => {
    for (const activeTrip of [undefined, null, { distanceKm: 'far' }]) {
      const h = new Harness(makeConfig(), { ...persisted(), activeTrip });
      expect(h.state.trip).toEqual({
        current: null,
        lastCompleted: null,
        completedCount: 0,
        active: null,
        endPending: false,
        resumed: null,
        lastSeq: 0,
      });
    }
  });
});

describe('the wall clock (clock/sync)', () => {
  const HOUR = 3_600_000;

  /** Driving with guidance, a speed limit (just refreshed), a trip in progress. */
  function drivingWithPhone(config = makeConfig()): Harness {
    const h = new Harness(config, persisted({ odometerKm: 1000 }));
    h.obdConnected(T0);
    h.phoneConnected(T0);
    h.send({ type: 'nav/update', nav: navInfo(), at: T0 + 100 });
    h.run(T0 + 60_000, { speed: 50, rpm: 2000 }, 500);
    h.send({ type: 'road/update', road: roadInfo(50), at: h.now });
    expect(h.state.context.context).toBe('city');
    return h;
  }

  function expectStillLive(h: Harness): void {
    const frame = h.frame();
    expect(widget(frame, 'speed')?.value).toBe(50);
    expect(widget(frame, 'speedLimit')?.value).toBe(50);
    expect(widget(frame, 'nav')).toBeDefined();
    expect(h.state.trip.completedCount).toBe(0);
    expect(h.state.context.context).toBe('city');
  }

  it.each([
    ['forward by days (network time on a Pi without a real-time clock)', 3 * 24 * HOUR],
    ['backward by minutes (a clock that ran fast)', -5 * 60_000],
  ])('keeps a drive going when the wall clock steps %s', (_, step) => {
    const h = drivingWithPhone();
    const tripStart = h.state.trip.active?.startedAt;
    h.send({ type: 'clock/sync', wallOffsetMs: step, at: h.now });
    expect(h.state.clock.wallOffsetMs).toBe(step);
    // Nothing measured in engine time noticed: data stays live, the trip goes on.
    h.run(h.now + 30_000, { speed: 50, rpm: 2000 }, 500);
    expectStillLive(h);
    expect(h.state.trip.active?.startedAt).toBe(tripStart);
    // Only what shows the absolute time moved.
    expect(widget(h.frame(), 'clock')?.epochMs).toBe(h.now + step);
    expect(h.state.trip.current?.startedAt).toBe((tripStart ?? 0) + step);
    // The trip ends normally, with wall-clock times.
    h.run(h.now + 5000, { speed: 0, rpm: 0 }, 500);
    h.send({ type: 'obd/link', state: 'error', at: h.now + 100 });
    h.idle(h.now + 6 * 60_000, 10_000);
    const trips = h.effects.filter((e) => e.type === 'trip/completed');
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({
      trip: { startedAt: (tripStart ?? 0) + step, id: tripId(1, (tripStart ?? 0) + step) },
    });
  });

  it('ignores a non-finite or unchanged offset', () => {
    const h = new Harness();
    h.send({ type: 'clock/sync', wallOffsetMs: 5000, at: T0 + 10 });
    const before = h.state;
    h.send({ type: 'clock/sync', wallOffsetMs: 5000, at: T0 + 10 });
    expect(h.state).toBe(before);
    h.send({ type: 'clock/sync', wallOffsetMs: Number.NaN, at: T0 + 10 });
    expect(h.state).toBe(before);
    expect(h.lastEffects).toEqual([]);
  });

  it('boots with a wrong clock, then follows network time for dates, the sun and the ETA', () => {
    // The Pi boots a month behind (the time it last saved), at night by its own clock.
    const behind = 30 * 24 * HOUR + 14 * HOUR;
    const config = makeConfig({
      sensors: { fallbackLocation: { lat: 48.2, lon: 16.4 } },
      display: {
        layout: {
          preset: 'custom',
          widgets: [
            { id: 'eta', zone: 'top-left', contexts: ['parked'] },
            { id: 'clock', zone: 'bottom-right', contexts: ['parked'] },
          ],
        },
      },
    });
    const h = new Harness(
      config,
      persisted({
        maintenanceRecords: [{ itemId: 'brake-fluid', odometerKm: null, at: T0 - 740 * DAY }],
      }),
      T0 - behind,
    );
    const brake = () => h.state.maintenance.status.find((s) => s.itemId === 'brake-fluid');
    expect(brake()?.status).toBe('due-soon'); // 730-day interval: 20 days left by its clock
    h.tick(T0 - behind + 100);
    expect(h.state.env.brightness.night).toBe(true);
    h.phoneConnected(T0 - behind + 200);
    const eta = T0 + 25 * 60_000; // the phone's ETA is wall-clock time
    h.send({
      type: 'nav/update',
      nav: navInfo({ etaEpochMs: eta, remainingSeconds: null }),
      at: T0 - behind + 300,
    });

    // Network time: the wall clock is really a month and 14 hours ahead.
    h.send({ type: 'clock/sync', wallOffsetMs: behind, at: T0 - behind + 400 });
    expect(brake()).toMatchObject({ status: 'overdue', remainingDays: -10 });
    expect(h.lastEffects).toContainEqual({
      type: 'maintenance/due',
      items: [expect.objectContaining({ itemId: 'brake-fluid', status: 'overdue' }) as unknown],
    });
    expect(h.state.env.brightness.night).toBe(false); // midday in Vienna
    const frame = h.frame();
    expect(widget(frame, 'clock')?.epochMs).toBe(T0 + 400);
    expect(widget(frame, 'eta')?.remainingMinutes).toBe(25);
    // A service recorded now is dated on the wall clock.
    h.send({ type: 'maintenance/done', itemId: 'brake-fluid', odometerKm: null, at: h.now + 600 });
    expect(h.state.maintenance.records).toEqual([
      { itemId: 'brake-fluid', odometerKm: null, at: T0 + 1000 },
    ]);
    expect(brake()?.status).toBe('ok');
  });

  describe('trust (a start-up clock that went back)', () => {
    const withClock = (): ReturnType<typeof makeConfig> =>
      makeConfig({
        display: {
          layout: {
            preset: 'custom',
            widgets: [{ id: 'clock', zone: 'bottom-right', contexts: ['parked'] }],
          },
        },
      });

    it('hides the clock until the real time arrives', () => {
      const h = new Harness(withClock(), persisted(), T0, { clockTrusted: false });
      expect(h.state.clock).toEqual({ wallOffsetMs: 0, trusted: false });
      expect(widget(h.frame(), 'clock')).toBeUndefined();
      // An offset alone (say, a step of the system clock) does not make it trusted.
      h.send({ type: 'clock/sync', wallOffsetMs: 1000, at: T0 + 10 });
      expect(h.state.clock).toEqual({ wallOffsetMs: 1000, trusted: false });
      expect(widget(h.frame(), 'clock')).toBeUndefined();
      // The phone's time (or network time) does, even when it agrees with the offset.
      h.send({ type: 'clock/sync', wallOffsetMs: 1000, trusted: true, at: T0 + 20 });
      expect(h.state.clock).toEqual({ wallOffsetMs: 1000, trusted: true });
      expect(widget(h.frame(), 'clock')?.epochMs).toBe(T0 + 1020);
      const before = h.state;
      h.send({ type: 'clock/sync', wallOffsetMs: 1000, trusted: true, at: T0 + 20 });
      expect(h.state).toBe(before);
    });

    it('dates a service recorded meanwhile with the real time once it arrives', () => {
      const h = new Harness(makeConfig(), persisted(), T0, { clockTrusted: false });
      h.send({ type: 'maintenance/done', itemId: 'oil', odometerKm: 41_000, at: T0 + 1000 });
      expect(h.state.maintenance.records).toEqual([
        { itemId: 'oil', odometerKm: 41_000, at: T0 + 1000 },
      ]);
      // The phone says the HUD's clock was 40 days behind.
      h.send({ type: 'clock/sync', wallOffsetMs: 40 * DAY, trusted: true, at: T0 + 5000 });
      expect(h.state.maintenance.records).toEqual([
        { itemId: 'oil', odometerKm: 41_000, at: T0 + 1000 + 40 * DAY },
      ]);
      expect(h.state.maintenance.undated).toEqual([]);
      expect(h.lastEffects).toContainEqual({ type: 'persist' });
      expect(extractPersisted(h.state).maintenanceRecords[0]?.at).toBe(T0 + 1000 + 40 * DAY);
    });

    it('dates a service recorded while trusted with the clock at once', () => {
      const h = new Harness();
      h.send({ type: 'maintenance/done', itemId: 'oil', odometerKm: null, at: T0 + 1000 });
      expect(h.state.maintenance.undated).toEqual([]);
    });
  });

  it('asks for a write when the clock moves while a trip is in progress', () => {
    const h = new Harness();
    h.send({ type: 'clock/sync', wallOffsetMs: HOUR, at: T0 + 10 });
    expect(h.lastEffects).toEqual([]);
    h.obdConnected(T0 + 20);
    h.run(T0 + 5000, { speed: 30, rpm: 1500 });
    expect(h.state.trip.active).not.toBeNull();
    h.send({ type: 'clock/sync', wallOffsetMs: 2 * HOUR, at: h.now });
    expect(h.lastEffects).toEqual([{ type: 'persist' }]);
    expect(extractActiveTrip(h.state)?.startedAt).toBe(T0 + 220 + 2 * HOUR);
  });
});

describe('the dashboard on request', () => {
  /** Stopped at a red light with the engine running (not parked for 2 minutes). */
  function stopped(config = makeConfig()): Harness {
    const h = driving(40, config);
    h.run(h.now + 6000, { speed: 0, rpm: 800 }, 500);
    expect(h.state.context.context).toBe('stopped');
    expect(h.frame().diagnostics).toBeNull();
    return h;
  }

  it('opens at once with next-page or prev-page while stopped, on the current page', () => {
    for (const action of ['next-page', 'prev-page'] as const) {
      const h = stopped();
      h.input(action);
      expect(h.state.ui).toMatchObject({ dashboardRequested: true, page: 0 });
      const frame = h.frame();
      expect(frame.context).toBe('stopped');
      expect(frame.diagnostics?.page).toBe('overview');
    }
  });

  it('then flips pages; secondary closes it', () => {
    const h = stopped();
    h.input('next-page');
    h.input('next-page');
    expect(h.frame().diagnostics?.page).toBe('engine');
    h.input('prev-page');
    expect(h.frame().diagnostics?.page).toBe('overview');
    h.input('secondary');
    expect(h.state.ui.dashboardRequested).toBe(false);
    expect(h.frame().diagnostics).toBeNull();
    expect(h.frame().context).toBe('stopped');
  });

  it('closes by itself as soon as the car moves, and never opens while moving', () => {
    const h = stopped();
    h.input('next-page');
    h.run(h.now + 400, { speed: 3, rpm: 1200 }, 200); // creeping: still stopped
    expect(h.frame().diagnostics).not.toBeNull();
    h.run(h.now + 2000, { speed: 15, rpm: 1500 }, 200);
    expect(h.state.context.context).toBe('city');
    expect(h.state.ui.dashboardRequested).toBe(false);
    expect(h.frame().diagnostics).toBeNull();
    h.input('next-page');
    expect(h.state.ui.dashboardRequested).toBe(false);
    expect(h.frame().diagnostics).toBeNull();
    // Stopping again does not bring it back by itself.
    h.run(h.now + 6000, { speed: 0, rpm: 800 }, 500);
    expect(h.state.context.context).toBe('stopped');
    expect(h.frame().diagnostics).toBeNull();
  });

  it('hands over to the parked dashboard, which secondary does not close', () => {
    const h = stopped(makeConfig({ display: { context: { parkedAfterMs: 20_000 } } }));
    h.input('next-page');
    h.input('next-page');
    h.run(h.now + 25_000, { speed: 0, rpm: 800 }, 500);
    expect(h.state.context.context).toBe('parked');
    expect(h.state.ui.dashboardRequested).toBe(false);
    expect(h.frame().diagnostics?.page).toBe('engine');
    h.input('secondary');
    expect(h.frame().diagnostics?.page).toBe('engine');
  });

  it('lets secondary decline a ringing call first, and closes before dismissing a toast', () => {
    const h = stopped();
    h.phoneConnected();
    h.input('next-page');
    h.send({ type: 'call/update', call: callInfo(), at: h.now + 10 });
    h.input('secondary');
    expect(h.lastEffects).toEqual([
      { type: 'phone/call-action', callId: 'call-1', action: 'decline' },
    ]);
    expect(h.state.ui.dashboardRequested).toBe(true);
    h.send({ type: 'call/update', call: null, at: h.now + 10 });
    h.send({ type: 'message/received', message: message('m1'), at: h.now + 10 });
    h.input('secondary');
    expect(h.state.ui.dashboardRequested).toBe(false);
    expect(h.frame().toast?.kind).toBe('message');
    h.input('secondary');
    expect(h.frame().toast).toBeNull();
  });
});

describe('reduce — general', () => {
  it('never moves time backwards', () => {
    const h = new Harness();
    h.tick(T0 + 5000);
    h.send({ type: 'sensor/light', lux: 500, at: T0 + 1000 });
    expect(h.state.now).toBe(T0 + 5000);
    expect(h.state.env.luxAt).toBe(T0 + 5000);
  });

  it('ignores events with a non-finite timestamp for the clock', () => {
    const h = new Harness();
    h.send({ type: 'sensor/light', lux: 500, at: Number.NaN });
    expect(h.state.now).toBe(T0);
    expect(h.state.env.lux).toBe(500);
  });

  it('ignores unknown event types from a newer peer', () => {
    const h = new Harness();
    const before = h.state;
    const next = reduce(before, { type: 'future/thing', at: T0 } as unknown as HudEvent, h.config);
    expect(next).toBe(before);
  });

  it('never mutates its input (frozen state)', () => {
    const config = makeConfig();
    const state = freezeDeep(createInitialState(config, EMPTY_PERSISTED_STATE, T0));
    const snapshot = JSON.stringify(state);
    reduce(state, samplesEvent(T0 + 100, { speed: 40, rpm: 1800 }), config);
    reduce(state, { type: 'input', action: 'next-page', at: T0 + 100 }, config);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('obd/samples', () => {
  it('stores valid samples stamped with the event time and ignores junk', () => {
    const h = new Harness();
    h.send({
      type: 'obd/samples',
      at: T0 + 100,
      samples: [
        { signal: 'coolantTemp', value: 90 },
        { signal: 'rpm', value: Number.NaN },
        { signal: 'bogus' as 'rpm', value: 3 },
      ],
    });
    expect(h.state.vehicle.signals).toEqual({ coolantTemp: { value: 90, at: T0 + 100 } });
  });

  it('leaves the state alone for a batch without usable samples', () => {
    const h = new Harness();
    const before = h.state;
    const next = reduce(before, samplesEvent(T0, { rpm: Number.NaN }), h.config);
    expect(next).toBe(before);
  });

  it('integrates distance trapezoidally between speed samples', () => {
    const h = new Harness();
    h.samples(T0, { speed: 0 });
    h.samples(T0 + 1000, { speed: 36 }); // mean 18 km/h for 1 s = 5 m
    h.samples(T0 + 2000, { speed: 36 }); // 10 m
    h.samples(T0 + 2500, { coolantTemp: 80 }); // no speed: no integration
    expect(h.state.odometer.integratedKm).toBeCloseTo(0.015, 9);
    expect(h.state.odometer.lastSampleAt).toBe(T0 + 2000);
    expect(h.state.odometer.lastSpeedKph).toBe(36);
  });

  it('does not bridge gaps longer than 5 s', () => {
    const h = new Harness();
    h.samples(T0, { speed: 100 });
    h.samples(T0 + 6000, { speed: 100 });
    expect(h.state.odometer.integratedKm).toBe(0);
    h.samples(T0 + 7000, { speed: 100 });
    expect(h.state.odometer.integratedKm).toBeCloseTo(100 / 3600, 9);
  });

  it('ignores negative speeds for integration', () => {
    const h = new Harness();
    h.samples(T0, { speed: 50 });
    h.samples(T0 + 1000, { speed: -5 });
    expect(h.state.odometer.integratedKm).toBe(0);
    expect(h.state.odometer.lastSampleAt).toBe(T0);
  });

  it('estimates the odometer from the persisted baseline plus integrated distance', () => {
    const h = new Harness(makeConfig(), persisted({ odometerKm: 1000 }));
    h.samples(T0, { speed: 72 });
    h.samples(T0 + 1000, { speed: 72 }); // 20 m
    expect(h.state.odometer.source).toBe('estimated');
    expect(h.state.odometer.km).toBeCloseTo(1000.02, 9);
  });

  it('snaps to the odometer PID once confirmed, extrapolates while it is fresh, then estimates', () => {
    const h = new Harness(makeConfig(), persisted({ odometerKm: 1000 }));
    h.samples(T0, { speed: 72, odometer: 52_000.4 });
    // Far from the known value: taken only once the next reading confirms it.
    expect(h.state.odometer).toMatchObject({ km: 1000, source: 'estimated' });
    h.samples(T0 + 1000, { speed: 72, odometer: 52_000.4 });
    expect(h.state.odometer).toMatchObject({ km: 52_000.4, source: 'pid' });
    h.samples(T0 + 2000, { speed: 72 });
    expect(h.state.odometer.source).toBe('pid');
    expect(h.state.odometer.km).toBeCloseTo(52_000.42, 9);
    // The PID goes stale after 120 s without readings.
    h.samples(T0 + 122_000, { speed: 72 });
    h.samples(T0 + 123_000, { speed: 72 });
    expect(h.state.odometer.source).toBe('estimated');
    expect(h.state.odometer.km).toBeCloseTo(52_000.44, 9);
  });

  it('takes a PID reading that continues the known odometer at once', () => {
    const h = new Harness(makeConfig(), persisted({ odometerKm: 48_213.4 }));
    h.samples(T0, { speed: 50, odometer: 48_213.5 });
    expect(h.state.odometer).toMatchObject({ km: 48_213.5, source: 'pid' });
  });

  it('ignores implausible odometer readings (regression: core-7)', () => {
    const config = makeConfig();
    const h = new Harness(
      config,
      persisted({
        odometerKm: 48_213.4,
        maintenanceRecords: [{ itemId: 'oil', odometerKm: 45_000, at: T0 - DAY }],
      }),
    );
    const oil = () => h.state.maintenance.status.find((i) => i.itemId === 'oil')?.remainingKm;
    const remaining = oil();
    // An ECU that lists PID 0xA6 but answers 0, then a bit error, then a garbled value.
    for (const [i, bad] of [0, 48_213.4 + 6553.6, 1234.5].entries()) {
      h.samples(T0 + i * 10_000, { odometer: bad });
      expect(h.state.odometer).toMatchObject({ km: 48_213.4, source: 'estimated' });
    }
    expect(h.effects).toEqual([]); // nothing to persist
    expect(extractPersisted(h.state).odometerKm).toBe(48_213.4);
    h.tick(T0 + 120_000);
    expect(oil()).toBe(remaining);
    // A later service without an explicit reading uses the real odometer.
    h.send({ type: 'maintenance/done', itemId: 'oil', odometerKm: null, at: T0 + 121_000 });
    expect(h.state.maintenance.records.at(-1)).toMatchObject({ odometerKm: 48_213.4 });
    // The next good reading is taken.
    h.samples(T0 + 130_000, { odometer: 48_213.5 });
    expect(h.state.odometer).toMatchObject({ km: 48_213.5, source: 'pid' });
  });

  it('keeps the odometer unknown without a baseline or PID', () => {
    const h = new Harness();
    h.samples(T0, { speed: 72 });
    h.samples(T0 + 1000, { speed: 72 });
    expect(h.state.odometer.km).toBeNull();
    expect(h.state.odometer.integratedKm).toBeGreaterThan(0);
  });

  it('advances context, gear, fuel and trip from fresh values', () => {
    const config = makeConfig({
      vehicle: { transmission: 'manual', gearRatiosRpmPerKph: [120, 70, 48, 36, 29] },
    });
    const h = new Harness(config);
    h.obdConnected(T0);
    h.run(T0 + 3000, { speed: 50, rpm: 2400, maf: 12, fuelLevel: 60 });
    expect(h.state.context.context).toBe('city');
    expect(h.state.gear.estimate.gear).toBe(3);
    expect(h.state.fuel.readings.rateSource).toBe('maf');
    expect(h.state.fuel.readings.levelPct).toBeCloseTo(60);
    expect(h.state.trip.current).not.toBeNull();
    expect(h.state.trip.current?.distanceKm).toBeGreaterThan(0.03);
  });

  it('shows the next gear one K-line cycle after a shift (speed and rpm read 250 ms apart)', () => {
    const config = makeConfig({
      vehicle: { transmission: 'manual', gearRatiosRpmPerKph: [120, 70, 48, 36, 29] },
    });
    const h = new Harness(config);
    h.obdConnected(T0);
    // One PID per request: rpm, then speed 250 ms later, a cycle every 1.25 s.
    const cycle = (at: number, kph: number, ratio: number): void => {
      h.samples(at, { rpm: kph * ratio });
      h.samples(at + 250, { speed: kph });
    };
    cycle(T0, 30, 70);
    cycle(T0 + 1250, 31, 70);
    expect(h.state.gear.estimate.gear).toBe(2);
    cycle(T0 + 2500, 33, 48); // shifted up: shown at the speed reading of this cycle
    expect(h.state.gear.estimate.gear).toBe(3);
  });

  it('drops readings a signal cannot have, so they read as missing', () => {
    const h = new Harness();
    h.obdConnected(T0);
    h.samples(T0 + 100, { coolantTemp: 90, rpm: 800 });
    expect(h.state.vehicle.signals.coolantTemp?.value).toBe(90);
    // A sensor fault (0xFF: 215 °C) is no reading: no OVERHEATING, and not the old 90 °C either.
    h.samples(T0 + 200, { coolantTemp: 215, rpm: 16_383.75 });
    expect(h.state.vehicle.signals.coolantTemp).toBeUndefined();
    expect(h.state.vehicle.signals.rpm).toBeUndefined();
    expect(h.state.alerts.filter((a) => a.kind === 'coolant')).toEqual([]);
    // A real overheating reading still raises the alert.
    h.samples(T0 + 300, { coolantTemp: 135 });
    expect(h.state.alerts.find((a) => a.kind === 'coolant')?.severity).toBe('critical');
  });

  it('treats the engine as running only from 300 rpm', () => {
    const h = new Harness();
    h.obdConnected(T0);
    h.samples(T0 + 100, { rpm: 250, speed: 0 });
    expect(h.state.trip.current).toBeNull();
    h.samples(T0 + 200, { rpm: 800, speed: 0 });
    expect(h.state.trip.current).not.toBeNull();
  });
});

describe('tick', () => {
  it('keeps driving when the adapter dies at speed (regression: core-4)', () => {
    const h = driving(120);
    h.send({ type: 'obd/link', state: 'error', message: 'Bluetooth link lost', at: h.now });
    h.idle(h.now + 10 * 60_000);
    expect(h.state.context.context).toBe('city');
    expect(h.frame().diagnostics).toBeNull();
    // Back with a reading of standstill: the normal parking rules apply again.
    h.obdConnected(h.now + 1000);
    h.run(h.now + 5000, { speed: 0, rpm: 800 });
    expect(h.state.context.context).toBe('stopped');
  });

  it('parks when the ECU falls silent at a standstill (ignition off)', () => {
    const h = driving(40);
    h.run(h.now + 3000, { speed: 0, rpm: 750 });
    expect(h.state.context.context).toBe('stopped');
    // Speed is known until it goes stale, then the grace runs.
    const unknownFrom = h.now + staleLimitMs('speed');
    h.idle(unknownFrom + DATA_GAP_GRACE_MS - 1000);
    expect(h.state.context.context).toBe('stopped');
    h.idle(unknownFrom + DATA_GAP_GRACE_MS);
    expect(h.state.context.context).toBe('parked');
  });

  it('does not open the dashboard during a long start-stop red light (regression: core-12)', () => {
    const h = driving(40);
    // The engine stopped by start-stop for nearly 3 minutes (longer than parkedAfterMs), then
    // restarting as the light turns green: never parked, not even when the engine restarts.
    h.run(h.now + 170_000, { speed: 0, rpm: 0 }, 500);
    expect(h.state.context.context).toBe('stopped');
    expect(h.frame().diagnostics).toBeNull();
    h.run(h.now + 3000, { speed: 0, rpm: 900 }, 500);
    expect(h.state.context.context).toBe('stopped');
    expect(h.frame().diagnostics).toBeNull();
  });

  it('brings the driving layout back within a second of creeping off the parked dashboard', () => {
    // Idling at a standstill in a jam for over parkedAfterMs parks the HUD …
    const h = driving(40);
    h.run(h.now + 130_000, { speed: 0, rpm: 800 }, 500);
    expect(h.state.context.context).toBe('parked');
    expect(isDashboardShown(h.state)).toBe(true);
    // … and the jam creeps on at 3 km/h: the speed is back a second after the first reading.
    const firstCreepAt = h.now + 200;
    h.run(firstCreepAt + UNPARK_CREEP_MS, { speed: 3, rpm: 900 }, 200);
    expect(h.state.context.context).toBe('stopped');
    expect(isDashboardShown(h.state)).toBe(false);
    const frame = h.frame();
    expect(frame.diagnostics).toBeNull();
    expect(widget(frame, 'speed')).toBeDefined();
    // A minute of creeping never parks again.
    h.run(h.now + 60_000, { speed: 3, rpm: 900 }, 500);
    expect(h.state.context.context).toBe('stopped');
    expect(isDashboardShown(h.state)).toBe(false);
  });

  it('does not park in a jam while the phone guides along a route', () => {
    const h = driving(40);
    h.phoneConnected();
    h.send({ type: 'nav/update', nav: navInfo(), at: h.now });
    h.run(h.now + 300_000, { speed: 0, rpm: 800 }, 1000);
    expect(h.state.context.context).toBe('stopped');
    expect(h.frame().diagnostics).toBeNull();
    // Guidance ends (arrived): idling parks as before.
    h.send({ type: 'nav/clear', at: h.now });
    h.run(h.now + 1000, { speed: 0, rpm: 800 }, 1000);
    expect(h.state.context.context).toBe('parked');
  });

  it('parks as before when the engine is switched off and the ECU falls silent', () => {
    const h = driving(40);
    h.phoneConnected();
    h.send({ type: 'nav/update', nav: navInfo(), at: h.now });
    h.run(h.now + 3000, { speed: 0, rpm: 750 });
    h.idle(h.now + staleLimitMs('speed') + DATA_GAP_GRACE_MS);
    expect(h.state.context.context).toBe('parked');
    expect(isDashboardShown(h.state)).toBe(true);
  });

  it('does not park on a 2.5 s OBD data gap at a red light (regression: core-11)', () => {
    const h = driving(40);
    h.run(h.now + 3000, { speed: 0, rpm: 750 });
    expect(h.state.context.context).toBe('stopped');
    h.idle(h.now + 2500, 100);
    h.run(h.now + 20_000, { speed: 0, rpm: 750 });
    expect(h.state.context.context).toBe('stopped');
    expect(h.frame().diagnostics).toBeNull();
  });

  it('drops the gear estimate once its inputs go stale', () => {
    const config = makeConfig({
      vehicle: { transmission: 'manual', gearRatiosRpmPerKph: [120, 70, 48, 36, 29] },
    });
    const h = new Harness(config);
    h.obdConnected(T0);
    h.run(T0 + 2000, { speed: 50, rpm: 2400 });
    expect(h.state.gear.estimate.gear).toBe(3);
    h.idle(h.now + 3000);
    expect(h.state.gear.estimate.gear).toBeNull();
  });

  it('drives brightness from a fresh light sensor and falls back to the sun', () => {
    const config = makeConfig({ sensors: { fallbackLocation: { lat: 48.1, lon: 11.6 } } });
    const h = new Harness(config);
    h.send({ type: 'sensor/light', lux: 1, at: T0 });
    h.tick(T0 + 100);
    expect(h.state.env.brightness.level).toBeCloseTo(0.08);
    expect(h.state.env.brightness.night).toBe(true);
    // Six seconds later the reading is stale: noon in Munich → daytime sun fallback.
    h.tick(T0 + 6000);
    h.idle(T0 + 30_000);
    expect(h.state.env.brightness.night).toBe(false);
    expect(h.state.env.brightness.target).toBe(1);
  });

  it('prefers the phone location over the fallback location for the sun', () => {
    const config = makeConfig({
      display: { brightness: { nightMode: 'sun' } },
      sensors: { fallbackLocation: { lat: 48.1, lon: 11.6 } },
    });
    const h = new Harness(config);
    h.tick(T0 + 1000);
    expect(h.state.env.brightness.night).toBe(false); // noon in Munich
    // Honolulu at 12:00 UTC is 02:00 local.
    h.send({ type: 'location/update', lat: 21.3, lon: -157.9, accuracyM: 10, at: T0 + 2000 });
    h.tick(T0 + 3000);
    expect(h.state.env.brightness.night).toBe(true);
  });

  describe('night mode without a light sensor or a phone', () => {
    const NO_LOCATION_ZONE = (utcOffsetMin: number) => ({
      name: 'Etc/GMT-10',
      utcOffsetMin,
      location: null,
    });

    it('goes to night by the local time (nightHours) within one tick', () => {
      // 12:00 UTC is 22:00 at UTC+10; the zone has no location, so only the clock is known.
      const h = new Harness();
      expect(h.state.env.brightness.level).toBe(1);
      h.send({ type: 'clock/zone', zone: NO_LOCATION_ZONE(600), at: T0 });
      h.tick(T0 + 100);
      expect(h.state.env.brightness.night).toBe(true);
      expect(h.state.env.brightness.level).toBeLessThanOrEqual(0.2);
      expect(h.frame().theme).toEqual({ night: true, brightness: h.state.env.brightness.level });
      // 12:00 at UTC+0: daytime.
      const noon = new Harness();
      noon.send({ type: 'clock/zone', zone: NO_LOCATION_ZONE(0), at: T0 });
      expect(noon.state.env.brightness).toMatchObject({ night: false, level: 1 });
    });

    it('follows the sun at the time zone’s principal city', () => {
      // 22:00 UTC is midnight in Berlin (summer time).
      const h = new Harness(makeConfig(), persisted(), T0 + 10 * 3_600_000);
      h.send({
        type: 'clock/zone',
        zone: { name: 'Europe/Berlin', utcOffsetMin: 120, location: { lat: 52.5, lon: 13.4 } },
        at: h.now,
      });
      expect(h.state.env.brightness.night).toBe(true);
      expect(h.state.env.timeZone?.name).toBe('Europe/Berlin');
    });

    it('ignores a time zone report with an impossible offset', () => {
      const h = new Harness();
      const before = h.state;
      h.send({ type: 'clock/zone', zone: NO_LOCATION_ZONE(Number.NaN), at: T0 });
      h.send({ type: 'clock/zone', zone: NO_LOCATION_ZONE(24 * 60), at: T0 });
      expect(h.state.env).toBe(before.env);
    });

    it('remembers the phone’s location, rounded, across a restart', () => {
      const h = new Harness();
      // Honolulu: 12:00 UTC is 02:00 local.
      h.send({ type: 'location/update', lat: 21.3069, lon: -157.8583, accuracyM: 10, at: T0 });
      expect(h.state.env.lastLocation).toEqual({ lat: 21.3, lon: -157.9 });
      expect(h.lastEffects).toEqual([{ type: 'persist' }]);
      // Moving within the same rounded cell asks for no write.
      h.send({ type: 'location/update', lat: 21.31, lon: -157.86, accuracyM: 10, at: T0 + 1000 });
      expect(h.lastEffects).toEqual([]);
      const saved = extractPersisted(h.state);
      expect(saved.lastLocation).toEqual({ lat: 21.3, lon: -157.9 });

      // Next start, before the phone connects (and with a Berlin system time zone, which
      // the remembered location beats): night in Honolulu from the first tick.
      const next = new Harness(makeConfig(), persisted(saved), T0 + 60_000);
      next.send({
        type: 'clock/zone',
        zone: { name: 'Europe/Berlin', utcOffsetMin: 120, location: { lat: 52.5, lon: 13.4 } },
        at: next.now,
      });
      next.tick(next.now + 100);
      expect(next.state.env.brightness.night).toBe(true);
    });

    it('asks for one write, not one a second, while GPS jitters across a rounding boundary', () => {
      // Waiting with the phone on the 52.45° N line (midway between 52.4 and 52.5): a metre of
      // GPS noise each second must not rewrite state.json every time the fix crosses it.
      const h = new Harness();
      let writes = 0;
      for (let i = 0; i < 120; i++) {
        const lat = 52.45 + (i % 2 === 0 ? 1e-5 : -1e-5);
        h.send({ type: 'location/update', lat, lon: 13.4, accuracyM: 5, at: T0 + i * 1000 });
        if (h.lastEffects.some((e) => e.type === 'persist')) writes++;
      }
      expect(writes).toBe(1);
      const kept = h.state.env.lastLocation;
      expect(kept === null ? null : Math.abs(kept.lat - 52.45)).toBeCloseTo(0.05, 9);
      // Driving on, the remembered location follows (and is written) once it is clearly off.
      h.send({ type: 'location/update', lat: 52.63, lon: 13.4, accuracyM: 5, at: T0 + 200_000 });
      expect(h.state.env.lastLocation).toEqual({ lat: 52.6, lon: 13.4 });
      expect(h.lastEffects).toEqual([{ type: 'persist' }]);
    });

    it('ranks the configured fallback location above the time zone’s city', () => {
      // At 12:00 UTC it is night in Honolulu (fallback) and day in Berlin (time zone).
      const h = new Harness(
        makeConfig({ sensors: { fallbackLocation: { lat: 21.3, lon: -157.9 } } }),
      );
      h.send({
        type: 'clock/zone',
        zone: { name: 'Europe/Berlin', utcOffsetMin: 120, location: { lat: 52.5, lon: 13.4 } },
        at: T0,
      });
      expect(h.state.env.brightness.night).toBe(true);
    });

    it('drops an invalid persisted location', () => {
      const h = new Harness(makeConfig(), {
        ...persisted(),
        lastLocation: { lat: 95, lon: 0 },
      });
      expect(h.state.env.lastLocation).toBeNull();
      expect(extractPersisted(h.state).lastLocation).toBeNull();
    });
  });

  it('ends the trip after the engine has been off long enough', () => {
    const h = driving(60);
    h.run(h.now + 20_000, { speed: 60, rpm: 2200 });
    h.run(h.now + 2000, { speed: 0, rpm: 0 });
    expect(h.state.trip.completedCount).toBe(0);
    h.idle(h.now + h.config.trip.endAfterEngineOffMs + 2000);
    expect(h.state.trip.completedCount).toBe(1);
    expect(h.state.trip.current).toBeNull();
    expect(h.state.trip.lastCompleted?.distanceKm).toBeGreaterThan(0.3);
  });

  it('recomputes maintenance status at most once a minute', () => {
    const h = new Harness(
      makeConfig(),
      persisted({
        odometerKm: 1000,
        maintenanceRecords: [{ itemId: 'brake-fluid', odometerKm: null, at: T0 - 700 * DAY }],
      }),
    );
    const checked = h.state.maintenance.checkedAt;
    h.tick(T0 + 30_000);
    expect(h.state.maintenance.checkedAt).toBe(checked);
    h.tick(T0 + 60_000);
    expect(h.state.maintenance.checkedAt).toBe(T0 + 60_000);
  });

  it('expires messages after a minute', () => {
    const h = new Harness();
    h.send({ type: 'message/received', message: message('m1'), at: T0 });
    h.tick(T0 + MESSAGE_TTL_MS);
    expect(h.state.messages).toHaveLength(1);
    h.tick(T0 + MESSAGE_TTL_MS + 1);
    expect(h.state.messages).toHaveLength(0);
  });

  it('clears an ended call 2 s after it ended', () => {
    const h = new Harness();
    h.phoneConnected(T0);
    h.send({ type: 'call/update', call: callInfo({ state: 'ended' }), at: T0 + 1000 });
    h.tick(T0 + 1000 + ENDED_CALL_SHOW_MS - 1);
    expect(h.state.call?.state).toBe('ended');
    h.tick(T0 + 1000 + ENDED_CALL_SHOW_MS);
    expect(h.state.call).toBeNull();
  });

  it('expires hazards not refreshed for 2 minutes', () => {
    const h = new Harness();
    h.phoneConnected(T0);
    h.send({ type: 'hazards/update', hazards: [hazard('h1', 800)], at: T0 });
    h.tick(T0 + HAZARD_TTL_MS);
    expect(h.state.hazards).toHaveLength(1);
    h.tick(T0 + HAZARD_TTL_MS + 1);
    expect(h.state.hazards).toHaveLength(0);
  });

  it('drops hazards once they are more than 50 m behind', () => {
    const h = driving(72); // 20 m/s
    h.phoneConnected(h.now);
    h.send({
      type: 'hazards/update',
      hazards: [hazard('near', 60), hazard('far', 900)],
      at: h.now,
    });
    h.run(h.now + 5000, { speed: 72, rpm: 2000 }); // 100 m
    expect(h.state.hazards.map((t) => t.hazard.id)).toEqual(['near', 'far']);
    h.run(h.now + 1000, { speed: 72, rpm: 2000 }); // 120 m: 60 m past "near"
    expect(h.state.hazards.map((t) => t.hazard.id)).toEqual(['far']);
  });

  it('clears phone data 30 s after the phone disconnects', () => {
    const h = new Harness();
    h.phoneConnected(T0);
    h.send({ type: 'nav/update', nav: navInfo(), at: T0 });
    h.send({ type: 'road/update', road: roadInfo(50), at: T0 });
    h.send({ type: 'hazards/update', hazards: [hazard('h1', 500)], at: T0 });
    h.send({ type: 'media/update', media: mediaInfo(), at: T0 });
    h.send({ type: 'call/update', call: callInfo({ state: 'active' }), at: T0 });
    h.send({ type: 'phone/link', connected: false, at: T0 + 1000 });
    h.tick(T0 + 1000 + PHONE_DATA_GRACE_MS - 1);
    expect(h.state.nav).not.toBeNull();
    expect(h.state.road).not.toBeNull();
    h.tick(T0 + 1000 + PHONE_DATA_GRACE_MS);
    expect(h.state.nav).toBeNull();
    expect(h.state.road).toBeNull();
    expect(h.state.hazards).toEqual([]);
    expect(h.state.media).toBeNull();
    expect(h.state.call).toBeNull();
  });

  it('drops a ringing or dialing call at once when the phone disconnects (regression: core-6)', () => {
    for (const state of ['ringing', 'dialing'] as const) {
      const h = new Harness();
      h.phoneConnected(T0);
      h.send({ type: 'call/update', call: callInfo({ state }), at: T0 });
      h.send({ type: 'phone/link', connected: false, at: T0 + 1000 });
      expect(h.state.call).toBeNull();
      expect(h.frame().call).toBeNull();
    }
    // An answered call keeps its card through the grace period, but without controls.
    const h = new Harness();
    h.phoneConnected(T0);
    h.send({ type: 'call/update', call: callInfo({ state: 'active' }), at: T0 });
    h.send({ type: 'phone/link', connected: false, at: T0 + 1000 });
    h.tick(T0 + 10_000);
    expect(h.frame().call).toMatchObject({ state: 'active', canAccept: false, canDecline: false });
  });

  it("drops the previous phone's route, road, call and media when another phone takes over", () => {
    const h = new Harness();
    h.phoneConnected(T0); // "Pixel"
    h.send({ type: 'nav/update', nav: navInfo(), at: T0 });
    h.send({ type: 'road/update', road: roadInfo(50), at: T0 });
    h.send({ type: 'hazards/update', hazards: [hazard('h1', 500)], at: T0 });
    h.send({ type: 'media/update', media: mediaInfo(), at: T0 });
    h.send({ type: 'call/update', call: callInfo({ state: 'active' }), at: T0 });
    h.send({ type: 'phone/link', connected: false, at: T0 + 1000 });
    // Within the grace period, another phone connects: nothing of the first one stays.
    h.send({ type: 'phone/link', connected: true, deviceName: 'Galaxy', at: T0 + 5000 });
    expect(h.state.phone).toMatchObject({ connected: true, deviceName: 'Galaxy' });
    expect(h.state.nav).toBeNull();
    expect(h.state.road).toBeNull();
    expect(h.state.hazards).toEqual([]);
    expect(h.state.media).toBeNull();
    expect(h.state.call).toBeNull();
    expect(h.frame().call).toBeNull();
    // The new phone's own data then stays, also over a reconnect that repeats its name.
    h.send({ type: 'road/update', road: roadInfo(80), at: T0 + 6000 });
    h.send({ type: 'phone/link', connected: true, deviceName: 'Galaxy', at: T0 + 7000 });
    h.send({ type: 'phone/link', connected: true, at: T0 + 8000 });
    expect(h.state.road).not.toBeNull();
  });

  it('tells two phones with the same name apart by their device id', () => {
    const h = new Harness();
    h.send({ type: 'phone/link', connected: true, deviceName: 'Pixel', deviceId: 'A', at: T0 });
    h.send({ type: 'nav/update', nav: navInfo(), at: T0 });
    h.send({ type: 'media/update', media: mediaInfo(), at: T0 });
    h.send({ type: 'phone/link', connected: false, at: T0 + 1000 });
    // The passenger's phone of the same model (and default name) connects.
    h.send({
      type: 'phone/link',
      connected: true,
      deviceName: 'Pixel',
      deviceId: 'B',
      at: T0 + 2000,
    });
    expect(h.state.phone).toMatchObject({ connected: true, deviceName: 'Pixel', deviceId: 'B' });
    expect(h.state.nav).toBeNull();
    expect(h.state.media).toBeNull();
  });

  it('keeps the data of a phone that reconnects under a new name', () => {
    const h = new Harness();
    h.send({ type: 'phone/link', connected: true, deviceName: 'Pixel', deviceId: 'A', at: T0 });
    h.send({ type: 'nav/update', nav: navInfo(), at: T0 });
    h.send({ type: 'phone/link', connected: false, at: T0 + 1000 });
    h.send({
      type: 'phone/link',
      connected: true,
      deviceName: 'My Pixel',
      deviceId: 'A',
      at: T0 + 2000,
    });
    expect(h.state.phone).toMatchObject({ deviceName: 'My Pixel', deviceId: 'A' });
    expect(h.state.nav).not.toBeNull();
  });

  it('keeps phone data when the phone reconnects within the grace period', () => {
    const h = new Harness();
    h.phoneConnected(T0);
    h.send({ type: 'nav/update', nav: navInfo(), at: T0 });
    h.send({ type: 'phone/link', connected: false, at: T0 + 1000 });
    h.send({ type: 'phone/link', connected: true, at: T0 + 20_000 });
    h.idle(T0 + 60_000, 5000);
    expect(h.state.nav).not.toBeNull();
  });
});

describe('OBD events', () => {
  it('tracks link state; `since` moves only on a state change', () => {
    const h = new Harness();
    h.send({ type: 'obd/link', state: 'connecting', message: 'Opening /dev/rfcomm0', at: T0 + 10 });
    expect(h.state.vehicle.link).toMatchObject({
      state: 'connecting',
      message: 'Opening /dev/rfcomm0',
      since: T0 + 10,
    });
    h.send({ type: 'obd/link', state: 'connecting', at: T0 + 20 });
    expect(h.state.vehicle.link.since).toBe(T0 + 10);
    expect(h.state.vehicle.link.message).toBe('Opening /dev/rfcomm0');
    h.send({
      type: 'obd/link',
      state: 'connected',
      adapter: 'ELM327 v2.1',
      protocol: 'CAN',
      at: T0 + 30,
    });
    expect(h.state.vehicle.link).toEqual({
      state: 'connected',
      adapter: 'ELM327 v2.1',
      protocol: 'CAN',
      message: null,
      since: T0 + 30,
    });
    h.send({ type: 'obd/link', state: 'error', message: 'Timeout', at: T0 + 40 });
    expect(h.state.vehicle.link).toMatchObject({ adapter: 'ELM327 v2.1', protocol: 'CAN' });
  });

  it('stores supported signals without duplicates or unknown ids', () => {
    const h = new Harness();
    h.send({
      type: 'obd/supported',
      signals: ['rpm', 'speed', 'rpm', 'nonsense' as 'rpm'],
      at: T0,
    });
    expect(h.state.vehicle.supported).toEqual(['rpm', 'speed']);
  });

  it('merges trouble codes, keeping when each code was first seen', () => {
    const h = new Harness();
    h.send({
      type: 'obd/dtcs',
      milOn: false,
      stored: [],
      pending: ['p0420'],
      permanent: [],
      at: T0 + 1000,
    });
    expect(h.state.vehicle.dtcs).toEqual([
      { code: 'P0420', kind: 'pending', firstSeenAt: T0 + 1000 },
    ]);
    h.send({
      type: 'obd/dtcs',
      milOn: true,
      stored: ['P0420', 'P0301', 'P0301', 'XYZ'],
      pending: [],
      permanent: ['P0420'],
      at: T0 + 5000,
    });
    expect(h.state.vehicle.milOn).toBe(true);
    expect(h.state.vehicle.dtcsCheckedAt).toBe(T0 + 5000);
    expect(h.state.vehicle.dtcs).toEqual([
      { code: 'P0420', kind: 'stored', firstSeenAt: T0 + 1000 },
      { code: 'P0301', kind: 'stored', firstSeenAt: T0 + 5000 },
      { code: 'P0420', kind: 'permanent', firstSeenAt: T0 + 1000 },
    ]);
    h.send({
      type: 'obd/dtcs',
      milOn: false,
      stored: [],
      pending: [],
      permanent: [],
      at: T0 + 9000,
    });
    expect(h.state.vehicle.dtcs).toEqual([]);
    expect(h.state.vehicle.milOn).toBe(false);
  });

  it('keeps the codes on an incomplete read and takes only the MIL from it', () => {
    const h = new Harness();
    h.send({
      type: 'obd/dtcs',
      milOn: true,
      stored: ['P0420'],
      pending: [],
      permanent: [],
      at: T0 + 1000,
    });
    const before = h.state.vehicle.dtcs;
    h.send({
      type: 'obd/dtcs',
      complete: false,
      milOn: true,
      stored: [],
      pending: [],
      permanent: [],
      at: T0 + 5000,
    });
    expect(h.state.vehicle.dtcs).toBe(before);
    expect(h.state.vehicle.dtcsCheckedAt).toBe(T0 + 1000);
    // A clone that never manages a complete read: the MIL alone raises CHECK ENGINE.
    const clone = new Harness();
    clone.send({
      type: 'obd/dtcs',
      complete: false,
      milOn: true,
      stored: [],
      pending: [],
      permanent: [],
      at: T0 + 1000,
    });
    expect(clone.state.vehicle).toMatchObject({ milOn: true, dtcs: [], dtcsCheckedAt: null });
    expect(clone.state.alerts.map((a) => [a.key, a.severity, a.detail])).toEqual([
      ['check-engine:mil', 'warning', 'Lamp on – no code read'],
    ]);
    clone.send({
      type: 'obd/dtcs',
      complete: false,
      milOn: false,
      stored: [],
      pending: [],
      permanent: [],
      at: T0 + 2000,
    });
    expect(clone.state.alerts).toEqual([]);
  });

  it('stores the VIN trimmed and upper-cased', () => {
    const h = new Harness();
    h.send({ type: 'obd/vin', vin: ' wvwzzzauzkw123456 ', at: T0 });
    expect(h.state.vehicle.vin).toBe('WVWZZZAUZKW123456');
    h.send({ type: 'obd/vin', vin: '  ', at: T0 });
    expect(h.state.vehicle.vin).toBeNull();
  });
});

describe('phone events', () => {
  it('tracks the phone link', () => {
    const h = new Harness();
    h.send({
      type: 'phone/link',
      connected: true,
      deviceName: 'Pixel 9',
      appVersion: '1.2.0',
      at: T0 + 5,
    });
    expect(h.state.phone).toEqual({
      connected: true,
      deviceName: 'Pixel 9',
      deviceId: null,
      appVersion: '1.2.0',
      since: T0 + 5,
    });
    h.send({ type: 'phone/link', connected: true, at: T0 + 10 });
    expect(h.state.phone.since).toBe(T0 + 5);
    expect(h.state.phone.deviceName).toBe('Pixel 9');
    h.send({ type: 'phone/link', connected: false, at: T0 + 20 });
    expect(h.state.phone).toMatchObject({
      connected: false,
      since: T0 + 20,
      deviceName: 'Pixel 9',
    });
  });

  it('anchors nav updates to the integrated distance and clears them', () => {
    const h = driving(72);
    const km = h.state.odometer.integratedKm;
    expect(km).toBeGreaterThan(0);
    h.send({ type: 'nav/update', nav: navInfo(), at: h.now });
    expect(h.state.nav).toEqual({ info: navInfo(), integratedKmAtUpdate: km });
    h.send({ type: 'nav/clear', at: h.now });
    expect(h.state.nav).toBeNull();
  });

  it('stores road info', () => {
    const h = new Harness();
    h.send({ type: 'road/update', road: roadInfo(80, { updatedAt: T0 - 5000 }), at: T0 });
    // Re-stamped with the HUD's receipt time.
    expect(h.state.road).toEqual(roadInfo(80, { updatedAt: T0 }));
  });

  it('drops a speed limit the phone stopped refreshing (regression: core-8)', () => {
    const h = driving(95);
    h.phoneConnected(h.now);
    h.send({ type: 'road/update', road: roadInfo(50), at: h.now });
    // Refreshed every 30 s: kept.
    for (let i = 0; i < 4; i++) {
      h.run(h.now + 30_000, { speed: 95, rpm: 2500 }, 1000);
      h.send({ type: 'road/update', road: roadInfo(50), at: h.now });
    }
    expect(widget(h.frame(), 'speed')).toMatchObject({ value: 95, overLimit: true });
    // The location feed stops but the socket stays up: 10 minutes without a refresh.
    h.run(h.now + ROAD_TTL_MS, { speed: 95, rpm: 2500 }, 1000);
    expect(h.state.road).not.toBeNull();
    h.run(h.now + 10 * 60_000, { speed: 95, rpm: 2500 }, 1000);
    expect(h.state.road).toBeNull();
    expect(widget(h.frame(), 'speedLimit')).toBeUndefined();
    expect(widget(h.frame(), 'speed')).toMatchObject({ value: 95, overLimit: false, overBy: null });
  });

  it('replaces hazards, stamping them with the receipt time', () => {
    const h = driving(50);
    h.send({ type: 'hazards/update', hazards: [hazard('a', 400), hazard('b', 900)], at: h.now });
    expect(h.state.hazards).toHaveLength(2);
    expect(h.state.hazards[0]?.hazard.updatedAt).toBe(h.now);
    expect(h.state.hazards[0]?.integratedKmAtUpdate).toBe(h.state.odometer.integratedKm);
    h.send({ type: 'hazards/update', hazards: [], at: h.now });
    expect(h.state.hazards).toEqual([]);
  });

  describe('media', () => {
    it('announces a new track only when it plays', () => {
      const h = new Harness();
      h.send({ type: 'media/update', media: mediaInfo(), at: T0 + 100 });
      expect(h.state.media?.trackChangedAt).toBe(T0 + 100);
      // Same track, new metadata timestamp: no new announcement.
      h.send({ type: 'media/update', media: mediaInfo({ updatedAt: T0 + 500 }), at: T0 + 500 });
      expect(h.state.media?.trackChangedAt).toBe(T0 + 100);
      h.send({
        type: 'media/update',
        media: mediaInfo({ trackKey: 'b', title: 'B' }),
        at: T0 + 900,
      });
      expect(h.state.media?.trackChangedAt).toBe(T0 + 900);
    });

    it('does not re-announce after pause and resume', () => {
      const h = new Harness();
      h.send({ type: 'media/update', media: mediaInfo(), at: T0 });
      h.send({ type: 'media/update', media: mediaInfo({ playing: false }), at: T0 + 10_000 });
      h.send({ type: 'media/update', media: mediaInfo(), at: T0 + 20_000 });
      expect(h.state.media?.trackChangedAt).toBe(T0);
    });

    it('announces a track that changed while paused once it starts playing', () => {
      const h = new Harness();
      h.send({ type: 'media/update', media: mediaInfo({ playing: false }), at: T0 });
      expect(h.state.media?.trackChangedAt).toBe(TRACK_NOT_ANNOUNCED);
      h.send({
        type: 'media/update',
        media: mediaInfo({ playing: false, trackKey: 'b' }),
        at: T0 + 100,
      });
      expect(h.state.media?.trackChangedAt).toBe(TRACK_NOT_ANNOUNCED);
      h.send({ type: 'media/update', media: mediaInfo({ trackKey: 'b' }), at: T0 + 200 });
      expect(h.state.media?.trackChangedAt).toBe(T0 + 200);
    });

    it('clears media', () => {
      const h = new Harness();
      h.send({ type: 'media/update', media: mediaInfo(), at: T0 });
      h.send({ type: 'media/update', media: null, at: T0 + 1 });
      expect(h.state.media).toBeNull();
    });
  });

  describe('calls', () => {
    it('restamps updates and restarts the clock when the call is answered', () => {
      const h = new Harness();
      h.send({ type: 'call/update', call: callInfo({ startedAt: T0 - 500 }), at: T0 });
      expect(h.state.call).toMatchObject({ state: 'ringing', startedAt: T0 - 500, updatedAt: T0 });
      h.send({
        type: 'call/update',
        call: callInfo({ state: 'active', startedAt: T0 - 500 }),
        at: T0 + 8000,
      });
      expect(h.state.call).toMatchObject({
        state: 'active',
        startedAt: T0 + 8000,
        updatedAt: T0 + 8000,
      });
      h.send({ type: 'call/update', call: callInfo({ state: 'held' }), at: T0 + 20_000 });
      expect(h.state.call?.startedAt).toBe(T0 + 8000);
      h.send({ type: 'call/update', call: callInfo({ state: 'ended' }), at: T0 + 30_000 });
      expect(h.state.call).toMatchObject({
        state: 'ended',
        startedAt: T0 + 8000,
        updatedAt: T0 + 30_000,
      });
    });

    it('trusts a plausible start time for a call first seen mid-call', () => {
      const h = new Harness();
      h.send({
        type: 'call/update',
        call: callInfo({ state: 'active', startedAt: T0 - 60_000 }),
        at: T0,
      });
      expect(h.state.call?.startedAt).toBe(T0 - 60_000);
      h.send({
        type: 'call/update',
        call: callInfo({ id: 'c2', startedAt: T0 + 99_999 }),
        at: T0 + 1,
      });
      expect(h.state.call?.startedAt).toBe(T0 + 1);
    });

    it('clears the call', () => {
      const h = new Harness();
      h.send({ type: 'call/update', call: callInfo(), at: T0 });
      h.send({ type: 'call/update', call: null, at: T0 + 1 });
      expect(h.state.call).toBeNull();
    });
  });

  describe('messages', () => {
    it('keeps the most recent first, capped, stamped with the receipt time', () => {
      const h = new Harness();
      for (let i = 0; i < MAX_MESSAGES + 2; i++) {
        h.send({ type: 'message/received', message: message(`m${i}`), at: T0 + i * 1000 });
      }
      expect(h.state.messages.map((m) => m.id)).toEqual(['m6', 'm5', 'm4', 'm3', 'm2']);
      expect(h.state.messages[0]?.receivedAt).toBe(T0 + 6000);
    });

    it('dedupes by id, keeping the original receipt time', () => {
      const h = new Harness();
      h.send({ type: 'message/received', message: message('a', 'Ann'), at: T0 });
      h.send({ type: 'message/received', message: message('b', 'Ben'), at: T0 + 1000 });
      h.send({
        type: 'message/received',
        message: message('a', 'Ann', { readingAloud: false }),
        at: T0 + 2000,
      });
      expect(h.state.messages.map((m) => m.id)).toEqual(['b', 'a']);
      expect(h.state.messages[1]).toMatchObject({ receivedAt: T0, readingAloud: false });
    });
  });

  it('accepts only plausible locations', () => {
    const h = new Harness();
    h.send({ type: 'location/update', lat: 48.1, lon: 11.6, accuracyM: 5, at: T0 + 1 });
    expect(h.state.env.location).toEqual({ lat: 48.1, lon: 11.6, at: T0 + 1 });
    h.send({ type: 'location/update', lat: 95, lon: 11.6, accuracyM: 5, at: T0 + 2 });
    h.send({ type: 'location/update', lat: Number.NaN, lon: 0, accuracyM: null, at: T0 + 3 });
    expect(h.state.env.location).toEqual({ lat: 48.1, lon: 11.6, at: T0 + 1 });
  });
});

describe('sensors and ADAS', () => {
  it('stores light readings, ignoring invalid ones', () => {
    const h = new Harness();
    h.send({ type: 'sensor/light', lux: 1200, at: T0 + 5 });
    expect(h.state.env).toMatchObject({ lux: 1200, luxAt: T0 + 5 });
    h.send({ type: 'sensor/light', lux: -1, at: T0 + 6 });
    h.send({ type: 'sensor/light', lux: Number.NaN, at: T0 + 7 });
    expect(h.state.env).toMatchObject({ lux: 1200, luxAt: T0 + 5 });
  });

  it('tracks the ADAS module', () => {
    const h = new Harness();
    h.send({ type: 'adas/link', connected: true, at: T0 });
    h.send({ type: 'adas/blind-spot', left: true, right: false, at: T0 + 10 });
    h.send({ type: 'adas/collision', level: 'caution', ttcSeconds: 2.4, at: T0 + 20 });
    expect(h.state.adas).toEqual({
      moduleConnected: true,
      blindSpotLeft: true,
      blindSpotRight: false,
      blindSpotUpdatedAt: T0 + 10,
      collision: 'caution',
      ttcSeconds: 2.4,
      collisionUpdatedAt: T0 + 20,
      collisionWarningAt: null,
    });
    h.send({ type: 'adas/collision', level: 'warning', ttcSeconds: 0.8, at: T0 + 25 });
    expect(h.state.adas.collisionWarningAt).toBe(T0 + 25);
    h.send({ type: 'adas/collision', level: 'caution', ttcSeconds: 1.9, at: T0 + 27 });
    expect(h.state.adas.collisionWarningAt).toBe(T0 + 25);
    h.send({ type: 'adas/link', connected: false, at: T0 + 30 });
    expect(h.state.adas.moduleConnected).toBe(false);
    // Data from the module proves it is back.
    h.send({ type: 'adas/collision', level: 'none', ttcSeconds: null, at: T0 + 40 });
    expect(h.state.adas.moduleConnected).toBe(true);
  });
});

describe('input', () => {
  /** A stopped vehicle with a low-fuel caution and a check-engine alert. */
  function withAlerts(): Harness {
    const h = new Harness();
    h.obdConnected(T0);
    h.samples(T0 + 100, { speed: 0, rpm: 800, fuelLevel: 5 });
    h.send({
      type: 'obd/dtcs',
      milOn: true,
      stored: ['P0301'],
      pending: [],
      permanent: [],
      at: T0 + 200,
    });
    return h;
  }

  it('records when the driver last pressed anything', () => {
    const h = new Harness();
    h.input('toggle-blank', T0 + 50);
    expect(h.state.ui.lastInputAt).toBe(T0 + 50);
  });

  it('primary acknowledges the top dismissible alert', () => {
    const h = withAlerts();
    const top = h.frame().alerts[0];
    expect(top?.key).toBe('check-engine:P0301');
    h.input('primary', T0 + 300);
    const dismissed = h.state.alerts.find((a) => a.key === 'check-engine:P0301');
    expect(dismissed?.dismissedAt).toBe(T0 + 300);
    expect(h.frame().alerts.map((a) => a.key)).toEqual(['fuel-low']);
    h.input('primary', T0 + 400);
    expect(h.frame().alerts).toEqual([]);
  });

  it('never dismisses a critical alert and skips to the next dismissible one', () => {
    const h = withAlerts();
    h.samples(T0 + 250, { coolantTemp: 125, speed: 0, rpm: 800, fuelLevel: 5 });
    expect(h.frame().alerts.map((a) => a.key)).toEqual(['coolant', 'check-engine:P0301']);
    h.input('primary', T0 + 300);
    expect(h.state.alerts.find((a) => a.key === 'coolant')?.dismissedAt).toBeNull();
    expect(h.state.alerts.find((a) => a.key === 'check-engine:P0301')?.dismissedAt).toBe(T0 + 300);
  });

  it('primary on a ringing call changes nothing but the input time', () => {
    const h = withAlerts();
    h.phoneConnected(T0 + 250);
    h.send({ type: 'call/update', call: callInfo(), at: T0 + 300 });
    const before = h.state;
    h.input('primary', T0 + 400);
    expect(h.state.alerts).toBe(before.alerts);
    expect(h.state.call).toBe(before.call);
    expect(h.state.ui).toEqual({ ...before.ui, lastInputAt: T0 + 400 });
  });

  it('secondary dismisses the toast first, then alerts', () => {
    const h = withAlerts();
    h.phoneConnected(T0 + 300);
    h.send({ type: 'message/received', message: message('m1'), at: T0 + 400 });
    expect(h.frame().toast?.kind).toBe('message');
    h.input('secondary', T0 + 500);
    expect(h.state.ui.toastDismissedAt).toBe(T0 + 500);
    expect(h.frame().toast).toBeNull();
    expect(h.state.alerts.every((a) => a.dismissedAt === null)).toBe(true);
    h.input('secondary', T0 + 600);
    expect(h.state.alerts.find((a) => a.key === 'check-engine:P0301')?.dismissedAt).toBe(T0 + 600);
  });

  it('secondary on a ringing or active call changes nothing but the input time', () => {
    for (const state of ['ringing', 'dialing', 'active'] as const) {
      const h = withAlerts();
      h.phoneConnected(T0 + 250);
      h.send({ type: 'call/update', call: callInfo({ state }), at: T0 + 300 });
      const before = h.state;
      h.input('secondary', T0 + 400);
      expect(h.state.alerts).toBe(before.alerts);
      expect(h.state.ui.toastDismissedAt).toBeNull();
    }
  });

  it('does nothing when there is nothing to dismiss', () => {
    const h = new Harness();
    h.input('primary', T0 + 1);
    h.input('secondary', T0 + 2);
    expect(h.state.alerts).toEqual([]);
    expect(h.state.ui.toastDismissedAt).toBeNull();
  });

  it('pages through the parked dashboard, wrapping both ways', () => {
    const h = new Harness();
    // Without live signals: overview, trouble codes, trip, maintenance, pair a phone.
    h.input('prev-page');
    expect(h.state.ui.page).toBe(4);
    expect(h.frame().diagnostics?.page).toBe('pair');
    h.input('next-page');
    expect(h.state.ui.page).toBe(0);
    h.input('next-page');
    h.input('next-page');
    expect(h.state.ui.page).toBe(2);
  });

  it('stays on the chosen page while pages come and go', () => {
    const h = new Harness();
    h.obdConnected(T0);
    h.samples(T0 + 100, { rpm: 800, speed: 0 });
    // overview, engine, trouble codes, trip, maintenance, pair a phone
    h.input('prev-page', T0 + 200);
    h.input('prev-page', T0 + 250);
    h.input('prev-page', T0 + 300);
    expect(h.frame().diagnostics?.page).toBe('trip');
    expect(h.state.ui.page).toBe(3);
    // The engine page disappears when its data goes stale; the driver stays on "Trip".
    h.idle(T0 + 20_000, 5000);
    expect(h.frame().diagnostics?.page).toBe('trip');
    expect(h.state.ui.page).toBe(2);
    // …and it stays there when the engine page comes back.
    h.samples(T0 + 21_000, { rpm: 800, speed: 0 });
    expect(h.frame().diagnostics?.page).toBe('trip');
    expect(h.state.ui.page).toBe(3);
  });

  it('shows whichever page takes the place of one that vanished', () => {
    const h = new Harness();
    h.obdConnected(T0);
    h.samples(T0 + 100, { rpm: 800, speed: 0 });
    h.input('next-page', T0 + 200);
    expect(h.frame().diagnostics?.page).toBe('engine');
    h.idle(T0 + 20_000, 5000);
    expect(h.frame().diagnostics?.page).toBe('trouble-codes');
  });

  it('re-raises dismissed tyre and fuel alerts as they worsen on the highway (regression: core-9)', () => {
    const h = new Harness(makeConfig({ vehicle: { hasTpms: true } }));
    h.obdConnected(T0);
    const drive = (tyre: number, fuel: number) => ({
      speed: 110,
      rpm: 2600,
      tirePressureFL: tyre,
      tirePressureFR: 230,
      tirePressureRL: 230,
      tirePressureRR: 230,
      fuelLevel: fuel,
    });
    h.run(T0 + 20_000, drive(175, 11), 500);
    expect(h.state.context.context).toBe('highway');
    h.input('primary');
    h.input('primary');
    expect(h.frame().alerts).toEqual([]);
    // A puncture and a nearly empty tank.
    h.run(h.now + 5 * 60_000, drive(90, 1.5), 1000);
    expect(h.frame().alerts.map((a) => [a.kind, a.severity])).toEqual([
      ['tpms', 'critical'],
      ['fuel-low', 'warning'],
    ]);
  });

  it('toggles blanking', () => {
    const h = new Harness();
    h.input('toggle-blank');
    expect(h.state.ui.blanked).toBe(true);
    h.input('toggle-blank');
    expect(h.state.ui.blanked).toBe(false);
  });

  it('trims brightness in 0.1 steps within ±0.5', () => {
    const h = new Harness();
    h.input('brightness-up');
    h.input('brightness-up');
    h.input('brightness-up');
    expect(h.state.ui.brightnessOffset).toBe(0.3);
    for (let i = 0; i < 5; i++) h.input('brightness-up');
    expect(h.state.ui.brightnessOffset).toBe(0.5);
    for (let i = 0; i < 12; i++) h.input('brightness-down');
    expect(h.state.ui.brightnessOffset).toBe(-0.5);
  });
});

describe('maintenance and odometer bookkeeping', () => {
  it('records a service at the current odometer and recomputes status', () => {
    const h = new Harness(
      makeConfig(),
      persisted({
        odometerKm: 60_000,
        maintenanceRecords: [{ itemId: 'oil', odometerKm: 50_000, at: T0 - 300 * DAY }],
      }),
    );
    expect(h.state.maintenance.status.find((s) => s.itemId === 'oil')?.status).toBe('overdue');
    h.send({ type: 'maintenance/done', itemId: 'oil', odometerKm: null, at: T0 + 1000 });
    expect(h.state.maintenance.records).toEqual([
      { itemId: 'oil', odometerKm: 60_000, at: T0 + 1000 },
    ]);
    expect(h.state.maintenance.status.find((s) => s.itemId === 'oil')).toMatchObject({
      status: 'ok',
      remainingKm: 8000,
    });
    expect(h.state.alerts.some((a) => a.key === 'maintenance-due:oil')).toBe(false);
  });

  it('uses an explicit odometer reading and ignores unknown items', () => {
    const h = new Harness();
    h.send({ type: 'maintenance/done', itemId: 'cabin-filter', odometerKm: 12_345, at: T0 + 1 });
    expect(h.state.maintenance.records).toEqual([
      { itemId: 'cabin-filter', odometerKm: 12_345, at: T0 + 1 },
    ]);
    const before = h.state.maintenance;
    h.send({ type: 'maintenance/done', itemId: 'flux-capacitor', odometerKm: null, at: T0 + 2 });
    expect(h.state.maintenance).toBe(before);
  });

  it('sets the odometer by hand', () => {
    const h = new Harness(
      makeConfig(),
      persisted({ maintenanceRecords: [{ itemId: 'oil', odometerKm: 50_000, at: T0 - DAY }] }),
    );
    expect(h.state.maintenance.status.find((s) => s.itemId === 'oil')?.remainingKm).toBeNull();
    h.send({ type: 'odometer/set', odometerKm: 57_800, at: T0 + 1 });
    expect(h.state.odometer).toMatchObject({ km: 57_800, source: 'estimated' });
    expect(h.state.maintenance.status.find((s) => s.itemId === 'oil')).toMatchObject({
      remainingKm: 200,
      status: 'due-soon',
    });
    h.send({ type: 'odometer/set', odometerKm: -1, at: T0 + 2 });
    expect(h.state.odometer.km).toBe(57_800);
  });
});

describe('config', () => {
  it('re-evaluates config-dependent state with the new config', () => {
    const h = new Harness(
      makeConfig(),
      persisted({ maintenanceRecords: [{ itemId: 'oil', odometerKm: null, at: T0 - 100 * DAY }] }),
    );
    h.obdConnected(T0);
    h.samples(T0 + 100, { coolantTemp: 105, rpm: 800, speed: 0 });
    expect(h.state.alerts.some((a) => a.kind === 'coolant')).toBe(false);
    expect(h.state.alerts.some((a) => a.kind === 'maintenance-due')).toBe(false);

    const next = makeConfig({
      alerts: { coolantHighC: 100, coolantCriticalC: 110 },
      maintenance: {
        items: [
          {
            id: 'oil',
            label: 'Oil',
            intervalKm: null,
            intervalDays: 90,
            warnBeforeKm: 0,
            warnBeforeDays: 14,
          },
        ],
      },
      display: { brightness: { mode: 'manual', manualLevel: 0.4 } },
    });
    h.send({ type: 'config', config: next, at: T0 + 200 });
    expect(h.state.maintenance.status).toEqual([
      expect.objectContaining({ itemId: 'oil', status: 'overdue', remainingDays: -10 }),
    ]);
    expect(h.state.env.brightness.level).toBe(0.4);
    expect(h.state.alerts.map((a) => a.key).sort()).toEqual(['coolant', 'maintenance-due:oil']);
  });

  it('forgets learned gear ratios when the transmission type changes (regression: core-3)', () => {
    const config = makeConfig({ vehicle: { transmission: 'automatic' } });
    const h = new Harness(config, persisted({ learnedGearRatios: [72, 48, 35.5, 28, 23] }));
    h.send({ type: 'config', config: makeConfig({ units: { clock: '12h' } }), at: T0 + 100 });
    expect(h.state.gear.learnedRatios).toEqual([72, 48, 35.5, 28, 23]);
    expect(h.lastEffects).toEqual([]);
    const manual = makeConfig({ vehicle: { transmission: 'manual' } });
    h.send({ type: 'config', config: manual, at: T0 + 200 });
    expect(h.state.gear.learnedRatios).toBeNull();
    expect(h.lastEffects).toEqual([{ type: 'persist' }]);
    expect(extractPersisted(h.state).learnedGearRatios).toBeNull();
  });

  it('forgets the gear-numbering anchor with the learned ratios', () => {
    const config = makeConfig({ vehicle: { transmission: 'automatic' } });
    const anchor = { transmission: 'automatic' as const, secondGearRpmPerKph: 72 };
    const h = new Harness(
      config,
      persisted({ learnedGearRatios: [72, 48, 35.5, 28, 23], gearAnchor: anchor }),
    );
    expect(h.state.gear.anchor).toEqual(anchor);
    expect(extractPersisted(h.state).gearAnchor).toEqual(anchor);
    h.send({
      type: 'config',
      config: makeConfig({ vehicle: { transmission: 'dct' } }),
      at: T0 + 1,
    });
    expect(h.state.gear.anchor).toBeNull();
    expect(extractPersisted(h.state)).toMatchObject({ learnedGearRatios: null, gearAnchor: null });
  });
});

describe('gear numbering across a restart', () => {
  const AUTO = makeConfig({ vehicle: { transmission: 'automatic', idleRpm: 750 } });
  const LADDER = [72, 48, 35.5, 28, 23]; // 2nd … 6th: the converter kept 1st out

  it('shows learned gears of an automatic right after start-up with a saved anchor', () => {
    const gearAt50 = (saved: Parameters<typeof persisted>[0]) => {
      const h = new Harness(AUTO, persisted(saved));
      h.obdConnected(T0);
      h.run(T0 + 3000, { speed: 50, rpm: 50 * 35.5, throttle: 20 }, 100);
      return h.frame();
    };
    // Without an anchor nothing proves which ratio is which gear yet.
    expect(widget(gearAt50({ learnedGearRatios: LADDER }), 'gear')).toBeUndefined();
    const anchored = gearAt50({
      learnedGearRatios: LADDER,
      gearAnchor: { transmission: 'automatic', secondGearRpmPerKph: 73.1 },
    });
    expect(widget(anchored, 'gear')).toMatchObject({ gear: '4', inferred: true });
  });

  it('ignores an anchor learned on another transmission, or one without ratios', () => {
    const other = new Harness(
      AUTO,
      persisted({
        learnedGearRatios: LADDER,
        gearAnchor: { transmission: 'dct', secondGearRpmPerKph: 73 },
      }),
    );
    expect(other.state.gear.anchor).toBeNull();
    const alone = new Harness(
      AUTO,
      persisted({ gearAnchor: { transmission: 'automatic', secondGearRpmPerKph: 73 } }),
    );
    expect(alone.state.gear.anchor).toBeNull();
    expect(extractPersisted(alone.state).gearAnchor).toBeNull();
  });
});

describe('odometer from the dash (no PID 0xA6)', () => {
  /** Drive `km` of speed-integrated distance at `kph`, a speed sample every 5 s. */
  function drive(h: Harness, km: number, kph = 200): void {
    const stepMs = 5000;
    const steps = Math.round((km / kph) * 3_600_000) / stepMs;
    h.samples(h.now + 100, { speed: kph });
    for (let i = 0; i < steps; i++) h.samples(h.now + stepMs, { speed: kph });
  }
  const oil = (h: Harness) => h.state.maintenance.status.find((i) => i.itemId === 'oil');

  it('turns distance reminders on when a service is logged with the dash reading', () => {
    const h = new Harness();
    expect(h.state.odometer.km).toBeNull();
    h.send({ type: 'maintenance/done', itemId: 'oil', odometerKm: 50_000, at: T0 + 1000 });
    expect(h.state.odometer).toMatchObject({ km: 50_000, source: 'estimated' });
    expect(h.lastEffects).toContainEqual({ type: 'persist' });
    drive(h, 100);
    expect(h.state.odometer.km).toBeCloseTo(50_100, 0);
    h.tick(h.now + 61_000);
    expect(oil(h)).toMatchObject({ lastDoneKm: 50_000, remainingKm: 7900, status: 'ok' });
    expect(kmSinceConfirmed(h.state)).toBeCloseTo(100, 0);
  });

  it('leaves an odometer the car reports alone', () => {
    const h = new Harness(makeConfig(), persisted({ odometerKm: 48_213.4 }));
    h.samples(T0, { speed: 50, odometer: 48_213.5 });
    h.send({ type: 'maintenance/done', itemId: 'oil', odometerKm: 40_000, at: T0 + 1000 });
    expect(h.state.odometer).toMatchObject({ km: 48_213.5, source: 'pid' });
    expect(h.state.maintenance.records.at(-1)).toMatchObject({ odometerKm: 40_000 });
    expect(kmSinceConfirmed(h.state)).toBeNull();
  });

  it('learns the speed PID error from two dash readings and applies it', () => {
    const h = new Harness();
    h.send({ type: 'odometer/set', odometerKm: 10_000, at: T0 });
    drive(h, 300); // the dash says 309: the speed PID reads 3 % low
    expect(h.state.odometer.km).toBeCloseTo(10_300, 0);
    h.send({ type: 'odometer/set', odometerKm: 10_309, at: h.now + 1000 });
    expect(h.state.odometer.calibration).toEqual({
      confirmedKm: 10_309,
      rawKmSince: 0,
      scale: 1.015, // halfway to the measured 1.03
    });
    drive(h, 100);
    expect(h.state.odometer.km).toBeCloseTo(10_309 + 101.5, 0);
    expect(kmSinceConfirmed(h.state)).toBeCloseTo(101.5, 0);
    // Persisted and restored with the odometer.
    const saved = extractPersisted(h.state);
    expect(saved.odometerCalibration).toMatchObject({ confirmedKm: 10_309, scale: 1.015 });
    const again = createInitialState(h.config, saved, T0);
    expect(again.odometer.calibration).toEqual(saved.odometerCalibration);
  });

  it('measures nothing from a typo, a short distance or a large error, and clamps the scale', () => {
    const h = new Harness();
    h.send({ type: 'odometer/set', odometerKm: 10_000, at: T0 });
    drive(h, 300);
    h.send({ type: 'odometer/set', odometerKm: 13_000, at: h.now + 1000 }); // a typo: 3000 km
    expect(h.state.odometer.calibration).toMatchObject({ confirmedKm: 13_000, scale: 1 });
    drive(h, 100);
    h.send({ type: 'odometer/set', odometerKm: 13_120, at: h.now + 1000 }); // too short to tell
    expect(h.state.odometer.calibration.scale).toBe(1);
    drive(h, 300);
    h.send({ type: 'odometer/set', odometerKm: 13_120 + 360, at: h.now + 1000 }); // +20 %
    expect(h.state.odometer.calibration.scale).toBe(1.05); // halfway to the clamped 1.1
  });

  it('bridges OBD gaps with accurate phone fixes, never counting a stretch twice', () => {
    const h = new Harness();
    h.send({ type: 'odometer/set', odometerKm: 10_000, at: T0 });
    // 1 km north per 30 s (120 km/h) along a meridian: 1/111.2 ° of latitude.
    const fix = (at: number, step: number, accuracyM: number | null = 8) =>
      h.send({ type: 'location/update', lat: 48 + step / 111.195, lon: 11, accuracyM, at });
    fix(T0 + 1000, 0); // the OBD link is not up yet
    fix(T0 + 31_000, 1);
    fix(T0 + 61_000, 2);
    expect(h.state.odometer.km).toBeCloseTo(10_002, 1);
    expect(h.state.odometer.calibration.rawKmSince).toBeCloseTo(2, 1);
    // Inaccurate fixes measure nothing (and break the chain) …
    fix(T0 + 91_000, 3, 60);
    fix(T0 + 121_000, 4);
    expect(h.state.odometer.km).toBeCloseTo(10_002, 1);
    // … nor does standing still in the fixes' noise …
    fix(T0 + 151_000, 4.001);
    expect(h.state.odometer.km).toBeCloseTo(10_002, 1);
    // … and once speed samples arrive, they measure the distance instead.
    h.samples(T0 + 160_000, { speed: 120 });
    h.samples(T0 + 165_000, { speed: 120 });
    fix(T0 + 166_000, 5);
    expect(h.state.odometer.km).toBeCloseTo(10_002 + (120 * 5) / 3600, 2);
  });

  it('restores a damaged calibration as nothing learned', () => {
    const state = createInitialState(
      makeConfig(),
      persisted({
        odometerKm: 1000,
        odometerCalibration: { confirmedKm: -5, rawKmSince: Number.NaN, scale: 2 },
      }),
      T0,
    );
    expect(state.odometer.calibration).toEqual({ confirmedKm: null, rawKmSince: 0, scale: 1 });
  });
});

describe('extractPersisted', () => {
  it('returns the persistent parts as independent copies', () => {
    const h = new Harness(
      makeConfig(),
      persisted({
        odometerKm: 1000,
        learnedGearRatios: [110, 65, 45],
        avgLPer100km: 6.5,
        maintenanceRecords: [{ itemId: 'oil', odometerKm: 900, at: T0 - DAY }],
      }),
    );
    h.run(T0 + 2000, { speed: 36 });
    const out = extractPersisted(h.state);
    expect(out.odometerKm).toBeCloseTo(1000.018, 6); // 1.8 s at 10 m/s
    expect(out.learnedGearRatios).toEqual([110, 65, 45]);
    expect(out.avgLPer100km).toBeCloseTo(6.5);
    expect(out.maintenanceRecords).toEqual([{ itemId: 'oil', odometerKm: 900, at: T0 - DAY }]);
    expect(out.learnedGearRatios).not.toBe(h.state.gear.learnedRatios);
    expect(out.maintenanceRecords[0]).not.toBe(h.state.maintenance.records[0]);
  });

  it('round-trips through createInitialState', () => {
    const h = new Harness(makeConfig(), persisted({ odometerKm: 42 }));
    const again = createInitialState(h.config, extractPersisted(h.state), T0);
    expect(extractPersisted(again)).toEqual(extractPersisted(h.state));
  });
});
