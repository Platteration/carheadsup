import { createHash, timingSafeEqual } from 'node:crypto';
import { isIPv4 } from 'node:net';

/**
 * Access rules for the REST API and the renderer socket, as pure functions.
 *
 *  - Clients on the HUD itself (loopback) are always allowed: the kiosk browser and local tools.
 *  - Everyone else (the phone, a laptop on the car's Wi-Fi) must present
 *    `Authorization: Bearer <server.apiToken>` once a token is configured; with no token the
 *    API is open to the car's network.
 *  - Browsers are additionally protected from cross-site request forgery: state-changing requests
 *    and WebSocket upgrades whose `Origin` is not the HUD itself are refused.
 */

/** Whether `address` (as reported by `socket.remoteAddress`) is a loopback address. */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (typeof address !== 'string' || address === '') return false;
  const ip = address.toLowerCase();
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  const v4 = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  // 127.0.0.0/8 is loopback in its entirety.
  return isIPv4(v4) && v4.startsWith('127.');
}

/** The token of an `Authorization: Bearer <token>` header, or null. The scheme is case-insensitive. */
export function bearerToken(header: string | string[] | null | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^\s*bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * Compare two secrets in constant time. Both are hashed first, so neither the content nor the
 * length of the expected secret leaks through timing.
 */
export function secretsEqual(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

export interface AuthInput {
  /** `req.socket.remoteAddress`. */
  remoteAddress: string | null | undefined;
  /** The `Authorization` header, if any. */
  authorization?: string | string[] | null | undefined;
  /** A token passed another way (the `?token=` query parameter of a WebSocket URL). */
  token?: string | null | undefined;
  /** `server.apiToken`; empty = no token required. */
  apiToken: string;
}

/**
 * Whether a client may use the API: loopback always; otherwise any client when no token is
 * configured, else only with the right token (Bearer header or explicit `token`).
 */
export function isAuthorized(input: AuthInput): boolean {
  if (isLoopbackAddress(input.remoteAddress)) return true;
  if (input.apiToken === '') return true;
  const candidates = [bearerToken(input.authorization), input.token ?? null];
  let ok = false;
  for (const candidate of candidates) {
    // Evaluate every candidate so the time taken does not depend on which one matched.
    if (candidate !== null && candidate !== '' && secretsEqual(candidate, input.apiToken)) {
      ok = true;
    }
  }
  return ok;
}

export interface OriginHeaders {
  origin?: string | string[] | undefined;
  host?: string | string[] | undefined;
  'sec-fetch-site'?: string | string[] | undefined;
}

/**
 * Whether a browser sent this request on behalf of another site (CSRF / cross-site WebSocket
 * hijacking). Requests without browser provenance headers (the phone app, curl) are not
 * cross-site. `Origin: null` (sandboxed frames, file: pages) counts as cross-site.
 */
export function isCrossSiteRequest(headers: OriginHeaders): boolean {
  const fetchSite = headers['sec-fetch-site'];
  if (fetchSite === 'cross-site') return true;
  const origin = headers.origin;
  if (typeof origin !== 'string' || origin === '') return false;
  if (origin === 'null') return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return true;
  }
  const host = typeof headers.host === 'string' ? headers.host.toLowerCase() : '';
  return host === '' || stripDefaultPort(originHost, origin) !== stripDefaultPort(host, origin);
}

/** `host:80` for http / `host:443` for https equals `host` (browsers omit default ports in Origin). */
function stripDefaultPort(host: string, origin: string): string {
  const defaultPort = origin.toLowerCase().startsWith('https:') ? ':443' : ':80';
  return host.endsWith(defaultPort) ? host.slice(0, -defaultPort.length) : host;
}
