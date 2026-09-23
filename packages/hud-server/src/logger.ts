import { formatWithOptions } from 'node:util';
import type { Clock, Logger } from '@carheadsup/obd';

/** Log levels, least to most severe. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };
const LABEL: Readonly<Record<LogLevel, string>> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

export interface LoggerOptions {
  /** Messages below this level are dropped. Default 'info'. */
  level?: LogLevel;
  /** Receives each finished line (no trailing newline). Default: stdout, warn/error to stderr. */
  write?: (line: string, level: LogLevel) => void;
  /** Timestamp source. Default `Date.now`. */
  now?: Clock;
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
 * per call — `2026-09-23T07:30:00.000Z INFO  message` — and drops messages below `level`.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = RANK[options.level ?? 'info'];
  const write = options.write ?? defaultWrite;
  const now = options.now ?? Date.now;

  const at = (level: LogLevel) => {
    if (RANK[level] < threshold) return (): void => {};
    return (...args: unknown[]): void => {
      const ms = now();
      const stamp = Number.isFinite(ms) ? new Date(ms).toISOString() : String(ms);
      try {
        write(`${stamp} ${LABEL[level]} ${formatLogMessage(args)}`, level);
      } catch {
        // A failing log sink (closed pipe) must never take the HUD down.
      }
    };
  };

  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}
