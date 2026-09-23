import { parsePhoneMessage, type HudEvent, type PhoneToHud } from '@carheadsup/core';
import { DEMO_SCENARIO, VehicleSimulator } from '@carheadsup/obd';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ARRIVED_END_MS,
  CALL_AUTO_ANSWER_MS,
  CALL_DURATION_MS,
  MANUAL_CAMERA_AHEAD_M,
  SCENARIO_CALLER,
  SIM_PHONE_DEVICE,
  SimPhone,
  TRACK_CHANGE_MS,
} from '../../src/sim/phone.ts';
import { ROUTE_MANEUVERS } from '../../src/sim/route.ts';
import type { PhoneMessageTranslator } from '../../src/sources/types.ts';
import { FakeClock, recordingContext } from '../sensors/fakes.ts';

interface Sent {
  at: number;
  step: string | null;
  position: number;
  message: PhoneToHud;
}

type Of<T extends PhoneToHud['t']> = Extract<PhoneToHud, { t: T }>;

/**
 * A SimPhone on a real VehicleSimulator. The translator records every PhoneToHud message and
 * returns a marker event, so the tests do not depend on the real translator.
 */
function harness(
  options: {
    mode?: 'scenario' | 'manual';
    readMessagesAloud?: boolean;
    translate?: PhoneMessageTranslator;
  } = {},
) {
  const clock = new FakeClock();
  const vehicle = new VehicleSimulator({ mode: options.mode ?? 'scenario', engineTempC: 80 });
  const sent: Sent[] = [];
  let phone: SimPhone | null = null;
  const record: PhoneMessageTranslator = (message, now) => {
    sent.push({
      at: now,
      step: vehicle.status().scenarioStep,
      position: phone?.routePosition ?? 0,
      message,
    });
    return [{ type: 'tick', at: now }];
  };
  const recorder = recordingContext(clock);
  phone = new SimPhone({
    vehicle,
    translate: options.translate ?? record,
    readMessagesAloud: options.readMessagesAloud ?? true,
    logger: recorder.logger,
  });
  /** Step the vehicle and the phone's timers together, in 50 ms slices. */
  const drive = async (ms: number): Promise<void> => {
    for (let t = 0; t < ms; t += 50) {
      vehicle.step(50);
      await clock.advance(50, false);
    }
  };
  const of = <T extends PhoneToHud['t']>(t: T, from = 0) =>
    sent.slice(from).filter((s): s is Sent & { message: Of<T> } => s.message.t === t);
  return { clock, vehicle, phone, sent, drive, of, ...recorder };
}

/** One whole demo loop and into the next. */
const DRIVE_MS = DEMO_SCENARIO.reduce((ms, step) => ms + step.durationS * 1000, 0) + 5000;

