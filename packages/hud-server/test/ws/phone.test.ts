import { readFile } from 'node:fs/promises';
import { get } from 'node:http';
import { join } from 'node:path';
import { PROTOCOL_VERSION, isAuthId } from '@carheadsup/core';
import type { ApiInfo, TripRecord } from '@carheadsup/core';
import { afterEach, describe, expect, it } from 'vitest';
import { HUD_VERSION } from '../../src/meta.ts';
import { hudProof } from '../../src/phone/auth.ts';
import { createSimulation } from '../../src/sim/index.ts';
import { SIM_PHONE_DEVICE } from '../../src/sim/phone.ts';
import { PHONE_CLOSE } from '../../src/ws/phone-channel.ts';
import { tlsRequiredMessage } from '../../src/ws/upgrade.ts';
import {
  FakeSimulation,
  TestSocket,
  answerChallenge,
  connectTestPhone,
  helloOn,
  startTestServer,
  testDeviceId,
  waitFor,
} from '../helpers.ts';
import type { TestPhone, TestServer, TestServerOptions } from '../helpers.ts';

let current: TestServer | null = null;
const sockets: TestSocket[] = [];

async function start(options: TestServerOptions = {}): Promise<TestServer> {
  current = await startTestServer(options);
  return current;
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await current?.stop();
  current = null;
});

/** A phone socket to the HUD's TLS listener. */
function phone(t: TestServer): TestSocket {
  const socket = new TestSocket(`${t.phoneBase}/ws/phone`);
  sockets.push(socket);
  return socket;
}

/** Open a phone socket and answer the HUD's challenge as `identity`. */
async function sayHello(t: TestServer, identity: TestPhone = {}): Promise<TestSocket> {
  const socket = phone(t);
  await socket.opened;
  await helloOn(socket, identity);
  return socket;
}

/** Connect and complete the handshake. */
async function connected(t: TestServer, identity: TestPhone = {}): Promise<TestSocket> {
  const { socket } = await connectTestPhone(t.phoneBase, identity);
  sockets.push(socket);
  return socket;
}

function trip(n: number): TripRecord {
  const startedAt = 1_790_000_000_000 + n * 3_600_000;
  return {
    id: `trip-${n}`,
    startedAt,
    endedAt: startedAt + 600_000,
    distanceKm: n,
    durationS: 600,
    movingS: 500,
    idleS: 100,
    fuelUsedL: null,
    avgLPer100km: null,
    maxSpeedKph: 80,
    avgMovingSpeedKph: 40,
    cost: null,
    currency: 'USD',
    startOdometerKm: null,
    endOdometerKm: null,
  };
}

