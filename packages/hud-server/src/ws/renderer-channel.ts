import { parseRendererMessage } from '@carheadsup/core';
import type {
  HudConfig,
  HudEvent,
  HudFrame,
  RendererClientError,
  RendererDisplayMessage,
  RendererFrameMessage,
} from '@carheadsup/core';
import type { Clock, Logger, Timers } from '@carheadsup/obd';
import type { RawData, WebSocket } from 'ws';
import { isHudItself } from '../http/auth.ts';
import type { ConnectionAddresses } from '../http/auth.ts';
import type { Listener } from '../http/https-only.ts';
import { TokenBucket } from './rate-limit.ts';
import { closeAll, closeSocket, rawDataToString, sendJson, sendText } from './sockets.ts';

/** Frames are skipped for a client whose unsent backlog exceeds this (it catches up later). */
export const MAX_RENDERER_BACKLOG_BYTES = 1024 * 1024;
/** Input actions accepted per renderer client and second (burst 40). */
const INPUT_RATE_PER_S = 20;
const INPUT_BURST = 40;
/** Page errors (`client-error`) logged per renderer client: 3 at once, then one per 20 s. */
const CLIENT_ERROR_RATE_PER_S = 1 / 20;
const CLIENT_ERROR_BURST = 3;
/** Close code for a client whose credentials stopped being valid (the API token changed). */
export const CLOSE_UNAUTHORIZED = 4001;
/**
 * Close code for another device's plain (`ws://`) connection once the HUD no longer serves those
 * (`server.allowPlainRemote` switched off while the TLS listener runs).
 */
export const CLOSE_TLS_REQUIRED = 4005;
/**
 * Clients from other machines, per address and in total (each gets every frame, and up to
 * {@link MAX_RENDERER_BACKLOG_BYTES} buffered). The HUD's own display (see `isHudItself`) is
 * never limited.
 */
export const MAX_RENDERER_CLIENTS_PER_ADDRESS = 4;
export const MAX_REMOTE_RENDERER_CLIENTS = 16;

/**
 * How a renderer client connected (its socket's addresses, kept while it is connected) and
 * authenticated, re-checked when the config changes.
 */
export interface RendererClientAuth extends ConnectionAddresses {
  /** Token from `?token=` or the Authorization header, if any. */
  token: string | null;
  /** The listener it connected to. */
  listener: Listener;
}

export interface RendererChannelOptions {
  engine: {
    readonly frame: HudFrame;
    onFrame(listener: (frame: HudFrame) => void): () => void;
    dispatch(event: HudEvent): void;
  };
  /** Effective config (projection, API token). */
  getConfig(): HudConfig;
  simulated: boolean;
  /**
   * Whether a frame sink applies the frames' brightness to the display's backlight right now
   * (default: never). Call {@link RendererChannel.refreshDisplay} when it changes.
   */
  hardwareBrightness?(): boolean;
  /** Whether a client may stay connected under `config` (same rule as for the HTTP API). */
  authorize(auth: RendererClientAuth, config: HudConfig): boolean;
  /**
   * Whether a client may stay on the listener it used under `config` (default: always); see
   * `https-only.ts`.
   */
  listenerAllowed?(auth: RendererClientAuth, config: HudConfig): boolean;
  /**
   * Called with each page error a client reports (`client-error`, within the rate limit), after
   * it was logged.
   */
  onClientError?(report: PageErrorReport): void;
  now: Clock;
  /**
   * Monotonic clock for the age of the kiosk's heartbeat (default `now`; the server passes engine
   * time, which a step of the system clock does not move).
   */
  monotonic?: Clock;
  timers: Timers;
  logger: Logger;
}

/** A page error as a renderer client reported it. */
export interface PageErrorReport {
  /** From the HUD's own display (see `isHudItself`), not another device. */
  fromHud: boolean;
  message: string;
  stack: string | null;
}

/** What `GET /api/kiosk/health` reports about the HUD's own display. */
export interface KioskHealth {
  /** Time since the last heartbeat from a page on the HUD itself; null when none came yet. */
  aliveAgoMs: number | null;
  /** Renderer connections from the HUD itself right now. */
  displays: number;
}

