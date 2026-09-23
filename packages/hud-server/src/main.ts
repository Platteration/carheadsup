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

interface SystemErrorInfo {
  code: string;
  syscall?: unknown;
  address?: unknown;
  port?: unknown;
}

/** The system error (EADDRINUSE, EACCES, ENOTDIR…) behind `err` or one of its causes, if any. */
function systemError(err: unknown): SystemErrorInfo | null {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    const info = current as Partial<SystemErrorInfo>;
    if (typeof info.code === 'string' && /^E[A-Z0-9]+$/.test(info.code)) {
      return info as SystemErrorInfo;
    }
    current = current.cause;
  }
  return null;
}

/** What to do about a start-up failure with a well-known cause, or null. */
function startupHint(info: SystemErrorInfo): string | null {
  const port = typeof info.port === 'number' ? `port ${info.port}` : 'the port';
  const listening = info.syscall === 'listen' || info.syscall === 'bind';
  switch (info.code) {
    case 'EADDRINUSE':
      return `${port} is already in use (another carheadsup or another service); stop it or choose another port with server.port or --port`;
    case 'EACCES':
      return listening
        ? `${port} needs extra privileges; use a port above 1023 (server.port or --port)`
        : 'the HUD runs as a user that may not access that path; check its owner and permissions';
    case 'EADDRNOTAVAIL':
      return `${typeof info.address === 'string' ? info.address : 'the bind address'} is not an address of this machine; check server.host or --host`;
    default:
      return null;
  }
}

/**
 * The log line for a failed start. Expected, operational failures (a system error such as a busy
 * port or a permission problem) are one concise line with a hint; anything else is unexpected
 * and keeps its stack trace.
 */
function describeStartupFailure(err: unknown): { message: string; stack: string | null } {
  const info = systemError(err);
  if (info === null || !(err instanceof Error)) return { message: describe(err), stack: null };
  const hint = startupHint(info);
  return {
    message: hint === null ? err.message : `${err.message} — ${hint}`,
    stack: describe(err),
  };
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
    allowedHosts: options.allowedHosts,
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
    const failure = describeStartupFailure(err);
    logger.error(`Fatal: ${failure.message}`);
    if (failure.stack !== null) logger.debug(`Start-up failure: ${failure.stack}`);
    exiting = true;
    process.exit(1);
  }
}

void main();