describe('SimPhone over one demo loop', () => {
  let h: ReturnType<typeof harness>;

  beforeAll(async () => {
    h = harness();
    await h.phone.start(h.ctx);
    await h.drive(DRIVE_MS);
    await h.phone.stop();
  }, 60_000);

  it('connects as "Simulated phone" and emits the translated events', () => {
    expect(h.events[0]).toMatchObject({
      type: 'phone/link',
      connected: true,
      deviceName: SIM_PHONE_DEVICE,
    });
    // Every message went through the translator, whose events were emitted.
    expect(h.events.filter((e: HudEvent) => e.type === 'tick')).toHaveLength(h.sent.length);
  });

  it('only builds messages that pass the strict phone-protocol validator', () => {
    expect(h.sent.length).toBeGreaterThan(200);
    for (const { message } of h.sent) {
      const parsed = parsePhoneMessage(JSON.stringify(message));
      if (!parsed.ok) throw new Error(`${message.t}: ${parsed.error}`);
    }
  });

  it('starts guidance on "city" and walks through every maneuver in order', () => {
    const nav = h.of('nav');
    const firstActive = nav.find((s) => s.message.active);
    expect(firstActive?.step).toBe('city');
    expect(firstActive?.message).toMatchObject({
      maneuver: { type: 'right' },
      street: 'Station Road',
      currentStreet: 'Maple Street',
      source: 'simulator',
    });
    const sequence: string[] = [];
    for (const s of nav) {
      const type = s.message.active ? s.message.maneuver?.type : 'off';
      if (type !== undefined && sequence.at(-1) !== type) sequence.push(type);
    }
    expect(sequence).toEqual([...ROUTE_MANEUVERS.map((m) => m.maneuver.type), 'off']);
  });

  it('counts the distance down about once a second from the odometer', () => {
    const toRight = h
      .of('nav')
      .filter((s) => s.message.active && s.message.maneuver?.type === 'right');
    expect(toRight.length).toBeGreaterThan(10);
    for (let i = 1; i < toRight.length; i++) {
      expect(toRight[i]!.at - toRight[i - 1]!.at).toBe(1000);
      expect(toRight[i]!.message.distanceM!).toBeLessThanOrEqual(
        toRight[i - 1]!.message.distanceM!,
      );
      // Distance + position along the route stays at the maneuver point.
      expect(toRight[i]!.message.distanceM! + toRight[i]!.position).toBeCloseTo(170, -1);
    }
    expect(toRight[0]!.message.distanceM).toBe(170);
  });

  it('keeps ETA and remaining distance consistent and shrinking', () => {
    const active = h.of('nav').filter((s) => s.message.active);
    for (const s of active) {
      const m = s.message;
      expect(m.etaEpochMs! - s.at).toBe(m.remainingSeconds! * 1000);
    }
    const remaining = active.map((s) => s.message.remainingDistanceM!);
    expect(remaining[0]).toBe(ROUTE_MANEUVERS.at(-1)!.at);
    for (let i = 1; i < remaining.length; i++)
      expect(remaining[i]!).toBeLessThanOrEqual(remaining[i - 1]!);
  });

  it('shows lanes and a "then" maneuver before the highway exit, while still on the highway', () => {
    const exit = h
      .of('nav')
      .filter((s) => s.message.active && s.message.maneuver?.type === 'exit-right');
    expect(exit[0]?.step).toBe('highway');
    expect(exit[0]!.message.lanes?.filter((l) => l.recommended)).toHaveLength(2);
    expect(exit[0]!.message.then?.type).toBe('roundabout-ccw');
    expect(exit[0]!.message.currentStreet).toBe('A7 North');
  });

  it('ends guidance shortly after arriving', () => {
    const arrival = h
      .of('nav')
      .find(
        (s) =>
          s.message.active &&
          s.message.distanceM === 0 &&
          s.message.maneuver?.type === 'arrive-right',
      );
    const end = h.of('nav').find((s) => !s.message.active);
    expect(arrival).toBeDefined();
    expect(end?.step).toBe('arriving');
    expect(end!.at - arrival!.at).toBeGreaterThanOrEqual(ARRIVED_END_MS - 1000);
    expect(end!.at - arrival!.at).toBeLessThanOrEqual(ARRIVED_END_MS);
  });

  it('sends road speed limits as the car moves: 50 in town, 100/120 on the highway', () => {
    const roads = h
      .of('road')
      .map((s) => ({ step: s.step, limit: s.message.speedLimitKph, name: s.message.roadName }));
    // Maple St, Station Rd, Bridge Ave, ramp, A7, camera zone, A7, exit, Harbor Rd ×2, then the
    // loop restarts on Maple St.
    expect(roads.map((r) => r.limit)).toEqual([50, 50, 50, 100, 120, 100, 120, 70, 50, 30, 50]);
    expect(roads.filter((r) => r.step === 'city').every((r) => r.limit === 50)).toBe(true);
    const highway = roads.filter((r) => r.step === 'highway').map((r) => r.limit);
    expect(new Set(highway)).toEqual(new Set([100, 120]));
    expect(roads.at(-1)).toMatchObject({ step: 'warm-up', name: 'Maple Street' }); // the loop restarts
  });

  it('reports the speed camera on the highway and clears it once passed', () => {
    const hazards = h.of('hazards');
    const announced = hazards.find((s) => s.message.items.length > 0);
    expect(announced?.step).toBe('highway');
    expect(announced!.message.items[0]).toMatchObject({ type: 'speed-camera', speedLimitKph: 100 });
    expect(announced!.message.items[0]!.distanceM).toBeLessThanOrEqual(1500);
    const cleared = hazards.find((s) => s.at > announced!.at && s.message.items.length === 0);
    expect(cleared?.step).toBe('highway');
    // Refreshed every 10 s in between, distance shrinking.
    const refreshes = hazards.filter((s) => s.at < cleared!.at && s.message.items.length > 0);
    expect(refreshes.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < refreshes.length; i++) {
      expect(refreshes[i]!.message.items[0]!.distanceM!).toBeLessThan(
        refreshes[i - 1]!.message.items[0]!.distanceM!,
      );
    }
  });

  it('rings at the red light, auto-answers after 6 s and hangs up 20 s later', () => {
    const calls = h.of('call');
    expect(calls.map((s) => s.message.state)).toEqual(['ringing', 'active', 'ended']);
    expect(calls[0]).toMatchObject({ step: 'red-light' });
    expect(calls[0]!.message).toMatchObject({
      callerName: SCENARIO_CALLER.name,
      number: SCENARIO_CALLER.number,
    });
    expect(calls[1]!.at - calls[0]!.at).toBe(CALL_AUTO_ANSWER_MS);
    expect(calls[2]!.at - calls[1]!.at).toBe(CALL_DURATION_MS);
    expect(new Set(calls.map((s) => s.message.id)).size).toBe(1);
  });

  it('delivers a message notification (sender only) while arriving', () => {
    const messages = h.of('message');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ step: 'arriving' });
    expect(Object.keys(messages[0]!.message).sort()).toEqual([
      'app',
      'id',
      'readingAloud',
      'sender',
      't',
    ]);
    expect(messages[0]!.message.readingAloud).toBe(true);
  });

  it('changes track every 45 s', () => {
    const media = h.of('media');
    expect(media.length).toBe(1 + Math.floor(290_000 / TRACK_CHANGE_MS));
    for (let i = 1; i < media.length; i++) {
      expect(media[i]!.at - media[i - 1]!.at).toBe(TRACK_CHANGE_MS);
      expect(media[i]!.message.trackKey).not.toBe(media[i - 1]!.message.trackKey);
      expect(media[i]!.message.playing).toBe(true);
    }
  });

  it('reports its location every 5 s', () => {
    const locations = h.of('location');
    expect(locations.length).toBe(Math.floor(DRIVE_MS / 5000));
    const moving = locations.find((s) => s.step === 'highway');
    expect(moving!.message.speedMps).toBeGreaterThan(25);
  });

  it('leaves no timers behind after stop', () => {
    expect(h.clock.pendingTimers).toBe(0);
  });
});

