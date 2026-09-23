/**
 * Small helpers shared by the hardware sources, the simulator and the side services: log-once
 * bookkeeping, exponential backoff, named timers on an injected {@link Timers}, a token-bucket
 * rate limiter and error inspection.
 */
import type { Clock, Logger, Timers } from '@carheadsup/obd';

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : String(err);
}

/** The Node.js error code (`'ENOENT'`, `'EACCES'` …) of a thrown value, if any. */
export function errorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Logs each distinct key once until it is reset, so a peripheral that keeps failing the same
 * way (unplugged sensor, missing tool) produces one line instead of one per retry.
 */
export class OnceLogger {
  private readonly logger: Logger;
  private readonly seen = new Set<string>();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** True when `key` has been logged since the last reset. */
  has(key: string): boolean {
    return this.seen.has(key);
  }

  info(key: string, message: string): void {
    if (this.mark(key)) this.logger.info(message);
  }

  warn(key: string, message: string): void {
    if (this.mark(key)) this.logger.warn(message);
  }

  error(key: string, message: string): void {
    if (this.mark(key)) this.logger.error(message);
  }

  /** Forget `key` (or everything), so the next occurrence is logged again. */
  reset(key?: string): void {
    if (key === undefined) this.seen.clear();
    else this.seen.delete(key);
  }

  private mark(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

/** Exponential backoff: `initialMs`, 2×, 4× … capped at `maxMs`. */
export class Backoff {
  private readonly initialMs: number;
  private readonly maxMs: number;
  private attempt = 0;

  constructor(initialMs: number, maxMs: number) {
    this.initialMs = Math.max(1, initialMs);
    this.maxMs = Math.max(this.initialMs, maxMs);
  }

  /** Delay before the next attempt; each call doubles the following one. */
  next(): number {
    const delay = Math.min(this.maxMs, this.initialMs * 2 ** Math.min(this.attempt, 30));
    this.attempt += 1;
    return delay;
  }

  /** Number of delays handed out since the last reset. */
  get attempts(): number {
    return this.attempt;
  }

  reset(): void {
    this.attempt = 0;
  }
}

/** Named one-shot timers on an injected {@link Timers}; setting a key replaces its timer. */
export class TimerSlots {
  private readonly timers: Timers;
  private readonly handles = new Map<string, unknown>();

  constructor(timers: Timers) {
    this.timers = timers;
  }

  set(key: string, ms: number, callback: () => void): void {
    this.clear(key);
    const handle = this.timers.setTimeout(
      () => {
        if (this.handles.get(key) !== handle) return;
        this.handles.delete(key);
        callback();
      },
      Math.max(0, ms),
    );
    this.handles.set(key, handle);
  }

  has(key: string): boolean {
    return this.handles.has(key);
  }

  clear(key: string): void {
    const handle = this.handles.get(key);
    if (handle === undefined) return;
    this.handles.delete(key);
    this.timers.clearTimeout(handle);
  }

  clearAll(): void {
    for (const handle of this.handles.values()) this.timers.clearTimeout(handle);
    this.handles.clear();
  }
}

/**
 * Token bucket: up to `capacity` operations in a burst, refilled at `perSecond`. Used to cap
 * how much work untrusted network input can cause.
 */
export class TokenBucket {
  private readonly capacity: number;
  private readonly perMs: number;
  private readonly now: Clock;
  private tokens: number;
  private last: number;

  constructor(capacity: number, perSecond: number, now: Clock) {
    this.capacity = Math.max(1, capacity);
    this.perMs = Math.max(0, perSecond) / 1000;
    this.now = now;
    this.tokens = this.capacity;
    this.last = now();
  }

  /** Take one token; false when the bucket is empty (the operation should be dropped). */
  take(): boolean {
    const now = this.now();
    const elapsed = now - this.last;
    this.last = now;
    // A clock that jumps backwards neither refills nor drains the bucket.
    if (elapsed > 0) this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.perMs);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** C0 control characters and DEL. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * A display label from untrusted text: control characters removed, whitespace collapsed,
 * trimmed and capped at `max` characters; `fallback` when nothing is left.
 */
export function cleanLabel(text: unknown, max: number, fallback: string): string {
  if (typeof text !== 'string') return fallback;
  const cleaned = text.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return fallback;
  return Array.from(cleaned).slice(0, max).join('').trim();
}
