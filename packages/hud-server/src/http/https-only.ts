import type { IncomingMessage } from 'node:http';
import { isIPv4, isIPv6 } from 'node:net';
import { isDnsName, isHudItself } from './auth.ts';
import type { ConnectionAddresses } from './auth.ts';

/**
 * HTTPS-only access for other devices. The plain listener (`server.port`) carries everything in
 * clear text — the API token, the config, the HUD's frames. While TLS is on (`server.tlsPort`
 * set), the plain listener therefore serves only the HUD itself (the kiosk browser, local tools:
 * see `isHudItself`); other devices are sent to HTTPS on the TLS port: their page requests are
 * redirected, their API requests and display-socket upgrades refused before any token they carry
 * is looked at. If the TLS listener could not start, other devices are refused (the phone cannot
 * connect then either) rather than quietly served in clear text. `server.allowPlainRemote`
 * restores plain access for development. With TLS off (`server.tlsPort` null) plain http is the
 * only way in and serves everyone. The phone link (`/ws/phone`) follows `server.allowPlainPhone`
 * instead.
 */

/** Which listener a request or upgrade arrived on. */
export type Listener = 'plain' | 'tls';

export interface PlainAccessPolicy {
  /** Whether TLS is on (`server.tlsPort` set when the HUD started). */
  tlsEnabled: () => boolean;
  /** The running TLS listener's port; null while there is none. */
  tlsPort: () => number | null;
  /** Current `server.allowPlainRemote`. */
  allowPlainRemote: () => boolean;
}

/** The plain listener serves the client. */
export const SERVE_PLAIN = 'serve';

/**
 * What the plain listener does with a client connected from `client.remoteAddress` to
 * `client.localAddress`: serve it ({@link SERVE_PLAIN}) — the HUD itself always (see
 * `isHudItself`), everyone while TLS is off or `server.allowPlainRemote` is on — or send it to
 * TLS: `{ tlsPort }`, the running TLS listener's port, or null when that listener is not running
 * (it could not start), so there is nowhere to send the client. A client whose address is unknown
 * (its socket is already gone) is not the HUD itself.
 */
export function plainAccess(
  client: ConnectionAddresses,
  policy: PlainAccessPolicy,
): typeof SERVE_PLAIN | { tlsPort: number | null } {
  if (isHudItself(client.remoteAddress, client.localAddress)) return SERVE_PLAIN;
  if (!policy.tlsEnabled() || policy.allowPlainRemote()) return SERVE_PLAIN;
  return { tlsPort: policy.tlsPort() };
}

/**
 * The host of a `Host` header as it may stand in an https URL — an IPv4 address, a bracketed IPv6
 * address (without a zone) or a DNS name; lower case, without port or trailing dot — or null for
 * anything else. So nothing a client puts in the header (userinfo, a path, a second host) can end
 * up in a redirect. Meant for headers that passed `isAllowedHost`, which decides whether the name
 * is the HUD's at all.
 */
export function redirectHost(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const text = header.trim().toLowerCase();
  const bracketed = /^\[([0-9a-f:.]+)\](?::\d{1,5})?$/.exec(text);
  if (bracketed !== null) {
    const address = bracketed[1] ?? '';
    return isIPv6(address) ? `[${address}]` : null;
  }
  const match = /^([^:]+)(?::\d{1,5})?$/.exec(text);
  if (match === null) return null;
  const raw = match[1] ?? '';
  const name = raw.endsWith('.') ? raw.slice(0, -1) : raw;
  return isIPv4(name) || isDnsName(name) ? name : null;
}

/** A socket's local address (where the client reached the HUD) as a URL host, or null. */
function addressHost(address: string | null | undefined): string | null {
  if (typeof address !== 'string') return null;
  const lower = address.toLowerCase();
  const v4 = lower.startsWith('::ffff:') ? lower.slice('::ffff:'.length) : lower;
  if (isIPv4(v4)) return v4;
  const v6 = lower.split('%')[0] ?? '';
  return isIPv6(v6) ? `[${v6}]` : null;
}

/** `scheme://host:port`, or null when the URL parser reads `host` as another host. */
function originFor(scheme: 'https' | 'wss', host: string, port: number): string | null {
  let parsed: URL;
  try {
    parsed = new URL(`${scheme}://${host}:${port}/`);
  } catch {
    return null;
  }
  // A name the URL parser takes for a number ("1234", "0x7f.1") becomes an IPv4 address:
  // only an unchanged name is used. (IPv6 addresses were validated and may be re-written.)
  if (!host.startsWith('[') && parsed.hostname !== host) return null;
  return `${scheme}://${parsed.host}`;
}

/** `pathname` and query of `url`, without a `token` parameter. */
function pathWithoutToken(url: URL): string {
  if (!url.searchParams.has('token')) return `${url.pathname}${url.search}`;
  const params = new URLSearchParams(url.search);
  params.delete('token');
  const query = params.toString();
  return `${url.pathname}${query === '' ? '' : `?${query}`}`;
}

export interface SecureLocationInput {
  /** The request's `Host` header (already checked by `isAllowedHost`). */
  host: string | string[] | undefined;
  /** `req.socket.localAddress`: used when the Host header names no usable host. */
  localAddress: string | null | undefined;
  tlsPort: number;
  /** The parsed request target (see `parseRequestUrl`). */
  url: URL;
  /** `https` for pages and the API, `wss` for the display socket. */
  scheme: 'https' | 'wss';
}

/**
 * Where a client of the plain listener is sent: `<scheme>://<host>:<tlsPort><path>[?query]`, with
 * the host from its `Host` header (see {@link redirectHost}) or else the address it reached the
 * HUD at, the port of the TLS listener, and the path and query of its request — without a `token`
 * parameter: an API token in a plain-http address has crossed the network in clear text already,
 * so it is neither handed on to the HTTPS page nor echoed back. Null when no usable host is known.
 */
export function secureLocation(input: SecureLocationInput): string | null {
  const candidates = [redirectHost(input.host), addressHost(input.localAddress)];
  for (const host of candidates) {
    if (host === null) continue;
    const origin = originFor(input.scheme, host, input.tlsPort);
    if (origin !== null) return `${origin}${pathWithoutToken(input.url)}`;
  }
  return null;
}

/**
 * {@link secureLocation} for a request to the plain listener, whose target parsed as `url`; null
 * while the TLS listener is not running (`tlsPort` null).
 */
export function secureLocationOf(
  req: IncomingMessage,
  url: URL,
  tlsPort: number | null,
  scheme: 'https' | 'wss',
): string | null {
  if (tlsPort === null) return null;
  return secureLocation({
    host: req.headers.host,
    localAddress: req.socket.localAddress,
    tlsPort,
    url,
    scheme,
  });
}

/**
 * The error for another device's API request or display-socket upgrade on the plain listener,
 * naming where to go instead (`location`, see {@link secureLocation}) — or saying that the TLS
 * listener is not running (`tlsPort` null).
 */
export function httpsRequiredMessage(
  location: string | null,
  tlsPort: number | null,
  scheme: 'https' | 'wss' = 'https',
): string {
  const reason = 'over plain http the HUD serves only itself, so this request was not processed';
  if (tlsPort === null) {
    return (
      "HTTPS required, but the HUD's TLS listener is not running (see its log and " +
      `server.tlsPort): ${reason} (see server.allowPlainRemote)`
    );
  }
  const where = location ?? `${scheme}://<this HUD>:${tlsPort}`;
  return `HTTPS required: use ${where} — ${reason} (see server.allowPlainRemote)`;
}
