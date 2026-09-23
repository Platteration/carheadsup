/**
 * Screenshot the settings app at phone size (not a test — run it by hand):
 *
 *   node packages/hud-renderer/test/settings/capture-screenshot.ts [options]
 *
 *   --out=<file>       output PNG (default docs/screenshots/settings-phone.png)
 *   --offline          no HUD at all: every API call fails (checks the failure states)
 *   --section=<ids>    scroll to a section first (e.g. projection); a comma-separated list
 *                      saves one file per section (<out>-<id>.png)
 *   --full             capture the whole page instead of the viewport
 *   --element          with --section: capture each whole section element (for reviewing)
 *   --width / --height viewport (default 390×844)
 *   --scale=<n>        device pixel ratio (default 2, like a phone)
 *   --eval=<js>        run this script in the page first (e.g. click a button to open a dialog)
 *
 * Starts the renderer's Vite dev server and answers `/api/*` from the in-memory `MockHud`
 * (unless --offline). Set `PW_CHROMIUM` to use a specific Chromium binary.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { MockHud } from './mock-hud.ts';

const rendererRoot = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot = resolve(rendererRoot, '../..');

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const out = resolve(repoRoot, arg('out') ?? 'docs/screenshots/settings-phone.png');
  const width = Number(arg('width') ?? 390);
  const height = Number(arg('height') ?? 844);
  const section = arg('section');

  const server = await createServer({
    root: rendererRoot,
    configFile: `${rendererRoot}vite.config.ts`,
    logLevel: 'warn',
    // No proxy target: with --offline every /api call fails like an unreachable HUD.
    server: { host: '127.0.0.1', port: 0, proxy: {} },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error('Vite did not report a local URL');

  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: Number(arg('scale') ?? 2),
      hasTouch: true,
      isMobile: true,
    });
    page.on('pageerror', (err) => console.error(`page error: ${err.message}`));
    const hud = new MockHud();
    if (flag('offline')) {
      await page.route('**/api/**', (route) => route.abort('connectionrefused'));
    } else {
      await page.route('**/api/**', async (route) => {
        const request = route.request();
        const raw = request.postData();
        const res = hud.handle(
          request.method(),
          request.url(),
          raw ? (JSON.parse(raw) as unknown) : undefined,
          request.headers().authorization ?? null,
        );
        await route.fulfill({ status: res.status, contentType: res.contentType, body: res.body });
      });
    }
    await page.goto(`${base}settings.html`);
    await page.waitForSelector(flag('offline') ? '.pill--offline' : '.pill--online');
    await page.waitForTimeout(600);
    await page.evaluate(() => document.fonts.ready);
    const script = arg('eval');
    if (script) {
      // Arbitrary page script before capturing, e.g. to open a dialog or edit a field.
      await page.evaluate(script);
      await page.waitForTimeout(500);
    }
    await mkdir(dirname(out), { recursive: true });
    // Several sections: one file each, named <out without .png>-<section>.png.
    const targets = section ? section.split(',') : [null];
    for (const target of targets) {
      if (target) {
        await page.evaluate(
          (id) => document.getElementById(id)?.scrollIntoView({ block: 'start' }),
          target,
        );
        await page.waitForTimeout(400);
      }
      const file = targets.length > 1 && target ? out.replace(/\.png$/, `-${target}.png`) : out;
      if (target && flag('element')) {
        // The whole section, however tall, with the sticky bars hidden.
        await page.addStyleTag({
          content: '.topbar, .section-nav, .save-bar { visibility: hidden !important; }',
        });
        await page.locator(`section#${target}`).screenshot({ path: file, animations: 'disabled' });
      } else {
        await page.screenshot({ path: file, fullPage: flag('full'), animations: 'disabled' });
      }
      console.log(`saved ${file}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
