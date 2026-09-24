/**
 * IP address literals for allow-lists such as `sensors.adasAllowedSenders`: validation and one
 * canonical text per address, so that the same address written differently compares equal — in
 * the config schema, the settings app and the server matching a datagram's source address.
 */

/** Longest textual IPv6 address: eight groups with an IPv4 tail, "ffff:…:ffff:255.255.255.255". */
const MAX_LITERAL_LENGTH = 45;
/** One IPv4 byte in decimal, without leading zeros (which some parsers read as octal). */
const IPV4_BYTE = /^(?:0|[1-9]\d{0,2})$/;
const HEX_GROUP = /^[0-9A-Fa-f]{1,4}$/;

function parseIpv4(text: string): [number, number, number, number] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!IPV4_BYTE.test(part)) return null;
    const byte = Number(part);
    if (byte > 255) return null;
    bytes.push(byte);
  }
  const [a = 0, b = 0, c = 0, d = 0] = bytes;
  return [a, b, c, d];
}

/** Colon-separated hex groups; an IPv4 tail (two groups) is allowed only where `ipv4Tail`. */
function parseGroups(text: string, ipv4Tail: boolean): number[] | null {
  if (text === '') return [];
  const pieces = text.split(':');
  const groups: number[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i] ?? '';
    if (ipv4Tail && i === pieces.length - 1 && piece.includes('.')) {
      const v4 = parseIpv4(piece);
      if (v4 === null) return null;
      groups.push(v4[0] * 256 + v4[1], v4[2] * 256 + v4[3]);
    } else {
      if (!HEX_GROUP.test(piece)) return null;
      groups.push(Number.parseInt(piece, 16));
    }
  }
  return groups;
}

/** The eight 16-bit groups of an IPv6 literal (RFC 4291 text forms, no zone index). */
function parseIpv6(text: string): number[] | null {
  const halves = text.split('::');
  if (halves.length === 1) {
    const groups = parseGroups(text, true);
    return groups !== null && groups.length === 8 ? groups : null;
  }
  if (halves.length !== 2) return null;
  const head = parseGroups(halves[0] ?? '', false);
  const tail = parseGroups(halves[1] ?? '', true);
  // "::" stands for at least one group of zeros.
  if (head === null || tail === null || head.length + tail.length > 7) return null;
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

/** RFC 5952 text: lower case, no leading zeros, the longest run of 2+ zero groups as "::". */
function formatIpv6(groups: readonly number[]): string {
  let bestStart = -1;
  let bestLength = 1;
  for (let i = 0; i < groups.length;) {
    if (groups[i] !== 0) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < groups.length && groups[end] === 0) end += 1;
    if (end - i > bestLength) {
      bestStart = i;
      bestLength = end - i;
    }
    i = end;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart < 0) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}

/**
 * The canonical text of an IPv4 or IPv6 address literal, or null when `text` is not one.
 * IPv4 is dotted decimal (leading zeros, which some parsers read as octal, are refused); IPv6 is
 * RFC 5952 text; an IPv4-mapped IPv6 address (`::ffff:10.42.0.50`, as a dual-stack socket reports
 * an IPv4 peer) becomes the IPv4 address. Host names, prefixes (`/24`), ports, brackets, zone
 * indices (`%eth0`) and surrounding spaces are refused.
 */
export function normalizeIpAddress(text: string): string | null {
  if (text.length === 0 || text.length > MAX_LITERAL_LENGTH) return null;
  if (!text.includes(':')) {
    const v4 = parseIpv4(text);
    return v4 === null ? null : v4.join('.');
  }
  const groups = parseIpv6(text);
  if (groups === null) return null;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  return formatIpv6(groups);
}