interface Client {
  ws: WebSocket;
  auth: RendererClientAuth;
  /** Connected from the HUD itself (the kiosk, a local developer console). */
  fromHud: boolean;
  inputs: TokenBucket;
  errors: TokenBucket;
  /** Page errors dropped by the rate limit since the last one logged. */
  suppressedErrors: number;
  /** Whether it has sent a heartbeat yet. */
  alive: boolean;
}

/**
 * `/ws/hud`: the projected display and the dev console. On connect a client gets the
 * `display` message and the latest frame; afterwards every composed frame (serialised once for
 * all clients), a new `display` message whenever the projection or `hardwareBrightness`
 * changes, and it may send `input` actions, which become input events. The kiosk page also
 * sends a heartbeat (`alive`, recorded for clients on the HUD itself: {@link kioskHealth}) and
 * the errors it catches (`client-error`, logged at warn).
 */
export class RendererChannel {
  private readonly options: RendererChannelOptions;
  private readonly monotonic: Clock;
  private readonly clients = new Map<WebSocket, Client>();
  private readonly unsubscribe: () => void;
  /** The `display` message last sent to every client. */
  private displayJson: string;
  /** When a page on the HUD itself last sent its heartbeat (`monotonic`), if ever. */
  private lastAliveAt: number | null = null;
  private closed = false;

