import { PROTOCOL_VERSION, parsePhoneMessage } from '@carheadsup/core';
import type {
  HudConfig,
  HudError,
  HudEvent,
  HudMaintenanceDue,
  HudToPhone,
  HudWelcome,
  PhoneHello,
  PhoneToHud,
  TripRecord,
} from '@carheadsup/core';
import type { Clock, Logger, Timers } from '@carheadsup/obd';
import type { RawData, WebSocket } from 'ws';
import { secretsEqual } from '../http/auth.ts';
import { phoneMessageToEvents } from '../phone/translate.ts';
import { TokenBucket } from './rate-limit.ts';
import { closeAll, closeSocket, rawDataToString, sendJson } from './sockets.ts';

/**
 * Close codes used on `/ws/phone` (4000–4999 are application-defined). The companion app shows
 * the accompanying `error` message; the codes make logs and tests unambiguous.
 */
export const PHONE_CLOSE = {
  /** A newer session from a phone replaced this one. */
  replaced: 4000,
  /** Wrong pairing token (also when the token is changed while connected). */
  badToken: 4001,
  /** Protocol version mismatch. */
  unsupportedVersion: 4002,
  /** No valid `hello` as the first message within the time limit. */
  helloRequired: 4003,
  /** Too many invalid messages in a row. */
  tooManyErrors: 4004,
  /** Too many connections waiting for their `hello`. */
  busy: 1013,
} as const;

export const HELLO_TIMEOUT_MS = 5000;
/** Consecutive invalid messages after which the session is closed. */
export const MAX_CONSECUTIVE_INVALID = 20;
/** Sustained message rate and burst allowed per session. */
export const PHONE_RATE_PER_S = 50;
export const PHONE_RATE_BURST = 100;
/** Most trips returned for one `trips-request` (newest first; older ones via GET /api/trips). */
export const MAX_TRIPS_PER_REQUEST = 1000;
/** Connections allowed to wait for their `hello` at the same time. */
export const MAX_PENDING_SESSIONS = 8;

export interface PhoneChannelOptions {
  /** Feed events into the engine. */
  dispatch(event: HudEvent): void;
  /** Effective config (vehicle name, pairing token, readMessagesAloud). */
  getConfig(): HudConfig;
  /** Trips that ended after `since`, newest first. */
  tripsEndedAfter(since: number, limit: number): TripRecord[];
  /** Maintenance items currently due, pushed right after `welcome`. */
  dueMaintenance(): HudMaintenanceDue | null;
  /** HUD software version for `welcome`. */
  version: string;
  now: Clock;
  timers: Timers;
  logger: Logger;
  helloTimeoutMs?: number;
  ratePerSecond?: number;
  rateBurst?: number;
  maxConsecutiveInvalid?: number;
}

interface Session {
  readonly id: number;
  readonly ws: WebSocket;
  readonly remoteAddress: string;
  phase: 'hello' | 'active' | 'closed';
  helloTimer: unknown;
  readonly bucket: TokenBucket;
  /** Currently dropping messages over the rate limit (notified once per episode). */
  throttled: boolean;
  invalidStreak: number;
  hello: PhoneHello | null;
}

/**
 * `/ws/phone`: the companion app's session protocol.
 *
 *  - The first message must be a valid `hello` within {@link HELLO_TIMEOUT_MS}. A different
 *    protocol version gets `error unsupported-version`; a wrong pairing token (when
 *    `phone.pairingToken` is set, compared in constant time) gets `error bad-token` and close
 *    4001. Otherwise the HUD answers `welcome`, the phone counts as connected (`phone/link`) and
 *    due maintenance items are pushed.
 *  - There is one active phone: a newer successful hello replaces the older session (close
 *    4000 "replaced") without a disconnect in between.
 *  - Messages are validated (`parsePhoneMessage`) and translated (`phoneMessageToEvents`);
 *    `ping` → `pong`, `trips-request` → `trips`. An invalid message gets `error bad-message`
 *    but the session survives, until {@link MAX_CONSECUTIVE_INVALID} in a row.
 *  - Each session is rate limited (token bucket, 50 msg/s, burst 100); excess messages are
 *    dropped with one `bad-message` notice per episode.
 */
