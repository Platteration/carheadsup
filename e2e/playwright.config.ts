import { defineConfig } from '@playwright/test';
import { findChromium } from './support.ts';

/**
 * Browser end-to-end tests against the real HUD server in simulator mode (`npm run test:e2e`).
 * Each spec file starts its own server on a free port; the renderer is built once by the
 * global setup. Without a Chromium binary (see `findChromium`) every test is skipped.
 */
const executablePath = findChromium() ?? undefined;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env['CI'],
  reporter: [['list']],
  outputDir: '../node_modules/.cache/carheadsup-e2e',
  use: {
    browserName: 'chromium',
    headless: true,
    // The pages only talk to the HUD under test — at this machine's LAN address, too
    // (remote.spec.ts) — never through a proxy the environment may name.
    launchOptions: { executablePath, args: ['--no-proxy-server'] },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
});
