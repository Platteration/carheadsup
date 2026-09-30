import { shortFingerprint } from '@carheadsup/core';
import type { HudConfig } from '@carheadsup/core';
import { expect, test } from '@playwright/test';
import { findChromium, startSimulatedHud } from './support.ts';
import type { SimulatedHud } from './support.ts';

/** The phone-sized settings app (`/settings`) changing the live HUD. */

test.skip(findChromium() === null, 'No Chromium binary (set PW_CHROMIUM) — skipping browser e2e');

let hud: SimulatedHud;
test.beforeAll(async () => {
  hud = await startSimulatedHud();
});
test.afterAll(async () => {
  await hud?.close();
});

test('switching to imperial units makes the HUD show mph', async ({ browser }) => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const kiosk = await browser.newPage({ viewport: { width: 1280, height: 480 } });
  const errors: string[] = [];
  for (const page of [phone, kiosk]) page.on('pageerror', (err) => errors.push(err.message));

  // The kiosk shows km/h while the car drives.
  await kiosk.goto(`${hud.base}/`);
  await hud.sim({ mode: 'manual', engineRunning: true, throttle: 0.4, brake: 0 });
  const speed = kiosk.locator('[data-widget="speed"]');
  await expect(speed).toHaveAttribute('aria-label', /km\/h$/);

  await phone.goto(`${hud.base}/settings`);
  const units = phone.locator('section#units');
  await units.scrollIntoViewIfNeeded();
  await units.getByText('mph · miles', { exact: true }).click();
  const saveBar = phone.getByRole('region', { name: 'Unsaved changes' });
  await expect(saveBar).toContainText('1');
  await saveBar.getByRole('button', { name: 'Save' }).click();
  await expect(saveBar.getByRole('status')).toHaveText('Saved');

  // Stored…
  const stored = (await (await fetch(`${hud.base}/api/config`)).json()) as HudConfig;
  expect(stored.units.system).toBe('imperial');
  // …and applied to the live HUD without a reload.
  await expect(speed).toHaveAttribute('aria-label', /^Speed \d+ mph$/);
  expect(errors).toEqual([]);
});

test('the Phone section shows the certificate the phone pins', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`${hud.base}/settings`);
  const phone = page.locator('section#phone');
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toContainText(shortFingerprint(hud.fingerprint));
  await expect(phone).toContainText('TLS port');
  expect(errors).toEqual([]);
});

test('the settings app works over TLS, as the companion app opens it', async ({ browser }) => {
  // The phone's WebView accepts the HUD's self-signed certificate only by its pinned
  // fingerprint; a browser context that ignores certificate errors stands in for that.
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const response = await page.goto(`${hud.httpsBase}/settings`);
  expect(response?.status()).toBe(200);
  expect(await response?.securityDetails()).toMatchObject({
    protocol: expect.stringMatching(/TLS/),
  });
  // The page reaches the API over the same encrypted origin.
  await expect(page.locator('.pill')).toHaveText('Simulator');
  await expect(page.locator('section#phone')).toContainText(shortFingerprint(hud.fingerprint));
  expect(errors).toEqual([]);
  await context.close();
});
