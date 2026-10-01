/**
 * Logs that survive the ignition. The journal of both recommended Pi set-ups lives in RAM (the
 * read-only root's overlay, or `Storage=volatile`), and the Pi loses power seconds after the
 * ignition: the log of the drive that went wrong is gone before anyone reaches a laptop. So the
 * server also writes its log to `<data dir>/logs/hud.log` (rotated, written to the card every
 * 5 s and at once for warnings and errors), and keeps the last few thousand lines at every
 * level — debug included — in memory, to write them to `logs/debug-<time>.log` when something
 * goes wrong (the OBD link lost, a page error on the HUD's display, an uncaught exception).
 */
import * as fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import type { Clock, Timers } from '@carheadsup/obd';
import { LOG_LEVEL_RANK } from './logger.ts';
import type { LogLevel, LogSink } from './logger.ts';

/** Directory of the log files, inside the data directory. */
export const LOG_DIR = 'logs';
export const LOG_FILE = 'hud.log';
/** `hud.log` is rotated at this size … */
export const MAX_LOG_FILE_BYTES = 2 * 1024 * 1024;
/** … into `hud.log.1` … `hud.log.4`: five files in all. */
export const LOG_FILES_KEPT = 5;
/** Buffered lines are written and flushed to the card this often (warn and error at once). */
export const LOG_SYNC_INTERVAL_MS = 5000;
/** Lines kept in memory for a debug dump, at every level. */
export const DEBUG_RING_LINES = 5000;
/** Debug dumps kept (the oldest are deleted). */
export const DEBUG_DUMPS_KEPT = 5;
/** At most one debug dump per this interval (a flapping link must not wear the card out). */
export const DEBUG_DUMP_INTERVAL_MS = 60_000;
/** Unwritten text kept while the file cannot be written; older lines are dropped beyond. */
const MAX_PENDING_CHARS = 1024 * 1024;

/** The open file the log appends to (a subset of `fs.promises.FileHandle`). */
export interface LogFileHandle {
  write(data: string): Promise<unknown>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** The file system calls the log files make (`node:fs/promises` by default; tests pass a fake). */
export interface LogFs {
  mkdir(path: string, options: { recursive: true; mode?: number }): Promise<unknown>;
  open(path: string, flags: 'a' | 'w'): Promise<LogFileHandle>;
  stat(path: string): Promise<{ size: number }>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
  readdir(path: string): Promise<string[]>;
}

/** `LogFs` on the real file system (files made private: mode 0600). */
export const NODE_LOG_FS: LogFs = {
  mkdir: (path, options) => fsPromises.mkdir(path, options),
  open: (path, flags) => fsPromises.open(path, flags, 0o600),
  stat: (path) => fsPromises.stat(path),
  rename: (from, to) => fsPromises.rename(from, to),
  rm: (path, options) => fsPromises.rm(path, options),
  readdir: (path) => fsPromises.readdir(path),
};

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface RotatingLogFileOptions {
  dir: string;
  /** Default {@link LOG_FILE}. */
  name?: string;
  /** Lines below this level are not written. Default 'info'. */
  level?: LogLevel;
  fs?: LogFs;
  timers: Timers;
  maxBytes?: number;
  /** Files in all, the current one included. */
  keep?: number;
  syncIntervalMs?: number;
  /**
   * Told when writing fails (once, until a write succeeds again), and when it works again. Must
   * not log through the file itself.
   */
  onProblem?: (message: string) => void;
}

/**
 * A log file that rotates by size: lines are buffered and appended — and flushed to the card
 * (fsync) — every `syncIntervalMs`, and at once after a warning or error, so that a power cut
 * loses at most a few seconds of the quiet lines and none of the bad news. Failures (a full or
 * read-only card) are reported once and never thrown; the lines wait, up to 1 MiB, for the next
 * try.
 */
export class RotatingLogFile implements LogSink {
  readonly level: LogLevel;
  readonly path: string;
  private readonly options: RotatingLogFileOptions;
  private readonly fs: LogFs;
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly syncIntervalMs: number;
  private pending: string[] = [];
  private pendingChars = 0;
  private handle: LogFileHandle | null = null;
  private size = 0;
  private timer: unknown = null;
  private chain: Promise<void> = Promise.resolve();
  private failing = false;
  private closed = false;

