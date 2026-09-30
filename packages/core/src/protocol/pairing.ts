import { normalizeIpAddress } from '../config/ip.ts';
import { PHONE_AUTH, isAuthId, isCertFingerprint } from './phone-auth.ts';

/**
 * Pairing a phone by QR code: the pairing URI (version 1) that the HUD shows on its own display
 * (the parked dashboard's "Pair a phone" page) and the companion app scans. The HUD's display is
 * a physical channel only someone in the car can read, so everything the phone needs travels
 * this way — the pairing token, the HUD's id and the SHA-256 fingerprint of its TLS certificate
 * (which the phone pins at once instead of trusting the first certificate it sees), and where to
 * reach it:
 *
 *   carheadsup://pair?v=1&id=<hudId>&fp=<certificate SHA-256, hex>&k=<pairing token>
 *     &h=<host>[,<host>…]&p=<TLS port>&n=<HUD name>
 *
 * - `v`  the version, `1`. A parser meeting a higher one says "update the app" (not "invalid").
 * - `id` the HUD's id (22 base64url characters), as in the phone link's `challenge`.
 * - `fp` the fingerprint of the HUD's certificate, 64 lowercase hex digits.
 * - `k`  the pairing token (`phone.pairingToken`, 1–256 characters). Never empty: a HUD without
 *        a token shows no code.
 * - `h`  1–8 hosts, comma-separated, in order of preference: IPv4 literals (the HUD's
 *        addresses) and DNS names (`<hostname>.local`). No IPv6 (a link-local address needs a
 *        zone, which differs on every phone).
 * - `p`  the TLS port (`server.tlsPort`), 1–65535.
 * - `n`  optional: the HUD's name as it advertises itself ({@link hudDisplayName}), at most 63
 *        bytes of UTF-8, no control characters.
 *
 * Values are percent-encoded (UTF-8; everything but RFC 3986's unreserved characters
 * `A–Z a–z 0–9 - . _ ~`; upper-case hex digits) and appear in that order. Parsers compare the
 * scheme and host case-insensitively, ignore surrounding white space, a fragment and parameters
 * they do not know (later versions of v1 may add some), and reject anything else that is out of
 * shape: a duplicated parameter, a malformed escape, a field out of range.
 *
 * Shared test vectors (`test/protocol/pairing-uri-vectors.json`) keep this module and the
 * companion's parser (`companion-android/protocol`, `PairingUri`) in step.
 */
export const PAIRING_URI = {
  scheme: 'carheadsup',
  host: 'pair',
  version: 1,
  /** Most hosts in `h`. */
  maxHosts: 8,
  /** Longest host (a DNS name). */
  maxHostChars: 253,
  /** Longest pairing token, in UTF-16 code units (the config schema's limit). */
  maxTokenChars: 256,
  /** Longest HUD name, in bytes of UTF-8 (one DNS-SD instance label). */
  maxNameBytes: 63,
} as const;

/** Everything the pairing URI carries. */
export interface PairingPayload {
  hudId: string;
  /** SHA-256 of the HUD's certificate (DER), 64 lowercase hex digits. */
  certFingerprint: string;
  /** `phone.pairingToken`; never empty. */
  pairingToken: string;
  /** Where to reach the HUD, most preferred first: IPv4 literals and DNS names. */
  hosts: string[];
  /** The HUD's TLS port (`server.tlsPort`). */
  tlsPort: number;
  /** The HUD's name ({@link hudDisplayName}), or null when the URI names none. */
  hudName: string | null;
}

/** Why a scanned text is not a usable pairing URI. */
export type PairingUriError =
  /** Not a carheadsup pairing URI at all (another app's QR code, a web address, text). */
  | 'foreign'
  /** A pairing URI of a later version than this parser knows: update the app. */
  | 'unsupported-version'
  /** A carheadsup pairing URI that is damaged or out of shape. */
  | 'invalid';

export type PairingUriParse =
  { ok: true; payload: PairingPayload } | { ok: false; error: PairingUriError; detail: string };

