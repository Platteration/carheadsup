import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '@carheadsup/obd';
import { isAuthorized, isCrossSiteRequest } from './auth.ts';
import { HttpError, MAX_JSON_BODY_BYTES, readJsonBody, sendError, sendReply } from './respond.ts';
import type { Router } from './router.ts';
import { applySecurityHeaders } from './security.ts';
import type { StaticServer } from './static.ts';

export interface RequestHandlerOptions {
  api: Router;
  static: StaticServer;
  /** Current `server.apiToken` (read per request, so a changed token applies immediately). */
  apiToken: () => string;
  logger: Logger;
  maxBodyBytes?: number;
}

/**
 * Parse the request target. Origin-form targets are appended to a fixed base rather than
 * resolved against it, so `//host/path` stays a path. Dot segments are normalised by the URL
 * parser. Null for unparseable targets.
 */
export function parseRequestUrl(target: string | undefined): URL | null {
  try {
    const raw = target ?? '/';
    return raw.startsWith('/') ? new URL(`http://hud.invalid${raw}`) : new URL(raw);
  } catch {
    return null;
  }
}

/** Methods that never change state (exempt from the cross-site check). */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The HTTP request listener: security headers on everything; `/api/*` → auth, CSRF check and
 * the API router (JSON errors); `/ws/*` without an upgrade → 426; anything else → the static
 * renderer files.
 */
export function createRequestHandler(
  options: RequestHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const maxBody = options.maxBodyBytes ?? MAX_JSON_BODY_BYTES;

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (
      !isAuthorized({
        remoteAddress: req.socket.remoteAddress,
        authorization: req.headers.authorization,
        apiToken: options.apiToken(),
      })
    ) {
      sendError(res, 401, 'Missing or invalid API token', {
        'WWW-Authenticate': 'Bearer realm="carheadsup"',
      });
      return;
    }
    const method = req.method ?? 'GET';
    if (!SAFE_METHODS.has(method) && isCrossSiteRequest(req.headers)) {
      sendError(res, 403, 'Cross-site requests are not allowed');
      return;
    }
    const match = options.api.match(method, url.pathname);
    if (match.kind === 'not-found') {
      sendError(res, 404, `No API endpoint ${url.pathname}`);
      return;
    }
    if (match.kind === 'method-not-allowed') {
      sendError(res, 405, `${method} is not supported on ${url.pathname}`, {
        Allow: match.allow.join(', '),
      });
      return;
    }
    let body: Promise<unknown> | null = null;
    const reply = await match.handler({
      req,
      url,
      params: match.params,
      body: () => (body ??= readJsonBody(req, maxBody)),
    });
    sendReply(res, reply);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applySecurityHeaders(res);
    const url = parseRequestUrl(req.url);
    if (url === null) {
      sendError(res, 400, 'Malformed request target');
      return;
    }
    const path = url.pathname;
    if (path === '/api' || path.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (path === '/ws' || path.startsWith('/ws/')) {
      sendError(res, 426, 'This endpoint only accepts WebSocket connections', {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
      });
      return;
    }
    await options.static.handle(req, res, path);
  }

  return (req, res) => {
    const started = process.hrtime.bigint();
    res.once('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      // The path only: query strings are not logged.
      const path = (req.url ?? '').split('?')[0] ?? '';
      options.logger.debug(
        `HTTP ${req.method ?? '?'} ${path} → ${res.statusCode} (${ms.toFixed(1)} ms)`,
      );
    });
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) {
        sendError(res, err.status, err.message, err.headers);
        return;
      }
      options.logger.error(
        `HTTP: ${req.method ?? '?'} ${req.url ?? '?'} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      sendError(res, 500, 'Internal server error');
    });
  };
}
