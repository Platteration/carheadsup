import { describe, expect, it } from 'vitest';
import { PAIRING_PAGE_TIMEOUT_MS, composePairing } from '../../src/compose/diagnostics.ts';
import { parsePairingUri } from '../../src/protocol/pairing.ts';
import { diagnosticsPageKinds } from '../../src/compose/diagnostics.ts';
import type { HudFrame } from '../../src/types/frame.ts';
import type { PairingEndpoint } from '../../src/types/state.ts';
import { Harness, T0, makeConfig } from './fixtures.ts';

const TOKEN = 'K7fQ2mZrP4xW9sLt3HvNbC8e';
const ENDPOINT: PairingEndpoint = {
  hudId: 'AAECAwQFBgcICQoLDA0ODw',
  certFingerprint: 'fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531',
  tlsPort: 8443,
  hosts: ['10.42.0.1', 'carheadsup.local'],
};

/** A parked HUD (engine off, link down: parked from the start) that knows its endpoint. */
function parkedHud(token = TOKEN, vehicleName = 'Golf'): Harness {
  const h = new Harness(
    makeConfig({ phone: { pairingToken: token }, vehicle: { name: vehicleName } }),
  );
  h.send({ type: 'pairing/endpoint', endpoint: ENDPOINT, at: T0 });
  expect(h.state.context.context).toBe('parked');
  return h;
}

/** Drive off from a parked HUD, then stop again for `stopMs` with the engine idling. */
function driveAndStop(h: Harness, stopMs = 3000): void {
  h.obdConnected(h.now);
  h.run(h.now + 5000, { speed: 40, rpm: 1800 });
  expect(h.state.context.context).toBe('city');
  h.run(h.now + stopMs, { speed: 0, rpm: 800 });
}

const pageOf = (frame: HudFrame) => frame.diagnostics?.page ?? null;

