import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { composeFrame, parsePairingUri, parseStoredConfig } from '@carheadsup/core';
import type {
  ApiConfigResult,
  ApiPairingShowResult,
  HudConfig,
  HudFrame,
  PairingPayload,
} from '@carheadsup/core';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeConfig } from '../../src/store/config-store.ts';
import { connectTestPhone, startTestServer, waitFor } from '../helpers.ts';
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

describe('a pairing token from before the pairing-token rule', () => {
  const LEGACY = 'mein Schlüssel';

  /** A HUD whose config.json an older version wrote, with a token that breaks today's rule. */
  async function startLegacy(): Promise<TestServer> {
    const stored = parseStoredConfig({
      phone: { pairingToken: LEGACY },
      vehicle: { name: 'Golf' },
    }).config;
    return start({
      files: { 'config.json': serializeConfig(stored) },
      pairingHosts: () => ['10.42.0.1'],
    });
  }

  /** PATCH /api/config; `status` 422 when every field sent was refused. */
  async function patch(t: TestServer, body: unknown, status = 200): Promise<ApiConfigResult> {
    const res = await fetch(`${t.base}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(status);
    return (await res.json()) as ApiConfigResult;
  }

  async function storedToken(t: TestServer): Promise<string> {
    const text = await readFile(join(t.dataDir, 'config.json'), 'utf8');
    return (JSON.parse(text) as HudConfig).phone.pairingToken;
  }

  it('is kept and reported, and phones paired with it keep connecting', async () => {
    const t = await startLegacy();
    expect(t.server.engine.config.phone.pairingToken).toBe(LEGACY);
    expect(await storedToken(t)).toBe(LEGACY);
    expect(t.logger.text('warn')).toMatch(
      /phone\.pairingToken .* breaks the pairing-code rule .* kept as it is/,
    );
    expect(t.logger.text('error')).toBe('');
    const config = (await (await fetch(`${t.base}/api/config`)).json()) as HudConfig;
    expect(config.phone.pairingToken).toBe(LEGACY);
    const { socket, welcome } = await connectTestPhone(t.phoneBase, { token: LEGACY });
    expect(welcome).toMatchObject({ t: 'welcome' });
    socket.close();
  });

  it('stays while other settings change, by PATCH or PUT', async () => {
    const t = await startLegacy();
    const patched = await patch(t, { vehicle: { name: 'Weekend car' } });
    expect(patched.errors).toEqual([]);
    expect(patched.config.phone.pairingToken).toBe(LEGACY);
    expect(patched.config.vehicle.name).toBe('Weekend car');
    // The settings app sends back what it got.
    const res = await fetch(`${t.base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...patched.config,
        vehicle: { ...patched.config.vehicle, name: 'Golf' },
      }),
    });
    const put = (await res.json()) as ApiConfigResult;
    expect(put.errors).toEqual([]);
    expect(put.config.phone.pairingToken).toBe(LEGACY);
    expect(await storedToken(t)).toBe(LEGACY);
  });

  it('cannot be shown as a pairing code: the HUD asks for a new one', async () => {
    const t = await startLegacy();
    const res = await showPairing(t);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: 'legacy-code' });
    expect(res.body.message).toMatch(/cannot carry .*older versions allowed.*generate a new code/);
    expect(res.body.message).not.toMatch(/it is from an older version/);
    expect(frame(t).diagnostics?.pairing).toMatchObject({ status: 'legacy-code', uri: null });
  });

  it('gives way to a new token that keeps the rule, and is never taken anew', async () => {
    const t = await startLegacy();
    const refused = await patch(t, { phone: { pairingToken: 'another phrase' } }, 422);
    expect(refused.errors.join('\n')).toMatch(/^phone\.pairingToken: no spaces/m);
    expect(refused.config.phone.pairingToken).toBe(LEGACY);
    const replaced = await patch(t, { phone: { pairingToken: TOKEN } });
    expect(replaced.errors).toEqual([]);
    expect(replaced.config.phone.pairingToken).toBe(TOKEN);
    const back = await patch(t, { phone: { pairingToken: LEGACY } }, 422);
    expect(back.errors.join('\n')).toMatch(/^phone\.pairingToken: no spaces/m);
    expect(back.config.phone.pairingToken).toBe(TOKEN);
    expect((await showPairing(t)).body.status).toBe('ready');
  });
});