const DNS_LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const DNS_NAME = new RegExp(`^${DNS_LABEL}(?:\\.${DNS_LABEL})*$`);
const DIGITS_AND_DOTS = /^[0-9.]+$/;
const PORT = /^[1-9][0-9]{0,4}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const LONE_SURROGATES = new RegExp(LONE_SURROGATE.source, 'g');

/** Whether `host` may appear in `h`: an IPv4 literal (canonical dotted decimal) or a DNS name. */
export function isPairingHost(host: string): boolean {
  if (host.length === 0 || host.length > PAIRING_URI.maxHostChars) return false;
  // All digits and dots must be an IPv4 address ("999.1.1.1" is not a name either).
  if (DIGITS_AND_DOTS.test(host)) return normalizeIpAddress(host) === host;
  return DNS_NAME.test(host);
}

/** Bytes of `text` in UTF-8 (a lone surrogate counts as U+FFFD, 3 bytes). */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * The HUD's name as phones see it — "<vehicle name> HUD", as it advertises itself over mDNS and
 * the pairing URI carries it: control characters and runs of white space become one space, a
 * lone UTF-16 surrogate (which no UTF-8 can carry) becomes U+FFFD, and the vehicle name is cut
 * (by whole code points) so that the whole fits one DNS label (63 bytes of UTF-8). An empty
 * vehicle name gives "carheadsup HUD". So any vehicle name gives a name the pairing URI accepts.
 */
export function hudDisplayName(vehicleName: string): string {
  const base = vehicleName
    .replace(LONE_SURROGATES, '�')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let name = `${base.length > 0 ? base : 'carheadsup'} HUD`;
  while (utf8Length(name) > PAIRING_URI.maxNameBytes) {
    // Trim the vehicle name and keep the " HUD" suffix.
    const chars = Array.from(name.slice(0, -4));
    chars.pop();
    name = `${chars.join('').trimEnd()} HUD`;
  }
  return name;
}

/** The first problem that keeps `payload` out of a pairing URI, or null when it can be encoded. */
export function pairingPayloadProblem(payload: PairingPayload): string | null {
  if (!isAuthId(payload.hudId)) {
    return `id must be ${PHONE_AUTH.idChars} base64url characters`;
  }
  if (!isCertFingerprint(payload.certFingerprint)) {
    return `fp must be ${PHONE_AUTH.fingerprintChars} lowercase hex digits`;
  }
  const token = payload.pairingToken;
  if (token.length === 0) return 'k (the pairing token) must not be empty';
  if (token.length > PAIRING_URI.maxTokenChars) {
    return `k (the pairing token) must be at most ${PAIRING_URI.maxTokenChars} characters`;
  }
  if (LONE_SURROGATE.test(token)) return 'k (the pairing token) is not well-formed text';
  const { hosts } = payload;
  if (hosts.length === 0) return 'h must name at least one host';
  if (hosts.length > PAIRING_URI.maxHosts) {
    return `h must name at most ${PAIRING_URI.maxHosts} hosts`;
  }
  const bad = hosts.find((host) => !isPairingHost(host));
  if (bad !== undefined) return `h: ${JSON.stringify(bad)} is not an IPv4 address or host name`;
  if (!Number.isInteger(payload.tlsPort) || payload.tlsPort < 1 || payload.tlsPort > 65535) {
    return 'p must be a port number (1–65535)';
  }
  const name = payload.hudName;
  if (name !== null) {
    if (name.length === 0) return 'n must not be empty';
    if (CONTROL.test(name) || LONE_SURROGATE.test(name)) return 'n must be plain text';
    if (utf8Length(name) > PAIRING_URI.maxNameBytes) {
      return `n must be at most ${PAIRING_URI.maxNameBytes} bytes of UTF-8`;
    }
  }
  return null;
}

