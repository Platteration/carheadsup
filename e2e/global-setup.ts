/**
 * Playwright global setup: build the renderer from the current sources into a temporary
 * directory (never touching `packages/hud-renderer/dist`, which a running `npm run sim` may be
 * serving), hand its path to the tests and remove it afterwards.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { RENDERER_DIR_ENV, REPO_ROOT, findChromium } from './support.ts';

export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  // Without a browser every test skips; do not spend time building.
  if (findChromium() === null) return undefined;
  const outDir = await mkdtemp(join(tmpdir(), 'carheadsup-e2e-renderer-'));
  const root = join(REPO_ROOT, 'packages', 'hud-renderer');
  await build({
    root,
    configFile: join(root, 'vite.config.ts'),
    logLevel: 'error',
    build: { outDir, emptyOutDir: true, reportCompressedSize: false },
  });
  process.env[RENDERER_DIR_ENV] = outDir;
  return async () => {
    await rm(outDir, { recursive: true, force: true });
  };
}
