import {
  CLIENT_ERROR_MESSAGE_CHARS,
  CLIENT_ERROR_STACK_CHARS,
  RENDERER_FRAME_CHARS,
} from '@carheadsup/core';
import type { RendererClientError, RendererToServer } from '@carheadsup/core';
import { useEffect } from 'preact/hooks';

/**
 * The kiosk page's errors, sent to the server (`client-error`) so that they reach its log: the
 * page itself has no console anyone reads, and an error that made it start over would otherwise
 * leave no trace at all.
 */

/** Errors sent at once; afterwards one per {@link PAGE_ERROR_REFILL_MS}. */
export const PAGE_ERROR_BURST = 3;
export const PAGE_ERROR_REFILL_MS = 20_000;
/** Errors kept while the page is not connected (the newest), sent once it is. */
const MAX_PENDING = PAGE_ERROR_BURST;

/** Control characters the server refuses in a report (tab, CR and LF are fine). */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** `text` cut to `max` UTF-16 code units, without leaving half a surrogate pair at the end. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.max(0, max));
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

function clean(text: string, max: number): string {
  return cut(text.replace(CONTROL_CHARS, ' '), max);
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(value);
    if (typeof json === 'string') return json;
  } catch {
    // A cycle or a BigInt: fall back to String().
  }
  return String(value);
}

/**
 * The `client-error` message for any thrown value: its message and stack trace, cleaned of
 * control characters and shortened so that the whole message fits a renderer frame.
 */
export function clientErrorMessage(error: unknown): RendererClientError {
  const message =
    error instanceof Error ? error.message || error.name || 'Error' : describeValue(error);
  const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : null;
  const report: RendererClientError = {
    t: 'client-error',
    message: clean(message, CLIENT_ERROR_MESSAGE_CHARS) || 'Error',
    stack: stack === null ? null : clean(stack, CLIENT_ERROR_STACK_CHARS),
  };
  // JSON escapes (quotes, backslashes, line breaks) can make it longer than its characters.
  for (let excess = JSON.stringify(report).length - RENDERER_FRAME_CHARS; excess > 0;) {
    if (report.stack === null || report.stack === '') {
      report.message = cut(report.message, report.message.length - excess);
    } else {
      report.stack = cut(report.stack, report.stack.length - excess);
    }
    excess = JSON.stringify(report).length - RENDERER_FRAME_CHARS;
  }
  return report;
}

export interface PageErrorReporterOptions {
  /** Monotonic ms clock (default `performance.now()`). */
  now?: () => number;
}

/**
 * Rate-limited delivery of page errors to the server: {@link PAGE_ERROR_BURST} at once, then
 * one per {@link PAGE_ERROR_REFILL_MS} (a page in a reload loop must not flood the log). While
 * no connection is set, the newest few wait for one.
 */
export class PageErrorReporter {
  private readonly now: () => number;
  private send: ((message: RendererToServer) => boolean) | null = null;
  private readonly pending: RendererClientError[] = [];
  private tokens = PAGE_ERROR_BURST;
  private refilledAt: number;

  constructor(options: PageErrorReporterOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.refilledAt = this.now();
  }

  /** Where reports go (the live feed's `send`), or null while there is no connection. */
  setSender(send: ((message: RendererToServer) => boolean) | null): void {
    this.send = send;
    this.flush();
  }

  /** Report a thrown value (dropped beyond the rate limit). */
  report(error: unknown): void {
    if (!this.take()) return;
    this.pending.push(clientErrorMessage(error));
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    this.flush();
  }

  private take(): boolean {
    const now = this.now();
    const elapsed = now - this.refilledAt;
    if (Number.isFinite(elapsed) && elapsed > 0) {
      this.tokens = Math.min(PAGE_ERROR_BURST, this.tokens + elapsed / PAGE_ERROR_REFILL_MS);
    }
    if (Number.isFinite(now)) this.refilledAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private flush(): void {
    const send = this.send;
    if (send === null) return;
    while (this.pending.length > 0) {
      const next = this.pending[0];
      if (next === undefined || !send(next)) return;
      this.pending.shift();
    }
  }
}

/**
 * Report the errors no code handled: uncaught exceptions (`error` events of scripts) and
 * unhandled promise rejections. Returns the function that removes the listeners.
 */
export function reportUncaughtErrors(reporter: PageErrorReporter, target: EventTarget): () => void {
  const onError = (event: Event): void => {
    const { error, message } = event as ErrorEvent;
    // Failed resource loads (an image) are no script errors and carry neither.
    if (error === undefined && (message === undefined || message === '')) return;
    reporter.report(error ?? message);
  };
  const onRejection = (event: Event): void => {
    reporter.report((event as PromiseRejectionEvent).reason);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}

/**
 * Deliver `reporter`'s errors through `send` while `connected` (the live kiosk page's feed):
 * what waited for the connection goes out as soon as it opens.
 */
export function usePageErrorSender(
  reporter: PageErrorReporter,
  send: (message: RendererToServer) => boolean,
  connected: boolean,
): void {
  useEffect(() => {
    if (!connected) return undefined;
    reporter.setSender(send);
    return () => reporter.setSender(null);
  }, [reporter, send, connected]);
}
