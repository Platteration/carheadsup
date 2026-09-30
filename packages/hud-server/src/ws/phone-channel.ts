import { NO_CHANNEL_BINDING, PROTOCOL_VERSION, parsePhoneMessage } from '@carheadsup/core';
import type {
  HudChallenge,
  HudConfig,
  HudError,
  HudEvent,
  HudMaintenanceDue,
  HudToPhone,
  HudWelcome,
  PhoneHello,
  PhoneProofInput,
  PhoneToHud,
  TripRecord,
} from '@carheadsup/core';
import type { Clock, Logger, Timers } from '@carheadsup/obd';
import type { RawData, WebSocket } from 'ws';
import { hudProof, phoneProof, proofsEqual, randomAuthId } from '../phone/auth.ts';
import { phoneMessageToEvents } from '../phone/translate.ts';
import { TokenBucket } from './rate-limit.ts';
import { closeAll, closeSocket, rawDataToString, sendJson } from './sockets.ts';

/**
 * Close codes used on `/ws/phone` (4000–4999 are application-defined). The companion app shows
 * the accompanying `error` message; the codes make logs and tests unambiguous.
 */
export const PHONE_CLOSE = {
  /** A newer session from the same phone (same `deviceId`) replaced this one. */
  replaced: 4000,
  /** The phone's proof does not match the pairing token (also when the token changes). */
  badToken: 4001,
  /** Protocol version mismatch. */
  unsupportedVersion: 4002,
  /** No valid `hello` as the first message within the time limit. */
  helloRequired: 4003,
  /** Too many invalid messages in a row. */
  tooManyErrors: 4004,
  /**
   * A plain (`ws://`) session while the HUD no longer allows them (`server.allowPlainPhone`
   * switched off): the phone must use TLS.
   */
  tlsRequired: 4005,
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
  /** The HUD's identity, sent in every `challenge` and `welcome` (see `store/hud-id.ts`). */
  hudId: string;
  /**
   * SHA-256 fingerprint of the HUD's TLS certificate (see `tls/identity.ts`), which the proofs
   * of a session over TLS are bound to; null without TLS.
   */
  certFingerprint: string | null;
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

/** How a phone reached the HUD: over TLS (`wss://`, the norm) or plain `ws://`. */
export type PhoneTransport = 'tls' | 'plain';

interface Session {
  readonly id: number;
  readonly ws: WebSocket;
  readonly remoteAddress: string;
  readonly transport: PhoneTransport;
  /**
   * What the proofs are bound to: the fingerprint of the certificate this TLS connection
   * presented, or `NO_CHANNEL_BINDING` on a plain one.
   */
  readonly channelBinding: string;
  /** The nonce of this connection's `challenge`. */
  readonly hudNonce: string;
  phase: 'hello' | 'active' | 'closed';
  helloTimer: unknown;
  readonly bucket: TokenBucket;
  readonly tripsBucket: TokenBucket;
  /** Currently dropping messages over the rate limit (notified once per episode). */
  throttled: boolean;
  invalidStreak: number;
  /** The accepted hello (its proof was checked). */
  hello: PhoneHello | null;
}

/**
 * `/ws/phone`: the companion app's session protocol (v3, mutually authenticated, bound to the
 * TLS certificate).
 *
 *  - On connect the HUD sends `challenge` (its id and a fresh nonce). The first message must be
 *    a valid `hello` within {@link HELLO_TIMEOUT_MS}. A different protocol version gets `error
 *    unsupported-version`; a proof that does not match `phone.pairingToken` (HMAC over the
 *    challenge and this connection's certificate fingerprint, compared in constant time; with
 *    no token set, the empty key) gets `error bad-token` and close 4001 — also a proof made for
 *    another certificate, i.e. through a relay that terminated the phone's TLS. Otherwise the
 *    HUD answers `welcome` with its own proof, the phone counts as connected (`phone/link`) and
 *    due maintenance items are pushed.
 *  - Sessions arrive over TLS ({@link PhoneTransport} `tls`), or — only while
 *    `server.allowPlainPhone` is on — over plain `ws://`, where nothing is bound. Switching the
 *    option off closes plain sessions (4005).
 *  - There is one active phone. A newer session from the same phone (same `deviceId`) replaces
 *    the older one (close 4000 "replaced") without a disconnect in between; another phone is
 *    refused (close 1013) while one is connected, so two paired phones never take the HUD from
 *    each other in turns.
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

  /**
   * A new `/ws/phone` connection, over TLS (bound to the HUD's certificate) or — where the
   * router allowed it — plain.
   */
  accept(ws: WebSocket, remoteAddress: string | undefined, transport: PhoneTransport): void {
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
      transport,
      channelBinding:
        transport === 'tls'
          ? (this.options.certFingerprint ?? NO_CHANNEL_BINDING)
          : NO_CHANNEL_BINDING,
      hudNonce: randomAuthId(),
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
    const challenge: HudChallenge = {
      t: 'challenge',
      v: PROTOCOL_VERSION,
      hudId: this.options.hudId,
      nonce: session.hudNonce,
    };
    this.sendTo(session, challenge);
  }

  /** Send a message to the active phone. False when no phone is connected. */
  send(message: HudToPhone): boolean {
    const session = this.active;
    return session !== null && this.sendTo(session, message);
  }

  /**
   * Disconnect the active phone if its proof does not match the (new) pairing token, and every
   * plain session once plain sessions are no longer allowed.
   */
  updateConfig(config: HudConfig): void {
    if (!config.server.allowPlainPhone) {
      for (const session of [...this.sessions]) {
        if (session.transport !== 'plain' || session.phase === 'closed') continue;
        this.options.logger.info(
          `Phone: plain connections are no longer allowed; closing session ${session.id}`,
        );
        this.closeSession(session, PHONE_CLOSE.tlsRequired, 'TLS required');
      }
    }
    const session = this.active;
    if (session?.hello && !this.proofAccepted(session, session.hello, config)) {
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

    const text = isBinary ? null : rawDataToString(data);
    const parsed =
      text === null
        ? ({ ok: false, error: 'expected a text frame' } as const)
        : parsePhoneMessage(text);
    if (!parsed.ok) {
      this.onInvalid(session, parsed.error, text);
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

  private onInvalid(session: Session, error: string, text: string | null): void {
    if (session.phase === 'hello') {
      // A hello of another version fails validation (v1 had other fields): say so.
      const version = text === null ? null : helloVersion(text);
      if (version !== null && version !== PROTOCOL_VERSION) {
        this.clearHelloTimer(session);
        this.refuseVersion(session, version);
        return;
      }
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
      this.refuseVersion(session, hello.v);
      return;
    }
    const config = this.options.getConfig();
    if (!this.proofAccepted(session, hello, config)) {
      this.options.logger.warn(
        `Phone: ${hello.device || 'a phone'} from ${session.remoteAddress} sent a wrong proof ` +
          '(a wrong pairing token, or a connection relayed through another TLS certificate)',
      );
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
      hudId: this.options.hudId,
      proof: hudProof(config.phone.pairingToken, this.proofInput(session, hello)),
    };
    this.sendTo(session, welcome);
    this.options.logger.info(
      `Phone: ${hello.device || 'phone'} connected from ${session.remoteAddress} (${hello.app} ${hello.appVersion}${session.transport === 'plain' ? ', unencrypted' : ''})`,
    );
    if (previous === null) this.notifyPhoneChange(true);
    this.options.dispatch({
      type: 'phone/link',
      connected: true,
      deviceName: hello.device === '' ? null : hello.device,
      deviceId: hello.deviceId,
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

  private proofInput(session: Session, hello: PhoneHello): PhoneProofInput {
    return {
      hudId: this.options.hudId,
      hudNonce: session.hudNonce,
      phoneNonce: hello.nonce,
      deviceId: hello.deviceId,
      certFingerprint: session.channelBinding,
    };
  }

  /**
   * Whether `hello.proof` was made with `phone.pairingToken` for this session's challenge and
   * certificate. With no token configured the key is empty: anyone can make that proof, and a
   * phone that holds a token (and proved it) does not pass.
   */
  private proofAccepted(session: Session, hello: PhoneHello, config: HudConfig): boolean {
    const expected = phoneProof(config.phone.pairingToken, this.proofInput(session, hello));
    return proofsEqual(expected, hello.proof);
  }

  private refuseVersion(session: Session, version: number): void {
    this.refuse(
      session,
      'unsupported-version',
      `The HUD speaks protocol version ${PROTOCOL_VERSION}, the phone ${version}`,
      PHONE_CLOSE.unsupportedVersion,
    );
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

/**
 * Whether two hellos come from the same phone: the same `deviceId` (a random id per app
 * install), not the same name — two phones of one model share their default name.
 */
function samePhone(a: PhoneHello, b: PhoneHello): boolean {
  return a.deviceId === b.deviceId;
}

/** `v` of a frame that looks like a hello (to answer an outdated one properly), else null. */
function helloVersion(text: string): number | null {
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
    const { t, v } = data as Record<string, unknown>;
    if (t !== 'hello') return null;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
