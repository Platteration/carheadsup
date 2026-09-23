/**
 * Capture screenshots of the real system (not fixtures) into `docs/screenshots/live-*.png`
 * (not a test — run it by hand, it follows the ~5 min demo drive in real time):
 *
 *   node e2e/capture-live-screenshots.ts
 *
 * Starts the HUD server with the simulator (free port, temporary data directory, the current
 * renderer sources built into a temporary directory), opens the kiosk page at 1280×480 without
 * mirroring (`?preview=1`) and saves it at the interesting moments of the scripted drive:
 * the parked dashboard with trouble codes, the city with guidance and lanes, the incoming call
 * at the red light and the speed camera on the highway. The dev console (1440×900) and the
 * settings app on a phone (390×844) are captured along the way. Set `PW_CHROMIUM` to use a
 * specific Chromium binary.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { build } from 'vite';
import { REPO_ROOT, findChromium, startSimulatedHud } from './support.ts';

const OUT_DIR = join(REPO_ROOT, 'docs', 'screenshots');
/** Longest wait for a moment of the drive (the camera comes ~2.5 min in). */
const MOMENT_TIMEOUT_MS = 6 * 60_000;

async function buildRenderer(): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), 'carheadsup-shots-renderer-'));
  const root = join(REPO_ROOT, 'packages', 'hud-renderer');
  await build({
    root,
    configFile: join(root, 'vite.config.ts'),
    logLevel: 'error',
    build: { outDir, emptyOutDir: true, reportCompressedSize: false },
  });
  return outDir;
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const file = join(OUT_DIR, `live-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  console.log(`saved ${file}`);
}

/** Wait until the kiosk page shows what `predicate` looks for (evaluated in the page). */
async function moment(page: Page, what: string, predicate: () => boolean): Promise<void> {
  console.log(`waiting for ${what}…`);
  await page.waitForFunction(predicate, undefined, { timeout: MOMENT_TIMEOUT_MS, polling: 100 });
}

/** Uncaught errors in any page; a run with errors fails after capturing. */
const pageErrors: string[] = [];

async function newPage(browser: Browser, width: number, height: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (err) => pageErrors.push(`${page.url()}: ${err.message}`));
  return page;
}

async function main(): Promise<void> {
  const executablePath = findChromium();
  if (executablePath === null) throw new Error('No Chromium found; set PW_CHROMIUM');
  await mkdir(OUT_DIR, { recursive: true });
  const rendererDir = await buildRenderer();
  const hud = await startSimulatedHud({ rendererDir });
  const browser = await chromium.launch({ executablePath });
  try {
    const kiosk = await newPage(browser, 1280, 480);
    await kiosk.goto(`${hud.base}/?preview=1`);

    // Warm-up, parked with the engine running: the dashboard with two trouble codes.
    await hud.sim({ dtcs: ['P0420', 'P0171'] });
    await moment(kiosk, 'the parked dashboard with trouble codes', () => {
      const d = document.querySelector('.hud-content[data-mode="diagnostics"]');
      // Every gauge read at least once (the slowest PIDs are polled every 10 s).
      return (
        d !== null &&
        /P0171/.test(d.textContent ?? '') &&
        d.querySelector('.hud-gauge[data-status="unknown"]') === null
      );
    });
    await shoot(kiosk, 'parked-diagnostics-1280x480');
    await hud.sim({ dtcs: [] });

    await moment(kiosk, 'the city with guidance and lanes', () => {
      const nav = document.querySelector('[data-widget="nav"]');
      return (
        document.querySelector('.hud')?.getAttribute('data-context') === 'city' &&
        /Bridge Avenue/.test(nav?.textContent ?? '') &&
        document.querySelector('[data-widget="lanes"]') !== null &&
        document.querySelector('[data-widget="speed"]') !== null
      );
    });
    await shoot(kiosk, 'city-nav-1280x480');

    await moment(kiosk, 'the incoming call', () => {
      return document.querySelector('[data-call="ringing"]') !== null;
    });
    await shoot(kiosk, 'incoming-call-1280x480');

    await moment(kiosk, 'the speed camera on the highway', () => {
      return (
        document.querySelector('.hud')?.getAttribute('data-context') === 'highway' &&
        document.querySelector('[data-widget="hazard"]') !== null
      );
    });
    await shoot(kiosk, 'highway-camera-1280x480');

    // The dev console and the settings app while the car is on the highway.
    const dev = await newPage(browser, 1440, 900);
    await dev.goto(`${hud.base}/dev#live`);
    await dev.waitForSelector('.feed-badge--live');
    await dev.waitForSelector('.preview [data-widget="speed"]');
    await dev.waitForTimeout(1500); // let the event log and fps counter fill in
    await shoot(dev, 'dev-console-1440x900');

    const settings = await newPage(browser, 390, 844);
    await settings.goto(`${hud.base}/settings`);
    await settings.waitForSelector('section#units');
    await settings.waitForTimeout(1000); // live status cards
    await shoot(settings, 'settings-390x844');
  } finally {
    await browser.close();
    await hud.close();
    await rm(rendererDir, { recursive: true, force: true });
  }
  if (pageErrors.length > 0) throw new Error(`Page errors:\n${pageErrors.join('\n')}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
