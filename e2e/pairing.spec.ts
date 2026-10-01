import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePairingUri } from '@carheadsup/core';
import type { ApiPairingShowResult } from '@carheadsup/core';
import decodeQR from '@paulmillr/qr/decode.js';
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { findChromium, startSimulatedHud } from './support.ts';
import type { SimulatedHud } from './support.ts';

/**
 * Pairing a phone by QR code: the settings app asks the parked HUD to show its pairing code, the
 * projected display (mirrored for the windshield) draws it, and the code decodes to everything
 * the companion app needs. Phones cannot scan here, so the test reads the code off a screenshot.
 */

test.skip(findChromium() === null, 'No Chromium binary (set PW_CHROMIUM) — skipping browser e2e');
test.describe.configure({ mode: 'serial' });

const TOKEN = 'K7fQ2mZrP4xW9sLt3HvNbC8e';
const HOSTS = ['10.42.0.1', 'carheadsup-e2e.local'];

let hud: SimulatedHud;
test.beforeAll(async () => {
  hud = await startSimulatedHud({
    config: { phone: { pairingToken: TOKEN }, vehicle: { name: 'Golf' } },
    pairingHosts: HOSTS,
  });
  // Parked with the engine off, whatever the scripted drive would do.
  await hud.sim({ mode: 'manual', engineRunning: false, throttle: 0, brake: 1 });
});
test.afterAll(async () => {
  await hud?.close();
});

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface Pixels {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8Array;
}

/** The image turned a quarter clockwise. */
function quarterTurn(image: Pixels): Pixels {
  const { width, height, data } = image;
  const turned = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      turned.set(data.subarray(from, from + 4), (x * height + (height - 1 - y)) * 4);
    }
  }
  return { width: height, height: width, data: turned };
}

/**
 * Decode a QR code in any of the four orientations, upright first. @paulmillr/qr mistakes a
 * finder-like run of modules in the data area for a finder pattern in a few codes in a thousand
 * (about 1 in 140 of the HUD's pairing codes; every run draws a different one, with a random HUD
 * id, certificate and port), and then fails; turned, the same code reads. A QR code means the
 * same in every orientation, so this loosens nothing; a mirror image reads in none of them.
 */
function decodeTurned(image: Pixels): string {
  const errors: unknown[] = [];
  let turned = image;
  for (let turn = 0; turn < 4; turn++) {
    try {
      return decodeQR(turned);
    } catch (err) {
      errors.push(err);
    }
    turned = quarterTurn(turned);
  }
  throw new AggregateError(errors, 'the QR code reads in no orientation');
}

/**
 * Read the QR code in a PNG screenshot: its pixels through a canvas (optionally flipped back
 * left-to-right), decoded in Node.js in any orientation (`decodeTurned`).
 */
async function decodeScreenshot(browser: Browser, png: Buffer, unmirror: boolean): Promise<string> {
  const page = await browser.newPage();
  try {
    const image = await page.evaluate(
      async ({ base64, flip }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('no 2D canvas');
        if (flip) {
          ctx.translate(img.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height);
        return { width: data.width, height: data.height, data: Array.from(data.data) };
      },
      { base64: png.toString('base64'), flip: unmirror },
    );
    return decodeTurned({ ...image, data: Uint8Array.from(image.data) });
  } finally {
    await page.close();
  }
}

test('the settings app shows the pairing code on the parked HUD, and it decodes', async ({
  browser,
}) => {
  const kiosk = await browser.newPage({ viewport: { width: 1280, height: 480 } });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const kioskErrors = watchErrors(kiosk);
  const phoneErrors = watchErrors(phone);
  await kiosk.goto(`${hud.base}/`);
  await expect(kiosk.locator('.hud-content[data-mode="diagnostics"]')).toBeVisible();
  await expect(kiosk.locator('[data-page="overview"]')).toBeVisible();

  await phone.goto(`${hud.base}/settings`);
  const section = phone.locator('section#phone');
  await section.scrollIntoViewIfNeeded();
  await section.getByRole('button', { name: 'Show pairing code on the HUD' }).click();
  await expect(section.locator('.notice--ok')).toContainText('scan it with the carheadsup app');

  const qr = kiosk.locator('svg[aria-label="Pairing QR code"]');
  await expect(qr).toBeVisible();
  await expect(kiosk.locator('[data-page="pair"]')).toContainText('Golf HUD');
  // The panel's image is mirrored for the windshield: flipped back, the code reads.
  const png = await qr.screenshot();
  const text = await decodeScreenshot(browser, png, true);
  const parsed = parsePairingUri(text);
  expect(parsed).toEqual({
    ok: true,
    payload: {
      hudId: (await readFile(join(hud.dataDir, 'hud-id'), 'utf8')).trim(),
      certFingerprint: hud.fingerprint,
      pairingToken: TOKEN,
      hosts: HOSTS,
      tlsPort: Number(new URL(hud.httpsBase).port),
      hudName: 'Golf HUD',
    },
  });
  // As shown, it is the mirror image (which phone decoders that handle mirroring read too):
  // it reads in no orientation here.
  await expect(decodeScreenshot(browser, png, false)).rejects.toThrow(
    'the QR code reads in no orientation',
  );
  expect([...kioskErrors, ...phoneErrors]).toEqual([]);
  await phone.close();
  await kiosk.close();
});

test('the code goes as the car drives off and cannot be shown while moving', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto(`${hud.base}/`);
  const show = async () => {
    const res = await fetch(`${hud.base}/api/pairing/show`, { method: 'POST' });
    return { status: res.status, body: (await res.json()) as ApiPairingShowResult };
  };
  expect(await show()).toMatchObject({ status: 200, body: { ok: true, status: 'ready' } });
  await expect(page.locator('svg[aria-label="Pairing QR code"]')).toBeVisible();

  await hud.sim({ engineRunning: true, throttle: 0.5, brake: 0 });
  await expect(page.locator('[data-widget="speed"]')).toBeVisible();
  await expect(page.locator('[data-page="pair"]')).toHaveCount(0);
  await expect(page.locator('svg[aria-label="Pairing QR code"]')).toHaveCount(0);
  expect(await show()).toMatchObject({ status: 409, body: { ok: false, status: null } });
  expect(errors).toEqual([]);
});

test('reads a code the decoder cannot read upright (a kiosk screenshot from a failed run)', async ({
  browser,
}) => {
  // Each run draws a different code (random HUD id, certificate and port). @paulmillr/qr cannot
  // read this one upright ("invalid format pattern"): the screenshot of a run that failed so.
  const png = await readFile(
    new URL('fixtures/pairing-qr-unreadable-upright.png', import.meta.url),
  );
  const text = await decodeScreenshot(browser, png, true);
  expect(parsePairingUri(text)).toEqual({
    ok: true,
    payload: {
      hudId: 'eu7jg0am-Cnzu9rUeOHKvA',
      certFingerprint: '9c59f9c990bc8363f49a70a5f25abca969bca0b29d2d5151a4fec8c6057b98f7',
      pairingToken: TOKEN,
      hosts: HOSTS,
      tlsPort: 36959,
      hudName: 'Golf HUD',
    },
  });
  await expect(decodeScreenshot(browser, png, false)).rejects.toThrow(
    'the QR code reads in no orientation',
  );
});
