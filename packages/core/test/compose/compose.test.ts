import { describe, expect, it } from 'vitest';
import { composeFrame } from '../../src/compose/compose.ts';
import type { HudConfig } from '../../src/types/config.ts';
import type { MessageInfo } from '../../src/types/phone.ts';
import { Harness, T0, callInfo, makeConfig, mediaInfo, roadInfo } from '../state/fixtures.ts';

function message(id: string, overrides: Partial<MessageInfo> = {}): MessageInfo {
  return {
    id,
    sender: 'Alex Chen',
    app: 'WhatsApp',
    receivedAt: 0,
    readingAloud: true,
    ...overrides,
  };
}

function connected(config: HudConfig = makeConfig()): Harness {
  const h = new Harness(config);
  h.obdConnected(T0);
  h.phoneConnected(T0);
  return h;
}

describe('frame basics', () => {
  it('describes an idle, parked HUD', () => {
    const h = new Harness(makeConfig(), undefined, T0, { simulated: true });
    const frame = h.frame();
    expect(frame).toMatchObject({
      at: T0,
      context: 'parked',
      blanked: false,
      alerts: [],
      toast: null,
      call: null,
      shiftLight: null,
      blindSpot: { left: false, right: false },
      collision: 'none',
      status: { obd: 'disconnected', phone: false, simulated: true },
    });
    expect(frame.diagnostics?.page).toBe('overview');
    expect(frame.theme.night).toBe(false);
  });

  it('is JSON-serialisable without loss', () => {
    const h = connected();
    h.run(T0 + 2000, { speed: 40, rpm: 1800, coolantTemp: 90 });
    const frame = h.frame();
    expect(JSON.parse(JSON.stringify(frame))).toEqual(frame);
  });

  it('applies the driver’s brightness trim within limits', () => {
    const config = makeConfig({ display: { brightness: { mode: 'manual', manualLevel: 0.4 } } });
    const h = new Harness(config);
    h.tick(T0 + 100);
    expect(h.frame().theme.brightness).toBe(0.4);
    h.input('brightness-up');
    expect(h.frame().theme.brightness).toBe(0.5);
    for (let i = 0; i < 10; i++) h.input('brightness-down');
    expect(h.frame().theme.brightness).toBe(0.05);
    const bright = new Harness(
      makeConfig({ display: { brightness: { mode: 'manual', manualLevel: 0.9 } } }),
    );
    bright.tick(T0 + 100);
    for (let i = 0; i < 5; i++) bright.input('brightness-up');
    expect(bright.frame().theme.brightness).toBe(1);
  });

  it('reports night mode', () => {
    const h = new Harness();
    h.send({ type: 'sensor/light', lux: 2, at: T0 + 10 });
    h.tick(T0 + 20);
    expect(h.frame().theme.night).toBe(true);
  });
});

describe('alerts in the frame', () => {
  it('shows visible alerts as frames, most severe first, capped', () => {
    const h = connected();
    h.samples(T0 + 100, { speed: 0, rpm: 800, coolantTemp: 125, fuelLevel: 4 });
    h.send({
      type: 'obd/dtcs',
      milOn: true,
      stored: ['P0301'],
      pending: [],
      permanent: [],
      at: T0 + 200,
    });
    const { alerts } = h.frame();
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toEqual({
      key: 'coolant',
      kind: 'coolant',
      severity: 'critical',
      title: 'OVERHEATING – STOP',
      detail: 'Coolant 125 °C',
      code: null,
      dismissible: false,
    });
    expect(alerts[1]?.severity).not.toBe('critical');
  });

  it('holds back minor check-engine alerts while moving', () => {
    const h = connected();
    h.send({
      type: 'obd/dtcs',
      milOn: false,
      stored: [],
      pending: ['P0420'],
      permanent: [],
      at: T0 + 10,
    });
    h.run(T0 + 3000, { speed: 0, rpm: 800 });
    expect(h.frame().alerts.map((a) => a.key)).toEqual(['check-engine:P0420']);
    h.run(h.now + 2000, { speed: 40, rpm: 1800 });
    expect(h.state.context.context).toBe('city');
    expect(h.frame().alerts).toEqual([]);
  });
});

