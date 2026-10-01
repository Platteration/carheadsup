import { request } from 'node:http';
import { shortFingerprint } from '@carheadsup/core';
import type { HudConfig } from '@carheadsup/core';
import { expect, test } from '@playwright/test';
import { findChromium, lanAddress, relayAsOtherDevice, startSimulatedHud } from './support.ts';
import type { SimulatedHud } from './support.ts';

/**
 * A laptop or phone browser on the car's Wi-Fi: it is sent from plain http to HTTPS, where the
 * settings app and the developer console work as on the HUD itself — with the API token, which
 * never crosses the network in clear text. The browser plays that device through a relay (see
 * `relayAsOtherDevice`). And the HUD's own kiosk on a HUD that listens on one network address:
 * it reaches the HUD there, and is served as the HUD itself.
 */

test.skip(findChromium() === null, 'No Chromium binary (set PW_CHROMIUM) — skipping browser e2e');

const lan = lanAddress();
test.skip(lan === null, 'No LAN address to play another device with');

const TOKEN = 'e2e-remote-token';

let hud: SimulatedHud;
let relay: { close: () => Promise<void> } | null = null;
test.beforeAll(async () => {
  hud = await startSimulatedHud({ config: { server: { apiToken: TOKEN } } });
  relay = await relayAsOtherDevice(lan ?? '', hud);
});
test.afterAll(async () => {
  await relay?.close();
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

test('the kiosk of a HUD on one network address is the HUD itself: plain http, no token', async ({
  browser,
}) => {
  // E.g. `server.host` = 10.42.0.1 on a hotspot: the kiosk cannot use loopback, and connects
  // from that address to that address.
  const own = await startSimulatedHud({
    host: lan ?? '',
    config: { server: { apiToken: TOKEN } },
  });
  try {
    expect(own.base).toBe(`http://${lan}:${own.port}`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 480 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // The projected display: live frames over plain ws://, no redirect, no token.
    const response = await page.goto(`${own.base}/`);
    expect(response?.status()).toBe(200);
    expect(page.url()).toBe(`${own.base}/`);
    await expect(page.locator('.hud-content[data-mode="diagnostics"]')).toBeVisible();
    await expect(page.locator('[data-no-signal="true"]')).toHaveCount(0);

    // The settings app: the config loads without asking for the token.
    await page.goto(`${own.base}/settings`);
    expect(page.url()).toBe(`${own.base}/settings`);
    await expect(page.locator('.pill')).toHaveText('Simulator');
    await expect(page.getByText('This HUD asks for an access token')).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  } finally {
    await own.close();
  }
});
