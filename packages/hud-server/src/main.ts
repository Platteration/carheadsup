#!/usr/bin/env node
/**
 * carheadsup — the HUD server's command-line entry point (`npm start`, `npm run sim`, systemd).
 * See `--help`. Exit codes: 0 after a clean shutdown (SIGINT/SIGTERM), 1 on a fatal error,
 * 2 on invalid arguments.
 */
import { homedir, networkInterfaces } from 'node:os';
import { createHudServer } from './app.ts';
import type { HudServer } from './app.ts';
import { USAGE, parseCli, serverUrls } from './cli.ts';
import { createLogger } from './logger.ts';
import { HUD_VERSION } from './meta.ts';

/** Non-internal IPv4 addresses of this machine (where the phone can reach the HUD). */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address);
    }
  }
  return out;
}

function describe(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}

async function main(): Promise<void> {
  const parsed = parseCli(process.argv.slice(2), process.env, homedir());
  if (parsed.kind === 'help') {
    process.stdout.write(USAGE);
    return;
  }
  if (parsed.kind === 'version') {
    process.stdout.write(`carheadsup ${HUD_VERSION}\n`);
    return;
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`carheadsup: ${parsed.message}\nTry "carheadsup --help".\n`);
    process.exit(2);
  }

  const options = parsed.options;
  const logger = createLogger({ level: options.logLevel });
  process.title = 'carheadsup';

  let server: HudServer | null = null;
  let exiting = false;
  const exit = (code: number, reason: string): void => {
    if (exiting) {
      logger.warn(`${reason} while shutting down; exiting immediately`);
      process.exit(1);
    }
    exiting = true;
    const stopped = server?.stop() ?? Promise.resolve();
    stopped.then(
      () => process.exit(code),
      (err: unknown) => {
        logger.error(`Shutdown failed: ${describe(err)}`);
        process.exit(1);
      },
    );
  };

  process.on('SIGINT', () => {
    logger.info('Received SIGINT; shutting down');
    exit(0, 'SIGINT');
  });
  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM; shutting down');
    exit(0, 'SIGTERM');
  });
  process.on('uncaughtException', (err) => {
    logger.error(`Fatal: uncaught exception: ${describe(err)}`);
    exit(1, 'Uncaught exception');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`Fatal: unhandled promise rejection: ${describe(reason)}`);
    exit(1, 'Unhandled rejection');
  });

  logger.info(
    `carheadsup ${HUD_VERSION} starting${options.sim ? ' with the simulator' : ''}; data in ${options.dataDir}`,
  );
  server = createHudServer({
    dataDir: options.dataDir,
    sim: options.sim,
    backlight: options.backlight,
    logger,
    ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.host !== undefined ? { host: options.host } : {}),
    ...(options.rendererDir !== undefined ? { rendererDir: options.rendererDir } : {}),
  });
  try {
    const { port } = await server.start();
    const host = options.host ?? server.engine.config.server.host;
    for (const url of serverUrls(host, port, lanAddresses())) {
      logger.info(`HUD: ${url}/   settings: ${url}/settings   dev console: ${url}/dev`);
    }
  } catch (err) {
    logger.error(`Fatal: ${describe(err)}`);
    exiting = true;
    process.exit(1);
  }
}

void main();
