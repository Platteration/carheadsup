import type { NavInfo } from '@carheadsup/core';
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { findChromium, startSimulatedHud } from './support.ts';
import type { SimulatedHud } from './support.ts';

/**
 * The nav app's own arrow (for a maneuver the HUD cannot name) on the projected display: drawn as
 * a mask filled with the HUD's accent colour — not in the app's colours, which could be invisible
 * or a bright square on the windshield — and allowed by the page's Content Security Policy (a
 * `data:` image in a CSS mask) as the real server sends it.
 */

test.skip(findChromium() === null, 'No Chromium binary (set PW_CHROMIUM) — skipping browser e2e');
test.describe.configure({ mode: 'serial' });

/** 16 × 16: a white 8 × 8 square in the middle of a transparent icon (the companion's mask). */
const ICON =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAF0lEQVR42mNgGAUY4D8BMGrAyDBgBAIAGmr/AeedcFUAAAAASUVORK5CYII=';

let hud: SimulatedHud;
test.beforeAll(async () => {
  hud = await startSimulatedHud();
  await hud.sim({ mode: 'manual', engineRunning: true, throttle: 0.45, brake: 0 });
  await hud.sim({ phone: { kind: 'nav-stop' } });
});
test.afterAll(async () => {
  await hud?.close();
});

function nav(iconPng: string): NavInfo {
  return {
    source: 'google-maps',
    maneuver: { type: 'unknown' },
    distanceToManeuverM: 800,
    street: null,
    currentStreet: null,
    thenManeuver: null,
    lanes: null,
    etaEpochMs: null,
    remainingDistanceM: null,
    remainingSeconds: null,
    iconPng,
    updatedAt: 0,
  };
}

/** The RGBA of pixel (x, y) of a PNG screenshot, read through a canvas. */
async function pixel(browser: Browser, png: Buffer, x: number, y: number): Promise<number[]> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ({ base64, px, py }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('no 2D canvas');
        ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(px, py, 1, 1).data);
      },
      { base64: png.toString('base64'), px: x, py: y },
    );
  } finally {
    await page.close();
  }
}

const rgb = (css: string): number[] => (css.match(/\d+/g) ?? []).slice(0, 3).map(Number);

function watch(page: Page): { errors: string[]; csp: string[] } {
  const errors: string[] = [];
  const csp: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) csp.push(message.text());
  });
  return { errors, csp };
}

test('draws the nav app’s arrow as a mask in the accent colour, under the real CSP', async ({
  page,
  browser,
}) => {
  const { errors, csp } = watch(page);
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto(`${hud.base}/`);
  await expect(page.locator('[data-widget="speed"]')).toBeVisible();

  const icon = page.locator('.hud-nav__png');
  // Guidance from the phone, for a maneuver the HUD has no arrow of its own for.
  await expect
    .poll(
      async () => {
        hud.server.engine.dispatch({ type: 'nav/update', nav: nav(ICON), at: 0 });
        return icon.count();
      },
      { intervals: [250], timeout: 10_000 },
    )
    .toBe(1);
  await expect(page.locator('[data-widget="nav"] img')).toHaveCount(0);

  const style = await icon.evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      mask: css.maskImage || css.getPropertyValue('-webkit-mask-image'),
      fill: css.backgroundColor,
      accent: getComputedStyle(el.parentElement ?? el).color,
    };
  });
  expect(style.mask).toContain('data:image/png;base64,');
  expect(style.fill).toBe(style.accent);

  // On screen: the accent colour where the icon is white, nothing where it is transparent.
  const box = await icon.boundingBox();
  expect(box).not.toBeNull();
  const shot = await icon.screenshot();
  const size = Math.round(box?.width ?? 0);
  const centre = await pixel(browser, shot, Math.floor(size / 2), Math.floor(size / 2));
  const corner = await pixel(browser, shot, 1, 1);
  const accent = rgb(style.accent);
  for (let i = 0; i < 3; i += 1)
    expect(Math.abs((centre[i] ?? 0) - (accent[i] ?? 0))).toBeLessThan(40);
  expect(Math.max(corner[0] ?? 0, corner[1] ?? 0, corner[2] ?? 0)).toBeLessThan(40);
  expect(csp).toEqual([]);
  expect(errors).toEqual([]);
});