export class PhoneChannel {
  private readonly options: PhoneChannelOptions;
  private readonly sessions = new Set<Session>();
  private active: Session | null = null;
  private nextId = 1;
  private closed = false;

  constructor(options: PhoneChannelOptions) {
    this.options = options;
  }

  /** A phone has completed its hello and is connected. */
  get connected(): boolean {
    return this.active !== null;
  }

  accept(ws: WebSocket, remoteAddress: string | undefined): void {
    if (this.closed) {
      closeSocket(ws, 1001, 'HUD shutting down');
      return;
    }
    const pending = [...this.sessions].filter((s) => s.phase === 'hello').length;
    if (pending >= MAX_PENDING_SESSIONS) {
      closeSocket(ws, PHONE_CLOSE.busy, 'too many pending connections');
      return;
    }
    const session: Session = {
      id: this.nextId++,
      ws,
      remoteAddress: remoteAddress ?? '?',
      phase: 'hello',
      helloTimer: null,
      bucket: new TokenBucket(
        this.options.ratePerSecond ?? PHONE_RATE_PER_S,
        this.options.rateBurst ?? PHONE_RATE_BURST,
        this.options.now,
      ),
      throttled: false,
      invalidStreak: 0,
      hello: null,
    };
    this.sessions.add(session);
    session.helloTimer = this.options.timers.setTimeout(() => {
      session.helloTimer = null;
      if (session.phase !== 'hello') return;
      this.refuse(session, 'bad-message', 'Expected a hello message', PHONE_CLOSE.helloRequired);
    }, this.options.helloTimeoutMs ?? HELLO_TIMEOUT_MS);

    ws.on('message', (data, isBinary) => this.onMessage(session, data, isBinary));
    ws.on('close', () => this.onClose(session));
    ws.on('error', (err) => this.options.logger.debug(`Phone socket error: ${err.message}`));
  }

  /** Send a message to the active phone. False when no phone is connected. */
  send(message: HudToPhone): boolean {
    const session = this.active;
    return session !== null && sendJson(session.ws, message);
  }

  /** Disconnect the active phone if its pairing token no longer matches. */
  updateConfig(config: HudConfig): void {
    const session = this.active;
    if (session?.hello && !this.tokenAccepted(session.hello.token, config)) {
      this.options.logger.info('Phone: pairing token changed; disconnecting the phone');
      this.refuse(session, 'bad-token', 'The pairing token has changed', PHONE_CLOSE.badToken);
    }
  }

