import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo, Server as NetServer } from 'node:net';
import type { ApiConfigResult } from '@carheadsup/core';
import { SILENT_LOGGER } from '@carheadsup/obd';
import { afterEach, describe, expect, it } from 'vitest';
import { hudHostNames, isAllowedHost } from '../../src/http/auth.ts';
import {
  SERVE_PLAIN,
  httpsRequiredMessage,
  plainAccess,
  redirectHost,
  secureLocation,
} from '../../src/http/https-only.ts';
import type { PlainAccessPolicy } from '../../src/http/https-only.ts';
import { Router } from '../../src/http/router.ts';
import { createRequestHandler, parseRequestUrl } from '../../src/http/server.ts';
import { createStaticServer } from '../../src/http/static.ts';
import { CLOSE_TLS_REQUIRED } from '../../src/ws/renderer-channel.ts';
import {
  TestSocket,
  connectTestPhone,
  lanAddress,
  makeTempDir,
  rawRequest,
  startTestServer,
  upgradeHeaders,
  writeFakeRenderer,
} from '../helpers.ts';
import type { RawReply, TestServer, TestServerOptions } from '../helpers.ts';

/**
 * HTTPS-only access for other devices: on the plain listener the HUD serves only itself while
 * TLS is on; other devices are redirected (pages) or refused (API, display socket).
 */

function policy(
  options: { tlsEnabled?: boolean; tlsPort?: number | null; allowPlainRemote?: boolean } = {},
): PlainAccessPolicy {
  return {
    tlsEnabled: () => options.tlsEnabled ?? true,
    tlsPort: () => (options.tlsPort === undefined ? 8443 : options.tlsPort),
    allowPlainRemote: () => options.allowPlainRemote ?? false,
  };
}

const url = (target: string): URL => {
  const parsed = parseRequestUrl(target);
  if (parsed === null) throw new Error(`unparseable ${target}`);
  return parsed;
};

const errorOf = (reply: RawReply): string => (JSON.parse(reply.body) as { error: string }).error;

describe('plainAccess', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.8.9.10'])(
    'serves the HUD itself (%s) on the plain listener',
    (address) => {
      expect(plainAccess(address, policy())).toBe(SERVE_PLAIN);
      expect(plainAccess(address, policy({ tlsPort: null }))).toBe(SERVE_PLAIN);
    },
  );

  it.each(['192.168.4.20', '10.42.0.23', '::ffff:10.42.0.23', 'fe80::1', 'fd00::10'])(
    'sends another device (%s) to the TLS port',
    (address) => {
      expect(plainAccess(address, policy())).toEqual({ tlsPort: 8443 });
    },
  );

  it('treats a client without an address (a socket already gone) as another device', () => {
    for (const address of [undefined, null, '']) {
      expect(plainAccess(address, policy())).toEqual({ tlsPort: 8443 });
    }
  });

  it('serves everyone with server.allowPlainRemote, or while TLS is off', () => {
    expect(plainAccess('192.168.4.20', policy({ allowPlainRemote: true }))).toBe(SERVE_PLAIN);
    expect(plainAccess('192.168.4.20', policy({ tlsEnabled: false, tlsPort: null }))).toBe(
      SERVE_PLAIN,
    );
  });

  it('has nowhere to send other devices while the TLS listener is not running', () => {
    expect(plainAccess('192.168.4.20', policy({ tlsPort: null }))).toEqual({ tlsPort: null });
  });
});

describe('redirectHost', () => {
  it.each([
    ['10.42.0.1:8080', '10.42.0.1'],
    ['10.42.0.1', '10.42.0.1'],
    ['10.42.0.1.', '10.42.0.1'],
    ['HUD.local:8080', 'hud.local'],
    ['hud.local.', 'hud.local'],
    [' carheadsup ', 'carheadsup'],
    ['my_pi.fritz.box:80', 'my_pi.fritz.box'],
    ['hud.localhost', 'hud.localhost'],
    ['[::1]:8080', '[::1]'],
    ['[FD00::10]', '[fd00::10]'],
  ])('takes %s as %s', (header, host) => {
    expect(redirectHost(header)).toBe(host);
  });

  it.each([
    // Each of these passes the Host allow-list (it ends in .localhost), but must not redirect.
    'evil.example/.localhost',
    'evil.example?.localhost',
    'evil.example#.localhost',
    'user@evil.example.localhost',
    'evil.example\\.localhost',
    'evil.example%2f.localhost',
    'a b.localhost',
    // Malformed or not a host at all.
    '[fe80::1%25wlan0]:8080',
    '[evil.example]:80',
    '[::1',
    '-hud.local',
    'hud..local',
    `${'x'.repeat(64)}.local`,
    'hud.local:80:80',
    ':8080',
    '',
  ])('refuses %j', (header) => {
    expect(redirectHost(header)).toBeNull();
  });

  it('refuses a missing or repeated header', () => {
    expect(redirectHost(undefined)).toBeNull();
    expect(redirectHost(['hud.local', 'evil.example'])).toBeNull();
  });
});

