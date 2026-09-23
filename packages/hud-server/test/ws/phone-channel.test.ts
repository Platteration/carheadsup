import { EventEmitter } from 'node:events';
import { PROTOCOL_VERSION } from '@carheadsup/core';
import type { HudEvent, TripRecord } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import {
  MAX_PENDING_SESSIONS,
  MAX_PHONE_BACKLOG_BYTES,
  PHONE_CLOSE,
  PhoneChannel,
} from '../../src/ws/phone-channel.ts';
import { FakeClock, memoryLogger } from '../sensors/fakes.ts';
import { testConfig } from '../helpers.ts';

/** Just enough of a `ws` WebSocket for the channel. */
class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
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
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function hello(device: string, token = ''): Record<string, unknown> {
  return { t: 'hello', v: PROTOCOL_VERSION, device, app: 'carheadsup', appVersion: '1', token };
}

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

function setup(options: { pairingToken?: string } = {}) {
  const clock = new FakeClock();
  const events: HudEvent[] = [];
  const phoneChanges: boolean[] = [];
  const config = testConfig({ phone: { pairingToken: options.pairingToken ?? '' } });
  const channel = new PhoneChannel({
    dispatch: (event) => events.push(event),
    getConfig: () => config,
    tripsEndedAfter: (_since, limit) =>
      Array.from({ length: Math.min(limit, 10) }, (_, i) => trip(i)),
    dueMaintenance: () => null,
    onPhoneChange: (connected) => phoneChanges.push(connected),
    version: 'test',
    now: clock.now,
    timers: clock,
    logger: memoryLogger(),
  });
  const connect = (address: string): FakeSocket => {
    const socket = new FakeSocket();
    channel.accept(socket as unknown as WebSocket, address);
    return socket;
  };
  const links = (): Array<{ connected: boolean; device: string | null | undefined }> =>
    events
      .filter((e): e is Extract<HudEvent, { type: 'phone/link' }> => e.type === 'phone/link')
      .map((e) => ({ connected: e.connected, device: e.deviceName }));
  return { clock, channel, events, phoneChanges, connect, links };
}

describe('PhoneChannel: connections waiting for their hello', () => {
  it('lets the paired phone in while idle connections from elsewhere fill every slot', async () => {
    const { connect, channel } = setup({ pairingToken: 's3cret' });
    const squatters = Array.from({ length: MAX_PENDING_SESSIONS + 4 }, (_, i) =>
      connect(`10.42.0.${100 + (i % 6)}`),
    );
    const phone = connect('10.42.0.23');
    await flush();
    expect(phone.closeCode).toBeNull();
    phone.receive(hello('Pixel', 's3cret'));
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
    phone.receive(hello('Pixel'));
    await flush();
    expect(phone.ofType('welcome')).toHaveLength(1);
  });
});

describe('PhoneChannel: one phone at a time', () => {
  it('refuses a different phone while one is connected, without touching its session', async () => {
    const { connect, links, channel } = setup();
    const driver = connect('10.42.0.23');
    driver.receive(hello('Driver Pixel'));
    const passenger = connect('10.42.0.24');
    passenger.receive(hello('Passenger iPhone'));
    await flush();
    expect(passenger.ofType('welcome')).toHaveLength(0);
    expect(passenger.closeCode).toBe(PHONE_CLOSE.busy);
    expect(driver.closeCode).toBeNull();
    expect(links()).toEqual([{ connected: true, device: 'Driver Pixel' }]);
    // Once the driver's phone has gone, the other one gets in.
    driver.close(1000);
    await flush();
    const again = connect('10.42.0.24');
    again.receive(hello('Passenger iPhone'));
    await flush();
    expect(again.ofType('welcome')).toHaveLength(1);
    expect(channel.connected).toBe(true);
    expect(links().at(-1)).toEqual({ connected: true, device: 'Passenger iPhone' });
  });

  it('lets the same phone replace its own older session seamlessly', async () => {
    const { connect, links, phoneChanges } = setup();
    const old = connect('10.42.0.23');
    old.receive(hello('Pixel'));
    const fresh = connect('10.42.0.23');
    fresh.receive(hello('Pixel'));
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

describe('PhoneChannel: a phone that does not read', () => {
  it('closes a session whose unsent backlog exceeds the limit', async () => {
    const { connect, channel } = setup();
    const phone = connect('10.42.0.23');
    phone.receive(hello('Pixel'));
    await flush();
    phone.bufferedAmount = MAX_PHONE_BACKLOG_BYTES + 1;
    phone.receive({ t: 'ping', id: 1 });
    await flush();
    expect(phone.ofType('pong')).toHaveLength(0);
    expect(phone.closeCode).toBe(PHONE_CLOSE.backlog);
    expect(channel.connected).toBe(false);
  });

  it('answers only a few trips-requests in a row', async () => {
    const { connect, clock } = setup();
    const phone = connect('10.42.0.23');
    phone.receive(hello('Pixel'));
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
