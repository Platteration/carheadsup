#!/usr/bin/env node
/**
 * Build the renderer if it has not been built yet, so `npm run sim` works straight after
 * `npm install` in a fresh clone. A no-op when `packages/hud-renderer/dist` has all three pages.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RENDERER_DIR, isRendererBuilt } from '../meta.ts';

/** The monorepo root (npm workspaces are addressed from there). */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function buildRenderer(): number {
  process.stdout.write('carheadsup: building the HUD renderer (first run)…\n');
  const args = ['run', 'build', '--workspace', '@carheadsup/hud-renderer'];
  // Under `npm run`, npm_execpath points at npm's own CLI: run it with this Node binary.
  const npmCli = process.env['npm_execpath'];
  const result =
    npmCli !== undefined && npmCli.endsWith('.js')
      ? spawnSync(process.execPath, [npmCli, ...args], { stdio: 'inherit', cwd: REPO_ROOT })
      : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
          stdio: 'inherit',
          cwd: REPO_ROOT,
          shell: process.platform === 'win32',
        });
  if (result.error) {
    process.stderr.write(`carheadsup: could not run npm: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

if (!isRendererBuilt(DEFAULT_RENDERER_DIR)) {
  const status = buildRenderer();
  if (status !== 0 || !isRendererBuilt(DEFAULT_RENDERER_DIR)) {
    process.stderr.write('carheadsup: the renderer build failed; see the output above.\n');
    process.exit(status === 0 ? 1 : status);
  }
}