describe('secureLocation', () => {
  const at = (
    target: string,
    host: string | undefined,
    localAddress: string | undefined = '10.42.0.1',
    tlsPort = 8443,
  ): string | null =>
    secureLocation({ host, localAddress, tlsPort, url: url(target), scheme: 'https' });

  it('keeps the host of the Host header, the path and the query, on the TLS port', () => {
    expect(at('/settings', 'hud.local:8080')).toBe('https://hud.local:8443/settings');
    expect(at('/?fixture=city-nav&preview=1', '10.42.0.1:8080')).toBe(
      'https://10.42.0.1:8443/?fixture=city-nav&preview=1',
    );
    expect(at('/dev', '[fd00::10]:8080')).toBe('https://[fd00::10]:8443/dev');
    expect(at('/settings', 'hud.local', undefined, 443)).toBe('https://hud.local/settings');
    expect(
      secureLocation({
        host: 'hud.local:8080',
        localAddress: undefined,
        tlsPort: 8443,
        url: url('/ws/hud'),
        scheme: 'wss',
      }),
    ).toBe('wss://hud.local:8443/ws/hud');
  });

  it('drops an API token from the query: it is neither handed on nor echoed back', () => {
    expect(at('/settings?token=s3cret', 'hud.local')).toBe('https://hud.local:8443/settings');
    expect(at('/dev?page=2&token=s3cret&token=again', 'hud.local')).toBe(
      'https://hud.local:8443/dev?page=2',
    );
  });

  it('keeps the path a path', () => {
    const location = at('//evil.example/x', 'hud.local') ?? '';
    expect(location).toBe('https://hud.local:8443//evil.example/x');
    expect(new URL(location).host).toBe('hud.local:8443');
    expect(at('/a/../../etc/passwd', 'hud.local')).toBe('https://hud.local:8443/etc/passwd');
  });

  it('uses the address the client reached the HUD at when the Host header names no usable host', () => {
    expect(at('/settings', undefined, '::ffff:10.42.0.1')).toBe('https://10.42.0.1:8443/settings');
    expect(at('/settings', 'evil.example/.localhost', '192.168.4.1')).toBe(
      'https://192.168.4.1:8443/settings',
    );
    expect(at('/settings', '[fe80::1%25wlan0]', 'fe80::1%wlan0')).toBe(
      'https://[fe80::1]:8443/settings',
    );
    // Names the URL parser would read as an IPv4 address are no names.
    expect(at('/', '1234', '10.42.0.1')).toBe('https://10.42.0.1:8443/');
    expect(at('/', '0x7f.1', '10.42.0.1')).toBe('https://10.42.0.1:8443/');
    const nowhere = {
      localAddress: undefined,
      tlsPort: 8443,
      url: url('/'),
      scheme: 'https' as const,
    };
    expect(secureLocation({ ...nowhere, host: undefined })).toBeNull();
    expect(secureLocation({ ...nowhere, host: '1234' })).toBeNull();
    expect(at('/', '1234', 'not an address')).toBeNull();
  });

  it('never leads anywhere but the Host header’s host or the HUD’s own address', () => {
    const hostile = [
      'evil.example/.localhost',
      'evil.example?.localhost',
      'evil.example#.localhost',
      'user@evil.example.localhost',
      'evil.example\\.localhost',
      'evil.example:443/.localhost',
      '[::1]@evil.example',
      'hud.local, evil.example',
      // An ideographic full stop, which the URL parser reads as a dot.
      'evil.example\u3002localhost',
    ];
    for (const header of hostile) {
      const location = at('/settings', header, '10.42.0.1');
      expect({ header, host: location === null ? null : new URL(location).host }).toEqual({
        header,
        host: '10.42.0.1:8443',
      });
    }
  });
});

