import { readFile, stat } from 'node:fs/promises';
import { get } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo, Server as NetServer } from 'node:net';
import { join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import type { ApiInfo, HudConfig } from '@carheadsup/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { MdnsAdvert } from '../../src/discovery/mdns.ts';
import { certificateFingerprint } from '../../src/tls/certificate.ts';
import { TLS_FILE, parseTlsIdentity } from '../../src/tls/identity.ts';
import { tlsRequiredMessage } from '../../src/ws/upgrade.ts';
import { TestSocket, startTestServer } from '../helpers.ts';
import type { TestServer, TestServerOptions } from '../helpers.ts';

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
  current = await startTestServer(options);
  return current;
}

interface SecureReply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  /** SHA-256 of the certificate the server presented. */
  fingerprint: string;
}

/** GET over HTTPS, trusting exactly `ca` (the HUD's certificate) and checking the host name. */
function secureGet(url: string, ca: string, servername?: string): Promise<SecureReply> {
  return new Promise((resolve, reject) => {
    const request = get(url, { ca, ...(servername ? { servername } : {}) }, (res) => {
      const socket = res.socket as TLSSocket;
      const fingerprint = certificateFingerprint(socket.getPeerCertificate().raw);
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, fingerprint }),
      );
    });
    request.on('error', reject);
  });
}

async function certificateOf(t: TestServer): Promise<string> {
  const identity = parseTlsIdentity(await readFile(join(t.dataDir, TLS_FILE), 'utf8'));
  return identity.certPem;
}

describe('the TLS listener', () => {
  it('serves the same API and pages as the plain one, with the stored certificate', async () => {
    const t = await start();
    expect(t.tlsPort).not.toBeNull();
    expect(t.tlsPort).not.toBe(t.port);
    const ca = await certificateOf(t);
    // Verified against the certificate's IP address (the phone reaches the HUD by IP).
    const info = await secureGet(`${t.httpsBase}/api/info`, ca);
    expect(info.status).toBe(200);
    expect(info.fingerprint).toBe(t.fingerprint);
    const body = JSON.parse(info.body) as ApiInfo;
    expect(body.tls).toEqual({ port: t.tlsPort, fingerprint: t.fingerprint });
    const plain = (await (await fetch(`${t.base}/api/info`)).json()) as ApiInfo;
    expect(plain.tls).toEqual(body.tls);

    const page = await secureGet(`${t.httpsBase}/settings`, ca, 'localhost');
    expect(page.status).toBe(200);
    expect(page.body).toContain('<title>Settings</title>');
    expect(page.headers['content-security-policy']).toContain("connect-src 'self' ws: wss:");
    expect(page.headers['x-frame-options']).toBe('DENY');
  });

  it('serves the display socket too, under the same rules', async () => {
    const t = await start();
    const hud = new TestSocket(`${t.phoneBase}/ws/hud`);
    sockets.push(hud);
    expect(await hud.nextOfType('display')).toMatchObject({ t: 'display' });
    expect(hud.peerFingerprint).toBe(t.fingerprint);
  });

  it('keeps its certificate across restarts', async () => {
    const t = await start();
    const first = t.fingerprint;
    const stored = await readFile(join(t.dataDir, TLS_FILE), 'utf8');
    if (process.platform !== 'win32') {
      expect((await stat(join(t.dataDir, TLS_FILE))).mode & 0o777).toBe(0o600);
    }
    await t.stop();
    current = null;
    const again = await start({ files: { [TLS_FILE]: stored } });
    expect(again.fingerprint).toBe(first);
  });

  it('advertises its port and fingerprint over mDNS', async () => {
    const adverts: MdnsAdvert[] = [];
    const t = await start({
      advertiseHud: (_config: HudConfig, advert: MdnsAdvert) => {
        adverts.push(advert);
        return null;
      },
    });
    expect(adverts).toEqual([
      {
        hudId: expect.stringMatching(/^[\w-]{22}$/),
        tls: { port: t.tlsPort, fingerprint: t.fingerprint },
      },
    ]);
  });

  it('keeps the HUD running when its port is taken, without advertising TLS', async () => {
    const blocker = createNetServer();
    blockers.push(blocker);
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const busy = (blocker.address() as AddressInfo).port;
    const adverts: MdnsAdvert[] = [];
    const t = await start({
      tlsPort: busy,
      advertiseHud: (_config: HudConfig, advert: MdnsAdvert) => {
        adverts.push(advert);
        return null;
      },
    });
    expect(t.tlsPort).toBeNull();
    expect(t.server.tls).toBeNull();
    expect(t.logger.text('error')).toMatch(
      /TLS: Cannot listen on 127\.0\.0\.1:\d+.*phone cannot connect/,
    );
    expect(((await (await fetch(`${t.base}/api/info`)).json()) as ApiInfo).tls).toBeNull();
    expect(adverts[0]?.tls).toBeNull();
    // A phone that tries the plain port is told why it cannot connect.
    const phone = new TestSocket(`${t.wsBase}/ws/phone`);
    sockets.push(phone);
    await expect(phone.opened).rejects.toThrow(/403/);
    expect(tlsRequiredMessage(null)).toMatch(/not running/);
  });

  it('makes no key when TLS is off', async () => {
    const t = await start({ tlsPort: null });
    expect(await stat(join(t.dataDir, TLS_FILE)).catch(() => null)).toBeNull();
    expect(t.server.tls).toBeNull();
    expect(t.logger.text('warn')).toContain('the phone cannot connect');
  });

  it('closes on shutdown', async () => {
    const t = await start();
    const url = `${t.httpsBase}/api/info`;
    const ca = await certificateOf(t);
    expect((await secureGet(url, ca)).status).toBe(200);
    await t.server.stop();
    await expect(secureGet(url, ca)).rejects.toThrow();
  });
});
