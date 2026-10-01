import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { isHudItself } from './auth.ts';
import type { ConnectionAddresses } from './auth.ts';

/**
 * TCP connections (HTTP requests, keep-alive, WebSockets) accepted from other machines, in total
 * and per address. Connections from the HUD itself (the kiosk browser; see `isHudItself`) are
 * never limited.
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
  /** Connections that are never limited; default: the HUD's own (`isHudItself`). */
  exempt?: (connection: ConnectionAddresses) => boolean;
  /** Called for each refused connection. */
  onRefused?: (address: string) => void;
}

/**
 * Keep other devices on the car's network from exhausting the service's file descriptors with
 * idle or slow connections (once they are gone, trip appends, config saves and OBD reconnects
 * fail with EMFILE): connections beyond the limits are closed at once, and requests must arrive
 * within {@link HEADERS_TIMEOUT_MS}. Several servers (the HTTP and the HTTPS listener) share one
 * budget; an HTTPS server's connections count from their first byte, before the TLS handshake.
 */
export function limitConnections(
  servers: Server | readonly Server[],
  limits: ConnectionLimits = {},
): void {
  const maxRemote = limits.maxRemote ?? MAX_REMOTE_CONNECTIONS;
  const maxPerAddress = limits.maxPerAddress ?? MAX_CONNECTIONS_PER_ADDRESS;
  const exempt =
    limits.exempt ??
    ((connection: ConnectionAddresses) =>
      isHudItself(connection.remoteAddress, connection.localAddress));
  const perAddress = new Map<string, number>();
  let remote = 0;
  const onConnection = (socket: Socket): void => {
    if (exempt({ remoteAddress: socket.remoteAddress, localAddress: socket.localAddress })) return;
    const address = socket.remoteAddress ?? '';
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
  };
  for (const server of Array.isArray(servers) ? servers : [servers]) {
    server.headersTimeout = HEADERS_TIMEOUT_MS;
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.on('connection', onConnection);
  }
}
