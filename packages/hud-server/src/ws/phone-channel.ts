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
  /** A newer session from the same phone replaced this one. */
  replaced: 4000,
  /** Wrong pairing token (also when the token is changed while connected). */
  badToken: 4001,
  /** Protocol version mismatch. */
  unsupportedVersion: 4002,
  /** No valid `hello` as the first message within the time limit. */
  helloRequired: 4003,
  /** Too many invalid messages in a row. */
  tooManyErrors: 4004,
  /** The phone does not read what the HUD sends (its unsent backlog passed the limit). */
  backlog: 1008,
  /**
   * Try again later: evicted while waiting for its `hello` (too many connections waiting), or
   * another phone is connected.
   */
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
/** Connections allowed to wait for their `hello` at the same time, in total and per address. */
export const MAX_PENDING_SESSIONS = 8;
export const MAX_PENDING_PER_ADDRESS = 2;
/** A session whose unsent messages pass this is closed: the phone is not reading. */
export const MAX_PHONE_BACKLOG_BYTES = 1024 * 1024;
/** `trips-request`s answered per session: sustained rate and burst (each can be ~300 kB). */
export const TRIPS_REQUEST_PER_S = 0.2;
export const TRIPS_REQUEST_BURST = 3;

export interface PhoneChannelOptions {
  /** Feed events into the engine. */
  dispatch(event: HudEvent): void;
  /** Effective config (vehicle name, pairing token, readMessagesAloud). */
  getConfig(): HudConfig;
  /** Trips that ended after `since`, newest first. */
  tripsEndedAfter(since: number, limit: number): TripRecord[];
  /** Maintenance items currently due, pushed right after `welcome`. */
  dueMaintenance(): HudMaintenanceDue | null;
  /**
   * A phone became connected (true) or the connected phone went away (false); not called when
   * the same phone replaces its own session. `--sim` uses it to pause the simulated phone.
   */
  onPhoneChange?(connected: boolean): void;
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
  readonly tripsBucket: TokenBucket;
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
 *  - There is one active phone. A newer session from the same phone (same `device` and `app`)
 *    replaces the older one (close 4000 "replaced") without a disconnect in between; another
 *    phone is refused (close 1013) while one is connected, so two paired phones never take the
 *    HUD from each other in turns.
 *  - At most {@link MAX_PENDING_SESSIONS} connections wait for their hello, at most
 *    {@link MAX_PENDING_PER_ADDRESS} per address; beyond that the oldest waiting one is closed
 *    (1013), so idle connections cannot lock the paired phone out.
 *  - Messages are validated (`parsePhoneMessage`) and translated (`phoneMessageToEvents`);
 *    `ping` → `pong`, `trips-request` → `trips` (at most {@link TRIPS_REQUEST_BURST} in a row,
 *    then one per 5 s). An invalid message gets `error bad-message` but the session survives,
 *    until {@link MAX_CONSECUTIVE_INVALID} in a row.
 *  - Each session is rate limited (token bucket, 50 msg/s, burst 100); excess messages are
 *    dropped with one `bad-message` notice per episode.
 *  - A session that stops reading (more than {@link MAX_PHONE_BACKLOG_BYTES} unsent) is closed
 *    (1008) instead of buffering without limit.
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
    const address = remoteAddress ?? '?';
    this.makeRoomForPending(address);
    const session: Session = {
      id: this.nextId++,
      ws,
      remoteAddress: address,
      phase: 'hello',
      helloTimer: null,
      bucket: new TokenBucket(
        this.options.ratePerSecond ?? PHONE_RATE_PER_S,
        this.options.rateBurst ?? PHONE_RATE_BURST,
        this.options.now,
      ),
      tripsBucket: new TokenBucket(TRIPS_REQUEST_PER_S, TRIPS_REQUEST_BURST, this.options.now),
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
    return session !== null && this.sendTo(session, message);
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

  /**
   * Keep the waiting (pre-hello) connections within the limits before accepting another one:
   * the oldest from the same address beyond {@link MAX_PENDING_PER_ADDRESS}, then the oldest
   * overall beyond {@link MAX_PENDING_SESSIONS}. The newcomer is always accepted: a phone says
   * hello at once, so it gets through while idle squatters only evict each other.
   */
  private makeRoomForPending(address: string): void {
    const pending = [...this.sessions].filter((s) => s.phase === 'hello');
    const sameAddress = pending.filter((s) => s.remoteAddress === address);
    let victim: Session | undefined;
    if (sameAddress.length >= MAX_PENDING_PER_ADDRESS) victim = sameAddress[0];
    else if (pending.length >= MAX_PENDING_SESSIONS) victim = pending[0];
    if (victim === undefined) return;
    this.options.logger.debug(
      `Phone: closing waiting session ${victim.id} from ${victim.remoteAddress} (too many waiting)`,
    );
    this.closeSession(victim, PHONE_CLOSE.busy, 'too many pending connections');
  }

  /**
   * Send to one session unless it has stopped reading: then it is closed rather than letting
   * its unsent messages pile up in memory.
   */
  private sendTo(session: Session, message: unknown): boolean {
    if (session.phase === 'closed') return false;
    if (session.ws.bufferedAmount > MAX_PHONE_BACKLOG_BYTES) {
      this.options.logger.warn(
        `Phone: session ${session.id} is not reading its messages; closing it`,
      );
      this.closeSession(session, PHONE_CLOSE.backlog, 'not reading');
      return false;
    }
    return sendJson(session.ws, message);
  }

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
    if (previous?.hello && !samePhone(previous.hello, hello)) {
      // One phone at a time: the connected one keeps the HUD until it goes away (a vanished
      // phone is dropped by the heartbeat), instead of two phones taking it in turns.
      this.options.logger.info(
        `Phone: ${hello.device || 'a phone'} from ${session.remoteAddress} refused: ${previous.hello.device || 'another phone'} is connected`,
      );
      this.closeSession(session, PHONE_CLOSE.busy, 'another phone is connected');
      return;
    }
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
    this.sendTo(session, welcome);
    this.options.logger.info(
      `Phone: ${hello.device || 'phone'} connected from ${session.remoteAddress} (${hello.app} ${hello.appVersion})`,
    );
    if (previous === null) this.notifyPhoneChange(true);
    this.options.dispatch({
      type: 'phone/link',
      connected: true,
      deviceName: hello.device === '' ? null : hello.device,
      appVersion: hello.appVersion === '' ? null : hello.appVersion,
      at: this.options.now(),
    });
    const due = this.options.dueMaintenance();
    if (due !== null) this.sendTo(session, due);
  }