  /** Close every session (the active phone is reported disconnected). */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await closeAll(
      [...this.sessions].map((s) => s.ws),
      1001,
      'HUD shutting down',
      this.options.timers,
    );
  }

  // -------------------------------------------------------------------------------------------

  private onMessage(session: Session, data: RawData, isBinary: boolean): void {
    if (session.phase === 'closed') return;
    if (!session.bucket.take()) {
      if (!session.throttled) {
        session.throttled = true;
        this.options.logger.warn(`Phone: session ${session.id} exceeds the rate limit`);
        this.sendError(session, 'bad-message', 'Too many messages: some were dropped');
      }
      return;
    }
    session.throttled = false;

    const parsed = isBinary
      ? ({ ok: false, error: 'expected a text frame' } as const)
      : parsePhoneMessage(rawDataToString(data));
    if (!parsed.ok) {
      this.onInvalid(session, parsed.error);
      return;
    }
    session.invalidStreak = 0;
    const message = parsed.value;

    if (session.phase === 'hello') {
      if (message.t !== 'hello') {
        this.refuse(
          session,
          'bad-message',
          'The first message must be hello',
          PHONE_CLOSE.helloRequired,
        );
        return;
      }
      this.onHello(session, message);
      return;
    }
    this.onSessionMessage(session, message);
  }

  private onInvalid(session: Session, error: string): void {
    if (session.phase === 'hello') {
      this.refuse(session, 'bad-message', `Expected hello: ${error}`, PHONE_CLOSE.helloRequired);
      return;
    }
    session.invalidStreak += 1;
    this.options.logger.debug(`Phone: invalid message: ${error}`);
    this.sendError(session, 'bad-message', error);
    const max = this.options.maxConsecutiveInvalid ?? MAX_CONSECUTIVE_INVALID;
    if (session.invalidStreak >= max) {
      this.options.logger.warn(
        `Phone: closing session ${session.id} after ${max} invalid messages`,
      );
      this.closeSession(session, PHONE_CLOSE.tooManyErrors, 'too many invalid messages');
    }
  }

  private onHello(session: Session, hello: PhoneHello): void {
    this.clearHelloTimer(session);
    if (hello.v !== PROTOCOL_VERSION) {
      this.refuse(
        session,
        'unsupported-version',
        `The HUD speaks protocol version ${PROTOCOL_VERSION}, the phone ${hello.v}`,
        PHONE_CLOSE.unsupportedVersion,
      );
      return;
    }
    const config = this.options.getConfig();
    if (!this.tokenAccepted(hello.token, config)) {
      this.options.logger.warn(`Phone: ${hello.device || 'a phone'} sent a wrong pairing token`);
      this.refuse(session, 'bad-token', 'Wrong pairing token', PHONE_CLOSE.badToken);
      return;
    }

    const previous = this.active;
    session.phase = 'active';
    session.hello = hello;
    this.active = session;
    if (previous !== null && previous !== session) {
      this.options.logger.info(`Phone: session ${previous.id} replaced by session ${session.id}`);
      this.closeSession(previous, PHONE_CLOSE.replaced, 'replaced');
    }

    const welcome: HudWelcome = {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      hudName: config.vehicle.name,
      hudVersion: this.options.version,
      readMessagesAloud: config.phone.readMessagesAloud,
    };
    sendJson(session.ws, welcome);
    this.options.logger.info(
      `Phone: ${hello.device || 'phone'} connected from ${session.remoteAddress} (${hello.app} ${hello.appVersion})`,
    );
    this.options.dispatch({
      type: 'phone/link',
      connected: true,
      deviceName: hello.device === '' ? null : hello.device,
      appVersion: hello.appVersion === '' ? null : hello.appVersion,
      at: this.options.now(),
    });
    const due = this.options.dueMaintenance();
    if (due !== null) sendJson(session.ws, due);
  }

  private onSessionMessage(session: Session, message: PhoneToHud): void {
    switch (message.t) {
      case 'hello':
        // Already greeted: a repeated hello changes nothing.
        return;
      case 'ping':
        sendJson(
          session.ws,
          message.id === undefined ? { t: 'pong' } : { t: 'pong', id: message.id },
        );
        return;
      case 'trips-request':
        sendJson(session.ws, {
          t: 'trips',
          trips: this.options.tripsEndedAfter(message.since, MAX_TRIPS_PER_REQUEST),
        });
        return;
      default:
        for (const event of phoneMessageToEvents(message, this.options.now())) {
          this.options.dispatch(event);
        }
    }
  }

  private onClose(session: Session): void {
    this.clearHelloTimer(session);
    session.phase = 'closed';
    this.sessions.delete(session);
    if (this.active !== session) return;
    this.active = null;
    this.options.logger.info(`Phone: ${session.hello?.device || 'phone'} disconnected`);
    this.options.dispatch({ type: 'phone/link', connected: false, at: this.options.now() });
  }

  private tokenAccepted(token: string, config: HudConfig): boolean {
    const expected = config.phone.pairingToken;
    return expected === '' || secretsEqual(token, expected);
  }

  private sendError(session: Session, code: HudError['code'], message: string): void {
    const error: HudError = { t: 'error', code, message };
    sendJson(session.ws, error);
  }

  /** Send an error and close the session (it never becomes/stays the active phone). */
  private refuse(
    session: Session,
    code: HudError['code'],
    message: string,
    closeCode: number,
  ): void {
    this.sendError(session, code, message);
    this.closeSession(session, closeCode, code);
  }

  private closeSession(session: Session, code: number, reason: string): void {
    this.clearHelloTimer(session);
    if (this.active === session) {
      // Report the disconnect now; the socket's close event may come much later.
      this.active = null;
      this.options.dispatch({ type: 'phone/link', connected: false, at: this.options.now() });
    }
    session.phase = 'closed';
    closeSocket(session.ws, code, reason);
  }

  private clearHelloTimer(session: Session): void {
    if (session.helloTimer !== null) this.options.timers.clearTimeout(session.helloTimer);
    session.helloTimer = null;
  }
}
