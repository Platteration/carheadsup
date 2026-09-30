import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { build } from 'vite';
import { inlineBuild } from '../packages/hud-renderer/scripts/inline-demo.ts';
import { REPO_ROOT, findChromium } from './support.ts';

/**
 * The drive simulator (`npm run build:demo`), with no server: the self-contained document opened
 * from disk, and the artifact fragment inside a skeleton like the artifact host's whose CSP
 * forbids every request (and eval), at desktop and phone sizes.
 */

test.skip(findChromium() === null, 'No Chromium binary (set PW_CHROMIUM) — skipping browser e2e');

const HOST_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data: blob:";

/** Roughly what the artifact host wraps a fragment in: charset, viewport, CSP and a reset. */
function hostPage(fragment: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${HOST_CSP}">
<style>
:root { color-scheme: light; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px) }
body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: #f6f5f2 }
img { max-width: 100% }
[hidden] { display: none !important }
</style>
</head>
<body>
${fragment}</body>
</html>
`;
}

let dir = '';
test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'carheadsup-e2e-demo-'));
  const root = join(REPO_ROOT, 'packages', 'hud-renderer');
  await build({
    root,
    configFile: join(root, 'vite.demo.config.ts'),
    logLevel: 'error',
    build: { outDir: dir, emptyOutDir: true, reportCompressedSize: false },
  });
  const { document, fragment } = await inlineBuild(dir);
  await writeFile(join(dir, 'index.html'), document);
  await writeFile(join(dir, 'host.html'), hostPage(fragment));
});
test.afterAll(async () => {
  if (dir !== '') await rm(dir, { recursive: true, force: true });
});

/** Console errors and warnings, page errors, CSP violations and requests other than the page. */
function watch(page: Page, pageUrl: string): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('request', (r) => {
    if (r.url() !== pageUrl) problems.push(`request: ${r.url().slice(0, 100)}`);
  });
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return problems;
}

for (const variant of ['index.html', 'host.html']) {
  for (const { width, height } of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    test(`${variant} at ${width}×${height}: live at once, drives, answers a call`, async ({
      browser,
    }) => {
      const phone = width < 600;
      const context = await browser.newContext({
        viewport: { width, height },
        isMobile: phone,
        hasTouch: phone,
      });
      const page = await context.newPage();
      const url = pathToFileURL(join(dir, variant)).href;
      const problems = watch(page, url);
      await page.clock.install({ time: new Date('2026-09-30T17:30:00') });
      await page.goto(url);
      await expect(page).toHaveTitle('carheadsup Drive Simulator');

      // Live from the first frame: the parked car's dashboard with the OBD link up.
      const hud = page.locator('.hud');
      await expect(hud).toHaveAttribute('data-context', 'parked');
      await expect(page.locator('.hud-content[data-mode="diagnostics"]')).toBeVisible();
      await expect(page.locator('.readout')).toContainText('warm-up');
      const widths = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      expect(widths[0]).toBe(widths[1]);

      // The scripted drive moves off into town.
      await page.clock.runFor(30_000);
      await expect(hud).toHaveAttribute('data-context', 'city');
      await expect(page.locator('.readout')).toContainText(/City \d+ km\/h/);

      // A call comes in and the driver accepts it.
      await page.click('#phone-call');
      await page.clock.runFor(500);
      await expect(hud).toContainText('Incoming call');
      await page.click('#input-primary');
      await page.clock.runFor(500);
      await expect(hud).toContainText('On call');

      expect(problems).toEqual([]);
      await context.close();
    });
  }
}