/** RFC 3986 percent-encoding of everything but the unreserved characters (UTF-8, upper case). */
function percentEncode(text: string): string {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The pairing URI of `payload`. Throws a RangeError naming the problem when it cannot be encoded
 * (see {@link pairingPayloadProblem}).
 */
export function encodePairingUri(payload: PairingPayload): string {
  const problem = pairingPayloadProblem(payload);
  if (problem !== null) throw new RangeError(`Invalid pairing payload: ${problem}`);
  const params = [
    `v=${PAIRING_URI.version}`,
    `id=${percentEncode(payload.hudId)}`,
    `fp=${percentEncode(payload.certFingerprint)}`,
    `k=${percentEncode(payload.pairingToken)}`,
    // Hosts need no escaping (letters, digits, '-' and '.'); the commas between them stay.
    `h=${payload.hosts.map(percentEncode).join(',')}`,
    `p=${payload.tlsPort}`,
  ];
  if (payload.hudName !== null) params.push(`n=${percentEncode(payload.hudName)}`);
  const query = params.join('&');
  return `${PAIRING_URI.scheme}://${PAIRING_URI.host}?${query}`;
}

/** Percent-decoding of UTF-8; null for a malformed escape or bytes that are not UTF-8. */
function percentDecode(text: string): string | null {
  if (/%(?![0-9A-Fa-f]{2})/.test(text)) return null;
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

const invalid = (detail: string): PairingUriParse => ({ ok: false, error: 'invalid', detail });

/**
 * Parse a scanned text as a pairing URI: the payload, or why it is not one — `foreign` for
 * anything that is not a carheadsup pairing URI, `unsupported-version` for a later version,
 * `invalid` (with a detail for logs) for a damaged one. Surrounding ASCII white space is ignored,
 * and the scheme and host are compared ignoring ASCII case.
 */
export function parsePairingUri(text: string): PairingUriParse {
  const trimmed = text.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '');
  const prefix = `${PAIRING_URI.scheme}://${PAIRING_URI.host}`;
  const head = trimmed.slice(0, prefix.length).replace(/[A-Z]/g, (c) => c.toLowerCase());
  const rest = trimmed.slice(prefix.length);
  if (head !== prefix || !(rest === '' || rest.startsWith('?') || rest.startsWith('#'))) {
    return { ok: false, error: 'foreign', detail: 'not a carheadsup pairing URI' };
  }
  const query = rest.startsWith('?') ? (rest.slice(1).split('#')[0] ?? '') : '';
  const params = new Map<string, string>();
  const pairs = query === '' ? [] : query.split('&');
  for (const [index, pair] of pairs.entries()) {
    const eq = pair.indexOf('=');
    // Not the parameter itself: it may be the pairing token.
    if (eq <= 0) return invalid(`parameter ${index + 1} is not name=value`);
    const key = pair.slice(0, eq);
    const value = percentDecode(pair.slice(eq + 1));
    if (value === null) return invalid(`${key}: malformed percent-encoding`);
    if (params.has(key)) return invalid(`${key} appears twice`);
    params.set(key, value);
  }

  const version = params.get('v');
  if (version === undefined) return invalid('v is missing');
  if (!/^[1-9][0-9]{0,8}$/.test(version)) return invalid('v must be a version number');
  if (Number(version) > PAIRING_URI.version) {
    return {
      ok: false,
      error: 'unsupported-version',
      detail: `version ${version}; this app reads version ${PAIRING_URI.version}`,
    };
  }

  const required = ['id', 'fp', 'k', 'h', 'p'] as const;
  const missing = required.find((key) => !params.has(key));
  if (missing !== undefined) return invalid(`${missing} is missing`);
  const port = params.get('p') ?? '';
  if (!PORT.test(port)) return invalid('p must be a port number (1–65535)');
  const payload: PairingPayload = {
    hudId: params.get('id') ?? '',
    certFingerprint: params.get('fp') ?? '',
    pairingToken: params.get('k') ?? '',
    hosts: (params.get('h') ?? '').split(','),
    tlsPort: Number(port),
    hudName: params.get('n') ?? null,
  };
  const problem = pairingPayloadProblem(payload);
  return problem === null ? { ok: true, payload } : invalid(problem);
}