  constructor(options: RotatingLogFileOptions) {
    this.options = options;
    this.level = options.level ?? 'info';
    this.path = join(options.dir, options.name ?? LOG_FILE);
    this.fs = options.fs ?? NODE_LOG_FS;
    this.maxBytes = Math.max(1024, options.maxBytes ?? MAX_LOG_FILE_BYTES);
    this.keep = Math.max(1, options.keep ?? LOG_FILES_KEPT);
    this.syncIntervalMs = Math.max(1, options.syncIntervalMs ?? LOG_SYNC_INTERVAL_MS);
  }

  write(line: string, level: LogLevel): void {
    if (this.closed) return;
    const text = `${line}\n`;
    this.pending.push(text);
    this.pendingChars += text.length;
    while (this.pendingChars > MAX_PENDING_CHARS && this.pending.length > 1) {
      this.pendingChars -= this.pending.shift()?.length ?? 0;
    }
    if (LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK.warn) {
      void this.flush();
    } else if (this.timer === null) {
      this.timer = this.options.timers.setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.syncIntervalMs);
    }
  }

  /** Write and fsync what is buffered. Never rejects. */
  flush(): Promise<void> {
    this.chain = this.chain.then(() => this.writePending());
    return this.chain;
  }

  /** Flush, close the file and stop taking lines. */
  async close(): Promise<void> {
    // Closed first: lines logged from now on are dropped, and a failing last write is not retried.
    this.closed = true;
    if (this.timer !== null) this.options.timers.clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
    this.chain = this.chain.then(async () => {
      const handle = this.handle;
      this.handle = null;
      await handle?.close().catch(() => undefined);
    });
    await this.chain;
  }

  private async writePending(): Promise<void> {
    if (this.pending.length === 0) return;
    const lines = this.pending;
    const chars = this.pendingChars;
    this.pending = [];
    this.pendingChars = 0;
    try {
      const text = lines.join('');
      const bytes = Buffer.byteLength(text);
      let handle = await this.open();
      if (this.size > 0 && this.size + bytes > this.maxBytes) {
        await this.rotate();
        handle = await this.open();
      }
      await handle.write(text);
      this.size += bytes;
      await handle.sync();
      if (this.failing) this.options.onProblem?.(`Log: writing ${this.path} works again`);
      this.failing = false;
    } catch (err) {
      // Keep the lines (ahead of newer ones) for the next try, and the file closed so that the
      // next try opens it afresh.
      this.pending = [...lines, ...this.pending];
      this.pendingChars += chars;
      const handle = this.handle;
      this.handle = null;
      await handle?.close().catch(() => undefined);
      if (!this.failing) {
        this.options.onProblem?.(
          `Log: cannot write ${this.path} (${describe(err)}); the log is kept in memory meanwhile`,
        );
      }
      this.failing = true;
      if (this.timer === null && !this.closed) {
        this.timer = this.options.timers.setTimeout(() => {
          this.timer = null;
          void this.flush();
        }, this.syncIntervalMs);
      }
    }
  }

  private async open(): Promise<LogFileHandle> {
    if (this.handle !== null) return this.handle;
    await this.fs.mkdir(this.options.dir, { recursive: true, mode: 0o700 });
    const handle = await this.fs.open(this.path, 'a');
    try {
      this.size = (await this.fs.stat(this.path)).size;
    } catch {
      this.size = 0;
    }
    this.handle = handle;
    return handle;
  }

  /** hud.log → hud.log.1 → … → hud.log.<keep − 1>; the oldest is dropped. */
  private async rotate(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    await handle?.close();
    const numbered = (n: number): string => (n === 0 ? this.path : `${this.path}.${n}`);
    await this.fs.rm(numbered(this.keep - 1), { force: true });
    for (let n = this.keep - 2; n >= 0; n -= 1) {
      try {
        await this.fs.rename(numbered(n), numbered(n + 1));
      } catch {
        // That one does not exist (yet).
      }
    }
    this.size = 0;
  }
}

/** The last `capacity` lines at every level, for a debug dump. */
export class DebugRing implements LogSink {
  readonly level: LogLevel = 'debug';
  private readonly capacity: number;
  private readonly lines: string[] = [];
  private next = 0;

  constructor(capacity = DEBUG_RING_LINES) {
    this.capacity = Math.max(1, capacity);
  }

  write(line: string): void {
    if (this.lines.length < this.capacity) {
      this.lines.push(line);
    } else {
      this.lines[this.next] = line;
      this.next = (this.next + 1) % this.capacity;
    }
  }

