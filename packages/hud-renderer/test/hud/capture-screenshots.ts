/**
 * Regenerate the HUD screenshots in `docs/screenshots/` (not a test — run it by hand):
 *
 *   node packages/hud-renderer/test/hud/capture-screenshots.ts [fixture ...]
 *
 * Starts the renderer's Vite dev server on a free port, opens `/?fixture=<name>&preview=1` in
 * headless Chromium at each panel size, and saves `<fixture>-<width>x<height>.png`. With fixture
 * names as arguments only those are captured (at 800×480 and 1280×480). Set `PW_CHROMIUM` to a
 * Chromium binary when Playwright's bundled browser is not installed.
 *
 * It also checks the layout: a widget that is partly clipped by its zone fails the run, while a
 * widget dropped whole for lack of room (the intended priority behaviour) is only reported.
 */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createServer } from 'vite';

type Size = readonly [width: number, height: number];

const SMALL: Size = [800, 480];
const WIDE: Size = [1280, 480];

/** The README set: every mode at the common 800×480 panel, key scenes on a wide panel too. */
const DEFAULT_SHOTS: ReadonlyArray<readonly [string, readonly Size[]]> = [
  ['city-nav', [SMALL, WIDE]],
  ['highway-exit-lanes', [SMALL, WIDE]],
  ['roundabout', [SMALL]],
  ['overspeed', [SMALL]],
  ['incoming-call', [SMALL, WIDE]],
  ['check-engine', [SMALL]],
  ['engine-hot', [WIDE]],
  ['tpms-low', [SMALL]],
  ['night-city', [SMALL]],
  ['collision-warning', [SMALL]],
  ['blind-spot-left', [WIDE]],
  ['sport-shift', [WIDE]],
  ['speed-camera', [WIDE]],
  ['imperial-us', [SMALL]],
  ['parked-overview', [SMALL, WIDE]],
  ['parked-trouble-codes', [SMALL]],
  ['parked-trip', [SMALL]],
  ['parked-maintenance', [SMALL]],
];

const rendererRoot = fileURLToPath(new URL('../../', import.meta.url));
const outDir = fileURLToPath(new URL('../../../../docs/screenshots/', import.meta.url));

interface LayoutReport {
  dropped: string[];
  clipped: string[];
}

/** Compare every zone item's box with its zone: beyond the right edge = dropped, else clipped. */
function inspectLayout(page: Page): Promise<LayoutReport> {
  return page.evaluate(() => {
    const report = { dropped: [] as string[], clipped: [] as string[] };
    for (const zone of document.querySelectorAll<HTMLElement>('.hud-zone')) {
      const z = zone.getBoundingClientRect();
      for (const item of zone.children) {
        const r = item.getBoundingClientRect();
        const name = `${zone.dataset.zone}: ${(item.firstElementChild as HTMLElement | null)?.dataset.widget ?? item.className}`;
        if (r.left >= z.right - 1) report.dropped.push(name);
        else if (r.bottom > z.bottom + 1 || r.right > z.right + 1) report.clipped.push(name);
      }
    }
    return report;
  });
}

async function main(): Promise<number> {
  const requested = process.argv.slice(2);
  const shots =
    requested.length > 0 ? requested.map((name) => [name, [SMALL, WIDE]] as const) : DEFAULT_SHOTS;

  const server = await createServer({
    root: rendererRoot,
    configFile: `${rendererRoot}vite.config.ts`,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error('Vite did not report a local URL');

  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  await mkdir(outDir, { recursive: true });
  let failures = 0;
  try {
    for (const [fixture, sizes] of shots) {
      for (const [width, height] of sizes) {
        const page = await browser.newPage({ viewport: { width, height } });
        page.on('pageerror', (err) => {
          failures += 1;
          console.error(`${fixture}: page error: ${err.message}`);
        });
        await page.goto(`${base}?fixture=${encodeURIComponent(fixture)}&preview=1`);
        await page.waitForSelector('.hud-content[data-mode]');
        await page.evaluate(() => document.fonts.ready);
        const file = `${outDir}${fixture}-${width}x${height}.png`;
        // Freeze blinking elements in their "on" state.
        await page.screenshot({ path: file, animations: 'disabled' });
        const { dropped, clipped } = await inspectLayout(page);
        failures += clipped.length;
        const notes = [
          ...clipped.map((c) => `CLIPPED ${c}`),
          ...dropped.map((d) => `dropped ${d}`),
        ];
        console.log(`${fixture} ${width}x${height}${notes.length ? ` — ${notes.join('; ')}` : ''}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return failures;
}

main().then(
  (failures) => {
    process.exitCode = failures > 0 ? 1 : 0;
  },
  (err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  },
);
