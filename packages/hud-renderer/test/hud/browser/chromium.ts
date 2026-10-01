/**
 * Shared set-up of the headless-Chromium HUD tests: a Chromium to run (null when none is
 * installed — the tests then skip; set `PW_CHROMIUM` to point at one) and a Vite dev server
 * serving `harness.html`, whose `window.renderHud(frame)` renders any frame.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';

function findChromium(): string | null {
  let bundled: string | null = null;
  try {
    bundled = chromium.executablePath();
  } catch {
    bundled = null;
  }
  for (const candidate of [process.env['PW_CHROMIUM'], '/opt/pw-browsers/chromium', bundled]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

export const executablePath = findChromium();

const rendererRoot = fileURLToPath(new URL('../../../', import.meta.url));

export interface Harness {
  browser: Browser;
  /** URL of the harness page. */
  url: string;
  close(): Promise<void>;
}

/** Start the dev server and the browser (call only when `executablePath` is set). */
export async function startHarness(): Promise<Harness> {
  if (executablePath === null) throw new Error('no Chromium');
  const server: ViteDevServer = await createServer({
    root: rendererRoot,
    configFile: `${rendererRoot}vite.config.ts`,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0] ?? '';
  const browser = await chromium.launch({ executablePath });
  return {
    browser,
    url: `${base}test/hud/browser/harness.html`,
    close: async () => {
      await browser.close();
      await server.close();
    },
  };
}