describe('SimPhone controls', () => {
  it('accepts and declines calls from the HUD (call-action)', async () => {
    const h = harness();
    await h.phone.start(h.ctx);
    h.phone.trigger({ kind: 'incoming-call', name: 'Maria Lopez' });
    const ringing = h.of('call').at(-1)!.message;
    expect(ringing).toMatchObject({ state: 'ringing', callerName: 'Maria Lopez' });
    h.phone.deliver({ t: 'call-action', callId: 'someone-else', action: 'accept' });
    expect(h.of('call')).toHaveLength(1);
    h.phone.deliver({ t: 'call-action', callId: ringing.id, action: 'accept' });
    expect(h.of('call').at(-1)!.message.state).toBe('active');
    h.phone.deliver({ t: 'call-action', callId: ringing.id, action: 'accept' }); // already active
    expect(h.of('call')).toHaveLength(2);
    await h.clock.advance(CALL_DURATION_MS);
    expect(h.of('call').at(-1)!.message.state).toBe('ended');

    h.phone.trigger({ kind: 'incoming-call' });
    const second = h.of('call').at(-1)!.message;
    expect(second.callerName).toBe('Maria Lopez');
    expect(second.id).not.toBe(ringing.id);
    h.phone.deliver({ t: 'call-action', callId: second.id, action: 'decline' });
    expect(h.of('call').at(-1)!.message).toMatchObject({ id: second.id, state: 'ended' });
    await h.clock.advance(60_000);
    expect(h.of('call').at(-1)!.message.id).toBe(second.id); // no auto-answer after a decline
    // Other HUD messages are ignored.
    h.phone.deliver({ t: 'pong' });
    await h.phone.stop();
  });

  it('replaces a live call with a new one and ends calls on request', async () => {
    const h = harness();
    await h.phone.start(h.ctx);
    h.phone.trigger({ kind: 'incoming-call', name: 'A' });
    h.phone.trigger({ kind: 'incoming-call', name: '  B\u0007 ' });
    expect(h.of('call').map((s) => [s.message.callerName, s.message.state])).toEqual([
      ['A', 'ringing'],
      ['A', 'ended'],
      ['B', 'ringing'],
    ]);
    await h.clock.advance(CALL_AUTO_ANSWER_MS);
    h.phone.trigger({ kind: 'end-call' });
    h.phone.trigger({ kind: 'end-call' }); // nothing left to end
    expect(h.of('call').map((s) => s.message.state)).toEqual([
      'ringing',
      'ended',
      'ringing',
      'active',
      'ended',
    ]);
    await h.phone.stop();
  });

  it('handles messages, tracks and speed cameras from the dev console', async () => {
    const h = harness({ readMessagesAloud: false });
    await h.phone.start(h.ctx);
    h.phone.trigger({ kind: 'message', sender: 'Alex Chen' });
    h.phone.trigger({ kind: 'message' });
    expect(h.of('message').map((s) => [s.message.sender, s.message.readingAloud])).toEqual([
      ['Alex Chen', false],
      ['Alex Chen', false],
    ]);
    h.phone.updateConfig({ phone: { readMessagesAloud: true } });
    h.phone.trigger({ kind: 'message', sender: 'Robin' });
    expect(h.of('message').at(-1)!.message.readingAloud).toBe(true);
    expect(new Set(h.of('message').map((s) => s.message.id)).size).toBe(3);

    const before = h.of('media').at(-1)!.message.trackKey;
    h.phone.trigger({ kind: 'next-track' });
    expect(h.of('media').at(-1)!.message.trackKey).not.toBe(before);

    h.phone.trigger({ kind: 'speed-camera' });
    const camera = h.of('hazards').at(-1)!.message.items;
    expect(camera).toEqual([
      expect.objectContaining({
        type: 'speed-camera',
        distanceM: MANUAL_CAMERA_AHEAD_M,
        speedLimitKph: 50,
      }),
    ]);
    // Parked: the camera is never reached and expires after two minutes.
    await h.clock.advance(125_000);
    expect(h.of('hazards').at(-1)!.message.items).toEqual([]);
    await h.phone.stop();
  });

  it('navigates in manual mode from the odometer and stops on request', async () => {
    const h = harness({ mode: 'manual' });
    await h.phone.start(h.ctx);
    h.phone.trigger({ kind: 'nav-start' });
    expect(h.of('nav').at(-1)!.message).toMatchObject({ active: true, distanceM: 170 });
    h.vehicle.setControls({ throttle: 0.3 });
    await h.drive(15_000);
    const latest = h.of('nav').at(-1)!.message;
    expect(latest.active).toBe(true);
    expect(latest.active && latest.distanceM! < 170).toBe(true);
    h.phone.trigger({ kind: 'nav-stop' });
    expect(h.of('nav').at(-1)!.message).toEqual({ t: 'nav', active: false, source: 'simulator' });
    h.phone.trigger({ kind: 'nav-stop' }); // already off: nothing sent
    expect(h.of('nav').filter((s) => !s.message.active)).toHaveLength(1);
    await h.phone.stop();
  });

  it('goes quiet while disconnected and resends its state on reconnect', async () => {
    const h = harness();
    await h.phone.start(h.ctx);
    h.phone.trigger({ kind: 'nav-start' });
    h.phone.trigger({ kind: 'incoming-call', name: 'Kim' });
    h.phone.trigger({ kind: 'disconnect' });
    h.phone.trigger({ kind: 'disconnect' });
    expect(
      h.events
        .filter((e) => e.type === 'phone/link')
        .map((e) => e.type === 'phone/link' && e.connected),
    ).toEqual([true, false]);
    expect(h.phone.isConnected).toBe(false);
    const count = h.sent.length;
    h.phone.trigger({ kind: 'next-track' });
    h.phone.trigger({ kind: 'message', sender: 'X' });
    h.phone.deliver({ t: 'call-action', callId: 'sim-call-1', action: 'decline' }); // unreachable
    await h.clock.advance(CALL_AUTO_ANSWER_MS);
    expect(h.sent.length).toBe(count);

    h.phone.trigger({ kind: 'connect' });
    const resent = h.sent.slice(count).map((s) => s.message.t);
    expect(resent).toEqual(['road', 'media', 'nav', 'hazards', 'call']);
    expect(h.of('call').at(-1)!.message.state).toBe('active'); // it auto-answered meanwhile
    expect(h.events.filter((e) => e.type === 'phone/link')).toHaveLength(3);
    await h.phone.stop();
  });

  it('ignores triggers while stopped and stops following the vehicle', async () => {
    const h = harness();
    h.phone.trigger({ kind: 'incoming-call' });
    expect(h.sent).toEqual([]);
    await h.phone.start(h.ctx);
    await h.phone.stop();
    const count = h.sent.length;
    h.vehicle.step(25_000); // into 'city'
    h.phone.trigger({ kind: 'message' });
    await h.clock.advance(60_000);
    expect(h.sent.length).toBe(count);
    expect(h.clock.pendingTimers).toBe(0);
  });

  it('logs a failing translator once and keeps going', async () => {
    let calls = 0;
    const h = harness({
      translate: () => {
        calls += 1;
        throw new Error('boom');
      },
    });
    await h.phone.start(h.ctx);
    h.phone.trigger({ kind: 'next-track' });
    h.phone.trigger({ kind: 'next-track' });
    expect(calls).toBeGreaterThan(2);
    const warnings = h.logger.lines('warn');
    expect(warnings.filter((w) => w.includes('"media"'))).toHaveLength(1);
    await h.phone.stop();
  });
});
