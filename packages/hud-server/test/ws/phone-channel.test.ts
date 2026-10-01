import { EventEmitter } from 'node:events';
import { NO_CHANNEL_BINDING, PROTOCOL_VERSION, isAuthId } from '@carheadsup/core';
import type { HudConfig, HudEvent, TripRecord } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { hudProof } from '../../src/phone/auth.ts';
import {
  MAX_PENDING_SESSIONS,
  MAX_PHONE_BACKLOG_BYTES,
  PHONE_CLOSE,
  PhoneChannel,
} from '../../src/ws/phone-channel.ts';
import type { PhoneTransport } from '../../src/ws/phone-channel.ts';
import type { PhoneTimeSample } from '../../src/clock.ts';
import { FakeClock, memoryLogger } from '../sensors/fakes.ts';
import { answerChallenge, testConfig, testDeviceId } from '../helpers.ts';
import type { TestPhone } from '../helpers.ts';

/** The fingerprint of the HUD's certificate in these tests. */
const CERT = 'ab'.repeat(32);

/** Just enough of a `ws` WebSocket for the channel. */
class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  /** The certificate a phone on this connection sees (none on a plain one). */
  binding: string = CERT;
  readonly sent: Array<Record<string, unknown>> = [];
  closeCode: number | null = null;

  send(text: string): void {
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }

  close(code: number): void {
    if (this.readyState !== 1) return;
    this.readyState = 2;
    this.closeCode = code;
    queueMicrotask(() => {
      this.readyState = 3;
      this.emit('close', code, Buffer.from(''));
    });
  }

  terminate(): void {
    this.close(1006);
  }

  receive(message: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(message)), false);
  }

  ofType(t: string): Array<Record<string, unknown>> {
    return this.sent.filter((m) => m['t'] === t);
  }

  /** The challenge the HUD sent on connect. */
  get challenge(): Record<string, unknown> {
    const challenge = this.ofType('challenge')[0];
    if (challenge === undefined) throw new Error('no challenge sent');
    return challenge;
  }

  /** Answer the challenge as `phone` (a name, or a full identity). */
  sayHello(phone: string | TestPhone = {}): Record<string, unknown> {
    const hello = answerChallenge(
      this.challenge,
      typeof phone === 'string' ? { device: phone } : phone,
      this.binding,
    );
    this.receive(hello);
    return hello;
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const HUD_ID = 'AAECAwQFBgcICQoLDA0ODw';

function trip(n: number): TripRecord {
  return {
    id: `trip-${n}`,
    startedAt: n * 1000,
    endedAt: n * 1000 + 500,
    distanceKm: 1,
    durationS: 1,
    movingS: 1,
    idleS: 0,
    fuelUsedL: null,
    avgLPer100km: null,
    maxSpeedKph: 1,
    avgMovingSpeedKph: 1,
    cost: null,
    currency: 'EUR',
    startOdometerKm: null,
    endOdometerKm: null,
  };
}

function setup(options: { pairingToken?: string; allowPlainPhone?: boolean } = {}) {
  const clock = new FakeClock();
  const events: HudEvent[] = [];
  const phoneChanges: boolean[] = [];
  const phoneTimes: PhoneTimeSample[] = [];
  const tripQueries: Array<{ since: number; sinceSeq?: number }> = [];
  let config = testConfig({
    phone: { pairingToken: options.pairingToken ?? '' },
    server: { allowPlainPhone: options.allowPlainPhone ?? false },
  });
  const logger = memoryLogger();
  const channel = new PhoneChannel({
    hudId: HUD_ID,
    certFingerprint: CERT,
    dispatch: (event) => events.push(event),
    getConfig: () => config,
    tripsMissed: (query, limit) => {
      tripQueries.push(query);
      return Array.from({ length: Math.min(limit, 10) }, (_, i) => trip(i));
    },
    onPhoneTime: (sample) => phoneTimes.push(sample),
    dueMaintenance: () => null,
    onPhoneChange: (connected) => phoneChanges.push(connected),
    version: 'test',
    now: clock.now,
    timers: clock,
    logger,
  });
  const connect = (address: string, transport: PhoneTransport = 'tls'): FakeSocket => {
    const socket = new FakeSocket();
    socket.binding = transport === 'tls' ? CERT : NO_CHANNEL_BINDING;
    channel.accept(socket as unknown as WebSocket, address, transport);
    return socket;
  };
  const links = (): Array<{ connected: boolean; device: string | null | undefined }> =>
    events
      .filter((e): e is Extract<HudEvent, { type: 'phone/link' }> => e.type === 'phone/link')
      .map((e) => ({ connected: e.connected, device: e.deviceName }));
  const changeConfig = (next: HudConfig): void => {
    config = next;
    channel.updateConfig(next);
  };
  return {
    clock,
    channel,
    events,
    phoneChanges,
    phoneTimes,
    tripQueries,
    connect,
    links,
    changeConfig,
    logger,
  };
}

describe('PhoneChannel: mutual authentication', () => {
  it('challenges every connection at once with its HUD id and a fresh nonce', () => {
    const { connect } = setup();
    const [a, b] = [connect('10.42.0.23'), connect('10.42.0.24')];
    expect(a.sent).toEqual([
      { t: 'challenge', v: PROTOCOL_VERSION, hudId: HUD_ID, nonce: expect.any(String) },
    ]);
    expect(isAuthId(String(a.challenge['nonce']))).toBe(true);
    expect(b.challenge['nonce']).not.toBe(a.challenge['nonce']);
  });

  it('welcomes a phone that proves the pairing token, and proves it back', async () => {
    const { connect, channel } = setup({ pairingToken: 's3cret' });
    const phone = connect('10.42.0.23');
    const hello = phone.sayHello({ device: 'Pixel', token: 's3cret' });
    await flush();
    const [welcome] = phone.ofType('welcome');
    const input = {
      hudId: HUD_ID,
      hudNonce: String(phone.challenge['nonce']),
      phoneNonce: String(hello['nonce']),
      deviceId: String(hello['deviceId']),
      certFingerprint: CERT,
    };
    expect(welcome).toMatchObject({ v: PROTOCOL_VERSION, hudId: HUD_ID });
    expect(welcome?.['proof']).toBe(hudProof('s3cret', input));
    expect(welcome?.['proof']).not.toBe(hudProof('', input));
    // Bound to the HUD's certificate: useless to a relay that showed the phone another one.
    expect(welcome?.['proof']).not.toBe(hudProof('s3cret', { ...input, certFingerprint: '' }));
    expect(channel.connected).toBe(true);
  });

  it('refuses a proof bound to another certificate (a relay in between)', async () => {
    const { connect, channel } = setup({ pairingToken: 's3cret' });
    const relayed = connect('10.42.0.23');
    relayed.binding = 'cd'.repeat(32);
    relayed.sayHello({ device: 'Pixel', token: 's3cret' });
    await flush();
    expect(relayed.sent.map((m) => m['t'])).toEqual(['challenge', 'error']);
    expect(relayed.closeCode).toBe(PHONE_CLOSE.badToken);
    expect(channel.connected).toBe(false);
  });

  it('binds nothing on a plain connection, so a TLS proof does not pass there', async () => {
    const { connect, channel } = setup({ pairingToken: 's3cret', allowPlainPhone: true });
    const relayed = connect('10.42.0.23', 'plain');
    relayed.binding = CERT; // a TLS phone's proof, carried to the plain port
    relayed.sayHello({ device: 'Pixel', token: 's3cret' });
    const plain = connect('10.42.0.24', 'plain');
    const hello = plain.sayHello({ device: 'Dev', token: 's3cret' });
    await flush();
    expect(relayed.closeCode).toBe(PHONE_CLOSE.badToken);
    const [welcome] = plain.ofType('welcome');
    expect(welcome?.['proof']).toBe(
      hudProof('s3cret', {
        hudId: HUD_ID,
        hudNonce: String(plain.challenge['nonce']),
        phoneNonce: String(hello['nonce']),
        deviceId: String(hello['deviceId']),
        certFingerprint: NO_CHANNEL_BINDING,
      }),
    );
    expect(channel.connected).toBe(true);
  });

  it('closes plain sessions once they are no longer allowed, and keeps TLS ones', async () => {
    const { connect, channel, changeConfig, links } = setup({ allowPlainPhone: true });
    const plain = connect('10.42.0.23', 'plain');
    plain.sayHello('Dev');
    const waiting = connect('10.42.0.24', 'plain');
    const secure = connect('10.42.0.25');
    await flush();
    expect(channel.connected).toBe(true);
    changeConfig(testConfig({ server: { allowPlainPhone: true, frameRate: 10 } }));
    expect(plain.closeCode).toBeNull();
    changeConfig(testConfig({ server: { allowPlainPhone: false } }));
    await flush();
    expect(plain.closeCode).toBe(PHONE_CLOSE.tlsRequired);
    expect(waiting.closeCode).toBe(PHONE_CLOSE.tlsRequired);
    expect(secure.closeCode).toBeNull();
    expect(channel.connected).toBe(false);
    expect(links()).toEqual([
      { connected: true, device: 'Dev' },
      { connected: false, device: undefined },
    ]);
    secure.sayHello('Pixel');
    await flush();
    expect(channel.connected).toBe(true);
  });

  it('refuses a proof made with another token (bad-token, 4001), sending nothing else', async () => {
    const { connect, channel, events } = setup({ pairingToken: 's3cret' });
    const phone = connect('10.42.0.23');
    phone.sayHello({ device: 'Pixel', token: 'guess' });
    await flush();
    expect(phone.sent.map((m) => m['t'])).toEqual(['challenge', 'error']);
    expect(phone.ofType('error')[0]).toMatchObject({ code: 'bad-token' });
    expect(phone.closeCode).toBe(PHONE_CLOSE.badToken);
    expect(channel.connected).toBe(false);
    expect(events).toEqual([]);
  });

  it("refuses a proof recorded on another connection (the HUD's nonce differs)", async () => {
    const { connect } = setup({ pairingToken: 's3cret' });
    const first = connect('10.42.0.23');
    const recorded = answerChallenge(first.challenge, { device: 'Pixel', token: 's3cret' }, CERT);
    const replay = connect('10.42.0.66');
    replay.receive(recorded);
    await flush();
    expect(replay.ofType('error')[0]).toMatchObject({ code: 'bad-token' });
    expect(replay.closeCode).toBe(PHONE_CLOSE.badToken);
    // A proof bound to another phone's id does not pass either.
    const other = connect('10.42.0.67');
    const hello = answerChallenge(other.challenge, { device: 'Pixel', token: 's3cret' }, CERT);
    other.receive({ ...hello, deviceId: testDeviceId('someone else') });
    await flush();
    expect(other.closeCode).toBe(PHONE_CLOSE.badToken);
  });

  it('without a pairing token, accepts proofs made with the empty key only', async () => {
    const { connect } = setup();
    const open = connect('10.42.0.23');
    open.sayHello({ device: 'Pixel' });
    const keyed = connect('10.42.0.24');
    keyed.sayHello({ device: 'Galaxy', token: 'old code' });
    await flush();
    expect(open.ofType('welcome')).toHaveLength(1);
    // A phone still holding a code gets told, rather than trusting an open HUD blindly.
    expect(keyed.ofType('error')[0]).toMatchObject({ code: 'bad-token' });
    expect(keyed.closeCode).toBe(PHONE_CLOSE.badToken);
  });

  it('never puts the token or a proof into its logs or error messages', async () => {
    const TOKEN = 'Kx7pQ2mZr9TxW4bHc8NpV3sL';
    const { connect, changeConfig, logger } = setup({ pairingToken: TOKEN });
    const good = connect('10.42.0.23');
    const hello = good.sayHello({ device: 'Pixel', token: TOKEN });
    const wrong = connect('10.42.0.24');
    const guess = wrong.sayHello({ device: 'Galaxy', token: `${TOKEN}x` });
    // An outdated (v1) phone still sends the token itself.
    const v1 = connect('10.42.0.25');
    v1.receive({ t: 'hello', v: 1, device: 'Old', app: 'a', appVersion: '1', token: TOKEN });
    await flush();
    changeConfig(testConfig({ phone: { pairingToken: 'a-new-code' } }));
    await flush();
    expect(good.closeCode).toBe(PHONE_CLOSE.badToken);
    const errors = [good, wrong, v1].flatMap((socket) =>
      socket.ofType('error').map((m) => JSON.stringify(m)),
    );
    const secrets = [TOKEN, 'a-new-code', String(hello['proof']), String(guess['proof'])];
    for (const text of [...logger.lines(), ...errors]) {
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
    expect(logger.lines('warn').join('\n')).toMatch(/Galaxy from 10\.42\.0\.24 sent a wrong/);
  });

  it('refuses a hello of another protocol version, v1 and v2 included', async () => {
    const { connect } = setup();
    const v1 = connect('10.42.0.23');
    v1.receive({ t: 'hello', v: 1, device: 'Pixel', app: 'a', appVersion: '1', token: '' });
    // A v2 phone looks like a v3 one but binds no certificate.
    const v2 = connect('10.42.0.26');
    v2.sayHello({ device: 'Pixel', v: 2 });
    const v4 = connect('10.42.0.24');
    v4.sayHello({ device: 'Pixel', v: PROTOCOL_VERSION + 1 });
    await flush();
    for (const socket of [v1, v2, v4]) {
      expect(socket.ofType('error')[0]).toMatchObject({ code: 'unsupported-version' });
      expect(socket.closeCode).toBe(PHONE_CLOSE.unsupportedVersion);
    }
  });

  it('checks the connected phone against a changed pairing token', async () => {
    const { connect, channel, changeConfig } = setup({ pairingToken: 'one' });
    const phone = connect('10.42.0.23');
    phone.sayHello({ device: 'Pixel', token: 'one' });
    await flush();
    changeConfig(testConfig({ phone: { pairingToken: 'one', readMessagesAloud: false } }));
    expect(phone.closeCode).toBeNull();
    // Removing the code opens the HUD: the phone proved a code, so it is sent away as well.
    changeConfig(testConfig({ phone: { pairingToken: '' } }));
    await flush();
    expect(phone.ofType('error')[0]).toMatchObject({ code: 'bad-token' });
    expect(phone.closeCode).toBe(PHONE_CLOSE.badToken);
    expect(channel.connected).toBe(false);
  });
});

describe('PhoneChannel: connections waiting for their hello', () => {
  it('lets the paired phone in while idle connections from elsewhere fill every slot', async () => {
    const { connect, channel } = setup({ pairingToken: 's3cret' });
    const squatters = Array.from({ length: MAX_PENDING_SESSIONS + 4 }, (_, i) =>
      connect(`10.42.0.${100 + (i % 6)}`),
    );
    const phone = connect('10.42.0.23');
    await flush();
    expect(phone.closeCode).toBeNull();
    phone.sayHello({ device: 'Pixel', token: 's3cret' });
    await flush();
    expect(phone.ofType('welcome')).toHaveLength(1);
    expect(channel.connected).toBe(true);
    // The squatters were evicted oldest first, never more than 2 per address kept waiting.
    expect(squatters.filter((s) => s.closeCode === null).length).toBeLessThan(MAX_PENDING_SESSIONS);
  });

  it('keeps at most 2 waiting connections per address, evicting its oldest', async () => {
    const { connect } = setup();
    const [a, b, c] = [connect('10.0.0.9'), connect('10.0.0.9'), connect('10.0.0.9')];
    await flush();
    expect([a.closeCode, b.closeCode, c.closeCode]).toEqual([PHONE_CLOSE.busy, null, null]);
  });

  it('lets the phone in even when a page in its own browser holds its address’s slots', async () => {
    const { connect } = setup();
    connect('10.42.0.23');
    connect('10.42.0.23');
    const phone = connect('10.42.0.23');
    phone.sayHello('Pixel');
    await flush();
    expect(phone.ofType('welcome')).toHaveLength(1);
  });
});

describe('PhoneChannel: one phone at a time', () => {
  it('refuses a different phone while one is connected, without touching its session', async () => {
    const { connect, links, channel } = setup();
    const driver = connect('10.42.0.23');
    driver.sayHello('Driver Pixel');
    const passenger = connect('10.42.0.24');
    passenger.sayHello('Passenger iPhone');
    await flush();
    expect(passenger.ofType('welcome')).toHaveLength(0);
    expect(passenger.closeCode).toBe(PHONE_CLOSE.busy);
    expect(driver.closeCode).toBeNull();
    expect(links()).toEqual([{ connected: true, device: 'Driver Pixel' }]);
    // Once the driver's phone has gone, the other one gets in.
    driver.close(1000);
    await flush();
    const again = connect('10.42.0.24');
    again.sayHello('Passenger iPhone');
    await flush();
    expect(again.ofType('welcome')).toHaveLength(1);
    expect(channel.connected).toBe(true);
    expect(links().at(-1)).toEqual({ connected: true, device: 'Passenger iPhone' });
  });

  it('tells two phones with the same name apart by their device id', async () => {
    const { connect, links, events } = setup();
    const driver = connect('10.42.0.23');
    driver.sayHello({ device: 'Pixel 9', deviceId: testDeviceId('driver') });
    const passenger = connect('10.42.0.24');
    passenger.sayHello({ device: 'Pixel 9', deviceId: testDeviceId('passenger') });
    await flush();
    // Not a reconnect of the driver's phone: refused, the driver keeps the HUD.
    expect(passenger.closeCode).toBe(PHONE_CLOSE.busy);
    expect(driver.closeCode).toBeNull();
    expect(links()).toEqual([{ connected: true, device: 'Pixel 9' }]);
    expect(events[0]).toMatchObject({ type: 'phone/link', deviceId: testDeviceId('driver') });
  });

  it('recognises its own phone under a new name', async () => {
    const { connect } = setup();
    const old = connect('10.42.0.23');
    old.sayHello({ device: 'Pixel 9', deviceId: testDeviceId('driver') });
    const renamed = connect('10.42.0.23');
    renamed.sayHello({ device: "Anna's Pixel", deviceId: testDeviceId('driver') });
    await flush();
    expect(old.closeCode).toBe(PHONE_CLOSE.replaced);
    expect(renamed.ofType('welcome')).toHaveLength(1);
  });

  it('lets the same phone replace its own older session seamlessly', async () => {
    const { connect, links, phoneChanges } = setup();
    const old = connect('10.42.0.23');
    old.sayHello('Pixel');
    const fresh = connect('10.42.0.23');
    fresh.sayHello('Pixel');
    await flush();
    expect(old.closeCode).toBe(PHONE_CLOSE.replaced);
    expect(fresh.ofType('welcome')).toHaveLength(1);
    expect(links()).toEqual([
      { connected: true, device: 'Pixel' },
      { connected: true, device: 'Pixel' },
    ]);
    expect(phoneChanges).toEqual([true]);
    fresh.close(1000);
    await flush();
    expect(phoneChanges).toEqual([true, false]);
  });
});

describe("PhoneChannel: the phone's clock", () => {
  const PHONE_NOW = Date.UTC(2026, 9, 1, 8, 0, 0);

  it('passes the time of the hello and of every ping on, with half the round trip', async () => {
    const { connect, clock, phoneTimes } = setup({ pairingToken: 's3cret' });
    const phone = connect('10.42.0.23');
    await clock.advance(40); // the phone answers the challenge 40 ms later
    phone.sayHello({ device: 'Pixel', token: 's3cret', time: PHONE_NOW });
    await flush();
    expect(phone.ofType('welcome')).toHaveLength(1);
    phone.receive({ t: 'ping', id: 1, time: PHONE_NOW + 5000 });
    phone.receive({ t: 'ping', id: 2 }); // without a time: nothing to pass on
    await flush();
    expect(phone.ofType('pong')).toEqual([
      { t: 'pong', id: 1 },
      { t: 'pong', id: 2 },
    ]);
    expect(phoneTimes).toEqual([
      { phoneMs: PHONE_NOW, delayMs: 20 },
      { phoneMs: PHONE_NOW + 5000, delayMs: 20 },
    ]);
  });

  it('takes no time from a phone that has not proved the pairing token', async () => {
    const { connect, phoneTimes } = setup({ pairingToken: 's3cret' });
    const phone = connect('10.42.0.23');
    phone.sayHello({ device: 'Pixel', token: 'guess', time: PHONE_NOW });
    phone.receive({ t: 'ping', id: 1, time: PHONE_NOW });
    await flush();
    expect(phone.closeCode).toBe(PHONE_CLOSE.badToken);
    expect(phoneTimes).toEqual([]);
  });

  it('takes none from an older phone that sends no time', async () => {
    const { connect, phoneTimes } = setup();
    const phone = connect('10.42.0.23');
    phone.sayHello('Pixel');
    phone.receive({ t: 'ping', id: 1 });
    await flush();
    expect(phone.ofType('welcome')).toHaveLength(1);
    expect(phoneTimes).toEqual([]);
  });
});

describe('PhoneChannel: a phone that does not read', () => {
  it('closes a session whose unsent backlog exceeds the limit', async () => {
    const { connect, channel } = setup();
    const phone = connect('10.42.0.23');
    phone.sayHello('Pixel');
    await flush();
    phone.bufferedAmount = MAX_PHONE_BACKLOG_BYTES + 1;
    phone.receive({ t: 'ping', id: 1 });
    await flush();
    expect(phone.ofType('pong')).toHaveLength(0);
    expect(phone.closeCode).toBe(PHONE_CLOSE.backlog);
    expect(channel.connected).toBe(false);
  });

  it('asks the trip store for what the phone is missing, by sequence number when it can', async () => {
    const { connect, tripQueries } = setup();
    const phone = connect('10.42.0.23');
    phone.sayHello('Pixel');
    phone.receive({ t: 'trips-request', since: 1234 });
    phone.receive({ t: 'trips-request', since: 1234, sinceSeq: 41 });
    await flush();
    expect(tripQueries).toEqual([{ since: 1234 }, { since: 1234, sinceSeq: 41 }]);
    expect(phone.ofType('trips')).toHaveLength(2);
  });

  it('answers only a few trips-requests in a row', async () => {
    const { connect, clock } = setup();
    const phone = connect('10.42.0.23');
    phone.sayHello('Pixel');
    for (let i = 0; i < 50; i += 1) phone.receive({ t: 'trips-request', since: 0 });
    await flush();
    expect(phone.ofType('trips')).toHaveLength(3);
    expect(phone.ofType('error').length).toBeGreaterThan(0);
    await clock.advance(5000);
    phone.receive({ t: 'trips-request', since: 0 });
    await flush();
    expect(phone.ofType('trips')).toHaveLength(4);
  });
});
