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
