import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Static facts about this package: its version and where its sibling packages live. */

function readVersion(): string {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    if (typeof raw === 'object' && raw !== null && 'version' in raw) {
      const { version } = raw;
      if (typeof version === 'string' && version !== '') return version;
    }
  } catch {
    // Fall through: a missing manifest must not stop the HUD.
  }
  return '0.0.0';
}

/** Version of @carheadsup/hud-server (reported by /api/info, the phone welcome and --version). */
export const HUD_VERSION: string = readVersion();

/**
 * The built renderer (`packages/hud-renderer/dist`), resolved relative to this package so the
 * server works from any working directory. `--renderer-dir` overrides it.
 */
export const DEFAULT_RENDERER_DIR: string = fileURLToPath(
  new URL('../../hud-renderer/dist', import.meta.url),
);

/** The pages a complete renderer build contains. */
export const RENDERER_PAGES: readonly string[] = ['index.html', 'settings.html', 'dev.html'];

/** Whether `dir` holds a complete renderer build. */
export function isRendererBuilt(dir: string): boolean {
  return RENDERER_PAGES.every((page) => existsSync(join(dir, page)));
}
