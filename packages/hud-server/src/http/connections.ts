import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { isLoopbackAddress } from './auth.ts';

/**
 * TCP connections (HTTP requests, keep-alive, WebSockets) accepted from other machines, in total
 * and per address. Connections from the HUD itself (the kiosk browser) are never limited.
 */
export const MAX_REMOTE_CONNECTIONS = 128;
export const MAX_CONNECTIONS_PER_ADDRESS = 32;
/** Time a client gets to send its request headers; also closes connections that send nothing. */
export const HEADERS_TIMEOUT_MS = 10_000;
/** Time a client gets to send a whole request (bodies are small JSON documents). */
export const REQUEST_TIMEOUT_MS = 30_000;

export interface ConnectionLimits {
  maxRemote?: number;
  maxPerAddress?: number;
  /** Addresses that are never limited; default: loopback. */
  exempt?: (address: string) => boolean;
  /** Called for each refused connection. */
  onRefused?: (address: string) => void;
}

/**
 * Keep other devices on the car's network from exhausting the service's file descriptors with
 * idle or slow connections (once they are gone, trip appends, config saves and OBD reconnects
 * fail with EMFILE): connections beyond the limits are closed at once, and requests must arrive
 * within {@link HEADERS_TIMEOUT_MS}.
 */
export function limitConnections(server: Server, limits: ConnectionLimits = {}): void {
  const maxRemote = limits.maxRemote ?? MAX_REMOTE_CONNECTIONS;
  const maxPerAddress = limits.maxPerAddress ?? MAX_CONNECTIONS_PER_ADDRESS;
  const exempt = limits.exempt ?? isLoopbackAddress;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  const perAddress = new Map<string, number>();
  let remote = 0;
  server.on('connection', (socket: Socket) => {
    const address = socket.remoteAddress ?? '';
    if (exempt(address)) return;
    const count = perAddress.get(address) ?? 0;
    if (remote >= maxRemote || count >= maxPerAddress) {
      socket.destroy();
      limits.onRefused?.(address);
      return;
    }
    remote += 1;
    perAddress.set(address, count + 1);
    socket.once('close', () => {
      remote -= 1;
      const left = (perAddress.get(address) ?? 1) - 1;
      if (left <= 0) perAddress.delete(address);
      else perAddress.set(address, left);
    });
  });
}
