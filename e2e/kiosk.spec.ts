import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ApiKioskHealth } from '@carheadsup/core';
import { findChromium, startSimulatedHud } from './support.ts';
import type { SimulatedHud } from './support.ts';

/** The projected display (`/`) against the real server running the simulator. */

test.skip(findChromium() === null, 'No Chromium binary (set PW_CHROMIUM) — skipping browser e2e');
test.describe.configure({ mode: 'serial' });

let hud: SimulatedHud;
test.beforeAll(async () => {
  hud = await startSimulatedHud();
});
test.afterAll(async () => {
  await hud?.close();
});

/** Fail the test on any uncaught page error. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

const speedValue = async (page: Page): Promise<number | null> => {
  const label = await page.locator('[data-widget="speed"]').getAttribute('aria-label', {
    timeout: 1000,
  });
  const match = /Speed (\d+) (km\/h|mph)/.exec(label ?? '');
  return match ? Number(match[1]) : null;
};

test('shows live frames: the parked dashboard, then a changing speed readout', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto(`${hud.base}/`);
  // Starting up parked (the scenario's warm-up): the diagnostics dashboard, mirrored for the glass.
  await expect(page.locator('.hud-content[data-mode="diagnostics"]')).toBeVisible();

  await hud.sim({ mode: 'manual', engineRunning: true, throttle: 0.45, brake: 0 });
  const speed = page.locator('[data-widget="speed"]');
  await expect(speed).toBeVisible();
  await expect(speed).toHaveAttribute('aria-label', /^Speed \d+ km\/h$/);

  // The readout follows the accelerating car: several distinct, increasing values.
  const seen = new Set<number>();
  await expect
    .poll(
      async () => {
        const value = await speedValue(page);
        if (value !== null) seen.add(value);
        return seen.size;
      },
      { intervals: [200], timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(4);
  const values = [...seen];
  expect(Math.max(...values)).toBeGreaterThan(Math.min(...values));
  expect(errors).toEqual([]);
});

test('blanks to the "no signal" dot as soon as the server stops, and recovers after a restart', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto(`${hud.base}/`);
  await expect(page.locator('[data-widget="speed"]')).toBeVisible();

  const stoppedAt = Date.now();
  await hud.close();
  await expect(page.locator('[data-no-signal="true"]')).toBeVisible({ timeout: 5000 });
  // Nothing of the last frame survives: no widgets, no dashboard, no overlays.
  await expect(page.locator('[data-widget]')).toHaveCount(0);
  await expect(page.locator('.hud-content')).toHaveAttribute('data-mode', 'no-signal');
  // Within the renderer's staleness limit (1 s), plus page and CI slack.
  expect(Date.now() - stoppedAt).toBeLessThan(4000);

  // The service comes back (systemd restarts it): the page reconnects by itself, no reload.
  hud = await startSimulatedHud({ port: hud.port });
  await expect(page.locator('.hud-content[data-mode="diagnostics"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('[data-no-signal="true"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('sends its heartbeat while it draws, and reports the errors it catches', async ({ page }) => {
  const health = async (): Promise<ApiKioskHealth> =>
    (await (await fetch(`${hud.base}/api/kiosk/health`)).json()) as ApiKioskHealth;
  await page.goto(`${hud.base}/`);
  // The kiosk launcher (deploy/kiosk.sh) restarts the browser after 5 s without a heartbeat.
  await expect
    .poll(async () => (await health()).aliveAgoMs ?? Number.POSITIVE_INFINITY, { timeout: 10_000 })
    .toBeLessThan(1500);
  expect((await health()).displays).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(2500);
  expect((await health()).aliveAgoMs).toBeLessThan(1500);

  // An error no code handles reaches the server's log.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e: an uncaught page error');
    }, 0);
  });
  await expect
    .poll(() => hud.warnings.find((line) => line.includes('e2e: an uncaught page error')))
    .toContain("Renderer: page error on the HUD's display");

  // No page, no heartbeat.
  await page.close();
  await expect
    .poll(async () => (await health()).aliveAgoMs ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(2000);
});
