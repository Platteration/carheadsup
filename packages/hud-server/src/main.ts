#!/usr/bin/env node
/**
 * carheadsup — the HUD server's command-line entry point (`npm start`, `npm run sim`, systemd).
 * See `--help`. Exit codes: 0 after a clean shutdown (SIGINT/SIGTERM), 1 on a fatal error,
 * 2 on invalid arguments.
 */
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { SYSTEM_CLOCK, SYSTEM_TIMERS } from '@carheadsup/obd';
import { createHudServer } from './app.ts';
import type { HudServer } from './app.ts';
import { USAGE, pageUrls, parseCli, serverUrls } from './cli.ts';
import { SYSTEM_MONOTONIC, WallClock } from './clock.ts';
import { LOG_DIR, LogFiles } from './log-files.ts';
import { LOG_LEVEL_RANK, createLogger } from './logger.ts';
import type { LogLevel } from './logger.ts';
import { HUD_VERSION } from './meta.ts';

/** Longest wait for the log file to be flushed before the process exits anyway. */
const LOG_CLOSE_TIMEOUT_MS = 3000;

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

/** What the times in a debug dump are worth, by where the HUD's wall clock takes them from. */
function clockNote(clock: WallClock): string {
  switch (clock.source) {
    case 'network':
      return 'the system clock, synchronised to network time';
    case 'phone':
      return "the phone's clock";
    case 'saved':
      return 'counted on from the time the HUD last saved (only a lower bound)';
    case 'system':
      return 'the system clock (not known to be synchronised)';
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  // The HUD's wall clock, shared with the server: on a Pi without a real-time clock the system
  // clock restores the same time at every boot, but this one never reads earlier than the time
  // the HUD last saved (once the server has read it, at start). Log lines, debug dump names and
  // OBD transcript names then sort by age and agree with trip and service times.
  const wallClock = new WallClock(SYSTEM_CLOCK, SYSTEM_MONOTONIC);
  const wallNow = (): number => wallClock.now();
  // Problems with the log files themselves go to the journal only.
  const terminal = createLogger({ level: options.logLevel, now: wallNow });
  // The file gets info and above — and debug too while the log level is debug.
  const fileLevel: LogLevel =
    LOG_LEVEL_RANK[options.logLevel] < LOG_LEVEL_RANK.info ? options.logLevel : 'info';
  const logFiles = new LogFiles({
    dir: join(options.dataDir, LOG_DIR),
    level: fileLevel,
    timers: SYSTEM_TIMERS,
    now: wallNow,
    clockNote: () => clockNote(wallClock),
    onProblem: (message) => terminal.warn(message),
  });
  const logger = createLogger({ level: options.logLevel, sinks: logFiles.sinks, now: wallNow });
  process.title = 'carheadsup';

  /** Write the recent debug log to a file (rate-limited), and say where. */
  const dumpDebugLog = async (reason: string): Promise<void> => {
    const path = await logFiles.dumpDebug(reason);
    if (path !== null) logger.info(`Log: wrote the recent debug log to ${path} (${reason})`);
  };
  /** Flush the log file, but never wait long for a card that hangs. */
  const closeLogs = (): Promise<void> =>
    Promise.race([
      logFiles.close(),
      new Promise<void>((resolve) => setTimeout(resolve, LOG_CLOSE_TIMEOUT_MS).unref()),
    ]);

  let server: HudServer | null = null;
  let exiting = false;
  /** Shut down and exit; `dumpReason` also writes the recent debug log first. */
  const exit = (code: number, reason: string, dumpReason?: string): void => {
    if (exiting) {
      logger.warn(`${reason} while shutting down; exiting immediately`);
      process.exit(1);
    }
    exiting = true;
    const dumped = dumpReason === undefined ? Promise.resolve() : dumpDebugLog(dumpReason);
    const stopped = server?.stop() ?? Promise.resolve();
    Promise.all([dumped, stopped])
      .then(
        () => code,
        (err: unknown) => {
          logger.error(`Shutdown failed: ${describe(err)}`);
          return 1;
        },
      )
      .then(async (status) => {
        await closeLogs();
        process.exit(status);
      });
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
    exit(1, 'Uncaught exception', `uncaught exception: ${errorMessage(err)}`);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`Fatal: unhandled promise rejection: ${describe(reason)}`);
    exit(1, 'Unhandled rejection', `unhandled promise rejection: ${errorMessage(reason)}`);
  });

  logger.info(
    `carheadsup ${HUD_VERSION} starting${options.sim ? ' with the simulator' : ''}; data in ${options.dataDir}`,
  );
  server = createHudServer({
    dataDir: options.dataDir,
    sim: options.sim,
    backlight: options.backlight,
    allowedHosts: options.allowedHosts,
    record: options.record,
    wallClock,
    logger,
    dumpDebugLog: (reason) => void dumpDebugLog(reason),
    ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.tlsPort !== undefined ? { tlsPort: options.tlsPort } : {}),
    ...(options.host !== undefined ? { host: options.host } : {}),
    ...(options.rendererDir !== undefined ? { rendererDir: options.rendererDir } : {}),
  });
  try {
    const { port, tlsPort } = await server.start();
    const config = server.engine.config.server;
    const host = options.host ?? config.host;
    const urls = pageUrls({
      host,
      port,
      tlsEnabled: config.tlsPort !== null,
      tlsPort,
      allowPlainRemote: config.allowPlainRemote,
      lanAddresses: lanAddresses(),
    });
    for (const url of urls) {
      logger.info(`HUD: ${url}/   settings: ${url}/settings   dev console: ${url}/dev`);
    }
    if (tlsPort !== null) {
      const phoneUrls = serverUrls(host, tlsPort, lanAddresses(), 'wss');
      logger.info(`Phone link: ${phoneUrls.map((url) => `${url}/ws/phone`).join('   ')}`);
    }
  } catch (err) {
    const failure = describeStartupFailure(err);
    logger.error(`Fatal: ${failure.message}`);
    if (failure.stack !== null) logger.debug(`Start-up failure: ${failure.stack}`);
    exiting = true;
    await closeLogs();
    process.exit(1);
  }
}

void main();