describe('toast', () => {
  it('shows the message sender, fading over the last second', () => {
    const h = connected();
    h.send({ type: 'message/received', message: message('m1'), at: T0 + 1000 });
    expect(h.frame().toast).toEqual({
      kind: 'message',
      title: 'Alex Chen',
      subtitle: 'WhatsApp',
      opacity: 1,
    });
    h.tick(T0 + 1000 + 5000);
    expect(h.frame().toast?.opacity).toBe(1);
    h.tick(T0 + 1000 + 5600);
    expect(h.frame().toast?.opacity).toBe(0.4);
    h.tick(T0 + 1000 + 6000);
    expect(h.frame().toast).toBeNull();
  });

  it('prefers a message over a track change', () => {
    const h = connected();
    h.send({ type: 'media/update', media: mediaInfo(), at: T0 + 100 });
    expect(h.frame().toast).toEqual({
      kind: 'media',
      title: 'Midnight City',
      subtitle: 'M83',
      opacity: 1,
    });
    h.send({ type: 'message/received', message: message('m1'), at: T0 + 200 });
    expect(h.frame().toast?.kind).toBe('message');
    h.tick(T0 + 200 + 6000);
    expect(h.frame().toast).toBeNull(); // the track toast has run out too
  });

  it('respects the phone settings', () => {
    const h = connected(makeConfig({ phone: { showMessageSender: false } }));
    h.send({ type: 'media/update', media: mediaInfo(), at: T0 + 100 });
    h.send({ type: 'message/received', message: message('m1'), at: T0 + 200 });
    expect(h.frame().toast?.kind).toBe('media');
    const quiet = connected(makeConfig({ phone: { showMedia: false } }));
    quiet.send({ type: 'media/update', media: mediaInfo(), at: T0 + 100 });
    expect(quiet.frame().toast).toBeNull();
  });

  it('is suppressed during a call', () => {
    const h = connected();
    h.send({ type: 'call/update', call: callInfo({ state: 'active' }), at: T0 + 100 });
    h.send({ type: 'message/received', message: message('m1'), at: T0 + 200 });
    expect(h.frame().toast).toBeNull();
    h.send({ type: 'call/update', call: null, at: T0 + 300 });
    expect(h.frame().toast?.kind).toBe('message');
  });

  it('stays dismissed, but a newer toast shows', () => {
    const h = connected();
    h.send({ type: 'message/received', message: message('m1'), at: T0 + 100 });
    h.input('secondary', T0 + 500);
    expect(h.frame().toast).toBeNull();
    h.send({ type: 'media/update', media: mediaInfo(), at: T0 + 700 });
    expect(h.frame().toast?.kind).toBe('media');
    h.send({ type: 'message/received', message: message('m2', { sender: 'Sam' }), at: T0 + 900 });
    expect(h.frame().toast?.title).toBe('Sam');
  });

  it('never shows message content (the contract carries none)', () => {
    const h = connected();
    h.send({ type: 'message/received', message: message('m1'), at: T0 + 100 });
    expect(Object.keys(h.frame().toast ?? {})).toEqual(['kind', 'title', 'subtitle', 'opacity']);
  });
});

describe('call card', () => {
  it('shows a ringing call with accept and decline', () => {
    const h = connected();
    h.send({ type: 'call/update', call: callInfo(), at: T0 + 100 });
    expect(h.frame().call).toEqual({
      state: 'ringing',
      name: 'Maria Lopez',
      number: '+1 415 555 0132',
      durationS: null,
      canAccept: true,
      canDecline: true,
    });
  });

  it('falls back to the number, then "Unknown caller"', () => {
    const h = connected();
    h.send({ type: 'call/update', call: callInfo({ callerName: ' ' }), at: T0 + 100 });
    expect(h.frame().call?.name).toBe('+1 415 555 0132');
    h.send({
      type: 'call/update',
      call: callInfo({ callerName: null, number: null }),
      at: T0 + 200,
    });
    expect(h.frame().call?.name).toBe('Unknown caller');
  });

  it('times an active call from pickup', () => {
    const h = connected();
    h.send({ type: 'call/update', call: callInfo(), at: T0 + 100 });
    h.send({ type: 'call/update', call: callInfo({ state: 'active' }), at: T0 + 5000 });
    h.tick(T0 + 5000 + 127_400);
    expect(h.frame().call).toMatchObject({
      state: 'active',
      durationS: 127,
      canAccept: false,
      canDecline: true,
    });
    h.send({ type: 'call/update', call: callInfo({ state: 'held' }), at: T0 + 140_000 });
    expect(h.frame().call).toMatchObject({ durationS: 135, canDecline: false });
  });

  it('shows "ended" for 2 s', () => {
    const h = connected();
    h.send({ type: 'call/update', call: callInfo({ state: 'ended' }), at: T0 + 100 });
    expect(h.frame().call).toMatchObject({ state: 'ended', canAccept: false, canDecline: false });
    // Even between ticks, the composer never shows it longer.
    const later = composeFrame({ ...h.state, now: T0 + 2100 }, h.config);
    expect(later.call).toBeNull();
  });

  it('shows dialing with decline only', () => {
    const h = connected();
    h.send({ type: 'call/update', call: callInfo({ state: 'dialing' }), at: T0 + 100 });
    expect(h.frame().call).toMatchObject({ canAccept: false, canDecline: true, durationS: null });
  });
});

