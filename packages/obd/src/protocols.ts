/**
 * ELM327 protocol numbers (AT SP / AT DPN) and what the driver needs to know about each:
 * how response headers are laid out, the default request header, and how many PIDs one
 * service 01 request may carry.
 */

/** How response lines are framed on the wire. */
export type ProtocolFamily = 'can11' | 'can29' | 'legacy';

export interface ElmProtocol {
  /** ELM327 protocol number, "1" … "C". */
  id: string;
  /** Description in the style of `AT DP`. */
  name: string;
  family: ProtocolFamily;
  /** The adapter's default (functional) request header, restored after a custom `AT SH`. */
  defaultHeader: string;
}

const PROTOCOL_LIST: readonly ElmProtocol[] = [
  { id: '1', name: 'SAE J1850 PWM', family: 'legacy', defaultHeader: '616AF1' },
  { id: '2', name: 'SAE J1850 VPW', family: 'legacy', defaultHeader: '686AF1' },
  { id: '3', name: 'ISO 9141-2', family: 'legacy', defaultHeader: '686AF1' },
  { id: '4', name: 'ISO 14230-4 (KWP 5BAUD)', family: 'legacy', defaultHeader: 'C133F1' },
  { id: '5', name: 'ISO 14230-4 (KWP FAST)', family: 'legacy', defaultHeader: 'C133F1' },
  { id: '6', name: 'ISO 15765-4 (CAN 11/500)', family: 'can11', defaultHeader: '7DF' },
  { id: '7', name: 'ISO 15765-4 (CAN 29/500)', family: 'can29', defaultHeader: '18DB33F1' },
  { id: '8', name: 'ISO 15765-4 (CAN 11/250)', family: 'can11', defaultHeader: '7DF' },
  { id: '9', name: 'ISO 15765-4 (CAN 29/250)', family: 'can29', defaultHeader: '18DB33F1' },
  { id: 'A', name: 'SAE J1939 (CAN 29/250)', family: 'can29', defaultHeader: '18DB33F1' },
  { id: 'B', name: 'USER1 (CAN 11/125)', family: 'can11', defaultHeader: '7DF' },
  { id: 'C', name: 'USER2 (CAN 11/50)', family: 'can11', defaultHeader: '7DF' },
];

export const ELM_PROTOCOLS: Readonly<Record<string, ElmProtocol>> = Object.freeze(
  Object.fromEntries(PROTOCOL_LIST.map((p) => [p.id, Object.freeze(p)])),
);

/** Look up a protocol by number ("6", "a", "A6" → protocol 6). */
export function getProtocol(id: string): ElmProtocol | undefined {
  const normalized = id.trim().toUpperCase();
  const bare = normalized.length === 2 && normalized.startsWith('A') ? normalized[1] : normalized;
  return bare === undefined ? undefined : ELM_PROTOCOLS[bare];
}

/**
 * Validate a configured `AT SP` argument: "0" (automatic), "1"–"C", or "A1"–"AC"
 * (automatic search starting with the given protocol). Returns the `AT SP` argument,
 * upper-cased. The config also allows the "try this one, else search" suffix form ("6A" →
 * "A6") and "A0" / "0A", which are plain automatic ("0").
 *
 * @throws RangeError for anything else.
 */
export function normalizeProtocolSetting(protocol: string): string {
  const value = protocol.trim().toUpperCase();
  if (/^[0-9A-C]$/.test(value)) return value;
  const auto = /^A([0-9A-C])$/.exec(value) ?? /^([0-9A-C])A$/.exec(value);
  const start = auto?.[1];
  if (start !== undefined) return start === '0' ? '0' : `A${start}`;
  throw new RangeError(
    `Invalid OBD protocol ${JSON.stringify(protocol)} (expected 0 for automatic, 1–9 or A–C)`,
  );
}

/** Service 01 requests carry up to six PIDs on CAN (ISO 15765-4) and one on legacy buses. */
export function maxPidsPerRequest(family: ProtocolFamily): number {
  return family === 'legacy' ? 1 : 6;
}

/**
 * Guess the framing from the first response to `0100` when the adapter cannot report its
 * protocol number (some clones answer `AT DPN` with "?" or "0"). Only possible with headers
 * visible: an 11-bit CAN id is three hex digits, a 29-bit id is four bytes starting 18 DA, a
 * legacy header is three bytes before the answer. Without headers ("41 00 BE 3F A8 13", which
 * CAN and legacy buses print alike) the framing is unknown: null.
 */
export function inferFamily(lines: readonly string[]): ProtocolFamily | null {
  for (const line of lines) {
    const tokens = line.trim().toUpperCase().split(/\s+/);
    const compact = tokens.join('');
    if (!/^[0-9A-F]+$/.test(compact) || compact.length < 6) continue;
    // The bare answer (service 41, PID 00, four bitmap bytes): no header to go by.
    if (/^4100[0-9A-F]{8}$/.test(compact)) return null;
    if (tokens.length > 1) {
      if (tokens[0]?.length === 3) return 'can11';
      if (tokens[0] === '18' && (tokens[1] === 'DA' || tokens[1] === 'DB')) return 'can29';
      return 'legacy';
    }
    if (compact.length % 2 === 1) return 'can11';
    if (compact.startsWith('18DA') || compact.startsWith('18DB')) return 'can29';
    return 'legacy';
  }
  return null;
}

/**
 * The framing named by an `AT DP` description ("AUTO, ISO 15765-4 (CAN 11/500)",
 * "SAE J1939 (CAN 29/250)", "ISO 9141-2" …), or null when it names no protocol ("AUTO").
 */
export function familyFromDescription(description: string | null): ProtocolFamily | null {
  if (!description) return null;
  const text = description.toUpperCase();
  if (/15765|J1939|CAN/.test(text)) return /\b29\b|J1939/.test(text) ? 'can29' : 'can11';
  if (/J1850|9141|14230|KWP|PWM|VPW/.test(text)) return 'legacy';
  return null;
}
