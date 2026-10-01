import { createHash, timingSafeEqual } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { normalizeIpAddress } from '@carheadsup/core';

/**
 * Access rules for the REST API and the renderer socket, as pure functions.
 *
 *  - Clients on the HUD itself are always allowed: the kiosk browser and local tools (see
 *    {@link isHudItself}: over loopback, or from the very address they reached the HUD at).
 *  - Everyone else (the phone, a laptop on the car's Wi-Fi) must present
 *    `Authorization: Bearer <server.apiToken>` once a token is configured; with no token the
 *    API is open to the car's network.
 *  - Browsers are additionally protected from cross-site request forgery: state-changing requests
 *    and WebSocket upgrades whose `Origin` is not the HUD itself are refused.
 *  - DNS rebinding (a foreign site's name made to resolve to the HUD, which makes its pages
 *    "same-origin") is stopped by refusing requests whose `Host` is not a name of the HUD.
 */

/**
 * A socket address (`socket.remoteAddress` / `socket.localAddress`) in comparable form: the
 * canonical text of `normalizeIpAddress` (lower case, IPv6 compressed, IPv4-mapped IPv6 as IPv4)
 * and the zone id Node appends to link-local IPv6 addresses (`fe80::1%wlan0`), if any. Null for
 * a missing or empty address (a socket already gone) and anything that is not an IP address.
 */
function socketAddress(
  address: string | null | undefined,
): { ip: string; zone: string | null } | null {
  if (typeof address !== 'string' || address === '') return null;
  const percent = address.indexOf('%');
  const bare = percent === -1 ? address : address.slice(0, percent);
  const zone = percent === -1 ? null : address.slice(percent + 1);
  if (zone === '' || (zone !== null && !bare.includes(':'))) return null;
  const ip = normalizeIpAddress(bare);
  return ip === null ? null : { ip, zone };
}

/** Whether `address` (as reported by `socket.remoteAddress`) is a loopback address. */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  const ip = socketAddress(address)?.ip;
  if (ip === undefined) return false;
  // ::1, and 127.0.0.0/8 in its entirety (also IPv4-mapped).
  return ip === '::1' || (isIPv4(ip) && ip.startsWith('127.'));
}

/** Where a connection comes from, and where it reached the HUD: its socket's two addresses. */
export interface ConnectionAddresses {
  /** `socket.remoteAddress`: the client's address; undefined once the socket is gone. */
  remoteAddress: string | null | undefined;
  /** `socket.localAddress`: the HUD's address the client connected to. */
  localAddress: string | null | undefined;
}

/**
 * Whether a connection comes from the HUD itself — the kiosk browser, local tools — rather than
 * from another device: its remote address is a loopback address, or the same address as its
 * local one (compared in canonical form: IPv4-mapped IPv6 as IPv4, IPv6 without its zone id).
 *
 * The second case is the kiosk when the HUD listens on one network address only
 * (`server.host` = `10.42.0.1`): it cannot use loopback then, and connects from that address to
 * that address. No other device can open such a connection: a peer that forges the HUD's own
 * address as its source never completes the TCP handshake, because the HUD's answer to its own
 * address is delivered locally and never leaves the machine (and for IPv4, Linux drops incoming
 * packets with a local source address as martians in the first place).
 *
 * A missing, empty or unparseable address (a socket already gone) is never the HUD itself, and
 * neither is an unspecified one (`0.0.0.0`, `::`), nor two link-local addresses with different
 * zones.
 */
export function isHudItself(
  remoteAddress: string | null | undefined,
  localAddress: string | null | undefined,
): boolean {
  if (isLoopbackAddress(remoteAddress)) return true;
  const remote = socketAddress(remoteAddress);
  const local = socketAddress(localAddress);
  if (remote === null || local === null || remote.ip !== local.ip) return false;
  if (remote.ip === '0.0.0.0' || remote.ip === '::') return false;
  return remote.zone === null || local.zone === null || remote.zone === local.zone;
}

/**
 * The token of an `Authorization: Bearer <token>` header, or null. The scheme is
 * case-insensitive; the token is everything after it (so it may contain spaces), without the
 * surrounding whitespace.
 */
export function bearerToken(header: string | string[] | null | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^\s*bearer\s+(.*?)\s*$/i.exec(header);
  const token = match?.[1];
  return token === undefined || token === '' ? null : token;
}

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * Compare two secrets in constant time. Both are hashed first, so neither the content nor the
 * length of the expected secret leaks through timing.
 */
