import type { ApiDiagnostics } from '@carheadsup/core';
import { expect, test } from '@playwright/test';
import { findChromium, startSimulatedHud } from './support.ts';
import type { SimulatedHud } from './support.ts';

/** The developer console (`/dev`) driving the real simulator. */

test.skip(findChromium() === null, 'No Chromium binary (set PW_CHROMIUM) — skipping browser e2e');

let hud: SimulatedHud;
test.beforeAll(async () => {
  hud = await startSimulatedHud();
});
test.afterAll(async () => {
  await hud?.close();
});

test('an incoming call from the phone controls shows the call card on the HUD preview', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${hud.base}/dev#live`);

  const badge = page.locator('.feed-badge');
  await expect(badge).toContainText('Live');
  await expect(badge).toContainText('SIM');
  const preview = page.getByRole('region', { name: 'HUD preview' });
  await expect(preview.locator('.hud-content')).toBeVisible();

  await page.getByRole('button', { name: 'Incoming call', exact: true }).click();
  const card = preview.locator('[data-call]');
  await expect(card).toHaveAttribute('data-call', 'ringing');
  await expect(card).toContainText('Maria Lopez');
  await expect(card).toContainText('Accept');

  // Accept from the driver-input pad: the HUD tells the (simulated) phone, which picks up.
  await page.getByRole('button', { name: /^Accept/ }).click();
  await expect(card).toHaveAttribute('data-call', 'active');

  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await expect(preview.locator('[data-call]')).toHaveCount(0, { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test('injected trouble codes reach the HUD within a polling cycle', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${hud.base}/dev#live`);
  await expect(page.locator('.feed-badge')).toContainText('Live');
  // Wait for the read right after connecting; the next scheduled one is 30 s away.
  await expect
    .poll(async () => {
      const res = await fetch(`${hud.base}/api/diagnostics`);
      return ((await res.json()) as ApiDiagnostics).dtcsCheckedAt;
    })
    .not.toBeNull();
  // Parked with the engine running, as at start-up: the dashboard's overview lists the codes.
  await hud.sim({ mode: 'manual', throttle: 0, brake: 1, dtcs: ['P0420'] });
  const preview = page.getByRole('region', { name: 'HUD preview' });
  await expect(preview).toContainText('P0420', { timeout: 5000 });
});