describe('httpsRequiredMessage', () => {
  it('says where to go instead', () => {
    const message = httpsRequiredMessage('https://hud.local:8443/api/info', 8443);
    expect(message).toMatch(/^HTTPS required: use https:\/\/hud\.local:8443\/api\/info — /);
    expect(message).toContain('server.allowPlainRemote');
    expect(httpsRequiredMessage(null, 8443, 'wss')).toContain('use wss://<this HUD>:8443');
  });

  it('says so when the TLS listener is not running', () => {
    expect(httpsRequiredMessage(null, null)).toMatch(/TLS listener is not running/);
  });
});

// ---------------------------------------------------------------------------------------------
// The request handler, with the client's address made up (so no second machine is needed)

describe('the plain listener’s request handler', () => {
  let server: Server | null = null;
  let temp: { dir: string; cleanup: () => Promise<void> } | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
    await temp?.cleanup();
    temp = null;
  });

  /** A plain listener whose clients all appear to come from `remoteAddress`. */
  async function listen(
    remoteAddress: string,
    access: PlainAccessPolicy = policy(),
  ): Promise<{ base: string; calls: string[]; tokenReads: () => number }> {
    temp = await makeTempDir();
    await writeFakeRenderer(temp.dir);
    const calls: string[] = [];
    let tokenReads = 0;
    const api = new Router()
      .add('GET', '/api/info', () => {
        calls.push('GET /api/info');
        return { json: { ok: true } };
      })
      .add('PATCH', '/api/config', async ({ body }) => {
        calls.push(`PATCH /api/config ${JSON.stringify(await body())}`);
        return { json: { ok: true } };
      });
    const names = hudHostNames('carheadsup');
    const handler = createRequestHandler({
      api,
      static: createStaticServer(temp.dir),
      apiToken: () => {
        tokenReads += 1;
        return 's3cret';
      },
      allowedHost: (host) => isAllowedHost(host, names),
      plainAccess: access,
      logger: SILENT_LOGGER,
    });
    const plain = createServer((req, res) => {
      Object.defineProperty(req.socket, 'remoteAddress', {
        value: remoteAddress,
        configurable: true,
      });
      handler(req, res);
    });
    server = plain;
    await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve));
    const { port } = plain.address() as AddressInfo;
    return { base: `http://127.0.0.1:${port}`, calls, tokenReads: () => tokenReads };
  }

  it('serves the HUD itself as before', async () => {
    const { base, calls } = await listen('127.0.0.1');
    expect((await rawRequest(`${base}/settings`)).status).toBe(200);
    expect((await rawRequest(`${base}/api/info`)).status).toBe(200);
    expect(calls).toEqual(['GET /api/info']);
  });

  it('redirects another device’s page requests to HTTPS', async () => {
    const { base } = await listen('192.168.4.20');
    for (const method of ['GET', 'HEAD']) {
      const reply = await rawRequest(`${base}/settings?x=1&token=s3cret`, {
        method,
        headers: { host: 'carheadsup.local:8080' },
      });
      expect(reply.status).toBe(307);
      expect(reply.headers.location).toBe('https://carheadsup.local:8443/settings?x=1');
      expect(reply.headers['cache-control']).toBe('no-store');
      expect(reply.headers['content-security-policy']).toContain("default-src 'self'");
    }
    for (const path of ['/', '/dev', '/assets/hud-AbC123.js', '/missing']) {
      const reply = await rawRequest(`${base}${path}`, { headers: { host: '10.42.0.1:8080' } });
      expect({ path, status: reply.status, location: reply.headers.location }).toEqual({
        path,
        status: 307,
        location: `https://10.42.0.1:8443${path}`,
      });
    }
  });

  it('refuses another device’s API requests without looking at their token', async () => {
    const { base, calls, tokenReads } = await listen('192.168.4.20');
    const host = { host: '10.42.0.1:8080' };
    for (const authorization of ['Bearer s3cret', 'Bearer wrong', '']) {
      const reply = await rawRequest(`${base}/api/info`, {
        headers: { ...host, ...(authorization === '' ? {} : { authorization }) },
      });
      expect(reply.status).toBe(403);
      expect(reply.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(reply.headers.location).toBeUndefined();
      expect(errorOf(reply)).toMatch(/^HTTPS required: use https:\/\/10\.42\.0\.1:8443\/api\/info/);
    }
    const patch = await rawRequest(`${base}/api/config`, {
      method: 'PATCH',
      headers: { ...host, authorization: 'Bearer s3cret', 'content-type': 'application/json' },
      body: JSON.stringify({ server: { apiToken: '' } }),
    });
    expect(patch.status).toBe(403);
    // Neither a page's form post nor a display socket without its upgrade gets through either.
    const post = await rawRequest(`${base}/settings`, { method: 'POST', headers: host });
    expect(post.status).toBe(403);
    const socket = await rawRequest(`${base}/ws/hud?token=s3cret`, { headers: host });
    expect(socket.status).toBe(403);
    expect(errorOf(socket)).toContain('use wss://10.42.0.1:8443/ws/hud —');
    expect(socket.body).not.toContain('s3cret');
    expect(calls).toEqual([]);
    expect(tokenReads()).toBe(0);
  });

  it('refuses everything from other devices while the TLS listener is not running', async () => {
    const { base, calls } = await listen('fd00::23', policy({ tlsPort: null }));
    for (const path of ['/settings', '/api/info']) {
      const reply = await rawRequest(`${base}${path}`, { headers: { host: '10.42.0.1:8080' } });
      expect(reply.status).toBe(403);
      expect(errorOf(reply)).toMatch(/TLS listener is not running/);
    }
    expect(calls).toEqual([]);
  });

  it('serves other devices with server.allowPlainRemote, or with TLS off', async () => {
    for (const access of [
      policy({ allowPlainRemote: true }),
      policy({ tlsEnabled: false, tlsPort: null }),
    ]) {
      const { base, calls } = await listen('192.168.4.20', access);
      expect((await rawRequest(`${base}/settings`)).status).toBe(200);
      expect((await rawRequest(`${base}/api/info`)).status).toBe(401);
      const authorized = await rawRequest(`${base}/api/info`, {
        headers: { authorization: 'Bearer s3cret' },
      });
      expect(authorized.status).toBe(200);
      expect(calls).toEqual(['GET /api/info']);
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
      await temp?.cleanup();
      temp = null;
    }
  });

  it('still refuses host names that are not the HUD’s before redirecting', async () => {
    const { base } = await listen('192.168.4.20');
    const reply = await rawRequest(`${base}/settings`, { headers: { host: 'evil.example:8080' } });
    expect(reply.status).toBe(403);
    expect(reply.headers.location).toBeUndefined();
    // Allowed by the list, but no usable host: the address the client connected to.
    const odd = await rawRequest(`${base}/settings`, {
      headers: { host: 'evil.example/.localhost' },
    });
    expect(odd.status).toBe(307);
    expect(odd.headers.location).toBe('https://127.0.0.1:8443/settings');
  });
});