export function secretsEqual(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

export interface AuthInput extends ConnectionAddresses {
  /** The `Authorization` header, if any. */
  authorization?: string | string[] | null | undefined;
  /** A token passed another way (the `?token=` query parameter of a WebSocket URL). */
  token?: string | null | undefined;
  /** `server.apiToken`; empty = no token required. */
  apiToken: string;
}

/**
 * Whether a client may use the API: the HUD itself always (see {@link isHudItself}); otherwise
 * any client when no token is configured, else only with the right token (Bearer header or
 * explicit `token`).
 *
 * Whitespace around a token is not part of it: an HTTP header cannot carry it, and the settings
 * app trims what it keeps. Spaces inside a token are.
 */
export function isAuthorized(input: AuthInput): boolean {
  if (isHudItself(input.remoteAddress, input.localAddress)) return true;
  if (input.apiToken === '') return true;
  const expected = input.apiToken.trim();
  const candidates = [bearerToken(input.authorization), input.token?.trim() ?? null];
  let ok = false;
  for (const candidate of candidates) {
    // Evaluate every candidate so the time taken does not depend on which one matched.
    if (candidate !== null && candidate !== '' && secretsEqual(candidate, expected)) {
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

// ---------------------------------------------------------------------------------------------
// Host names (DNS-rebinding protection)

/**
 * Dot-separated DNS labels: letters, digits, hyphens and underscores, 1–63 characters each, not
 * starting or ending with a hyphen; 253 characters in all. Lower case (see {@link isDnsName}).
 */
const DNS_NAME =
  /^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*$/;

/**
 * Whether `name` (lower case, without a trailing dot) is made of DNS labels — so nothing but a
 * host name: no path, userinfo, port, space, percent sign or non-ASCII character can be in it.
 */
export function isDnsName(name: string): boolean {
  return DNS_NAME.test(name);
}

/** A host name in comparable form: lower case, without one trailing dot. */
function normalizeName(name: string): string {
  const lower = name.trim().toLowerCase();
  return lower.endsWith('.') ? lower.slice(0, -1) : lower;
}

/**
 * The names the HUD answers to besides IP addresses and localhost: the machine's host name, its
 * first label and `<label>.local` (mDNS), plus `extra` names (e.g. a name the home router's DNS
 * gives the Pi). Lower case, without ports.
 */
export function hudHostNames(machineName: string, extra: readonly string[] = []): Set<string> {
  const names = new Set<string>();
  const full = normalizeName(machineName);
  if (full !== '') {
    const label = full.split('.')[0] ?? full;
    names.add(full);
    names.add(label);
    names.add(`${label}.local`);
  }
  for (const name of extra) {
    const normalized = normalizeName(name);
    if (normalized !== '') names.add(normalized);
  }
  return names;
}

/** An IPv6 zone in a `Host` header (`%25wlan0`, or unencoded `%wlan0`): unreserved characters. */
const HOST_ZONE = /^%(?:25)?[a-z0-9._~-]+$/;

/**
 * Whether a request's `Host` header addresses this HUD: an IP address (a rebound name is never
 * an address; a bracketed IPv6 address may carry a zone), `localhost` / `*.localhost` (browsers
 * resolve those to loopback themselves) or one of `names` (see {@link hudHostNames}), with or
 * without a port. A name counts only when it is made of DNS labels ({@link isDnsName}): one
 * ending in `.localhost` but holding a path, userinfo, spaces or the like
 * (`evil.example/.localhost`) is refused. A request without a Host header does not come from a
 * browser and is allowed; a malformed one is not.
 *
 * Without this check a page on `http://evil.example:8080` whose name was rebound to the HUD's
 * address would be same-origin with the HUD (its Origin and Host match), so the cross-site
 * checks would let it drive the API and the WebSockets.
 */
export function isAllowedHost(
  header: string | string[] | undefined,
  names: ReadonlySet<string>,
): boolean {
  if (header === undefined) return true;
  if (typeof header !== 'string') return false;
  const text = header.trim().toLowerCase();
  if (text === '') return true;
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    if (end < 0 || !/^(:\d{1,5})?$/.test(text.slice(end + 1))) return false;
    const inside = text.slice(1, end);
    const percent = inside.indexOf('%');
    if (percent >= 0 && !HOST_ZONE.test(inside.slice(percent))) return false;
    return isIPv6(percent < 0 ? inside : inside.slice(0, percent));
  }
  const match = /^([^:]+)(?::\d{1,5})?$/.exec(text);
  if (match === null) return false;
  const name = normalizeName(match[1] ?? '');
  if (isIPv4(name)) return true;
  if (!isDnsName(name)) return false;
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  return names.has(name);
}
