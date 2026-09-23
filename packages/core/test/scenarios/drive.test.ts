import { describe, expect, it } from 'vitest';
import { diagnosticsPageKinds } from '../../src/compose/diagnostics.ts';
import { navDistanceM } from '../../src/state/selectors.ts';
import type { HudEffect } from '../../src/types/effects.ts';
import type { HudFrame } from '../../src/types/frame.ts';
import type { Lane } from '../../src/types/nav.ts';
import { formatNavDistance, roundTo } from '../../src/units.ts';
import {
  Harness,
  T0,
  callInfo,
  makeConfig,
  mediaInfo,
  navInfo,
  persisted,
  roadInfo,
  widget,
  widgetIds,
} from '../state/fixtures.ts';
import { DriveScript, SCENARIO_RATIOS } from './drive-script.ts';

const DAY = 86_400_000;

const EXIT_LANES: Lane[] = [
  { directions: ['straight'], recommended: false },
  { directions: ['straight'], recommended: false },
  { directions: ['straight', 'slight-right'], recommended: true, activeDirection: 'slight-right' },
  { directions: ['slight-right'], recommended: true, activeDirection: 'slight-right' },
];

const alertKeys = (frame: HudFrame): string[] => frame.alerts.map((a) => a.key);
const ofType = <T extends HudEffect['type']>(effects: HudEffect[], type: T) =>
  effects.filter((e): e is Extract<HudEffect, { type: T }> => e.type === type);

/**
 * One continuous drive, replayed as an event stream through the real reducer, effects and
 * composer: cold start → city with navigation → highway (clutter drops, guidance waits for the
 * exit, then lanes) → overspeed → the engine overheats → exit → stop and take a call → park →
 * browse the diagnostics dashboard → the trip completes.
 */
