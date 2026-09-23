import { parseRendererMessage } from '@carheadsup/core';
import type {
  HudConfig,
  HudEvent,
  HudFrame,
  RendererDisplayMessage,
  RendererFrameMessage,
} from '@carheadsup/core';
import type { Clock, Logger, Timers } from '@carheadsup/obd';
import type { RawData, WebSocket } from 'ws';
import { isLoopbackAddress } from '../http/auth.ts';
import { TokenBucket } from './rate-limit.ts';
import { closeAll, closeSocket, rawDataToString, sendJson, sendText } from './sockets.ts';

/** Frames are skipped for a client whose unsent backlog exceeds this (it catches up later). */
export const MAX_RENDERER_BACKLOG_BYTES = 1024 * 1024;
/** Input actions accepted per renderer client and second (burst 40). */
const INPUT_RATE_PER_S = 20;
const INPUT_BURST = 40;
/** Close code for a client whose credentials stopped being valid (the API token changed). */
export const CLOSE_UNAUTHORIZED = 4001;
/**
 * Clients from other machines, per address and in total (each gets every frame, and up to
 * {@link MAX_RENDERER_BACKLOG_BYTES} buffered). The HUD's own display (loopback) is never
 * limited.
 */
export const MAX_RENDERER_CLIENTS_PER_ADDRESS = 4;
export const MAX_REMOTE_RENDERER_CLIENTS = 16;

/** How a renderer client authenticated, re-checked when the API token changes. */
export interface RendererClientAuth {
  remoteAddress: string | undefined;
  /** Token from `?token=` or the Authorization header, if any. */
  token: string | null;
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
  now: Clock;
  timers: Timers;
  logger: Logger;
}

interface Client {
  ws: WebSocket;
  auth: RendererClientAuth;
  inputs: TokenBucket;
}

/**
 * `/ws/hud`: the projected display and the dev console. On connect a client gets the
 * `display` message and the latest frame; afterwards every composed frame (serialised once for
 * all clients), a new `display` message whenever the projection or `hardwareBrightness`
 * changes, and it may send `input` actions, which become input events.
 */
export class RendererChannel {
  private readonly options: RendererChannelOptions;
  private readonly clients = new Map<WebSocket, Client>();
  private readonly unsubscribe: () => void;
  /** The `display` message last sent to every client. */
  private displayJson: string;
  private closed = false;

  constructor(options: RendererChannelOptions) {
    this.options = options;
    this.displayJson = JSON.stringify(this.displayMessage(options.getConfig()));
    this.unsubscribe = options.engine.onFrame((frame) => this.broadcastFrame(frame));
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Whether another client from `remoteAddress` is within the limits (loopback always is). */
  canAccept(remoteAddress: string | undefined): boolean {
    if (isLoopbackAddress(remoteAddress)) return true;
    let remote = 0;
    let sameAddress = 0;
    for (const client of this.clients.values()) {
      if (isLoopbackAddress(client.auth.remoteAddress)) continue;
      remote += 1;
      if (client.auth.remoteAddress === remoteAddress) sameAddress += 1;
    }
    return remote < MAX_REMOTE_RENDERER_CLIENTS && sameAddress < MAX_RENDERER_CLIENTS_PER_ADDRESS;
  }

  accept(ws: WebSocket, auth: RendererClientAuth): void {
    if (this.closed) {
      closeSocket(ws, 1001, 'HUD shutting down');
      return;
    }
    if (!this.canAccept(auth.remoteAddress)) {
      closeSocket(ws, 1013, 'too many display connections');
      return;
    }
    const client: Client = {
      ws,
      auth,
      inputs: new TokenBucket(INPUT_RATE_PER_S, INPUT_BURST, this.options.now),
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

  /** Re-send `display` when the projection changed; drop clients the new token locks out. */
  updateConfig(config: HudConfig): void {
    this.sendDisplayIfChanged(config);
    for (const client of [...this.clients.values()]) {
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
    this.options.engine.dispatch({
      type: 'input',
      action: parsed.value.action,
      at: this.options.now(),
    });
  }
}