  constructor(options: RendererChannelOptions) {
    this.options = options;
    this.monotonic = options.monotonic ?? options.now;
    this.displayJson = JSON.stringify(this.displayMessage(options.getConfig()));
    this.unsubscribe = options.engine.onFrame((frame) => this.broadcastFrame(frame));
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Whether the HUD's own display still draws: the age of its latest heartbeat. */
  kioskHealth(): KioskHealth {
    let displays = 0;
    for (const client of this.clients.values()) if (client.fromHud) displays += 1;
    const last = this.lastAliveAt;
    return {
      aliveAgoMs: last === null ? null : Math.max(0, Math.round(this.monotonic() - last)),
      displays,
    };
  }

  /**
   * Whether another client connected like `connection` is within the limits (the HUD itself
   * always is).
   */
  canAccept(connection: ConnectionAddresses): boolean {
    if (isHudItself(connection.remoteAddress, connection.localAddress)) return true;
    let remote = 0;
    let sameAddress = 0;
    for (const { auth } of this.clients.values()) {
      if (isHudItself(auth.remoteAddress, auth.localAddress)) continue;
      remote += 1;
      if (auth.remoteAddress === connection.remoteAddress) sameAddress += 1;
    }
    return remote < MAX_REMOTE_RENDERER_CLIENTS && sameAddress < MAX_RENDERER_CLIENTS_PER_ADDRESS;
  }

  accept(ws: WebSocket, auth: RendererClientAuth): void {
    if (this.closed) {
      closeSocket(ws, 1001, 'HUD shutting down');
      return;
    }
    if (!this.canAccept(auth)) {
      closeSocket(ws, 1013, 'too many display connections');
      return;
    }
    const client: Client = {
      ws,
      auth,
      fromHud: isHudItself(auth.remoteAddress, auth.localAddress),
      inputs: new TokenBucket(INPUT_RATE_PER_S, INPUT_BURST, this.options.now),
      errors: new TokenBucket(CLIENT_ERROR_RATE_PER_S, CLIENT_ERROR_BURST, this.options.now),
      suppressedErrors: 0,
      alive: false,
    };
    this.clients.set(ws, client);
    ws.on('message', (data, isBinary) => this.onMessage(client, data, isBinary));
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', (err) => this.options.logger.debug(`Renderer socket error: ${err.message}`));
    sendJson(ws, this.displayMessage(this.options.getConfig()));
    const frame: RendererFrameMessage = { t: 'frame', frame: this.options.engine.frame };
    sendJson(ws, frame);
    this.options.logger.debug(
      `Renderer: client connected from ${auth.remoteAddress ?? '?'} (${this.clients.size} total)`,
    );
  }

  /**
   * Re-send `display` when the projection changed; drop plain clients from other devices that
   * must use TLS now, and clients the new token locks out.
   */
  updateConfig(config: HudConfig): void {
    this.sendDisplayIfChanged(config);
    for (const client of [...this.clients.values()]) {
      if (this.options.listenerAllowed?.(client.auth, config) === false) {
        this.options.logger.info(
          'Renderer: plain connections from other devices are off; disconnecting a remote client',
        );
        closeSocket(client.ws, CLOSE_TLS_REQUIRED, 'use wss');
        continue;
      }
      if (!this.options.authorize(client.auth, config)) {
        this.options.logger.info('Renderer: API token changed; disconnecting a remote client');
        closeSocket(client.ws, CLOSE_UNAUTHORIZED, 'unauthorized');
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    await closeAll([...this.clients.keys()], 1001, 'HUD shutting down', this.options.timers);
    this.clients.clear();
  }

  /** Re-send `display` if `hardwareBrightness` (or anything else in it) changed. */
  refreshDisplay(): void {
    if (this.closed) return;
    this.sendDisplayIfChanged(this.options.getConfig());
  }

  private sendDisplayIfChanged(config: HudConfig): void {
    const text = JSON.stringify(this.displayMessage(config));
    if (text === this.displayJson) return;
    this.displayJson = text;
    for (const client of this.clients.values()) sendText(client.ws, text);
  }

  private displayMessage(config: HudConfig): RendererDisplayMessage {
    return {
      t: 'display',
      projection: config.display.projection,
      simulated: this.options.simulated,
      hardwareBrightness: this.options.hardwareBrightness?.() === true,
    };
  }

  private broadcastFrame(frame: HudFrame): void {
    if (this.clients.size === 0) return;
    const message: RendererFrameMessage = { t: 'frame', frame };
    const text = JSON.stringify(message);
    for (const client of this.clients.values()) {
      // A client that cannot keep up misses frames rather than accumulating a backlog.
      if (client.ws.bufferedAmount > MAX_RENDERER_BACKLOG_BYTES) continue;
      sendText(client.ws, text);
    }
  }

  private onMessage(client: Client, data: RawData, isBinary: boolean): void {
    if (isBinary || !client.inputs.take()) return;
    const parsed = parseRendererMessage(rawDataToString(data));
    if (!parsed.ok) {
      this.options.logger.debug(`Renderer: ignoring invalid message: ${parsed.error}`);
      return;
    }
    const message = parsed.value;
    switch (message.t) {
      case 'input':
        this.options.engine.dispatch({
          type: 'input',
          action: message.action,
          at: this.options.now(),
        });
        return;
      case 'alive':
        // Only the HUD's own display: a page on a laptop says nothing about the windshield.
        if (!client.fromHud) return;
        this.lastAliveAt = this.monotonic();
        if (!client.alive) {
          client.alive = true;
          this.options.logger.debug("Renderer: the HUD's display is drawing (heartbeat)");
        }
        return;
      case 'client-error':
        this.pageError(client, message);
        return;
      default: {
        const unknown: never = message;
        void unknown;
      }
    }
  }

  /** Log a page error (rate-limited per client) and pass it on. */
  private pageError(client: Client, message: RendererClientError): void {
    if (!client.errors.take()) {
      client.suppressedErrors += 1;
      return;
    }
    const where = client.fromHud
      ? "the HUD's display"
      : `a display at ${client.auth.remoteAddress ?? '?'}`;
    const { stack } = message;
    // A stack trace usually starts with the message already.
    const detail =
      stack === null
        ? message.message
        : stack.includes(message.message)
          ? stack
          : `${message.message} | ${stack}`;
    const suppressed =
      client.suppressedErrors > 0 ? ` (${client.suppressedErrors} more not logged)` : '';
    client.suppressedErrors = 0;
    this.options.logger.warn(`Renderer: page error on ${where}: ${detail}${suppressed}`);
    try {
      this.options.onClientError?.({ fromHud: client.fromHud, message: message.message, stack });
    } catch (err) {
      this.options.logger.debug(
        `Renderer: handling a page error failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