describe('shift light', () => {
  const config = makeConfig({ shiftLight: { enabled: true } });

  it('fills from start to shift rpm and flashes above flash rpm', () => {
    const h = connected(config);
    h.run(T0 + 2000, { speed: 60, rpm: 5250 });
    expect(h.frame().shiftLight).toEqual({ level: 0.5, flash: false });
    h.samples(h.now + 100, { speed: 60, rpm: 6400 });
    expect(h.frame().shiftLight).toEqual({ level: 1, flash: true });
    h.samples(h.now + 100, { speed: 60, rpm: 3000 });
    expect(h.frame().shiftLight).toBeNull();
  });

  it('is off when parked or disabled', () => {
    const h = connected(config);
    h.samples(T0 + 100, { speed: 0, rpm: 6000 });
    expect(h.state.context.context).toBe('parked');
    expect(h.frame().shiftLight).toBeNull();
    const off = connected();
    off.run(T0 + 2000, { speed: 60, rpm: 6000 });
    expect(off.frame().shiftLight).toBeNull();
  });
});

describe('ADAS', () => {
  it('shows fresh readings from a connected module', () => {
    const h = connected();
    h.send({ type: 'adas/link', connected: true, at: T0 });
    h.send({ type: 'adas/blind-spot', left: true, right: false, at: T0 + 100 });
    h.send({ type: 'adas/collision', level: 'warning', ttcSeconds: 1.1, at: T0 + 100 });
    expect(h.frame()).toMatchObject({
      blindSpot: { left: true, right: false },
      collision: 'warning',
    });
    h.tick(T0 + 1100);
    expect(h.frame()).toMatchObject({
      blindSpot: { left: true, right: false },
      collision: 'warning',
    });
    h.tick(T0 + 1101);
    expect(h.frame()).toMatchObject({
      blindSpot: { left: false, right: false },
      collision: 'none',
    });
  });

  it('ignores a disconnected module', () => {
    const h = connected();
    h.send({ type: 'adas/collision', level: 'caution', ttcSeconds: null, at: T0 + 100 });
    h.send({ type: 'adas/link', connected: false, at: T0 + 200 });
    expect(h.frame().collision).toBe('none');
  });
});

describe('blanked display', () => {
  it('withholds everything but critical alerts and the collision warning', () => {
    const h = connected();
    h.run(T0 + 3000, { speed: 50, rpm: 2000, coolantTemp: 125, fuelLevel: 4 });
    h.send({ type: 'road/update', road: roadInfo(50), at: h.now });
    h.send({ type: 'message/received', message: message('m1'), at: h.now });
    h.send({ type: 'call/update', call: callInfo(), at: h.now });
    h.send({ type: 'adas/blind-spot', left: true, right: true, at: h.now });
    h.send({ type: 'adas/collision', level: 'warning', ttcSeconds: 0.9, at: h.now });
    const open = h.frame();
    expect(open.widgets.length).toBeGreaterThan(0);
    expect(open.alerts.length).toBeGreaterThan(1);
    expect(open.call).not.toBeNull();
    h.input('toggle-blank');
    const frame = h.frame();
    expect(frame.blanked).toBe(true);
    expect(frame.widgets).toEqual([]);
    expect(frame.toast).toBeNull();
    expect(frame.call).toBeNull();
    expect(frame.diagnostics).toBeNull();
    expect(frame.shiftLight).toBeNull();
    expect(frame.blindSpot).toEqual({ left: false, right: false });
    expect(frame.collision).toBe('warning');
    expect(frame.alerts.map((a) => a.severity)).toEqual(['critical', 'critical']);
  });

  it('withholds the parked dashboard', () => {
    const h = new Harness();
    h.input('toggle-blank');
    expect(h.frame().diagnostics).toBeNull();
  });
});
