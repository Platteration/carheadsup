import { WebSocket } from 'ws';
import type { RawData } from 'ws';
import type { Logger, Timers } from '@carheadsup/obd';

/** Server-initiated ping period; a socket that has not answered the previous ping is dropped. */
export const HEARTBEAT_INTERVAL_MS = 10_000;
/** How long `closeAll` waits for close handshakes before terminating sockets. */
export const CLOSE_GRACE_MS = 1000;

/** The text of a received message, whatever buffer form `ws` delivered it in. */
export function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

/** Send a text message if the socket is open. Returns false when it could not be sent. */
export function sendText(ws: WebSocket, text: string): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(text);
    return true;
  } catch {
    return false;
  }
}

export function sendJson(ws: WebSocket, message: unknown): boolean {
  return sendText(ws, JSON.stringify(message));
}

/** Start a close handshake, never throwing (reasons are capped to the protocol's 123 bytes). */
export function closeSocket(ws: WebSocket, code: number, reason: string): void {
  if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) return;
  try {
    ws.close(code, Buffer.from(reason).subarray(0, 123).toString());
  } catch {
    ws.terminate();
  }
}

/**
 * Close every socket with `code`/`reason` and resolve once all have closed, terminating the ones
 * whose peer has not completed the handshake within `graceMs`.
 */
export async function closeAll(
  sockets: Iterable<WebSocket>,
  code: number,
  reason: string,
  timers: Timers,
  graceMs: number = CLOSE_GRACE_MS,
): Promise<void> {
  const waits = [...sockets].map(
    (ws) =>
      new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        const timer = timers.setTimeout(() => {
          ws.terminate();
          resolve();
        }, graceMs);
        ws.once('close', () => {
          timers.clearTimeout(timer);
          resolve();
        });
        closeSocket(ws, code, reason);
      }),
  );
  await Promise.all(waits);
}

/**
 * WebSocket keep-alive: every `intervalMs` each tracked socket that answered the previous ping
 * gets a new one; a socket that did not is terminated (a vanished Wi-Fi client never sends a
 * TCP close, and its buffered frames would otherwise pile up).
 */
export class Heartbeat {
  private readonly intervalMs: number;
  private readonly timers: Timers;
  private readonly logger: Logger;
  private readonly sockets = new Set<WebSocket>();
  private readonly alive = new WeakSet<WebSocket>();
  private timer: unknown = null;

  constructor(options: { intervalMs?: number; timers: Timers; logger: Logger }) {
    this.intervalMs = Math.max(1, options.intervalMs ?? HEARTBEAT_INTERVAL_MS);
    this.timers = options.timers;
    this.logger = options.logger;
  }

  track(ws: WebSocket): void {
    this.sockets.add(ws);
    this.alive.add(ws);
    ws.on('pong', () => this.alive.add(ws));
    ws.once('close', () => this.sockets.delete(ws));
  }

  start(): void {
    if (this.timer !== null) return;
    const beat = () => {
      this.timer = this.timers.setTimeout(() => {
        this.check();
        beat();
      }, this.intervalMs);
    };
    beat();
  }

  stop(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private check(): void {
    for (const ws of [...this.sockets]) {
      if (!this.alive.has(ws)) {
        this.logger.debug('WebSocket: peer stopped answering pings; dropping it');
        this.sockets.delete(ws);
        ws.terminate();
        continue;
      }
      this.alive.delete(ws);
      try {
        ws.ping();
      } catch {
        // Not open (yet/anymore): the close handler removes it.
      }
    }
  }
}
