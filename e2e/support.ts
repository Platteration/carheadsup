/**
 * Shared helpers for the browser end-to-end suite (`npm run test:e2e`) and the live screenshot
 * capture: find a Chromium to drive, and start the real HUD server in simulator mode on a free
 * port with a throw-away data directory.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeepPartial, HudConfig, SimControl, SimStatus } from '@carheadsup/core';
import { DEFAULT_CONFIG, mergeConfig } from '@carheadsup/core';
import { chromium } from '@playwright/test';
import { createHudServer } from '../packages/hud-server/src/app.ts';
import type { HudServer } from '../packages/hud-server/src/app.ts';

/** Where the environment's preinstalled Chromium lives (Playwright's own may be missing). */
export const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';

/** The monorepo root. */
export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Environment variable through which the global setup hands the renderer build to the tests. */
export const RENDERER_DIR_ENV = 'CARHEADSUP_E2E_RENDERER_DIR';

function bundledChromium(): string | null {
  try {
    return chromium.executablePath();
  } catch {
    return null;
  }
}

/**
 * The Chromium binary to drive: `$PW_CHROMIUM`, the preinstalled one, or Playwright's bundled
 * browser — the first that exists. Null when none is installed (the suite then skips).
 */
export function findChromium(): string | null {
  const candidates = [process.env['PW_CHROMIUM'], PREINSTALLED_CHROMIUM, bundledChromium()];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && candidate !== '' && existsSync(candidate))
      return candidate;
  }
  return null;
}

export interface SimulatedHud {
  server: HudServer;
  port: number;
  /** `http://127.0.0.1:<port>` */
  base: string;
  /**
   * `https://127.0.0.1:<TLS port>`: the same pages and API over TLS with the HUD's self-signed
   * certificate, as the companion app's settings page loads them.
   */
  httpsBase: string;
  /** SHA-256 of the HUD's certificate (what the companion app pins). */
  fingerprint: string;
  dataDir: string;
  /** POST /api/sim. */
  sim(control: SimControl): Promise<SimStatus>;
  /** PATCH /api/config; throws when the HUD rejects a field. */
  patchConfig(patch: DeepPartial<HudConfig>): Promise<HudConfig>;
  /** Stop the server (idempotent) and delete the data directory. */
  close(): Promise<void>;
}

export interface StartOptions {
  /** Built renderer to serve; default: the global setup's build, else the package's `dist`. */
  rendererDir?: string;
  /** Merged over the defaults and written to `config.json` before start. */
  config?: DeepPartial<HudConfig>;
  /** Listen on this port (e.g. to restart a server where a page expects it); default: any free port. */
  port?: number;
}

/**
 * Start the real HUD server with the simulator (`--sim`) on 127.0.0.1 and a free port, with
 * mDNS and the backlight off (nothing leaves the test machine).
 */
export async function startSimulatedHud(options: StartOptions = {}): Promise<SimulatedHud> {
  const dataDir = await mkdtemp(join(tmpdir(), 'carheadsup-e2e-'));
  const { config, errors } = mergeConfig(structuredClone(DEFAULT_CONFIG) as HudConfig, {
    ...options.config,
    server: { mdns: false, ...options.config?.server },
  });
  if (errors.length > 0) throw new Error(`Invalid e2e config: ${errors.join('; ')}`);
  await writeFile(join(dataDir, 'config.json'), JSON.stringify(config, null, 2));
  const rendererDir =
    options.rendererDir ??
    process.env[RENDERER_DIR_ENV] ??
    join(REPO_ROOT, 'packages', 'hud-renderer', 'dist');
  const server = createHudServer({
    dataDir,
    rendererDir,
    sim: true,
    port: options.port ?? 0,
    tlsPort: 0,
    host: '127.0.0.1',
    backlight: false,
  });
  let port: number;
  let tlsPort: number | null;
  try {
    ({ port, tlsPort } = await server.start());
  } catch (err) {
    await rm(dataDir, { recursive: true, force: true });
    throw err;
  }
  const fingerprint = server.tls?.fingerprint;
  if (tlsPort === null || fingerprint === undefined) {
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
    throw new Error('The HUD started without its TLS listener');
  }
  const base = `http://127.0.0.1:${port}`;
  const json = async <T>(method: string, path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  let closed: Promise<void> | null = null;
  return {
    server,
    port,
    base,
    httpsBase: `https://127.0.0.1:${tlsPort}`,
    fingerprint,
    dataDir,
    sim: (control) => json<SimStatus>('POST', '/api/sim', control),
    patchConfig: async (patch) => {
      const result = await json<{ config: HudConfig; errors: string[] }>(
        'PATCH',
        '/api/config',
        patch,
      );
      if (result.errors.length > 0) throw new Error(result.errors.join('; '));
      return result.config;
    },
    close: () => {
      closed ??= (async () => {
        await server.stop();
        await rm(dataDir, { recursive: true, force: true });
      })();
      return closed;
    },
  };
}