  /** The lines kept, oldest first. */
  snapshot(): string[] {
    return [...this.lines.slice(this.next), ...this.lines.slice(0, this.next)];
  }
}

export interface LogFilesOptions {
  /** Where the files go: `<data dir>/logs`. */
  dir: string;
  /** Lowest level written to `hud.log`. Default 'info'. */
  level?: LogLevel;
  fs?: LogFs;
  timers: Timers;
  /** Wall clock, for the dump file names and the dump rate limit. */
  now: Clock;
  onProblem?: (message: string) => void;
  ringLines?: number;
  maxBytes?: number;
  keep?: number;
  syncIntervalMs?: number;
  dumpsKept?: number;
  dumpIntervalMs?: number;
}

/** `debug-2026-10-01T07-30-00.123Z.log`: sorts by time, and no colons for other file systems. */
function dumpName(at: number): string {
  const stamp = Number.isFinite(at) ? new Date(at).toISOString() : 'unknown-time';
  return `debug-${stamp.replace(/:/g, '-')}.log`;
}

/**
 * The server's log files: {@link RotatingLogFile} `hud.log` and the in-memory {@link DebugRing},
 * whose lines {@link dumpDebug} writes to a file of its own when something goes wrong.
 */
export class LogFiles {
  readonly file: RotatingLogFile;
  readonly ring: DebugRing;
  readonly dir: string;
  private readonly options: LogFilesOptions;
  private readonly fs: LogFs;
  private lastDumpAt = Number.NEGATIVE_INFINITY;
  private dumping: Promise<string | null> | null = null;

  constructor(options: LogFilesOptions) {
    this.options = options;
    this.dir = options.dir;
    this.fs = options.fs ?? NODE_LOG_FS;
    this.file = new RotatingLogFile({
      dir: options.dir,
      level: options.level ?? 'info',
      fs: this.fs,
      timers: options.timers,
      ...(options.onProblem !== undefined ? { onProblem: options.onProblem } : {}),
      ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
      ...(options.keep !== undefined ? { keep: options.keep } : {}),
      ...(options.syncIntervalMs !== undefined ? { syncIntervalMs: options.syncIntervalMs } : {}),
    });
    this.ring = new DebugRing(options.ringLines);
  }

  /** The logger sinks: the file and the ring. */
  get sinks(): LogSink[] {
    return [this.file, this.ring];
  }

  /**
   * Write the in-memory log to `debug-<time>.log` (fsync'd), keeping the newest few such files.
   * At most one per {@link DEBUG_DUMP_INTERVAL_MS}. Resolves with the file's path, or null when
   * nothing was written; never rejects.
   */
  dumpDebug(reason: string): Promise<string | null> {
    if (this.dumping !== null) return this.dumping;
    const at = this.options.now();
    const interval = this.options.dumpIntervalMs ?? DEBUG_DUMP_INTERVAL_MS;
    if (Math.abs(at - this.lastDumpAt) < interval) return Promise.resolve(null);
    this.lastDumpAt = at;
    const lines = this.ring.snapshot();
    const run = this.writeDump(at, reason, lines).finally(() => {
      this.dumping = null;
    });
    this.dumping = run;
    return run;
  }

  /** Flush and close the log file. */
  async close(): Promise<void> {
    await this.dumping;
    await this.file.close();
  }

  private async writeDump(at: number, reason: string, lines: string[]): Promise<string | null> {
    const path = join(this.dir, dumpName(at));
    try {
      await this.fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      const handle = await this.fs.open(path, 'w');
      try {
        const header = `# carheadsup debug log: ${reason.replace(/\s*\r?\n\s*/g, ' | ')}\n`;
        await handle.write(`${header}${lines.map((line) => `${line}\n`).join('')}`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.prune();
      return path;
    } catch (err) {
      this.options.onProblem?.(`Log: cannot write the debug log ${path}: ${describe(err)}`);
      return null;
    }
  }

  /** Delete all but the newest debug dumps. */
  private async prune(): Promise<void> {
    const keep = Math.max(1, this.options.dumpsKept ?? DEBUG_DUMPS_KEPT);
    const dumps = (await this.fs.readdir(this.dir))
      .filter((name) => /^debug-.*\.log$/.test(name))
      .sort();
    for (const name of dumps.slice(0, Math.max(0, dumps.length - keep))) {
      await this.fs.rm(join(this.dir, name), { force: true });
    }
  }
}
