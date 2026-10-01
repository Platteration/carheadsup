import { formatWithOptions } from 'node:util';
import type { Clock, Logger } from '@carheadsup/obd';

/** Log levels, least to most severe. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
const RANK = LOG_LEVEL_RANK;
const LABEL: Readonly<Record<LogLevel, string>> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

/** Somewhere log lines go besides the console (a log file, the in-memory debug log). */
export interface LogSink {
  /** Lines below this level are not passed on. */
  readonly level: LogLevel;
  /** Receives each finished line (no trailing newline). Must not throw. */
  write(line: string, level: LogLevel): void;
}

export interface LoggerOptions {
  /** Messages below this level do not reach `write`. Default 'info'. */
  level?: LogLevel;
  /** Receives each finished line (no trailing newline). Default: stdout, warn/error to stderr. */
  write?: (line: string, level: LogLevel) => void;
  /** Timestamp source. Default `Date.now`. */
  now?: Clock;
  /** Further destinations, each with a level of its own. */
  sinks?: readonly LogSink[];
}

function defaultWrite(line: string, level: LogLevel): void {
  const stream = RANK[level] >= RANK.warn ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

/**
 * Format log arguments like `console.log` does, but always as a single line: embedded line
 * breaks (multi-line messages, stack traces) are folded into " | " so every journald / syslog
 * record is one entry.
 */
export function formatLogMessage(args: readonly unknown[]): string {
  const text = formatWithOptions({ breakLength: Infinity, colors: false }, ...args);
  return text.replace(/\s*\r?\n\s*/g, ' | ').trimEnd();
}

/**
 * A Logger (the `console` subset used across the packages) that writes one timestamped line
 * per call — `2026-09-23T07:30:00.000Z INFO  message` — and drops messages below `level`; each
 * of `sinks` gets the lines at or above its own level. A message nobody takes is not even
 * formatted.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const terminal: LogSink = {
    level: options.level ?? 'info',
    write: options.write ?? defaultWrite,
  };
  const sinks = [terminal, ...(options.sinks ?? [])];
  const now = options.now ?? Date.now;

  const at = (level: LogLevel) => {
    const targets = sinks.filter((sink) => RANK[level] >= RANK[sink.level]);
    if (targets.length === 0) return (): void => {};
    return (...args: unknown[]): void => {
      const ms = now();
      const stamp = Number.isFinite(ms) ? new Date(ms).toISOString() : String(ms);
      let line: string;
      try {
        line = `${stamp} ${LABEL[level]} ${formatLogMessage(args)}`;
      } catch {
        return;
      }
      for (const target of targets) {
        try {
          target.write(line, level);
        } catch {
          // A failing log sink (closed pipe, full disk) must never take the HUD down.
        }
      }
    };
  };

  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}
