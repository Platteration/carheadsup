import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { PROTOCOL_LIMITS } from '@carheadsup/core';
import type { Logger, Timers } from '@carheadsup/obd';
import { WebSocketServer } from 'ws';
import { bearerToken, isAuthorized, isCrossSiteRequest } from '../http/auth.ts';
import { UNKNOWN_HOST_MESSAGE, parseRequestUrl } from '../http/server.ts';
import type { PhoneChannel, PhoneTransport } from './phone-channel.ts';
import type { RendererChannel } from './renderer-channel.ts';
import { Heartbeat } from './sockets.ts';

export const HUD_SOCKET_PATH = '/ws/hud';
export const PHONE_SOCKET_PATH = '/ws/phone';

/** Largest message accepted from renderer clients (their frames are tiny input messages). */
export const RENDERER_MAX_PAYLOAD = 64 * 1024;
/**
 * Largest message accepted from the phone. `parsePhoneMessage` allows frames of up to
 * `PROTOCOL_LIMITS.phoneFrameChars` UTF-16 units (a nav update with its maneuver icon, a full
 * hazard list); twice that in bytes covers non-ASCII text without cutting valid messages off.
 */
export const PHONE_MAX_PAYLOAD = Math.max(64 * 1024, PROTOCOL_LIMITS.phoneFrameChars * 2);

export interface WebSocketRouterOptions {
  renderer: RendererChannel;
  phone: PhoneChannel;
  /** Current `server.apiToken`. */
  apiToken: () => string;
  /** Current `server.allowPlainPhone`: whether `/ws/phone` is served on the plain listener. */
  allowPlainPhone: () => boolean;
  /** The port the TLS listener is bound to (named when a plain phone connection is refused). */
  tlsPort: () => number | null;
  /** Whether a `Host` header names this HUD (DNS-rebinding protection). */
  allowedHost: (host: string | undefined) => boolean;
  timers: Timers;
  logger: Logger;
  heartbeatIntervalMs?: number;
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  503: 'Service Unavailable',
};

/** Answer an upgrade request with a plain HTTP error and close the socket. */
function reject(socket: Duplex, status: number, message: string): void {
  const body = `${message}\n`;
  const extra = status === 401 ? 'WWW-Authenticate: Bearer realm="carheadsup"\r\n' : '';
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      extra +
      '\r\n' +
      body,
  );
}

/** Answer to a phone connecting to the plain listener while it only takes TLS. */
export function tlsRequiredMessage(tlsPort: number | null): string {
  return tlsPort === null
    ? 'The phone link needs TLS, which is not running on this HUD (see server.tlsPort)'
    : `The phone link needs TLS: connect to wss://<this HUD>:${tlsPort}${PHONE_SOCKET_PATH}`;
}

/**
 * Routes HTTP upgrade requests of both listeners to the two WebSocket endpoints (`ws` in
 * noServer mode): `/ws/hud` (same access rule as the REST API; remote clients pass the token as
 * `?token=` or a Bearer header) and `/ws/phone` (authenticated by its `hello`, and bound to the
 * TLS certificate). The phone endpoint is served on the TLS listener, and on the plain one only
 * while `server.allowPlainPhone` is on (403 otherwise). Unknown paths, upgrades addressed to a
 * host name that is not the HUD's (DNS rebinding) and cross-site browser upgrades are refused.
 * Keeps every socket alive with pings every 10 s.
 */
export class WebSocketRouter {
  private readonly options: WebSocketRouterOptions;
  private readonly rendererServer: WebSocketServer;
  private readonly phoneServer: WebSocketServer;
  private readonly heartbeat: Heartbeat;
  private closed = false;

  constructor(options: WebSocketRouterOptions) {
    this.options = options;
    this.rendererServer = new WebSocketServer({
      noServer: true,
      maxPayload: RENDERER_MAX_PAYLOAD,
      perMessageDeflate: false,
    });
    this.phoneServer = new WebSocketServer({
      noServer: true,
      maxPayload: PHONE_MAX_PAYLOAD,
      perMessageDeflate: false,
    });
    this.heartbeat = new Heartbeat({
      intervalMs: options.heartbeatIntervalMs,
      timers: options.timers,
      logger: options.logger,
    });
    this.heartbeat.start();
  }

  /** The plain HTTP server's `upgrade` listener. */
  readonly handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    this.upgrade(req, socket, head, 'plain');
  };

  /** The HTTPS server's `upgrade` listener. */
  readonly handleSecureUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    this.upgrade(req, socket, head, 'tls');
  };

  private upgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    transport: PhoneTransport,
  ): void {
    socket.on('error', (err) => this.options.logger.debug(`Upgrade socket error: ${err.message}`));
    if (this.closed) {
      reject(socket, 503, 'The HUD is shutting down');
      return;
    }
    if (!this.options.allowedHost(req.headers.host)) {
      reject(socket, 403, UNKNOWN_HOST_MESSAGE);
      return;
    }
    const url = parseRequestUrl(req.url);
    if (url === null) {
      reject(socket, 400, 'Malformed request target');
      return;
    }
    const path = url.pathname;
    if (path !== HUD_SOCKET_PATH && path !== PHONE_SOCKET_PATH) {
      reject(socket, 404, `No WebSocket endpoint at ${path}`);
      return;
    }
    if (isCrossSiteRequest(req.headers)) {
      reject(socket, 403, 'Cross-site WebSocket connections are not allowed');
      return;
    }
    const remoteAddress = req.socket.remoteAddress;

    if (path === HUD_SOCKET_PATH) {
      const token = url.searchParams.get('token') ?? bearerToken(req.headers.authorization);
      const authorized = isAuthorized({
        remoteAddress,
        token,
        apiToken: this.options.apiToken(),
      });
      if (!authorized) {
        reject(socket, 401, 'Missing or invalid API token');
        return;
      }
      if (!this.options.renderer.canAccept(remoteAddress)) {
        reject(socket, 503, 'Too many display connections from other devices');
        return;
      }
      this.rendererServer.handleUpgrade(req, socket, head, (ws) => {
        this.heartbeat.track(ws);
        this.options.renderer.accept(ws, { remoteAddress, token });
      });
      return;
    }

    if (transport === 'plain' && !this.options.allowPlainPhone()) {
      this.options.logger.debug(
        `Phone: refused a plain connection from ${remoteAddress ?? '?'} (TLS required)`,
      );
      reject(socket, 403, tlsRequiredMessage(this.options.tlsPort()));
      return;
    }
    this.phoneServer.handleUpgrade(req, socket, head, (ws) => {
      this.heartbeat.track(ws);
      this.options.phone.accept(ws, remoteAddress, transport);
    });
  }

  /** Stop accepting upgrades and pinging, and close both channels' clients. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.heartbeat.stop();
    await Promise.all([this.options.renderer.close(), this.options.phone.close()]);
    await Promise.all([
      new Promise<void>((resolve) => this.rendererServer.close(() => resolve())),
      new Promise<void>((resolve) => this.phoneServer.close(() => resolve())),
    ]);
  }
}
