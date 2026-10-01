/**
 * Shared helpers for the browser end-to-end suite (`npm run test:e2e`) and the live screenshot
 * capture: find a Chromium to drive, and start the real HUD server in simulator mode on a free
 * port with a throw-away data directory.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
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
  /** `http://127.0.0.1:<port>` (the bind address instead of 127.0.0.1 for a single address) */
  base: string;
  /**
   * `https://127.0.0.1:<TLS port>` (or the bind address): the same pages and API over TLS with
   * the HUD's self-signed certificate, as the companion app's settings page loads them.
   */
  httpsBase: string;
  /** The TLS listener's port. */
  tlsPort: number;
  /** SHA-256 of the HUD's certificate (what the companion app pins). */
  fingerprint: string;
  dataDir: string;
  /** The server's warnings and errors so far, one log line each. */
  warnings: string[];
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
  /**
   * The addresses the pairing QR code names. Default: none — the server listens on 127.0.0.1,
   * which no phone can reach, so the pairing page has no code to show.
   */
  pairingHosts?: string[];
  /**
   * Bind address; default 127.0.0.1 (which {@link relayAsOtherDevice} needs). `lanAddress()`
   * makes a HUD that listens on one network address, as on a hotspot.
   */
  host?: string;
}

/**
 * A non-loopback IPv4 address of this machine, if any. A browser that opens the HUD at it
 * connects from it too: the HUD itself, as far as the HUD can tell — like the kiosk of a HUD
 * that listens on that one address. To play another device, see {@link relayAsOtherDevice}.
 */
export function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return null;
}

/**
 * Another device on the car's Wi-Fi, played from this machine for a browser, which cannot choose
 * the address it connects from: a TCP relay on this machine's LAN address `lan`, at the HUD's
 * two ports, that forwards every connection to the HUD on 127.0.0.1 — from `lan`. A browser that
 * opens `http://<lan>:<hud.port>/settings` reaches the HUD as a client at `lan` that came to
 * 127.0.0.1, so neither loopback nor at the address it reached the HUD at: another device. The
 * HUD's redirect to `https://<lan>:<hud.tlsPort>` leads through the relay again. The HUD must
 * listen on 127.0.0.1 only (the default), so that the relay can take its ports at `lan`.
 */
export async function relayAsOtherDevice(
  lan: string,
  hud: SimulatedHud,
): Promise<{ close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const track = (socket: Socket): void => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  const relay = (port: number): Promise<Server> =>
    new Promise((resolve, reject) => {
      const server = createServer((client) => {
        const upstream = connect({ host: '127.0.0.1', port, localAddress: lan });
        track(client);
        track(upstream);
        const cut = (): void => {
          client.destroy();
          upstream.destroy();
        };
        for (const socket of [client, upstream]) {
          socket.on('error', cut);
          socket.on('close', cut);
        }
        client.pipe(upstream).pipe(client);
      });
      server.once('error', reject);
      server.listen(port, lan, () => resolve(server));
    });
  const servers = await Promise.all([relay(hud.port), relay(hud.tlsPort)]);
  return {
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
      );
    },
  };
}

/**
 * Start the real HUD server with the simulator (`--sim`) on 127.0.0.1 (or `options.host`) and a
 * free port, with mDNS and the backlight off (nothing is advertised).
 */
export async function startSimulatedHud(options: StartOptions = {}): Promise<SimulatedHud> {
  const host = options.host ?? '127.0.0.1';
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
  const warnings: string[] = [];
  const record = (...args: unknown[]): void => void warnings.push(args.map(String).join(' '));
  const quiet = (): void => undefined;
  const server = createHudServer({
    dataDir,
    rendererDir,
    sim: true,
    logger: { debug: quiet, info: quiet, warn: record, error: record },
    port: options.port ?? 0,
    tlsPort: 0,
    host,
    backlight: false,
    ...(options.pairingHosts !== undefined
      ? { pairingHosts: () => [...(options.pairingHosts ?? [])] }
      : {}),
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
  // Reached at the bind address, or over loopback for a wildcard bind.
  const at = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const origin = (scheme: string, listenerPort: number): string =>
    `${scheme}://${at.includes(':') ? `[${at}]` : at}:${listenerPort}`;
  const base = origin('http', port);
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
    httpsBase: origin('https', tlsPort),
    tlsPort,
    fingerprint,
    dataDir,
    warnings,
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
