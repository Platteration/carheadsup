import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { findChromium } from './support.ts';

// The lab has no dependencies on a running HUD server or vehicle data.
const html = readFileSync(
  new URL('../packages/hud-renderer/public/ui-lab.html', import.meta.url),
  'utf8',
);

async function setRange(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((element, next) => {
    if (!(element instanceof HTMLInputElement)) throw new Error('Expected a range input');
    element.value = next;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test.skip(!findChromium(), 'No Chromium installed');

test.beforeEach(async ({ page }) => {
  await page.setContent(html);
});

for (const concept of ['glance', 'vector', 'apex']) {
  for (const format of ['wide', 'compact']) {
    test(`${concept}, ${format}: samples and critical states`, async ({ page }) => {
      await page.locator(`.tab[data-concept="${concept}"]`).click();
      await page.selectOption('#format', format);
      await expect(page.locator('#hud svg')).toHaveAttribute(
        'viewBox',
        format === 'wide' ? '0 0 1280 480' : '0 0 800 480',
      );
      await expect(page.locator('#hud [data-role="speed"]')).toHaveText('42');
      for (const scene of ['city', 'highway', 'exit', 'call', 'parked']) {
        await page.selectOption('#scenario', scene);
        await expect(page.locator('#hud svg')).toBeVisible();
        await expect(page.locator('#hud .demo-mark')).toBeVisible();
      }
      await page.selectOption('#scenario', 'warning');
      for (const palette of ['ice', 'phosphor', 'amber']) {
        await page.locator(`[data-palette="${palette}"]`).click();
        await expect(page.locator('#hud [data-role="critical"]')).toHaveAttribute(
          'fill',
          '#ff6b78',
        );
      }
      await page.selectOption('#scenario', 'signal');
      await expect(page.locator('#hud [data-role="speed"]')).toHaveCount(0);
      await expect(page.locator('#hud')).toContainText('SIGNAL LOST');
      await expect(page.locator('#speed')).toBeDisabled();
      await expect(page.locator('#play')).toBeDisabled();
    });
  }
}

test('unit conversion, zero and overspeed use explicit states', async ({ page }) => {
  await page.selectOption('#units', 'metric');
  await expect(page.locator('#hud [data-role="speed"]')).toHaveText('68');
  await expect(page.locator('#hud')).toContainText('110 m');
  await page.selectOption('#units', 'imperial');
  await expect(page.locator('#hud')).toContainText('360 ft');
  await setRange(page, '#speed', '90');
  await expect(page.locator('#hud [data-role="speed"]')).toHaveAttribute('fill', '#ff6b78');
  await expect(page.locator('#hud [data-role="overspeed"]')).toHaveText('OVER LIMIT');
  await setRange(page, '#speed', '0');
  await expect(page.locator('#hud [data-role="speed"]')).toHaveText('0');
  await expect(page.locator('#hud [data-role="overspeed"]')).toHaveCount(0);
});

test('mirror and dimming controls affect only the preview', async ({ page }) => {
  const drawing = page.locator('#hud [data-role="drawing"]');
  await page.selectOption('#mirror', 'x');
  await expect(drawing).toHaveAttribute('transform', 'translate(1280 0) scale(-1 1)');
  await page.selectOption('#mirror', 'y');
  await expect(drawing).toHaveAttribute('transform', 'translate(0 480) scale(1 -1)');
  await page.selectOption('#mirror', 'none');
  await page.locator('#night').check();
  await expect(drawing).toHaveAttribute('style', 'filter:brightness(0.58)');
  await setRange(page, '#brightness', '50');
  await expect(drawing).toHaveAttribute('style', 'filter:brightness(0.29)');
});

test('focus retains its demo label and Escape returns focus', async ({ page }) => {
  await page.locator('#focus').click();
  await expect(page.locator('body')).toHaveClass('focus');
  await expect(page.locator('#hud .demo-mark')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass('focus');
  await expect(page.locator('#focus')).toBeFocused();
});

test('switching to no signal stops playback without a frozen value', async ({ page }) => {
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
  await page.selectOption('#scenario', 'signal');
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#hud [data-role="speed"]')).toHaveCount(0);
});

test('no network, no WebSocket and no page errors', async ({ page }) => {
  const requests: string[] = [];
  const sockets: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('websocket', (socket) => sockets.push(socket.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(html);
  await page.locator('.tab[data-concept="apex"]').click();
  await page.selectOption('#scenario', 'call');
  await page.locator('#reset').click();
  expect(requests).toEqual([]);
  expect(sockets).toEqual([]);
  expect(errors).toEqual([]);
});

for (const width of [320, 390, 760, 1024, 1536]) {
  test(`responsive shell at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
}
