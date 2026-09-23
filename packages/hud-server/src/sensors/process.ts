/**
 * Child-process seam for the helper tools the HUD drives (libgpiod's `gpiomon`/`gpiodetect`,
 * `avahi-publish-service`): an injectable spawn function, a one-shot command runner and a
 * supervisor that keeps a long-running tool alive with exponential backoff.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { Readable } from 'node:stream';
import type { Clock, Logger, Timers } from '@carheadsup/obd';
import { Backoff, errorCode, errorMessage } from './util.ts';

/** The part of `ChildProcess` the HUD uses; tests substitute an EventEmitter-based fake. */
export interface ChildProcessLike {
  /** Undefined when the process could not be started. */
  readonly pid?: number | undefined;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

/** Start `command` with `args`, stdin ignored and stdout/stderr piped. Must not throw for ENOENT. */
export type SpawnFn = (command: string, args: readonly string[]) => ChildProcessLike;

export const defaultSpawn: SpawnFn = (command, args) =>
  nodeSpawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });

/** Longest line kept from a child's output; longer garbage is discarded. */
const MAX_LINE_CHARS = 16 * 1024;

/** Call `onLine` for every complete line of `stream` (CR/LF stripped). */
export function forEachLine(stream: Readable | null, onLine: (line: string) => void): void {
  if (stream === null) return;
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string | Buffer) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      onLine(line);
      newline = buffer.indexOf('\n');
    }
    if (buffer.length > MAX_LINE_CHARS) buffer = '';
  });
  // A read error on a pipe must not become an uncaught 'error' event.
  stream.on('error', () => {});
}

/**
 * Locate an executable on `PATH` (synchronously, a few stat calls). Returns its path, or null
 * when it is not installed.
 */