describe('scenario: a complete drive', () => {
  it('shows the right things at every key moment', () => {
    const config = makeConfig({
      vehicle: { transmission: 'manual', gearRatiosRpmPerKph: SCENARIO_RATIOS },
      units: { currency: 'EUR' },
      display: { maxAlerts: 3 },
    });
    const h = new Harness(
      config,
      persisted({
        odometerKm: 47_690.4,
        avgLPer100km: 7.4,
        maintenanceRecords: [{ itemId: 'oil', odometerKm: 40_000, at: T0 - 200 * DAY }],
      }),
    );
    const car = new DriveScript(h);

    // ---------------------------------------------------------------- cold start, parked
    h.send({
      type: 'obd/link',
      state: 'connecting',
      message: 'Opening /dev/rfcomm0',
      at: T0 + 100,
    });
    h.send({
      type: 'obd/link',
      state: 'connected',
      adapter: 'OBDLink MX+',
      protocol: 'ISO 15765-4 (CAN 11/500)',
      at: T0 + 1500,
    });
    h.phoneConnected(T0 + 1600);
    h.send({ type: 'obd/vin', vin: 'WVWZZZAUZKW123456', at: T0 + 1700 });
    h.send({
      type: 'obd/dtcs',
      milOn: false,
      stored: [],
      pending: ['P0420'],
      permanent: [],
      at: T0 + 1800,
    });
    car.engine = 'cranking';
    car.voltage = 10.2; // the starter drags the battery down
    car.go(T0 + 3000, 0);
    car.engine = 'running';
    car.voltage = 14.3;
    car.go(T0 + 8000, 0);

    let frame = h.frame();
    expect(frame.context).toBe('parked');
    expect(frame.status).toEqual({ obd: 'connected', phone: true, simulated: false });
    expect(frame.diagnostics).toMatchObject({
      page: 'overview',
      vehicle: { vin: 'WVWZZZAUZKW123456' },
    });
    // Cold morning: a brief ice warning; at rest the service reminder and pending code show too.
    expect(alertKeys(frame)).toEqual(['ice-risk', 'check-engine:P0420', 'maintenance-due:oil']);
    // The cranking dip never became a battery alert.
    expect(h.state.alerts.some((a) => a.kind === 'voltage')).toBe(false);
    expect(widgetIds(frame)).toEqual(['fuel', 'outsideTemp', 'clock', 'tripSummary']);
    expect(widget(frame, 'outsideTemp')).toMatchObject({ value: 2, iceRisk: true });
    // 27.5 L at the persisted 7.4 L/100 km ≈ 372 km (idling nudges the average up a little).
    expect(widget(frame, 'fuel')).toMatchObject({ average: 7.4, levelPct: 55 });
    expect(widget(frame, 'fuel')?.range).toBeGreaterThanOrEqual(368);
    expect(widget(frame, 'fuel')?.range).toBeLessThanOrEqual(372);

    car.go(T0 + 15_000, 0);
    expect(alertKeys(h.frame())).not.toContain('ice-risk'); // transient: gone after 10 s

    // ---------------------------------------------------------------- city with navigation
    car.coolantC = 60;
    h.send({
      type: 'nav/update',
      nav: navInfo({
        maneuver: { type: 'right', instruction: 'Turn right onto Rosenheimer Straße' },
        distanceToManeuverM: 800,
        street: 'Rosenheimer Straße',
        etaEpochMs: h.now + 12 * 60_000,
        remainingDistanceM: 9000,
        remainingSeconds: 720,
      }),
      at: h.now,
    });
    h.send({ type: 'road/update', road: roadInfo(50), at: h.now });
    car.go(h.now + 12_000, 50, 5);

    frame = h.frame();
    expect(frame.context).toBe('city');
    expect(frame.diagnostics).toBeNull();
    expect(widget(frame, 'speed')).toMatchObject({ value: 50, overLimit: false });
    expect(widget(frame, 'speedLimit')).toMatchObject({ value: 50 });
    // ≈ 70 m accelerating over 10 s plus 2 s at 50 km/h: about 700 m to go.
    const d = navDistanceM(h.state) ?? Number.NaN;
    expect(d).toBeGreaterThan(680);
    expect(d).toBeLessThan(720);
    expect(widget(frame, 'nav')).toMatchObject({
      maneuver: { type: 'right', instruction: null },
      distance: formatNavDistance(d, 'metric'),
      street: 'Rosenheimer Straße',
      imminent: false,
    });
    expect(widget(frame, 'gear')).toMatchObject({ gear: '4', inferred: true });
    expect(widget(frame, 'eta')).toMatchObject({ remainingMinutes: 12 });
    // Moving: service reminders and minor pending codes wait for the next stop.
    expect(frame.alerts).toEqual([]);

    // A message: sender only, then it fades out.
    h.send({
      type: 'message/received',
      message: {
        id: 'm1',
        sender: 'Alex Chen',
        app: 'WhatsApp',
        receivedAt: 0,
        readingAloud: true,
      },
      at: h.now,
    });
    const messageAt = h.now;
    expect(h.frame().toast).toEqual({
      kind: 'message',
      title: 'Alex Chen',
      subtitle: 'WhatsApp',
      opacity: 1,
    });
    car.go(messageAt + 5600, 50);
    expect(h.frame().toast?.opacity).toBe(0.4);
    car.go(messageAt + 6000, 50);
    expect(h.frame().toast).toBeNull();

    // A new song.
    h.send({
      type: 'media/update',
      media: mediaInfo({ title: 'Everlong', artist: 'Foo Fighters', trackKey: 'everlong' }),
      at: h.now,
    });
    frame = h.frame();
    expect(frame.toast).toMatchObject({
      kind: 'media',
      title: 'Everlong',
      subtitle: 'Foo Fighters',
    });
    expect(widget(frame, 'media')).toMatchObject({ title: 'Everlong', playing: true });

    // Final approach to the turn: countdown and progress bar.
    car.until(() => (navDistanceM(h.state) ?? 0) < 150, 50);
    const turn = navDistanceM(h.state) ?? Number.NaN;
    expect(widget(h.frame(), 'nav')).toMatchObject({
      imminent: true,
      approach: roundTo(1 - turn / 300, 2),
    });

    // ---------------------------------------------------------------- highway
    h.send({
      type: 'nav/update',
      nav: navInfo({
        maneuver: { type: 'exit-right' },
        distanceToManeuverM: 6000,
        street: 'Garching-Süd',
        thenManeuver: { type: 'keep-left' },
        lanes: EXIT_LANES,
        remainingDistanceM: 7500,
        remainingSeconds: 330,
      }),
      at: h.now,
    });
    h.send({ type: 'road/update', road: roadInfo(120, { roadClass: 'motorway' }), at: h.now });
    h.send({
      type: 'hazards/update',
      hazards: [
        {
          id: 'cam-1',
          type: 'speed-camera',
          distanceM: 2500,
          speedLimitKph: 120,
          delaySeconds: null,
          description: null,
          updatedAt: 0,
        },
      ],
      at: h.now,
    });
    car.coolantC = 92;
    car.go(h.now + 25_000, 115, 4);

    frame = h.frame();
    expect(frame.context).toBe('highway');
    // Adaptive clutter: at highway cruise only speed and limit remain.
    expect(widgetIds(frame)).toEqual(['speed', 'speedLimit']);
    expect(widget(frame, 'speed')).toMatchObject({ value: 115, overLimit: false });

    // The camera appears within 1 km and disappears once passed.
    car.until(() => widget(h.frame(), 'hazard') !== undefined, 115);
    expect(widget(h.frame(), 'hazard')).toMatchObject({
      type: 'speed-camera',
      label: 'Speed camera',
      speedLimit: 120,
    });
    expect(widget(h.frame(), 'hazard')?.distance?.text).toBe('1.0 km');
    car.until(() => widget(h.frame(), 'hazard') === undefined, 115);
    expect(widgetIds(h.frame())).toEqual(['speed', 'speedLimit']);

    // Guidance returns 2 km before the exit — without lanes yet.
    car.until(() => widget(h.frame(), 'nav') !== undefined, 115);
    frame = h.frame();
    expect(navDistanceM(h.state)).toBeLessThanOrEqual(2000);
    expect(widget(frame, 'nav')).toMatchObject({
      maneuver: { type: 'exit-right' },
      distance: { text: '2.0 km' },
    });
    expect(widget(frame, 'lanes')).toBeUndefined();

    // Limit drops before the exit: 115 in a 100 zone.
    h.send({ type: 'road/update', road: roadInfo(100, { roadClass: 'motorway' }), at: h.now });
    expect(widget(h.frame(), 'speed')).toMatchObject({ value: 115, overLimit: true, overBy: 15 });

    // The engine starts to overheat.
    car.until(
      () => h.frame().alerts.some((a) => a.key === 'coolant'),
      115,
      60_000,
      () => {
        car.coolantC = Math.min(112, car.coolantC + 0.2);
      },
    );
    frame = h.frame();
    expect(frame.alerts[0]).toMatchObject({
      key: 'coolant',
      severity: 'warning',
      title: 'ENGINE HOT',
      dismissible: true,
    });
    expect(widget(frame, 'coolant')).toMatchObject({ value: 110, status: 'hot' });
    h.input('primary');
    expect(alertKeys(h.frame())).not.toContain('coolant');

    // Lanes appear 800 m before the exit.
    car.until(
      () => widget(h.frame(), 'lanes') !== undefined,
      115,
      120_000,
      () => {
        car.coolantC = Math.min(119, car.coolantC + 0.1);
      },
    );
    expect(navDistanceM(h.state)).toBeLessThanOrEqual(800);
    expect(widget(h.frame(), 'lanes')?.lanes).toEqual(EXIT_LANES);

    // Critical now: re-raised despite the earlier dismissal, and it cannot be dismissed.
    car.until(
      () => car.coolantC >= 119 && h.frame().alerts[0]?.severity === 'critical',
      115,
      60_000,
      () => {
        car.coolantC = Math.min(119, car.coolantC + 0.1);
      },
    );
    frame = h.frame();
    expect(frame.alerts[0]).toMatchObject({
      key: 'coolant',
      title: 'OVERHEATING – STOP',
      dismissible: false,
    });
    expect(widget(frame, 'coolant')).toMatchObject({ status: 'critical' });
    h.input('primary');
    expect(h.frame().alerts[0]?.key).toBe('coolant');

    // ---------------------------------------------------------------- exit, stop
    car.until(() => (navDistanceM(h.state) ?? 0) <= 50, 115, 60_000);
    h.send({
      type: 'nav/update',
      nav: navInfo({
        maneuver: { type: 'right' },
        distanceToManeuverM: 700,
        street: 'Lichtenbergstraße',
      }),
      at: h.now,
    });
    h.send({ type: 'road/update', road: roadInfo(60), at: h.now });
    car.go(h.now + 20_000, 50, 4, () => {
      car.coolantC = Math.max(98, car.coolantC - 0.3);
    });
    frame = h.frame();
    expect(frame.context).toBe('city');
    expect(frame.alerts.some((a) => a.key === 'coolant')).toBe(false);
    expect(widget(frame, 'coolant')).toBeUndefined();
    expect(widget(frame, 'speed')).toMatchObject({ value: 50, overLimit: false });

    car.go(h.now + 15_000, 0, 5);
    frame = h.frame();
    expect(frame.context).toBe('stopped');
    expect(widget(frame, 'speed')).toMatchObject({ value: 0 });
    // ≈ 0.8 km in town, 6 km of motorway and the exit ramp.
    expect(widget(frame, 'tripSummary')?.distance.value).toBeGreaterThan(6.5);
    expect(alertKeys(frame)).toEqual(['check-engine:P0420', 'maintenance-due:oil']);

    // ---------------------------------------------------------------- incoming call
    h.send({
      type: 'call/update',
      call: callInfo({ id: 'call-42', callerName: 'Maria Lopez' }),
      at: h.now,
    });
    expect(h.frame().call).toMatchObject({
      state: 'ringing',
      name: 'Maria Lopez',
      canAccept: true,
    });
    expect(h.frame().toast).toBeNull();
    h.input('primary');
    expect(h.lastEffects).toEqual([
      { type: 'phone/call-action', callId: 'call-42', action: 'accept' },
    ]);
    // The alerts were not touched by accepting.
    expect(alertKeys(h.frame())).toEqual(['check-engine:P0420', 'maintenance-due:oil']);
    h.send({
      type: 'call/update',
      call: callInfo({ id: 'call-42', state: 'active' }),
      at: h.now + 800,
    });
    car.go(h.now + 30_000, 0);
    expect(h.frame().call).toMatchObject({
      state: 'active',
      durationS: 30,
      canAccept: false,
      canDecline: true,
    });
    h.send({ type: 'call/update', call: callInfo({ id: 'call-42', state: 'ended' }), at: h.now });
    car.go(h.now + 1000, 0);
    expect(h.frame().call?.state).toBe('ended');
    car.go(h.now + 1200, 0);
    expect(h.frame().call).toBeNull();

    // ---------------------------------------------------------------- park
    car.engine = 'stopped';
    car.go(h.now + 400, 0);
    car.engine = 'off';
    car.voltage = 12.6;
    h.send({ type: 'nav/clear', at: h.now });
    // Engine off at a standstill looks like start-stop at first: still 'stopped'.
    expect(h.frame().context).toBe('stopped');
    car.go(h.now + 31_000, 0);
    frame = h.frame();
    expect(frame.context).toBe('parked');
    expect(frame.diagnostics).toMatchObject({ page: 'overview', pageIndex: 0 });
    expect(frame.diagnostics?.gauges.find((g) => g.signal === 'odometer')?.value).toBe(
      Math.round(h.state.odometer.km ?? 0),
    );

    // Browse the dashboard.
    const pages = diagnosticsPageKinds(h.state);
    expect(pages[0]).toBe('overview');
    expect(pages.slice(-3)).toEqual(['trouble-codes', 'trip', 'maintenance']);
    h.input('next-page');
    expect(h.frame().diagnostics).toMatchObject({
      page: pages[1],
      pageIndex: 1,
      pageCount: pages.length,
    });
    h.input('prev-page');
    h.input('prev-page');
    expect(h.frame().diagnostics).toMatchObject({ page: 'maintenance' });
    h.input('prev-page');
    const trip = h.frame().diagnostics;
    expect(trip?.page).toBe('trip');
    expect(trip?.trip?.distanceKm).toBeGreaterThan(6.5);
    h.input('prev-page');
    expect(h.frame().diagnostics?.dtcs.map((x) => x.code)).toEqual(['P0420']);

    // Engine off for five minutes: the trip completes and is handed to the server once.
    const odometerAtPark = h.state.odometer.km ?? 0;
    car.go(h.now + h.config.trip.endAfterEngineOffMs + 5000, 0);
    const completed = ofType(h.effects, 'trip/completed');
    expect(completed).toHaveLength(1);
    const record = completed[0]?.trip;
    expect(record?.id).toMatch(/^trip-/);
    expect(record?.distanceKm).toBeCloseTo(h.state.odometer.integratedKm, 1);
    expect(record?.maxSpeedKph).toBe(115);
    expect(record?.currency).toBe('EUR');
    expect(h.frame().diagnostics).toMatchObject({ page: 'trouble-codes' });

    // Side effects over the whole drive.
    expect(ofType(h.effects, 'phone/call-action')).toHaveLength(1);
    const crossings = Math.floor(odometerAtPark) - Math.floor(47_690.4);
    expect(crossings).toBeGreaterThanOrEqual(6);
    expect(ofType(h.effects, 'persist')).toHaveLength(crossings);
  });
});