// ---------------------------------------------------------------------------------------------
// The whole server, reached from this machine's LAN address (a client that is not loopback)

const lan = lanAddress();

describe('the HUD server', () => {
  let current: TestServer | null = null;
  const sockets: TestSocket[] = [];
  const blockers: NetServer[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await current?.stop();
    current = null;
    for (const blocker of blockers.splice(0)) blocker.close();
  });

  async function start(options: TestServerOptions = {}): Promise<TestServer> {
    current = await startTestServer({ host: '0.0.0.0', ...options });
    return current;
  }

  function connect(address: string, options?: ConstructorParameters<typeof TestSocket>[1]) {
    const socket = new TestSocket(address, options);
    sockets.push(socket);
    return socket;
  }

  async function patchLocally(t: TestServer, patch: unknown): Promise<ApiConfigResult> {
    const res = await fetch(`${t.base}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ApiConfigResult;
  }

  const secret = { server: { apiToken: 's3cret' } };
  const bearer = { authorization: 'Bearer s3cret' };

  it('keeps plain http for the HUD itself: kiosk, settings app, API and display socket', async () => {
    const t = await start({ config: secret });
    expect((await fetch(`${t.base}/`)).status).toBe(200);
    expect((await fetch(`${t.base}/settings`)).status).toBe(200);
    expect((await fetch(`${t.base}/api/info`)).status).toBe(200);
    const kiosk = connect(`${t.wsBase}/ws/hud`);
    await kiosk.nextOfType('frame');
    // Turning plain remote access on and off leaves it alone.
    await patchLocally(t, { server: { allowPlainRemote: true } });
    await patchLocally(t, { server: { allowPlainRemote: false } });
    await kiosk.nextOfType('frame');
    expect(kiosk.ws.readyState).toBe(kiosk.ws.OPEN);
  });

  it.skipIf(lan === null)(
    'redirects other devices’ page requests on the plain port to HTTPS',
    async () => {
      const t = await start({ config: secret });
      expect(t.logger.text('info')).toContain(
        `Browsers on other devices: HTTPS on port ${t.tlsPort}`,
      );
      const reply = await rawRequest(`http://${lan}:${t.port}/settings?tab=phone&token=s3cret`);
      expect(reply.status).toBe(307);
      const location = `https://${lan}:${t.tlsPort}/settings?tab=phone`;
      expect(reply.headers.location).toBe(location);
      // The target serves the page, with the certificate the phone pins.
      const page = await rawRequest(location);
      expect(page.status).toBe(200);
      expect(page.body).toContain('<title>Settings</title>');
      expect(page.fingerprint).toBe(t.fingerprint);
    },
  );

  it.skipIf(lan === null)(
    'refuses other devices’ API requests and display sockets on the plain port',
    async () => {
      const t = await start({ config: { vehicle: { name: 'Golf' }, ...secret } });
      const plain = `http://${lan}:${t.port}`;
      const info = await rawRequest(`${plain}/api/info`, { headers: bearer });
      expect(info.status).toBe(403);
      expect(errorOf(info)).toContain(`use https://${lan}:${t.tlsPort}/api/info —`);
      expect((await rawRequest(`${plain}/api/info`)).status).toBe(403);
      const patch = await rawRequest(`${plain}/api/config`, {
        method: 'PATCH',
        headers: { ...bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ vehicle: { name: 'Owned' } }),
      });
      expect(patch.status).toBe(403);
      expect(t.server.engine.config.vehicle.name).toBe('Golf');

      const upgrade = await rawRequest(`${plain}/ws/hud?token=s3cret`, {
        headers: upgradeHeaders(`${lan}:${t.port}`),
      });
      expect(upgrade.status).toBe(403);
      expect(upgrade.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(errorOf(upgrade)).toContain(`use wss://${lan}:${t.tlsPort}/ws/hud —`);
      expect(upgrade.body).not.toContain('s3cret');
      await expect(connect(`ws://${lan}:${t.port}/ws/hud?token=s3cret`).opened).rejects.toThrow(
        /403/,
      );
      await expect(
        connect(`ws://${lan}:${t.port}/ws/hud`, { headers: bearer }).opened,
      ).rejects.toThrow(/403/);
    },
  );

  it.skipIf(lan === null)('leaves the plain phone link to server.allowPlainPhone', async () => {
    const t = await start({ config: { server: { allowPlainPhone: true } } });
    const { welcome } = await connectTestPhone(`ws://${lan}:${t.port}`);
    expect(welcome).toMatchObject({ t: 'welcome' });
  });

  it.skipIf(lan === null)('serves other devices over HTTPS, with the API token', async () => {
    const t = await start({ config: secret });
    const secure = `https://${lan}:${t.tlsPort}`;
    for (const path of ['/', '/settings', '/dev']) {
      expect((await rawRequest(`${secure}${path}`)).status).toBe(200);
    }
    expect((await rawRequest(`${secure}/api/info`)).status).toBe(401);
    const info = await rawRequest(`${secure}/api/info`, { headers: bearer });
    expect(info.status).toBe(200);
    expect(info.fingerprint).toBe(t.fingerprint);
    const patch = await rawRequest(`${secure}/api/config`, {
      method: 'PATCH',
      headers: { ...bearer, 'content-type': 'application/json' },
      body: JSON.stringify({ vehicle: { name: 'Weekend car' } }),
    });
    expect(patch.status).toBe(200);
    expect(t.server.engine.config.vehicle.name).toBe('Weekend car');
    await expect(connect(`wss://${lan}:${t.tlsPort}/ws/hud`).opened).rejects.toThrow(/401/);
    const display = connect(`wss://${lan}:${t.tlsPort}/ws/hud?token=s3cret`);
    expect(await display.nextOfType('display')).toMatchObject({ t: 'display' });
    await display.nextOfType('frame');
    expect(display.peerFingerprint).toBe(t.fingerprint);
  });

  it.skipIf(lan === null)(
    'serves other devices plainly with server.allowPlainRemote, until it is switched off',
    async () => {
      const t = await start({ config: { server: { apiToken: 's3cret', allowPlainRemote: true } } });
      expect(t.logger.text('warn')).toContain('server.allowPlainRemote is on');
      const plain = `http://${lan}:${t.port}`;
      expect((await rawRequest(`${plain}/settings`)).status).toBe(200);
      expect((await rawRequest(`${plain}/api/info`)).status).toBe(401);
      expect((await rawRequest(`${plain}/api/info`, { headers: bearer })).status).toBe(200);
      const display = connect(`ws://${lan}:${t.port}/ws/hud?token=s3cret`);
      await display.nextOfType('frame');
      const kiosk = connect(`${t.wsBase}/ws/hud`);
      await kiosk.nextOfType('frame');

      const { config } = await patchLocally(t, { server: { allowPlainRemote: false } });
      expect(config.server.allowPlainRemote).toBe(false);
      expect(await display.closed).toBe(CLOSE_TLS_REQUIRED);
      expect((await rawRequest(`${plain}/settings`)).status).toBe(307);
      expect((await rawRequest(`${plain}/api/info`, { headers: bearer })).status).toBe(403);
      await kiosk.nextOfType('frame');
      expect(kiosk.ws.readyState).toBe(kiosk.ws.OPEN);
    },
  );

  it.skipIf(lan === null)(
    'serves other devices plainly while TLS is off, as the only way in',
    async () => {
      const t = await start({ tlsPort: null, config: secret });
      expect(t.logger.text('warn')).toContain('Browsers on other devices: TLS is off');
      const plain = `http://${lan}:${t.port}`;
      expect((await rawRequest(`${plain}/settings`)).status).toBe(200);
      expect((await rawRequest(`${plain}/api/info`)).status).toBe(401);
      expect((await rawRequest(`${plain}/api/info`, { headers: bearer })).status).toBe(200);
      const display = connect(`ws://${lan}:${t.port}/ws/hud?token=s3cret`);
      await display.nextOfType('frame');
    },
  );

  it.skipIf(lan === null)(
    'refuses other devices when the TLS listener could not start, rather than serve them plainly',
    async () => {
      const blocker = createNetServer();
      blockers.push(blocker);
      await new Promise<void>((resolve) => blocker.listen(0, '0.0.0.0', resolve));
      const busy = (blocker.address() as AddressInfo).port;
      const t = await start({ tlsPort: busy, config: secret });
      expect(t.tlsPort).toBeNull();
      expect(t.logger.text('error')).toContain('browsers on other devices are refused');
      const plain = `http://${lan}:${t.port}`;
      for (const path of ['/settings', '/api/info']) {
        const reply = await rawRequest(`${plain}${path}`, { headers: bearer });
        expect(reply.status).toBe(403);
        expect(errorOf(reply)).toMatch(/TLS listener is not running/);
      }
      await expect(connect(`ws://${lan}:${t.port}/ws/hud?token=s3cret`).opened).rejects.toThrow(
        /403/,
      );
      // The HUD itself is served as ever.
      expect((await fetch(`${t.base}/settings`)).status).toBe(200);
    },
  );

  it.skipIf(lan === null)(
    'takes the redirect’s host from an allowed Host header only',
    async () => {
      const t = await start();
      const plain = `http://${lan}:${t.port}/dev`;
      const redirect = async (host: string) =>
        rawRequest(plain, { headers: { host } }).then((reply) => ({
          status: reply.status,
          location: reply.headers.location,
        }));
      expect(await redirect(`evil.example:${t.port}`)).toEqual({
        status: 403,
        location: undefined,
      });
      expect(await redirect(`localhost:${t.port}`)).toEqual({
        status: 307,
        location: `https://localhost:${t.tlsPort}/dev`,
      });
      expect(await redirect(`[::1]:${t.port}`)).toEqual({
        status: 307,
        location: `https://[::1]:${t.tlsPort}/dev`,
      });
      expect(await redirect('evil.example/.localhost')).toEqual({
        status: 307,
        location: `https://${lan}:${t.tlsPort}/dev`,
      });
    },
  );
});
