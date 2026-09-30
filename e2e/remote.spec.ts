import { request } from 'node:http';
import { shortFingerprint } from '@carheadsup/core';
import type { HudConfig } from '@carheadsup/core';
import { expect, test } from '@playwright/test';
import { findChromium, lanAddress, startSimulatedHud } from './support.ts';
import type { SimulatedHud } from './support.ts';

/**
 * A laptop or phone browser on the car's Wi-Fi: it is sent from plain http to HTTPS, where the
 * settings app and the developer console work as on the HUD itself — with the API token, which
 * never crosses the network in clear text.
 */

test.skip(findChromium() === null, 'No Chromium binary (set PW_CHROMIUM) — skipping browser e2e');

const lan = lanAddress();
test.skip(lan === null, 'No LAN address to play another device with');

const TOKEN = 'e2e-remote-token';

let hud: SimulatedHud;
test.beforeAll(async () => {
  hud = await startSimulatedHud({ host: '0.0.0.0', config: { server: { apiToken: TOKEN } } });
});
test.afterAll(async () => {
  await hud?.close();
});

test('the settings app opened over plain http moves to HTTPS and works there with the token', async ({
  browser,
}) => {
  // The browser's certificate warning, accepted (after comparing the fingerprint).
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const plainRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('http:')) plainRequests.push(request.url());
  });

  const response = await page.goto(`http://${lan}:${hud.port}/settings`);
  expect(page.url()).toBe(`https://${lan}:${hud.tlsPort}/settings`);
  expect(response?.status()).toBe(200);
  expect(await response?.securityDetails()).toMatchObject({
    protocol: expect.stringMatching(/TLS/),
  });

  // Another device: the HUD asks for the token.
  await expect(page.getByText('This HUD asks for an access token')).toBeVisible();
  await page.locator('#api-token').fill(TOKEN);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await expect(page.locator('.pill')).toHaveText('Simulator');
  const phone = page.locator('section#phone');
  await expect(phone).toContainText(shortFingerprint(hud.fingerprint));

  // A change travels over HTTPS and is stored.
  const units = page.locator('section#units');
  await units.scrollIntoViewIfNeeded();
  await units.getByText('mph · miles', { exact: true }).click();
  const saveBar = page.getByRole('region', { name: 'Unsaved changes' });
  await saveBar.getByRole('button', { name: 'Save' }).click();
  await expect(saveBar.getByRole('status')).toHaveText('Saved');
  const stored = (await (await fetch(`${hud.base}/api/config`)).json()) as HudConfig;
  expect(stored.units.system).toBe('imperial');

  // Only the first request went out plainly — the one that was redirected.
  expect(plainRequests).toEqual([`http://${lan}:${hud.port}/settings`]);
  expect(errors).toEqual([]);
  await context.close();
});

test('the developer console on another device gets its live feed over wss', async ({ browser }) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const sockets: string[] = [];
  page.on('websocket', (socket) => sockets.push(socket.url()));

  // A token in a plain-http address has crossed the network already: it is not carried over.
  await page.goto(`http://${lan}:${hud.port}/dev?token=${TOKEN}#live`);
  expect(page.url()).toBe(`https://${lan}:${hud.tlsPort}/dev#live`);
  await page.getByRole('textbox', { name: 'Access token' }).fill(TOKEN);
  await page.getByRole('button', { name: 'Use', exact: true }).click();

  const badge = page.locator('.feed-badge');
  await expect(badge).toContainText('Live');
  const preview = page.getByRole('region', { name: 'HUD preview' });
  await expect(preview.locator('.hud-content')).toBeVisible();
  expect(sockets.length).toBeGreaterThan(0);
  for (const url of sockets) expect(url).toMatch(new RegExp(`^wss://${lan}:${hud.tlsPort}/ws/hud`));
  expect(errors).toEqual([]);
  await context.close();
});

test('plain http from another device gets no API and no display socket', async () => {
  const api = await fetch(`http://${lan}:${hud.port}/api/config`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  expect(api.status).toBe(403);
  expect(((await api.json()) as { error: string }).error).toContain(
    `use https://${lan}:${hud.tlsPort}/api/config`,
  );
  const upgrade = await new Promise<number>((resolve, reject) => {
    const req = request({
      host: lan ?? '',
      port: hud.port,
      path: `/ws/hud?token=${TOKEN}`,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 101);
    });
    req.on('error', reject);
    req.end();
  });
  expect(upgrade).toBe(403);
  // The HUD itself (the kiosk) keeps plain http.
  expect((await fetch(`${hud.base}/api/config`)).status).toBe(200);
});