describe('/ws/phone handshake', () => {
  it('challenges, welcomes a phone with its own proof and reports it connected', async () => {
    const t = await start({
      config: { vehicle: { name: 'Golf' }, phone: { readMessagesAloud: false } },
    });
    const socket = phone(t);
    await socket.opened;
    // The phone sees the HUD's own certificate, and binds its proof to it.
    expect(socket.peerFingerprint).toBe(t.fingerprint);
    const challenge = await socket.next();
    const hudId = (await readFile(join(t.dataDir, 'hud-id'), 'utf8')).trim();
    expect(isAuthId(hudId)).toBe(true);
    expect(challenge).toEqual({
      t: 'challenge',
      v: PROTOCOL_VERSION,
      hudId,
      nonce: expect.stringMatching(/^[\w-]{22}$/),
    });
    const hello = answerChallenge(challenge, {}, socket.peerFingerprint);
    socket.send(hello);
    expect(await socket.next()).toEqual({
      t: 'welcome',
      v: PROTOCOL_VERSION,
      hudName: 'Golf',
      hudVersion: HUD_VERSION,
      readMessagesAloud: false,
      hudId,
      proof: hudProof('', {
        hudId,
        hudNonce: String(challenge['nonce']),
        phoneNonce: String(hello['nonce']),
        deviceId: String(hello['deviceId']),
        certFingerprint: t.fingerprint ?? '',
      }),
    });
    await waitFor(() => t.server.engine.state.phone.connected, 1000, 'phone link');
    expect(t.server.engine.state.phone).toMatchObject({
      deviceName: 'Pixel 9',
      deviceId: hello['deviceId'],
      appVersion: '1.2.3',
    });
    const info = await (await fetch(`${t.base}/api/info`)).json();
    expect(info).toMatchObject({ phoneConnected: true });
  });

  it('uses the identity kept in its data directory', async () => {
    const t = await start({ files: { 'hud-id': 'AAECAwQFBgcICQoLDA0ODw\n' } });
    const { socket, welcome } = await connectTestPhone(t.phoneBase);
    sockets.push(socket);
    expect(welcome['hudId']).toBe('AAECAwQFBgcICQoLDA0ODw');
  });

  it('checks the pairing token when one is configured', async () => {
    const t = await start({ config: { phone: { pairingToken: 'K7fQ2mZr' } } });
    const wrong = await sayHello(t, { token: 'guess' });
    expect(await wrong.nextOfType('error')).toMatchObject({ t: 'error', code: 'bad-token' });
    expect(await wrong.closed).toBe(PHONE_CLOSE.badToken);
    expect(t.server.engine.state.phone.connected).toBe(false);

    const right = await connected(t, { token: 'K7fQ2mZr' });
    expect(right.ws.readyState).toBe(right.ws.OPEN);
  });

  it('refuses a proof bound to another certificate: a relay cannot complete the handshake', async () => {
    const t = await start({ config: { phone: { pairingToken: 'K7fQ2mZr' } } });
    // A relay terminates the phone's TLS with a certificate of its own: the phone's proof names
    // that certificate, and the HUD, which knows its own, refuses it — right token or not.
    const relayed = await sayHello(t, { token: 'K7fQ2mZr', certFingerprint: 'e'.repeat(64) });
    expect(await relayed.nextOfType('error')).toMatchObject({ code: 'bad-token' });
    expect(await relayed.closed).toBe(PHONE_CLOSE.badToken);
    // Nor does a proof without any binding pass over TLS.
    const unbound = await sayHello(t, { token: 'K7fQ2mZr', certFingerprint: '' });
    expect(await unbound.closed).toBe(PHONE_CLOSE.badToken);
    expect(t.logger.text('warn')).toContain('relayed through another TLS certificate');
    expect(t.server.engine.state.phone.connected).toBe(false);
    // The same phone, bound to the certificate it really sees, gets in.
    await connected(t, { token: 'K7fQ2mZr' });
    await waitFor(() => t.server.engine.state.phone.connected, 1000, 'phone link');
  });

  it('is served over TLS only: a plain ws:// phone is refused by default', async () => {
    const t = await start();
    const plain = new TestSocket(`${t.wsBase}/ws/phone`);
    sockets.push(plain);
    await expect(plain.opened).rejects.toThrow(/403/);
    expect(t.server.engine.state.phone.connected).toBe(false);
    // The display and the pages stay on the plain listener.
    const hud = new TestSocket(`${t.wsBase}/ws/hud`);
    sockets.push(hud);
    await hud.opened;
    expect((await fetch(`${t.base}/api/info`)).status).toBe(200);
  });

  it('says where to connect instead', async () => {
    const t = await start();
    const answer = await new Promise<string>((resolve, reject) => {
      const request = get(
        `${t.base}/ws/phone`,
        {
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk.toString()));
          res.on('end', () => resolve(`${res.statusCode ?? '?'} ${body}`));
        },
      );
      request.on('error', reject);
    });
    expect(answer).toBe(`403 ${tlsRequiredMessage(t.tlsPort)}\n`);
    expect(answer).toContain(`:${t.tlsPort}/ws/phone`);
  });

  it('takes plain ws:// phones with server.allowPlainPhone, binding nothing, until it is switched off', async () => {
    const t = await start({ config: { server: { allowPlainPhone: true } } });
    // A plain session binds no certificate…
    const { socket: plain, welcome } = await connectTestPhone(t.wsBase, { device: 'Dev phone' });
    sockets.push(plain);
    expect(plain.peerFingerprint).toBe('');
    expect(welcome['t']).toBe('welcome');
    await waitFor(() => t.server.engine.state.phone.connected, 1000, 'phone link');
    expect(t.logger.text('info')).toContain('unencrypted');
    // …and a relay cannot pass a TLS phone's proof off as a plain one's.
    const relayed = new TestSocket(`${t.wsBase}/ws/phone`);
    sockets.push(relayed);
    await relayed.opened;
    await helloOn(relayed, { device: 'Dev phone', certFingerprint: t.fingerprint ?? '' });
    expect(await relayed.closed).toBe(PHONE_CLOSE.badToken);

    const res = await fetch(`${t.base}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: { allowPlainPhone: false } }),
    });
    expect(res.status).toBe(200);
    expect(await plain.closed).toBe(PHONE_CLOSE.tlsRequired);
    await waitFor(() => !t.server.engine.state.phone.connected, 1000, 'phone gone');
    const again = new TestSocket(`${t.wsBase}/ws/phone`);
    sockets.push(again);
    await expect(again.opened).rejects.toThrow(/403/);
    // TLS phones are not affected.
    await connected(t, { device: 'Dev phone' });
  });

  it('runs without a TLS listener when server.tlsPort is null (and a plain phone is allowed)', async () => {
    const t = await start({ tlsPort: null, config: { server: { allowPlainPhone: true } } });
    expect(t.tlsPort).toBeNull();
    expect(t.server.tls).toBeNull();
    expect(((await (await fetch(`${t.base}/api/info`)).json()) as ApiInfo).tls).toBeNull();
    const { socket } = await connectTestPhone(t.wsBase);
    sockets.push(socket);
    await waitFor(() => t.server.engine.state.phone.connected, 1000, 'phone link');
    expect(t.logger.text('warn')).toContain('TLS is off');
  });

  it('refuses other protocol versions', async () => {
    const t = await start();
    const socket = await sayHello(t, { v: PROTOCOL_VERSION + 1 });
    expect(await socket.next()).toMatchObject({ t: 'error', code: 'unsupported-version' });
    expect(await socket.closed).toBe(PHONE_CLOSE.unsupportedVersion);
  });

  it('requires hello as the first message', async () => {
    const t = await start();
    const socket = phone(t);
    await socket.opened;
    socket.send({ t: 'ping' });
    expect(await socket.nextOfType('error')).toMatchObject({ t: 'error', code: 'bad-message' });
    expect(await socket.closed).toBe(PHONE_CLOSE.helloRequired);

    const garbage = phone(t);
    await garbage.opened;
    garbage.send('{"t":"hello"');
    expect(await garbage.closed).toBe(PHONE_CLOSE.helloRequired);
  });

  it('closes sessions that never say hello', async () => {
    const t = await start({ tuning: { helloTimeoutMs: 100 } });
    const socket = phone(t);
    await socket.opened;
    expect(await socket.nextOfType('error', 2000)).toMatchObject({
      t: 'error',
      code: 'bad-message',
    });
    expect(await socket.closed).toBe(PHONE_CLOSE.helloRequired);
  });

  it('replaces the active phone with a newer session without flapping the link', async () => {
    const t = await start();
    const first = await connected(t, { device: 'Pixel 9', appVersion: '1.2.3' });
    const links: boolean[] = [];
    const unsubscribe = t.server.engine.onFrame((frame) => links.push(frame.status.phone));
    // The same phone reconnects (e.g. after roaming) while its old socket is still open.
    const second = await connected(t, { device: 'Pixel 9', appVersion: '1.2.4' });
    expect(await first.closed).toBe(PHONE_CLOSE.replaced);
    expect(first.closeReason).toBe('replaced');
    expect(t.server.engine.state.phone).toMatchObject({ connected: true, appVersion: '1.2.4' });
    // Frames composed across the switch-over never showed the phone as disconnected.
    await waitFor(() => links.length >= 3, 2000, 'frames');
    unsubscribe();
    expect(links.every(Boolean)).toBe(true);
    // Messages from the new session are processed.
    second.send({ t: 'road', speedLimitKph: 50, source: 'osm' });
    await waitFor(() => t.server.engine.state.road?.speedLimitKph === 50, 1000, 'road update');
  });

  it('refuses another phone while one is connected', async () => {
    const t = await start();
    const driver = await connected(t, { device: 'Driver Pixel' });
    // Same model, same default name: still another phone.
    const passenger = await sayHello(t, {
      device: 'Driver Pixel',
      deviceId: testDeviceId('passenger'),
    });
    expect(await passenger.closed).toBe(PHONE_CLOSE.busy);
    expect(passenger.closeReason).toBe('another phone is connected');
    expect(driver.ws.readyState).toBe(driver.ws.OPEN);
    expect(t.server.engine.state.phone).toMatchObject({
      connected: true,
      deviceName: 'Driver Pixel',
    });
  });

  it('clears what the previous phone showed when a different phone connects', async () => {
    const t = await start();
    const driver = await connected(t, { device: 'Driver Pixel' });
    driver.send({
      t: 'nav',
      active: true,
      source: 'maps',
      maneuver: { type: 'right' },
      distanceM: 800,
      street: 'Exit 12',
    });
    driver.send({ t: 'call', id: 'c1', state: 'active', callerName: 'Boss', number: null });
    driver.send({ t: 'media', playing: true, title: 'Song', artist: 'Band' });
    driver.send({ t: 'hazards', items: [{ id: 'h1', type: 'police', distanceM: 900 }] });
    await waitFor(() => t.server.engine.state.hazards.length === 1, 1000, 'driver data');
    driver.close();
    await waitFor(() => !t.server.engine.state.phone.connected, 2000, 'driver gone');
    // Within the 30 s grace the driver's route would still be shown…
    expect(t.server.engine.state.nav).not.toBeNull();
    // …but not once another phone has taken over.
    const passenger = await connected(t, { device: 'Passenger iPhone' });
    passenger.send({ t: 'media', playing: true, title: 'Other', artist: 'Artist' });
    await waitFor(() => t.server.engine.state.media?.info.title === 'Other', 1000, 'media');
    const state = t.server.engine.state;
    expect(state.phone).toMatchObject({ connected: true, deviceName: 'Passenger iPhone' });
    expect(state.nav).toBeNull();
    expect(state.call).toBeNull();
    expect(state.hazards).toEqual([]);
    expect(t.server.engine.frame.call).toBeNull();
  });

  it('keeps the data of a phone that reconnects', async () => {
    const t = await start();
    const first = await connected(t, { device: 'Pixel 9' });
    first.send({ t: 'nav', active: true, source: 'maps', street: 'Elm St', distanceM: 300 });
    await waitFor(() => t.server.engine.state.nav !== null, 1000, 'nav');
    first.close();
    await waitFor(() => !t.server.engine.state.phone.connected, 2000, 'disconnected');
    await connected(t, { device: 'Pixel 9' });
    await waitFor(() => t.server.engine.state.phone.connected, 1000, 'reconnected');
    expect(t.server.engine.state.nav?.info.street).toBe('Elm St');
  });

  it('reports the phone disconnected when its socket closes', async () => {
    const t = await start();
    const socket = await connected(t);
    await waitFor(() => t.server.engine.state.phone.connected, 1000, 'connected');
    socket.close();
    await waitFor(() => !t.server.engine.state.phone.connected, 2000, 'disconnected');
  });

  it('disconnects the phone when the pairing token changes', async () => {
    const t = await start({ config: { phone: { pairingToken: 'one' } } });
    const socket = await connected(t, { token: 'one' });
    const res = await fetch(`${t.base}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: { pairingToken: 'two' } }),
    });
    expect(res.status).toBe(200);
    expect(await socket.nextOfType('error')).toMatchObject({ code: 'bad-token' });
    expect(await socket.closed).toBe(PHONE_CLOSE.badToken);
    expect(t.server.engine.state.phone.connected).toBe(false);
  });

  it('pushes due maintenance right after the welcome', async () => {
    const year = 365 * 86_400_000;
    const t = await start({
      files: {
        'state.json': JSON.stringify({
          odometerKm: 50_000,
          learnedGearRatios: null,
          avgLPer100km: null,
          maintenanceRecords: [{ itemId: 'oil', odometerKm: 45_000, at: Date.now() - year }],
        }),
      },
    });
    const socket = await connected(t);
    const due = await socket.nextOfType('maintenance-due');
    expect(due['items']).toEqual([expect.objectContaining({ itemId: 'oil', status: 'overdue' })]);
  });
});

