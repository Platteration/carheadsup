/**
 * Small runtime seams (timers, clock, logging) injected throughout the package so that the
 * driver, poller, service and simulator can be driven by fake clocks in tests.
 */

/** Minimal timer API. The defaults resolve the global timers at call time, so fake timers work. */
export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

type GlobalTimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

export const SYSTEM_TIMERS: Timers = Object.freeze({
  setTimeout: (callback: () => void, ms: number): unknown => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle: unknown): void => {
    globalThis.clearTimeout(handle as GlobalTimeoutHandle);
  },
});

/** Epoch-millisecond clock. */
export type Clock = () => number;

export const SYSTEM_CLOCK: Clock = () => Date.now();

/** The subset of `console` the package logs through. */
export type Logger = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

const noop = (): void => {};

export const SILENT_LOGGER: Logger = Object.freeze({
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
});

/**
 * A cancellable sleep: `sleep()` resolves after `ms`, or early when `wake()` is called.
 * Only one sleep may be pending at a time.
 */
export class Sleeper {
  private readonly timers: Timers;
  private handle: unknown = null;
  private resolveSleep: (() => void) | null = null;

  constructor(timers: Timers) {
    this.timers = timers;
  }

  get sleeping(): boolean {
    return this.resolveSleep !== null;
  }

  sleep(ms: number): Promise<void> {
    this.wake();
    return new Promise((resolve) => {
      this.resolveSleep = resolve;
      this.handle = this.timers.setTimeout(() => this.wake(), Math.max(0, ms));
    });
  }

  /** Resolve the pending sleep now (no-op when not sleeping). */
  wake(): void {
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
    const resolve = this.resolveSleep;
    this.resolveSleep = null;
    resolve?.();
  }
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : String(err);
}
