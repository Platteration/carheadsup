import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { composeFrame, parsePairingUri } from '@carheadsup/core';
import type { ApiPairingShowResult, HudConfig, HudFrame, PairingPayload } from '@carheadsup/core';
import { afterEach, describe, expect, it } from 'vitest';
import { startTestServer, waitFor } from '../helpers.ts';
import type { TestServer, TestServerOptions } from '../helpers.ts';

const TOKEN = 'K7fQ2mZrP4xW9sLt3HvNbC8e';

let current: TestServer | null = null;

async function start(options: TestServerOptions = {}): Promise<TestServer> {
  current = await startTestServer(options);
  return current;
}

afterEach(async () => {
  await current?.stop();
  current = null;
});

async function showPairing(t: TestServer): Promise<{ status: number; body: ApiPairingShowResult }> {
  const res = await fetch(`${t.base}/api/pairing/show`, { method: 'POST' });
  return { status: res.status, body: (await res.json()) as ApiPairingShowResult };
}

function frame(t: TestServer): HudFrame {
  return composeFrame(t.server.engine.state, t.server.engine.config);
}

/** The payload of the QR code on the HUD right now. */
function shownPayload(t: TestServer): PairingPayload {
  const parsed = parsePairingUri(frame(t).diagnostics?.pairing?.uri ?? '');
  if (!parsed.ok) throw new Error(`no pairing code on the HUD: ${parsed.detail}`);
  return parsed.payload;
}

async function hudId(t: TestServer): Promise<string> {
  return (await readFile(join(t.dataDir, 'hud-id'), 'utf8')).trim();
}

function drive(t: TestServer): void {
  t.obd.emit({ type: 'obd/link', state: 'connected', at: 0 });
  t.obd.emit({
    type: 'obd/samples',
    samples: [
      { signal: 'rpm', value: 2000 },
      { signal: 'speed', value: 60 },
    ],
    at: 0,
  });
}

describe('POST /api/pairing/show', () => {
  it('turns the parked dashboard to the pairing code, with everything the phone needs', async () => {
    const hosts = ['10.42.0.1', 'carheadsup.local'];
    const listenHosts: string[] = [];
    const t = await start({
      config: { phone: { pairingToken: TOKEN }, vehicle: { name: 'Golf' } },
      pairingHosts: (listenHost) => {
        listenHosts.push(listenHost);
        return hosts;
      },
    });
    expect(frame(t).diagnostics?.page).toBe('overview');
    const res = await showPairing(t);
    expect(res).toEqual({
      status: 200,
      body: {
        ok: true,
        status: 'ready',
        message: expect.stringMatching(/scan it with the carheadsup app/) as unknown,
      },
    });
    expect(frame(t).diagnostics?.page).toBe('pair');
    expect(shownPayload(t)).toEqual({
      hudId: await hudId(t),
      certFingerprint: t.fingerprint,
      pairingToken: TOKEN,
      hosts,
      tlsPort: t.tlsPort,
      hudName: 'Golf HUD',
    });
    // The addresses are looked up for the address the server listens on.
    expect(new Set(listenHosts)).toEqual(new Set(['127.0.0.1']));
  });

  it('is refused unless the car is parked', async () => {
    const t = await start({ config: { phone: { pairingToken: TOKEN } } });
    drive(t);
    expect(t.server.engine.state.context.context).toBe('city');
    const res = await showPairing(t);
    expect(res).toEqual({
      status: 409,
      body: {
        ok: false,
        status: null,
        message: 'The HUD shows its pairing code only while the car is parked',
      },
    });
    expect(frame(t).diagnostics).toBeNull();
    expect(JSON.stringify(frame(t))).not.toContain(TOKEN);
  });

  it('says so when the HUD has no pairing code or no phone link', async () => {
    const open = await start();
    expect((await showPairing(open)).body).toMatchObject({ ok: true, status: 'open' });
    expect(frame(open).diagnostics?.pairing).toMatchObject({ status: 'open', uri: null });
    await open.stop();
    current = null;

    const noTls = await start({ config: { phone: { pairingToken: TOKEN } }, tlsPort: null });
    expect((await showPairing(noTls)).body).toMatchObject({ ok: true, status: 'unavailable' });
    expect(frame(noTls).diagnostics?.pairing).toMatchObject({ status: 'unavailable', uri: null });
  });

  it('has nothing to show where no phone can reach the HUD', async () => {
    // The test server listens on 127.0.0.1 only.
    const t = await start({ config: { phone: { pairingToken: TOKEN } } });
    expect((await showPairing(t)).body).toMatchObject({ ok: true, status: 'unavailable' });
    expect(t.server.engine.state.pairing?.hosts).toEqual([]);
  });

  it('looks up the HUD’s addresses again before showing the code', async () => {
    let hosts = ['10.42.0.1'];
    const t = await start({
      config: { phone: { pairingToken: TOKEN } },
      pairingHosts: () => hosts,
    });
    await showPairing(t);
    expect(shownPayload(t).hosts).toEqual(['10.42.0.1']);
    hosts = ['192.168.1.23', 'carheadsup.local'];
    await showPairing(t);
    expect(shownPayload(t).hosts).toEqual(['192.168.1.23', 'carheadsup.local']);
  });

  it('follows address changes while the page is up', async () => {
    let wall = Date.now();
    let hosts = ['10.42.0.1'];
    const t = await start({
      config: { phone: { pairingToken: TOKEN } },
      pairingHosts: () => hosts,
      now: () => wall,
    });
    await showPairing(t);
    hosts = ['10.42.0.99'];
    // Not before the refresh interval…
    const frames: HudFrame[] = [];
    const unsubscribe = t.server.engine.onFrame((f) => frames.push(f));
    await waitFor(() => frames.length >= 3, 3000, 'frames');
    expect(shownPayload(t).hosts).toEqual(['10.42.0.1']);
    // …then within a frame or two.
    wall += 6000;
    await waitFor(
      () => t.server.engine.state.pairing?.hosts[0] === '10.42.0.99',
      3000,
      'new hosts',
    );
    expect(shownPayload(t).hosts).toEqual(['10.42.0.99']);
    unsubscribe();
  });
});

describe('a new HUD', () => {
  it('pairs by QR code out of the box: its new config has a pairing token', async () => {
    const t = await start({ createsConfig: true, pairingHosts: () => ['10.42.0.1'] });
    const stored = JSON.parse(await readFile(join(t.dataDir, 'config.json'), 'utf8')) as HudConfig;
    expect(stored.phone.pairingToken).toMatch(/^[A-Za-z2-9]{24}$/);
    expect((await showPairing(t)).body).toMatchObject({ ok: true, status: 'ready' });
    expect(shownPayload(t).pairingToken).toBe(stored.phone.pairingToken);
  });
});