describe('the "Pair a phone" page', () => {
  it('is the last page of the parked dashboard, reached with the page buttons', () => {
    const h = parkedHud();
    expect(diagnosticsPageKinds(h.state).at(-1)).toBe('pair');
    h.input('prev-page', T0 + 100);
    const frame = h.frame();
    expect(pageOf(frame)).toBe('pair');
    expect(frame.diagnostics?.title).toBe('Pair a phone');
    expect(h.state.ui.pairingShownAt).toBe(T0 + 100);
    h.input('next-page', T0 + 200);
    expect(pageOf(h.frame())).toBe('overview');
    expect(h.state.ui.pairingShownAt).toBeNull();
  });

  it('shows the pairing URI with everything the phone needs', () => {
    const h = parkedHud(TOKEN, '  Golf \n 7 ');
    h.send({ type: 'pairing/show', at: T0 + 100 });
    const pairing = h.frame().diagnostics?.pairing;
    expect(pairing).toMatchObject({
      status: 'ready',
      hudName: 'Golf 7 HUD',
      fingerprint: 'FDC1 53EE DCA2 B536 4DD7',
      closesInS: PAIRING_PAGE_TIMEOUT_MS / 1000,
    });
    expect(parsePairingUri(pairing?.uri ?? '')).toEqual({
      ok: true,
      payload: {
        hudId: ENDPOINT.hudId,
        certFingerprint: ENDPOINT.certFingerprint,
        pairingToken: TOKEN,
        hosts: ENDPOINT.hosts,
        tlsPort: 8443,
        hudName: 'Golf 7 HUD',
      },
    });
  });

  it('puts the pairing token in no other frame', () => {
    const h = parkedHud();
    h.obdConnected(T0);
    h.samples(T0 + 100, { rpm: 800, speed: 0, fuelLevel: 40, batteryVoltage: 14 });
    const pages = diagnosticsPageKinds(h.state);
    expect(pages).toContain('engine');
    let pairFrames = 0;
    for (let i = 0; i < pages.length; i++) {
      h.input('next-page', T0 + 200 + i);
      const frame = h.frame();
      const json = JSON.stringify(frame);
      if (pageOf(frame) === 'pair') {
        pairFrames++;
        expect(json).toContain(TOKEN);
      } else {
        expect(frame.diagnostics?.pairing).toBeNull();
        expect(json).not.toContain(TOKEN);
      }
    }
    expect(pairFrames).toBe(1);
  });

  it('says so instead of showing a code when the HUD has no pairing token', () => {
    const h = parkedHud('');
    h.send({ type: 'pairing/show', at: T0 + 100 });
    expect(h.frame().diagnostics?.pairing).toEqual({
      status: 'open',
      hudName: 'Golf HUD',
      uri: null,
      fingerprint: 'FDC1 53EE DCA2 B536 4DD7',
      closesInS: 180,
    });
  });

  it('is unavailable while the phone link is off or has no usable address', () => {
    const h = parkedHud();
    h.send({ type: 'pairing/endpoint', endpoint: null, at: T0 + 50 });
    h.send({ type: 'pairing/show', at: T0 + 100 });
    expect(h.frame().diagnostics?.pairing).toMatchObject({
      status: 'unavailable',
      uri: null,
      fingerprint: null,
    });
    h.send({
      type: 'pairing/endpoint',
      endpoint: { ...ENDPOINT, hosts: ['fe80::1', 'bad host'] },
      at: T0 + 200,
    });
    expect(h.frame().diagnostics?.pairing).toMatchObject({
      status: 'unavailable',
      uri: null,
      fingerprint: 'FDC1 53EE DCA2 B536 4DD7',
    });
  });

  it('leaves out hosts a phone cannot use, and duplicates', () => {
    const h = parkedHud();
    const hosts = [
      '10.42.0.1',
      'fe80::1',
      '10.42.0.1',
      ...Array.from({ length: 9 }, (_, i) => `10.9.0.${i}`),
    ];
    h.send({ type: 'pairing/endpoint', endpoint: { ...ENDPOINT, hosts }, at: T0 + 50 });
    h.send({ type: 'pairing/show', at: T0 + 100 });
    const parsed = parsePairingUri(h.frame().diagnostics?.pairing?.uri ?? '');
    expect(parsed.ok && parsed.payload.hosts).toEqual([
      '10.42.0.1',
      ...Array.from({ length: 7 }, (_, i) => `10.9.0.${i}`),
    ]);
  });

  it('follows a new endpoint, and keeps the state when it is unchanged', () => {
    const h = parkedHud();
    const before = h.state;
    h.send({
      type: 'pairing/endpoint',
      endpoint: { ...ENDPOINT, hosts: [...ENDPOINT.hosts] },
      at: T0,
    });
    expect(h.state.pairing).toBe(before.pairing);
    h.send({
      type: 'pairing/endpoint',
      endpoint: { ...ENDPOINT, hosts: ['192.168.1.23', 'carheadsup.local'] },
      at: T0 + 10,
    });
    expect(h.state.pairing?.hosts).toEqual(['192.168.1.23', 'carheadsup.local']);
    h.send({ type: 'pairing/endpoint', endpoint: null, at: T0 + 20 });
    expect(h.state.pairing).toBeNull();
  });

  it('turns back to the overview after its time-out', () => {
    const h = parkedHud();
    h.send({ type: 'pairing/show', at: T0 + 1000 });
    h.idle(T0 + 1000 + 60_000);
    expect(h.frame().diagnostics?.pairing?.closesInS).toBe(120);
    h.tick(T0 + 1000 + PAIRING_PAGE_TIMEOUT_MS - 1);
    expect(pageOf(h.frame())).toBe('pair');
    expect(h.frame().diagnostics?.pairing?.closesInS).toBe(1);
    h.tick(T0 + 1000 + PAIRING_PAGE_TIMEOUT_MS);
    expect(pageOf(h.frame())).toBe('overview');
    expect(h.state.ui.pairingShownAt).toBeNull();
    // Showing it again starts a new time-out.
    h.send({ type: 'pairing/show', at: h.now + 10 });
    expect(pageOf(h.frame())).toBe('pair');
    expect(h.frame().diagnostics?.pairing?.closesInS).toBe(180);
  });

  it('restarts the time-out when shown again from the settings app', () => {
    const h = parkedHud();
    h.send({ type: 'pairing/show', at: T0 + 1000 });
    h.send({ type: 'pairing/show', at: T0 + 100_000 });
    h.tick(T0 + 1000 + PAIRING_PAGE_TIMEOUT_MS);
    expect(pageOf(h.frame())).toBe('pair');
    h.tick(T0 + 100_000 + PAIRING_PAGE_TIMEOUT_MS);
    expect(pageOf(h.frame())).toBe('overview');
  });

  it('unblanks the HUD when shown from the settings app', () => {
    const h = parkedHud();
    h.input('toggle-blank', T0 + 10);
    expect(h.frame().diagnostics).toBeNull();
    h.send({ type: 'pairing/show', at: T0 + 20 });
    expect(h.state.ui.blanked).toBe(false);
    expect(pageOf(h.frame())).toBe('pair');
  });

  it('never appears while moving or stopped, and not by itself at the next stop', () => {
    const h = parkedHud();
    h.send({ type: 'pairing/show', at: T0 + 100 });
    expect(pageOf(h.frame())).toBe('pair');
    // Driving off closes the dashboard…
    driveAndStop(h);
    expect(h.state.context.context).toBe('stopped');
    expect(h.frame().diagnostics).toBeNull();
    expect(h.state.ui.pairingShownAt).toBeNull();
    // …the settings app cannot bring the page up while stopped…
    const stopped = h.state;
    h.send({ type: 'pairing/show', at: h.now + 10 });
    expect(h.state.ui).toEqual(stopped.ui);
    expect(h.frame().diagnostics).toBeNull();
    // …the stopped dashboard has no such page, whichever way the driver pages…
    h.input('next-page', h.now + 10);
    expect(pageOf(h.frame())).toBe('overview');
    for (let i = 0; i < 12; i++) {
      h.input(i % 3 === 0 ? 'next-page' : 'prev-page', h.now + 10);
      const frame = h.frame();
      expect(pageOf(frame)).not.toBe('pair');
      expect(frame.diagnostics?.pairing ?? null).toBeNull();
    }
    h.input('secondary', h.now + 10);
    expect(h.frame().diagnostics).toBeNull();
    // …and once parked again the dashboard opens where the driver left it, not on the code.
    h.run(h.now + 125_000, { speed: 0, rpm: 800 }, 1000);
    expect(h.state.context.context).toBe('parked');
    expect(pageOf(h.frame())).not.toBe('pair');
  });

  it('gives way to the overview when the car drives off, and stays away', () => {
    const h = parkedHud();
    h.send({ type: 'pairing/show', at: T0 + 100 });
    driveAndStop(h, 125_000);
    expect(h.state.context.context).toBe('parked');
    expect(pageOf(h.frame())).toBe('overview');
    expect(h.state.ui.pairingShownAt).toBeNull();
  });

  it('is refused while moving', () => {
    const h = parkedHud();
    h.obdConnected(T0);
    h.run(T0 + 5000, { speed: 60, rpm: 2000 });
    const moving = h.state;
    h.send({ type: 'pairing/show', at: h.now + 10 });
    expect(h.state.ui).toEqual(moving.ui);
    expect(h.frame().diagnostics).toBeNull();
  });

  it('composes nothing secret without an endpoint and counts down from when it came up', () => {
    const h = parkedHud();
    h.send({ type: 'pairing/show', at: T0 + 500 });
    h.idle(T0 + 500 + 30_000);
    expect(composePairing(h.state, h.config).closesInS).toBe(150);
    const noEndpoint = { ...h.state, pairing: null };
    expect(composePairing(noEndpoint, h.config)).toMatchObject({
      status: 'unavailable',
      uri: null,
    });
  });
});