export function findExecutable(name: string, pathEnv = process.env['PATH'] ?? ''): string | null {
  const dirs = pathEnv.split(delimiter).filter((d) => d.length > 0);
  for (const dir of dirs) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Thrown by {@link runCommand} when the executable does not exist. */
export class CommandNotFoundError extends Error {
  readonly command: string;

  constructor(command: string) {
    super(`${command}: command not found`);
    this.name = 'CommandNotFoundError';
    this.command = command;
  }
}

/**
 * Run a short-lived command and collect its output. Rejects with {@link CommandNotFoundError}
 * when the tool is not installed and with a timeout error (after killing it) when it hangs.
 * A non-zero exit status resolves normally; callers inspect `code`.
 */
export function runCommand(
  spawn: SpawnFn,
  timers: Timers,
  command: string,
  args: readonly string[],
  timeoutMs = 5000,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessLike;
    try {
      child = spawn(command, args);
    } catch (err) {
      reject(errorCode(err) === 'ENOENT' ? new CommandNotFoundError(command) : err);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: CommandResult | Error): void => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const timer = timers.setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`${command} did not finish within ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < 256 * 1024) stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });
    child.stdout?.on('error', () => {});
    child.stderr?.on('error', () => {});
    child.on('error', (err) => {
      finish(errorCode(err) === 'ENOENT' ? new CommandNotFoundError(command) : err);
    });
    child.on('exit', (code) => {
      // Let the pipes drain: 'exit' can precede the last 'data' events.
      setImmediate(() => finish({ code, stdout, stderr }));
    });
  });
}

export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** How long the process ran. */
  ranMs: number;
  /** Last lines the process wrote to stderr (at most 20). */
  stderr: readonly string[];
}

/** What to do after the supervised process exits on its own. */
export type ExitDecision = 'restart' | 'stop';

export interface SupervisorOptions {
  /** Name used in log lines, e.g. "gpiomon". */
  label: string;
  command: string;
  /** Arguments, re-evaluated before every (re)start. */
  args: () => readonly string[];
  spawn: SpawnFn;
  timers: Timers;
  now: Clock;
  logger: Logger;
  onStdoutLine?: (line: string) => void;
  /** The executable is not installed (ENOENT). The supervisor stops; no restart is attempted. */
  onMissing?: () => void;
  /** Decide what happens after an unexpected exit; defaults to 'restart'. */
  onExit?: (info: ExitInfo) => ExitDecision;
  /** First restart delay (default 1 s), doubling up to `maxBackoffMs` (default 60 s). */
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** A run at least this long resets the backoff (default 30 s). */
  stableAfterMs?: number;
  /** Grace period between SIGTERM and SIGKILL on stop (default 2 s). */
  killTimeoutMs?: number;
}

const STDERR_TAIL_LINES = 20;

/**
 * Keeps one long-running child process alive: restarts it with exponential backoff when it
 * exits unexpectedly, reports a missing executable once, and terminates it (SIGTERM, then
 * SIGKILL) on {@link stop}. Never throws into the caller.
 */
export class ProcessSupervisor {
  private readonly options: SupervisorOptions;
  private readonly backoff: Backoff;
  private child: ChildProcessLike | null = null;
  private childExited: Promise<void> | null = null;
  private restartTimer: unknown = null;
  private startedAt = 0;
  private stopped = true;
  private failures = 0;

  constructor(options: SupervisorOptions) {
    this.options = options;
    this.backoff = new Backoff(options.initialBackoffMs ?? 1000, options.maxBackoffMs ?? 60_000);
  }

  /** True while a child process is running. */
  get running(): boolean {
    return this.child !== null;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.launch();
  }

  /** Stop supervising and terminate the child; resolves once it has exited. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer !== null) this.options.timers.clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    const exited = this.childExited;
    if (child === null || exited === null) return;
    const { timers } = this.options;
    const killTimeoutMs = this.options.killTimeoutMs ?? 2000;
    child.kill('SIGTERM');
    let killTimer: unknown = null;
    let giveUpTimer: unknown = null;
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        killTimer = timers.setTimeout(() => {
          child.kill('SIGKILL');
          // A process stuck in the kernel may not even die from SIGKILL; do not hang shutdown.
          giveUpTimer = timers.setTimeout(resolve, 1000);
        }, killTimeoutMs);
      }),
    ]);
    if (killTimer !== null) timers.clearTimeout(killTimer);
    if (giveUpTimer !== null) timers.clearTimeout(giveUpTimer);
  }

  private launch(): void {
    if (this.stopped) return;
    const { label, command, logger } = this.options;
    let child: ChildProcessLike;
    try {
      child = this.options.spawn(command, this.options.args());
    } catch (err) {
      this.handleSpawnError(err);
      return;
    }
    this.child = child;
    this.startedAt = this.options.now();
    const stderrTail: string[] = [];
    let resolveExited: () => void = () => {};
    this.childExited = new Promise((resolve) => {
      resolveExited = resolve;
    });
    let done = false;
    const onGone = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (done) return;
      done = true;
      if (this.child === child) {
        this.child = null;
        this.childExited = null;
      }
      resolveExited();
      this.handleExit({
        code,
        signal,
        ranMs: this.options.now() - this.startedAt,
        stderr: stderrTail,
      });
    };
    forEachLine(child.stdout, (line) => {
      try {
        this.options.onStdoutLine?.(line);
      } catch (err) {
        logger.error(`${label}: output handler failed: ${errorMessage(err)}`);
      }
    });
    forEachLine(child.stderr, (line) => {
      if (line.trim().length === 0) return;
      stderrTail.push(line);
      if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
    });
    child.on('error', (err) => {
      if (done) return;
      if (errorCode(err) === 'ENOENT') {
        done = true;
        if (this.child === child) {
          this.child = null;
          this.childExited = null;
        }
        resolveExited();
        this.handleSpawnError(err);
        return;
      }
      if (child.pid === undefined) {
        // Other spawn failures (EACCES …) never produce 'exit': treat them as a failed run.
        stderrTail.push(errorMessage(err));
        onGone(null, null);
        return;
      }
      // A running child reports e.g. a failed kill(); it is still alive, so keep waiting for 'exit'.
      logger.warn(`${label}: ${errorMessage(err)}`);
    });
    child.on('exit', onGone);
  }

  private handleSpawnError(err: unknown): void {
    const { label, logger } = this.options;
    if (errorCode(err) === 'ENOENT') {
      this.stopped = true;
      if (this.options.onMissing) this.options.onMissing();
      else logger.warn(`${label}: ${this.options.command} is not installed`);
      return;
    }
    logger.warn(`${label}: could not start ${this.options.command}: ${errorMessage(err)}`);
    this.scheduleRestart();
  }

  private handleExit(info: ExitInfo): void {
    if (this.stopped) return;
    const { label, logger } = this.options;
    const stableAfterMs = this.options.stableAfterMs ?? 30_000;
    if (info.ranMs >= stableAfterMs) {
      this.backoff.reset();
      this.failures = 0;
    }
    const decision = this.options.onExit?.(info) ?? 'restart';
    if (decision === 'stop') {
      this.stopped = true;
      return;
    }
    this.failures += 1;
    const detail = info.stderr.length > 0 ? `: ${info.stderr[info.stderr.length - 1]}` : '';
    const how = info.signal !== null ? `signal ${info.signal}` : `code ${String(info.code)}`;
    const message = `${label}: ${this.options.command} exited (${how})${detail}`;
    // The first failure of a streak is worth a warning; repeats of a persistent problem are not.
    if (this.failures === 1) logger.warn(`${message}; restarting`);
    else logger.debug(`${message}; restarting (attempt ${this.failures})`);
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.stopped) return;
    const delay = this.backoff.next();
    this.restartTimer = this.options.timers.setTimeout(() => {
      this.restartTimer = null;
      this.launch();
    }, delay);
  }
}
