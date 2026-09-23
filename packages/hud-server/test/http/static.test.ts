import { symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isInside, mimeType, resolveStaticPath } from '../../src/http/static.ts';
import { startTestServer } from '../helpers.ts';
import type { TestServer, TestServerOptions } from '../helpers.ts';

let current: TestServer | null = null;

async function start(options: TestServerOptions = {}): Promise<TestServer> {
  current = await startTestServer(options);
  return current;
}

afterEach(async () => {
  await current?.stop();
  current = null;
});

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Send a request with the path exactly as given (fetch would normalise `..` away). */
function raw(
  port: number,
  path: string,
  method = 'GET',
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

describe('static renderer files', () => {
  it('serves the three pages with no-cache HTML headers', async () => {
    const t = await start();
    const pages: Array<[string, string]> = [
      ['/', 'HUD'],
      ['/index.html', 'HUD'],
      ['/settings', 'Settings'],
      ['/settings/', 'Settings'],
      ['/dev', 'Dev'],
      ['/dev.html', 'Dev'],
    ];
    for (const [path, title] of pages) {
      const res = await raw(t.port, path);
      expect(res.status, path).toBe(200);
      expect(res.body).toContain(`<title>${title}</title>`);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['content-security-policy']).toContain("script-src 'self'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('serves hashed assets with immutable caching and the right MIME types', async () => {
    const t = await start();
    const js = await raw(t.port, '/assets/hud-AbC123.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(js.body).toBe('console.log("hud");');
    expect((await raw(t.port, '/assets/hud-AbC123.css')).headers['content-type']).toBe(
      'text/css; charset=utf-8',
    );
    expect((await raw(t.port, '/assets/font-x1.woff2')).headers['content-type']).toBe('font/woff2');
  });

  it('answers HEAD without a body and revalidates with ETags', async () => {
    const t = await start();
    const head = await raw(t.port, '/', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(Number(head.headers['content-length'])).toBeGreaterThan(0);
    const etag = String(head.headers['etag']);
    expect(etag).toMatch(/^W\/"/);
    const cached = await raw(t.port, '/', 'GET', { 'If-None-Match': etag });
    expect(cached.status).toBe(304);
    expect(cached.body).toBe('');
  });

  it('answers 404 for missing files, directories and dotfiles, 405 for other methods', async () => {
    const t = await start();
    expect((await raw(t.port, '/nope.js')).status).toBe(404);
    expect((await raw(t.port, '/assets')).status).toBe(404);
    expect((await raw(t.port, '/assets/')).status).toBe(404);
    const hidden = await raw(t.port, '/.hidden');
    expect(hidden.status).toBe(404);
    expect(hidden.body).not.toContain('secret');
    const post = await raw(t.port, '/', 'POST');
    expect(post.status).toBe(405);
    expect(post.headers['allow']).toBe('GET, HEAD');
  });

  it('never serves files outside the renderer directory', async () => {
    const t = await start();
    // A secret right next to the renderer directory, and the data directory's config.
    await writeFile(join(t.rendererDir, '..', 'secret.txt'), 'TOP-SECRET');
    const attempts = [
      '/../secret.txt',
      '/assets/../../secret.txt',
      '/%2e%2e/secret.txt',
      '/%2E%2E/%2e%2e/secret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/..%2fsecret.txt',
      '/..%5csecret.txt',
      '/assets/%2e%2e%2f%2e%2e%2fdata%2fconfig.json',
      '/%00/../secret.txt',
      '/index.html%00.js',
      '/%2fetc%2fpasswd',
      '//etc/passwd',
      '/assets/%252e%252e/secret.txt',
      '/%E0%A4%A',
    ];
    for (const path of attempts) {
      const res = await raw(t.port, path);
      expect([400, 404], path).toContain(res.status);
      expect(res.body, path).not.toContain('TOP-SECRET');
      expect(res.body, path).not.toContain('"version"');
    }
  });

  it('does not follow symlinks out of the renderer directory', async () => {
    const t = await start();
    await writeFile(join(t.rendererDir, '..', 'outside.txt'), 'OUTSIDE');
    await symlink(join(t.rendererDir, '..', 'outside.txt'), join(t.rendererDir, 'link.txt'));
    const res = await raw(t.port, '/link.txt');
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('OUTSIDE');
  });

  it('shows a helpful 503 page when the renderer has not been built', async () => {
    const t = await start({ noRenderer: true });
    for (const path of ['/', '/settings', '/dev', '/assets/x.js']) {
      const res = await raw(t.port, path);
      expect(res.status, path).toBe(503);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.body).toContain('npm run build');
    }
    // The API is unaffected.
    expect((await raw(t.port, '/api/info')).status).toBe(200);
  });
});

describe('static path helpers', () => {
  it('maps page routes and plain files', () => {
    expect(resolveStaticPath('/')).toEqual({ kind: 'file', relative: 'index.html' });
    expect(resolveStaticPath('/settings')).toEqual({ kind: 'file', relative: 'settings.html' });
    expect(resolveStaticPath('/assets/a%20b.js')).toEqual({
      kind: 'file',
      relative: 'assets/a b.js',
    });
  });

  it('rejects dangerous paths', () => {
    expect(resolveStaticPath('/a%00b').kind).toBe('bad-request');
    expect(resolveStaticPath('/a%5cb').kind).toBe('bad-request');
    expect(resolveStaticPath('/%E0%A4%A').kind).toBe('bad-request');
    expect(resolveStaticPath('/../x').kind).toBe('not-found');
    expect(resolveStaticPath('/.git/config').kind).toBe('not-found');
    expect(resolveStaticPath('/a//b').kind).toBe('not-found');
  });

  it('checks containment by path segments, not string prefixes', () => {
    expect(isInside('/srv/dist', '/srv/dist')).toBe(true);
    expect(isInside('/srv/dist', '/srv/dist/assets/x.js')).toBe(true);
    expect(isInside('/srv/dist', '/srv/dist-evil/x.js')).toBe(false);
    expect(isInside('/srv/dist', '/srv')).toBe(false);
  });

  it('knows the MIME types the build emits', () => {
    expect(mimeType('a.html')).toBe('text/html; charset=utf-8');
    expect(mimeType('a.JS')).toBe('text/javascript; charset=utf-8');
    expect(mimeType('a.woff')).toBe('font/woff');
    expect(mimeType('a.svg')).toBe('image/svg+xml');
    expect(mimeType('a.bin')).toBe('application/octet-stream');
  });
});
