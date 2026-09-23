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
import { TokenBucket } from './rate-limit.ts';
import { closeAll, closeSocket, rawDataToString, sendJson, sendText } from './sockets.ts';

/** Frames are skipped for a client whose unsent backlog exceeds this (it catches up later). */
export const MAX_RENDERER_BACKLOG_BYTES = 1024 * 1024;
/** Input actions accepted per renderer client and second (burst 40). */
const INPUT_RATE_PER_S = 20;
const INPUT_BURST = 40;
/** Close code for a client whose credentials stopped being valid (the API token changed). */
export const CLOSE_UNAUTHORIZED = 4001;

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
 * all clients), a new `display` message whenever the projection changes, and it may send
 * `input` actions, which become input events.
 */
export class RendererChannel {
  private readonly options: RendererChannelOptions;
  private readonly clients = new Map<WebSocket, Client>();
  private readonly unsubscribe: () => void;
  private projectionJson: string;
  private closed = false;

  constructor(options: RendererChannelOptions) {
    this.options = options;
    this.projectionJson = JSON.stringify(options.getConfig().display.projection);
    this.unsubscribe = options.engine.onFrame((frame) => this.broadcastFrame(frame));
  }

  get clientCount(): number {
    return this.clients.size;
  }

  accept(ws: WebSocket, auth: RendererClientAuth): void {
    if (this.closed) {
      closeSocket(ws, 1001, 'HUD shutting down');
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
    sendJson(ws, this.displayMessage());
    const frame: RendererFrameMessage = { t: 'frame', frame: this.options.engine.frame };
    sendJson(ws, frame);
    this.options.logger.debug(
      `Renderer: client connected from ${auth.remoteAddress ?? '?'} (${this.clients.size} total)`,
    );
  }

  /** Re-send `display` when the projection changed; drop clients the new token locks out. */
  updateConfig(config: HudConfig): void {
    const projection = JSON.stringify(config.display.projection);
    if (projection !== this.projectionJson) {
      this.projectionJson = projection;
      const text = JSON.stringify(this.displayMessage());
      for (const client of this.clients.values()) sendText(client.ws, text);
    }
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

  private displayMessage(): RendererDisplayMessage {
    return {
      t: 'display',
      projection: this.options.getConfig().display.projection,
      simulated: this.options.simulated,
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