describe('/ws/phone messages', () => {
  it('translates phone messages into HUD state', async () => {
    const t = await start();
    const socket = await connected(t);
    socket.send({
      t: 'nav',
      active: true,
      source: 'osmand',
      maneuver: { type: 'left' },
      distanceM: 300,
      street: 'Elm St',
    });
    socket.send({ t: 'media', playing: true, title: 'Song', artist: 'Band' });
    socket.send({ t: 'message', id: 'm1', sender: 'Alex', app: null, readingAloud: true });
    socket.send({ t: 'location', lat: 48.1, lon: 11.5, accuracyM: 5 });
    socket.send({ t: 'hazards', items: [{ id: 'h1', type: 'police', distanceM: 900 }] });
    await waitFor(() => t.server.engine.state.hazards.length === 1, 1000, 'hazards');
    const state = t.server.engine.state;
    expect(state.nav?.info).toMatchObject({
      source: 'osmand',
      maneuver: { type: 'left' },
      street: 'Elm St',
    });
    expect(state.media?.info).toMatchObject({ title: 'Song', trackKey: 'Song|Band|' });
    expect(state.messages[0]).toMatchObject({ id: 'm1', sender: 'Alex' });
    expect(state.env.location).toMatchObject({ lat: 48.1, lon: 11.5 });
    socket.send({ t: 'nav', active: false, source: 'osmand' });
    await waitFor(() => t.server.engine.state.nav === null, 1000, 'nav cleared');
  });

  it('answers ping with pong and trips-request with trips', async () => {
    const t = await start({
      files: { 'trips.jsonl': [1, 2, 3].map((n) => `${JSON.stringify(trip(n))}\n`).join('') },
    });
    const socket = await connected(t);
    socket.send({ t: 'ping', id: 7 });
    expect(await socket.nextOfType('pong')).toEqual({ t: 'pong', id: 7 });
    socket.send({ t: 'ping' });
    expect(await socket.nextOfType('pong')).toEqual({ t: 'pong' });
    socket.send({ t: 'trips-request', since: trip(1).endedAt });
    const trips = await socket.nextOfType('trips');
    expect((trips['trips'] as TripRecord[]).map((x) => x.id)).toEqual(['trip-3', 'trip-2']);
    socket.send({ t: 'trips-request', since: 0 });
    expect((await socket.nextOfType('trips'))['trips'] as TripRecord[]).toHaveLength(3);
  });

  it('reports invalid messages but keeps the session, up to 20 in a row', async () => {
    const t = await start();
    const socket = await connected(t);
    socket.send({
      t: 'message',
      id: 'm',
      sender: 'X',
      app: null,
      readingAloud: false,
      body: 'secret text',
    });
    const error = await socket.nextOfType('error');
    expect(error).toMatchObject({ code: 'bad-message' });
    expect(String(error['message'])).toContain('not allowed');
    expect(t.server.engine.state.messages).toEqual([]);
    socket.send({ t: 'ping', id: 1 });
    expect(await socket.nextOfType('pong')).toEqual({ t: 'pong', id: 1 });

    // A valid message resets the streak; 20 invalid ones in a row end the session.
    for (let i = 0; i < 19; i += 1) socket.send('nonsense');
    socket.send({ t: 'ping', id: 2 });
    expect(await socket.nextOfType('pong')).toEqual({ t: 'pong', id: 2 });
    for (let i = 0; i < 20; i += 1) socket.send({ t: 'nav' });
    expect(await socket.closed).toBe(PHONE_CLOSE.tooManyErrors);
  });

  it('rate-limits a flooding phone without dropping the session', async () => {
    const t = await start({ tuning: { phoneRatePerSecond: 1, phoneRateBurst: 5 } });
    const socket = await connected(t); // the hello used one token
    for (let i = 0; i < 10; i += 1) socket.send({ t: 'ping', id: i });
    socket.send({ t: 'road', speedLimitKph: 30, source: 'osm' }); // dropped as well
    await waitFor(() => socket.messages.some((m) => m['t'] === 'error'), 1000, 'rate-limit notice');
    await new Promise((r) => setTimeout(r, 100));
    const pongs = socket.messages.filter((m) => m['t'] === 'pong').map((m) => m['id']);
    expect(pongs).toEqual([0, 1, 2, 3]);
    // One notice per episode, not one per dropped message.
    const errors = socket.messages.filter((m) => m['t'] === 'error');
    expect(errors).toEqual([
      { t: 'error', code: 'bad-message', message: expect.stringMatching(/Too many/) },
    ]);
    expect(t.server.engine.state.road).toBeNull();
    expect(socket.ws.readyState).toBe(socket.ws.OPEN);
    // Tokens come back over time.
    await new Promise((r) => setTimeout(r, 1100));
    socket.send({ t: 'ping', id: 99 });
    expect(await socket.next((m) => m['t'] === 'pong' && m['id'] === 99)).toEqual({
      t: 'pong',
      id: 99,
    });
  });

  it('delivers call actions to the phone when the driver answers a ringing call', async () => {
    const t = await start();
    const socket = await connected(t);
    socket.send({ t: 'call', id: 'call-1', state: 'ringing', callerName: 'Maria', number: null });
    await waitFor(() => t.server.engine.state.call?.state === 'ringing', 1000, 'ringing');
    const hud = new TestSocket(`${t.wsBase}/ws/hud`);
    sockets.push(hud);
    await hud.opened;
    hud.send({ t: 'input', action: 'primary' });
    expect(await socket.nextOfType('call-action')).toEqual({
      t: 'call-action',
      callId: 'call-1',
      action: 'accept',
    });
    // The phone's own remote control works too.
    socket.send({ t: 'input', action: 'secondary' });
    expect(await socket.nextOfType('call-action')).toEqual({
      t: 'call-action',
      callId: 'call-1',
      action: 'decline',
    });
  });

  it('times a call first seen mid-call from its receipt, even after the wall clock stepped back', async () => {
    // Network time sets the system clock back an hour while the HUD runs: engine time keeps
    // counting, and the phone's messages must be stamped with it, not with the wall clock (a
    // call first seen active keeps its stamp as its start: the timer would read an hour long).
    let wallShiftMs = 0;
    const t = await start({
      now: () => Date.now() + wallShiftMs,
      monotonic: () => performance.now(),
    });
    const socket = await connected(t);
    wallShiftMs = -3_600_000;
    socket.send({ t: 'call', id: 'c9', state: 'active', callerName: 'Maria', number: null });
    await waitFor(() => t.server.engine.state.call?.id === 'c9', 1000, 'call');
    const state = t.server.engine.state;
    expect(state.clock.wallOffsetMs).toBeLessThan(-3_590_000);
    expect(state.now - (state.call?.startedAt ?? 0)).toBeLessThan(5000);
    expect(state.now - (state.call?.startedAt ?? 0)).toBeGreaterThanOrEqual(0);
  });

  it('also delivers phone messages to the simulated phone', async () => {
    const sim = new FakeSimulation();
    const t = await start({ sim: true, simulation: sim });
    const socket = await connected(t);
    socket.send({ t: 'call', id: 'c2', state: 'ringing', callerName: null, number: '+1 555' });
    await waitFor(() => t.server.engine.state.call !== null, 1000, 'ringing');
    await fetch(`${t.base}/api/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'primary' }),
    });
    expect(await socket.nextOfType('call-action')).toMatchObject({
      callId: 'c2',
      action: 'accept',
    });
    expect(sim.delivered).toContainEqual({ t: 'call-action', callId: 'c2', action: 'accept' });
  });

  it('tells the simulation when a real phone comes and goes', async () => {
    const sim = new FakeSimulation();
    const t = await start({ sim: true, simulation: sim });
    const first = await connected(t, { device: 'Pixel' });
    await connected(t, { device: 'Pixel' }); // same phone again: no change
    expect(await first.closed).toBe(PHONE_CLOSE.replaced);
    expect(sim.realPhone).toEqual([true]);
    for (const socket of sockets) socket.close();
    await waitFor(() => sim.realPhone.length === 2, 2000, 'phone gone');
    expect(sim.realPhone).toEqual([true, false]);
  });

  it('with the real simulator, lets a real phone take over the phone state and hand it back', async () => {
    const t = await start({
      sim: true,
      createSimulation: (config, deps) => createSimulation(config, deps),
    });
    await waitFor(() => t.server.engine.state.phone.connected, 2000, 'simulated phone');
    const simNav = await fetch(`${t.base}/api/sim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: { kind: 'nav-start' } }),
    });
    expect(simNav.status).toBe(200);
    await waitFor(() => t.server.engine.state.nav !== null, 2000, 'simulated guidance');
    const simulatedStreet = t.server.engine.state.nav?.info.street;

    const real = await connected(t, { device: 'Pixel' });
    real.send({ t: 'nav', active: true, source: 'maps', street: 'Real Street', distanceM: 400 });
    await waitFor(() => t.server.engine.state.nav?.info.street === 'Real Street', 1000, 'real');
    // The simulated phone updates its guidance every second; it must not take it back.
    await new Promise((r) => setTimeout(r, 1500));
    expect(t.server.engine.state.nav?.info.street).toBe('Real Street');
    expect(t.server.engine.state.phone).toMatchObject({ connected: true, deviceName: 'Pixel' });

    real.close();
    await waitFor(
      () => t.server.engine.state.phone.deviceName === SIM_PHONE_DEVICE,
      2000,
      'simulated phone back',
    );
    expect(t.server.engine.state.phone.connected).toBe(true);
    await waitFor(
      () => t.server.engine.state.nav?.info.street === simulatedStreet,
      2000,
      'simulated guidance back',
    );
  });

  it('closes the phone with 1001 on shutdown', async () => {
    const t = await start();
    const socket = await connected(t);
    await t.server.stop();
    expect(await socket.closed).toBe(1001);
  });
});