  private onSessionMessage(session: Session, message: PhoneToHud): void {
    switch (message.t) {
      case 'hello':
        // Already greeted: a repeated hello changes nothing.
        return;
      case 'ping':
        this.sendTo(
          session,
          message.id === undefined ? { t: 'pong' } : { t: 'pong', id: message.id },
        );
        return;
      case 'trips-request':
        if (!session.tripsBucket.take()) {
          this.sendError(
            session,
            'bad-message',
            'Too many trip requests: try again in a few seconds',
          );
          return;
        }
        this.sendTo(session, {
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
    this.notifyPhoneChange(false);
  }

  private notifyPhoneChange(connected: boolean): void {
    try {
      this.options.onPhoneChange?.(connected);
    } catch (err) {
      this.options.logger.warn(
        `Phone: change handler failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private tokenAccepted(token: string, config: HudConfig): boolean {
    const expected = config.phone.pairingToken;
    return expected === '' || secretsEqual(token, expected);
  }

  private sendError(session: Session, code: HudError['code'], message: string): void {
    const error: HudError = { t: 'error', code, message };
    this.sendTo(session, error);
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
    session.phase = 'closed';
    if (this.active === session) {
      // Report the disconnect now; the socket's close event may come much later.
      this.active = null;
      this.options.dispatch({ type: 'phone/link', connected: false, at: this.options.now() });
      this.notifyPhoneChange(false);
    }
    closeSocket(session.ws, code, reason);
  }

  private clearHelloTimer(session: Session): void {
    if (session.helloTimer !== null) this.options.timers.clearTimeout(session.helloTimer);
    session.helloTimer = null;
  }
}

/** Whether two hellos come from the same phone (same device and app). */
function samePhone(a: PhoneHello, b: PhoneHello): boolean {
  return a.device === b.device && a.app === b.app;
}
