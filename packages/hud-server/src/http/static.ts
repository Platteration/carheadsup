import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * Serves the built renderer (`packages/hud-renderer/dist`): the three pages, their hashed
 * assets and anything else Vite emitted. Read-only, GET/HEAD only, path-traversal safe.
 */

/** The pages, by URL path. Everything else maps 1:1 onto files below the dist directory. */
export const PAGE_ROUTES: Readonly<Record<string, string>> = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/settings': 'settings.html',
  '/settings/': 'settings.html',
  '/settings.html': 'settings.html',
  '/dev': 'dev.html',
  '/dev/': 'dev.html',
  '/dev.html': 'dev.html',
};

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
};

export function mimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** Vite puts content-hashed files under /assets/: they never change, so cache them forever. */
const IMMUTABLE_PREFIX = '/assets/';
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/** Pages and other unhashed files are revalidated on every load (an update must show at once). */
const REVALIDATE_CACHE = 'no-cache';

export type StaticResolution =
  | { kind: 'file'; relative: string }
  | { kind: 'bad-request'; reason: string }
  | { kind: 'not-found' };

/**
 * Map a URL pathname (still percent-encoded) onto a path relative to the dist directory, or
 * reject it. Decodes once, refuses NUL bytes, backslashes, dot-files/`..` segments and
 * anything that would resolve outside the root.
 */
export function resolveStaticPath(pathname: string): StaticResolution {
  const page = PAGE_ROUTES[pathname];
  if (page !== undefined) return { kind: 'file', relative: page };
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { kind: 'bad-request', reason: 'Malformed percent-encoding' };
  }
  if (decoded.includes('\0')) return { kind: 'bad-request', reason: 'NUL byte in path' };
  if (decoded.includes('\\')) return { kind: 'bad-request', reason: 'Backslash in path' };
  if (!decoded.startsWith('/')) return { kind: 'bad-request', reason: 'Relative path' };
  const segments = decoded.split('/').slice(1);
  if (segments.some((segment) => segment.startsWith('.'))) return { kind: 'not-found' };
  if (segments.length === 0 || segments.some((segment) => segment === '')) {
    return { kind: 'not-found' };
  }
  return { kind: 'file', relative: segments.join('/') };
}

/** Whether `child` is `root` itself or inside it (both absolute and normalised). */
export function isInside(root: string, child: string): boolean {
  return child === root || child.startsWith(root.endsWith(sep) ? root : root + sep);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The page shown when the renderer has not been built. */
export function rendererMissingPage(dir: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>HUD renderer not built</title>
<style>body{background:#000;color:#ddd;font:16px/1.5 system-ui,sans-serif;margin:2rem;max-width:40rem}code{color:#8cf}</style>
</head>
<body>
<h1>The HUD renderer has not been built</h1>
<p>The server is running, but there is no built user interface in <code>${escapeHtml(dir)}</code>.</p>
<p>Build it once from the repository root with <code>npm run build</code>, then reload this page.
(<code>npm run sim</code> does this automatically.)</p>
<p>The REST API under <code>/api/</code> and the WebSockets under <code>/ws/</code> work regardless.</p>
</body>
</html>
`;
}

function sendText(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
  headers: Record<string, string> = {},
): void {
  const buffer = Buffer.from(body, 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(req.method === 'HEAD' ? undefined : buffer);
}

/** A weak validator from size and mtime (enough to answer conditional requests for pages). */
function etagOf(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`;
}

function matchesEtag(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .some((candidate) => candidate.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''));
}

export interface StaticServer {
  /** Serve a GET/HEAD for a non-API path. Never throws; writes the whole response. */
  handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void>;
}

/**
 * Static file handler for `rootDir`. When the directory has no `index.html` (not built yet)
 * every page answers 503 with instructions instead of a bare 404.
 */
export function createStaticServer(rootDir: string): StaticServer {
  const root = resolve(rootDir);

  async function builtRoot(): Promise<string | null> {
    try {
      const real = await realpath(root);
      const index = await stat(resolve(real, 'index.html'));
      return index.isFile() ? real : null;
    } catch {
      return null;
    }
  }

  return {
    async handle(req, res, pathname) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(req, res, 405, 'Method not allowed\n', undefined, { Allow: 'GET, HEAD' });
        return;
      }
      const resolution = resolveStaticPath(pathname);
      if (resolution.kind === 'bad-request') {
        sendText(req, res, 400, `Bad request: ${resolution.reason}\n`);
        return;
      }
      const realRoot = await builtRoot();
      if (realRoot === null) {
        sendText(req, res, 503, rendererMissingPage(root), 'text/html; charset=utf-8', {
          'Retry-After': '10',
        });
        return;
      }
      if (resolution.kind === 'not-found') {
        sendText(req, res, 404, 'Not found\n');
        return;
      }

      let file: string;
      let size: number;
      let mtimeMs: number;
      try {
        const candidate = resolve(realRoot, resolution.relative);
        if (!isInside(realRoot, candidate)) throw new Error('outside root');
        // Resolve symlinks too: a link inside dist must not lead outside it.
        file = await realpath(candidate);
        if (!isInside(realRoot, file)) throw new Error('outside root');
        const info = await stat(file);
        if (!info.isFile()) throw new Error('not a file');
        size = info.size;
        mtimeMs = info.mtimeMs;
      } catch {
        sendText(req, res, 404, 'Not found\n');
        return;
      }

      const etag = etagOf(size, mtimeMs);
      const immutable = pathname.startsWith(IMMUTABLE_PREFIX);
      res.setHeader('Cache-Control', immutable ? IMMUTABLE_CACHE : REVALIDATE_CACHE);
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', new Date(mtimeMs).toUTCString());
      if (matchesEtag(req.headers['if-none-match'], etag)) {
        res.statusCode = 304;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', mimeType(file));
      res.setHeader('Content-Length', String(size));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      try {
        await pipeline(createReadStream(file), res);
      } catch {
        // Client went away or the file vanished mid-stream: nothing sensible left to send.
        res.destroy();
      }
    },
  };
}
