/**
 * Frame-level parsing: turns the data lines of an OBD response into one complete message per
 * ECU (and per response), for every framing an ELM327 can print:
 *
 *  - ISO 15765-4 CAN, 11-bit ids, headers on:   `7E8 06 41 00 BE 3F A8 13`
 *  - ISO 15765-4 CAN, 29-bit ids, headers on:   `18 DA F1 10 06 41 00 BE 3F A8 13`
 *    (multi-frame ISO-TP: `7E8 10 14 49 02 01 …` first frame, `7E8 21 …` consecutive frames)
 *  - CAN, headers off (no id, no PCI byte):     `41 00 BE 3F A8 13`, or for multi-frame
 *    `014` (total length, hex) followed by `0: 49 02 01 …`, `1: …` segments
 *  - ISO 9141-2 / ISO 14230-4 KWP / SAE J1850, headers on: 3-byte header, data, checksum:
 *    `48 6B 10 41 00 BE 3F A8 13 C4`; KWP may use a 4-byte header with a length byte.
 *    Multi-line replies (service 03, 09) are concatenated per ECU.
 *  - legacy, headers off: data only.
 *
 * Spaces are optional everywhere (`AT S0`). Frames that do not fit their framing are dropped;
 * callers treat "lines but no messages" as a malformed response, and {@link parseEcuResponse}
 * counts what was dropped so that callers needing every ECU's complete answer (trouble codes)
 * can tell a partial answer from a complete one.
 */
import { concatBytes, hexToBytes } from './hex.ts';
import type { ProtocolFamily } from './protocols.ts';

export interface EcuMessage {
  /**
   * The responding ECU: CAN id ("7E8", "18DAF110"), the legacy source address ("10"),
   * or null when headers are off and responders cannot be told apart.
   */
  ecu: string | null;
  /** Complete service payload starting with the response service id (0x41, 0x43 …, or 0x7F). */
  data: Uint8Array;
}

export interface FrameParseOptions {
  family: ProtocolFamily;
  /** Whether the adapter prints headers (`AT H1`). */
  headers: boolean;
}

export interface ParsedResponse {
  messages: EcuMessage[];
  /**
   * Lines or messages that had to be discarded: unparseable lines, frames that do not fit the
   * framing, and multi-frame messages with missing or garbled parts (flow-control frames do not
   * count). Non-zero means some ECU's answer may be incomplete or missing.
   */
  dropped: number;
}

interface RawFrame {
  ecu: string | null;
  bytes: Uint8Array;
}

const HEX_LINE_RE = /^[0-9A-F]+$/;
const LENGTH_LINE_RE = /^[0-9A-F]{3}$/;
const SEGMENT_LINE_RE = /^([0-9A-F]):([0-9A-F]*)$/;

const compact = (line: string): string => line.replace(/\s+/g, '').toUpperCase();

/** Decode hex into bytes, or null for odd-length / non-hex text. */
function tryBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !HEX_LINE_RE.test(hex)) return null;
  return hexToBytes(hex);
}

/**
 * Parse data lines into per-ECU messages, sorted by ECU (null last), preserving the order of
 * messages from the same ECU.
 */
export function parseEcuMessages(
  lines: readonly string[],
  options: FrameParseOptions,
): EcuMessage[] {
  return parseEcuResponse(lines, options).messages;
}

/** {@link parseEcuMessages}, also reporting how much of the response had to be dropped. */
export function parseEcuResponse(
  lines: readonly string[],
  options: FrameParseOptions,
): ParsedResponse {
  const cleaned = lines.map(compact).filter((line) => line.length > 0);
  if (options.headers) {
    const split = splitHeaderFrames(cleaned, options.family);
    const assembled = assemble(split.frames, options.family);
    // A clone that ignored AT H1 prints headerless lines. On CAN those are recognisable (no
    // id, no PCI byte), so fall back to them; legacy lines look the same either way.
    if (assembled.messages.length > 0 || options.family === 'legacy') {
      return { messages: assembled.messages, dropped: split.dropped + assembled.dropped };
    }
  }
  return parseHeaderless(cleaned, options.family);
}

// ---------------------------------------------------------------------------------------------
// Headers on
// ---------------------------------------------------------------------------------------------

function splitHeaderFrames(
  lines: readonly string[],
  family: ProtocolFamily,
): { frames: RawFrame[]; dropped: number } {
  const frames: RawFrame[] = [];
  let dropped = 0;
  for (const line of lines) {
    const frame = !HEX_LINE_RE.test(line)
      ? null
      : family === 'legacy'
        ? legacyHeaderFrame(line)
        : canHeaderFrame(line, family);
    if (frame) frames.push(frame);
    else dropped += 1;
  }
  return { frames, dropped };
}

function canHeaderFrame(line: string, family: 'can11' | 'can29'): RawFrame | null {
  const headerLength = family === 'can11' ? 3 : 8;
  if (line.length < headerLength + 2) return null;
  const bytes = tryBytes(line.slice(headerLength));
  if (!bytes || !isValidPci(bytes)) return null;
  return { ecu: line.slice(0, headerLength), bytes };
}

/** A CAN frame must start with a plausible ISO-TP protocol control information byte. */
function isValidPci(bytes: Uint8Array): boolean {
  const pci = bytes[0] ?? 0;
  switch (pci >> 4) {
    case 0: {
      const length = pci & 0x0f;
      if (length === 0) return bytes.length >= 2 && (bytes[1] ?? 0) > 0; // CAN FD escape
      return length <= 7 && bytes.length >= 1 + length;
    }
    case 1:
      return bytes.length >= 3;
    case 2:
      return bytes.length >= 2;
    case 3:
      return true; // flow control: valid, ignored
    default:
      return false;
  }
}

function legacyHeaderFrame(line: string): RawFrame | null {
  const bytes = tryBytes(line);
  // Header (3) + service id (1) + checksum (1) at minimum.
  if (!bytes || bytes.length < 5) return null;
  const format = bytes[0] ?? 0;
  const ecu = (bytes[2] ?? 0).toString(16).toUpperCase().padStart(2, '0');
  // ISO 14230 (KWP) format byte: bit 7 = address information present, bits 5–0 = length;
  // a zero length means a separate length byte follows the addresses (4-byte header).
  if ((format & 0x80) !== 0) {
    const inlineLength = format & 0x3f;
    const headerLength = inlineLength === 0 ? 4 : 3;
    const length = inlineLength === 0 ? (bytes[3] ?? 0) : inlineLength;
    if (length > 0 && bytes.length >= headerLength + length) {
      return { ecu, bytes: bytes.slice(headerLength, headerLength + length) };
    }
  }
  return { ecu, bytes: bytes.slice(3, bytes.length - 1) };
}

function assemble(frames: readonly RawFrame[], family: ProtocolFamily): ParsedResponse {
  const byEcu = new Map<string | null, Uint8Array[]>();
  for (const frame of frames) {
    const list = byEcu.get(frame.ecu);
    if (list) list.push(frame.bytes);
    else byEcu.set(frame.ecu, [frame.bytes]);
  }
  const messages: EcuMessage[] = [];
  let dropped = 0;
  for (const ecu of sortEcus([...byEcu.keys()])) {
    const list = byEcu.get(ecu) ?? [];
    const assembled = family === 'legacy' ? assembleLegacy(list) : assembleIsoTp(list);
    for (const data of assembled.payloads) messages.push({ ecu, data });
    dropped += assembled.dropped;
  }
  return { messages, dropped };
}

function sortEcus(ecus: Array<string | null>): Array<string | null> {
  return ecus.sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a < b ? -1 : 1;
  });
}

interface PendingIsoTp {
  total: number;
  first: Uint8Array;
  consecutive: Array<{ seq: number; data: Uint8Array }>;
}

interface Assembled {
  payloads: Uint8Array[];
  dropped: number;
}

/** Reassemble ISO 15765-2 frames (PCI byte first) from one ECU into complete payloads. */
function assembleIsoTp(frames: readonly Uint8Array[]): Assembled {
  const out: Uint8Array[] = [];
  let dropped = 0;
  let pending: PendingIsoTp | null = null;
  const flush = (): void => {
    if (pending) {
      const payload = finishSegments(pending.total, pending.first, pending.consecutive);
      if (payload) out.push(payload);
      else dropped += 1;
    }
    pending = null;
  };

  for (const frame of frames) {
    const pci = frame[0] ?? 0;
    switch (pci >> 4) {
      case 0: {
        flush();
        const escaped = (pci & 0x0f) === 0;
        const length = escaped ? (frame[1] ?? 0) : pci & 0x0f;
        const start = escaped ? 2 : 1;
        const data = frame.slice(start, start + length);
        if (length > 0 && data.length === length) out.push(data);
        else dropped += 1;
        break;
      }
      case 1: {
        flush();
        const total = ((pci & 0x0f) << 8) | (frame[1] ?? 0);
        if (total > 0) pending = { total, first: frame.slice(2), consecutive: [] };
        else dropped += 1;
        break;
      }
      case 2:
        // A consecutive frame without its first frame cannot be placed; drop it.
        if (pending) pending.consecutive.push({ seq: pci & 0x0f, data: frame.slice(1) });
        else dropped += 1;
        break;
      default:
        break; // flow control frames carry no data
    }
  }
  flush();
  return { payloads: out, dropped };
}

/**
 * Join a first frame / first segment with its continuation segments. Segments normally arrive
 * in order (sequence 1, 2 … F, 0, 1 …); when they do not and there are at most 15 of them the
 * sequence numbers are unique, so they are sorted. Missing segments drop the message.
 */
function finishSegments(
  total: number,
  first: Uint8Array,
  segments: ReadonlyArray<{ seq: number; data: Uint8Array }>,
): Uint8Array | null {
  let ordered = [...segments];
  const inOrder = ordered.every((s, i) => s.seq === ((i + 1) & 0x0f));
  if (!inOrder) {
    if (ordered.length > 15) return null;
    ordered = ordered.sort((a, b) => a.seq - b.seq);
    if (!ordered.every((s, i) => s.seq === i + 1)) return null;
  }
  const joined = concatBytes([first, ...ordered.map((s) => s.data)]);
  // Without a length line (some clones) the message ends where the segments end.
  if (!Number.isFinite(total)) return joined;
  if (joined.length < total) return null;
  return joined.slice(0, total);
}

/** Services whose legacy multi-line responses are one list split across frames. */
const LEGACY_DTC_SERVICES: ReadonlySet<number> = new Set([0x43, 0x47, 0x4a]);

/**
 * Combine the frames one legacy (non-CAN) ECU sent. DTC responses repeat the service byte on
 * every frame and are concatenated without a count byte; service 09 responses carry a
 * sequence byte after the PID ("49 02 01 …", "49 02 02 …") and are ordered by it; anything
 * else is one message per frame.
 */
function assembleLegacy(frames: readonly Uint8Array[]): Assembled {
  const groups = new Map<number, Uint8Array[]>();
  let dropped = 0;
  for (const frame of frames) {
    const sid = frame[0];
    if (sid === undefined) {
      dropped += 1;
      continue;
    }
    const list = groups.get(sid);
    if (list) list.push(frame);
    else groups.set(sid, [frame]);
  }
  const out: Uint8Array[] = [];
  for (const [sid, list] of groups) {
    if (LEGACY_DTC_SERVICES.has(sid)) {
      out.push(concatBytes([Uint8Array.of(sid), ...list.map((f) => f.slice(1))]));
    } else if (sid === 0x49 && list.length > 1) {
      const merged = mergeLegacySequence(list);
      if (merged) out.push(merged);
      else dropped += list.length;
    } else {
      out.push(...list);
    }
  }
  return { payloads: out, dropped };
}

function mergeLegacySequence(frames: readonly Uint8Array[]): Uint8Array | null {
  const sorted = [...frames].sort((a, b) => (a[2] ?? 0) - (b[2] ?? 0));
  if (!sorted.every((f, i) => f.length >= 3 && f[2] === i + 1)) return null;
  const head = sorted[0];
  if (!head) return null;
  return concatBytes([head.slice(0, 2), ...sorted.map((f) => f.slice(3))]);
}

// ---------------------------------------------------------------------------------------------
// Headers off
// ---------------------------------------------------------------------------------------------

function parseHeaderless(lines: readonly string[], family: ProtocolFamily): ParsedResponse {
  if (family === 'legacy') {
    const frames: Uint8Array[] = [];
    let dropped = 0;
    for (const line of lines) {
      const bytes = tryBytes(line);
      if (bytes) frames.push(bytes);
      else dropped += 1;
    }
    const assembled = assembleLegacy(frames);
    return {
      messages: assembled.payloads.map((data) => ({ ecu: null, data })),
      dropped: dropped + assembled.dropped,
    };
  }

  const messages: EcuMessage[] = [];
  let dropped = 0;
  let pending: { total: number; segments: Array<{ seq: number; data: Uint8Array }> } | null = null;
  const flush = (): void => {
    if (pending) {
      const [first, ...rest] = pending.segments;
      const payload =
        first && first.seq === 0 ? finishSegments(pending.total, first.data, rest) : null;
      if (payload) messages.push({ ecu: null, data: payload });
      else dropped += 1;
    }
    pending = null;
  };

  for (const line of lines) {
    if (LENGTH_LINE_RE.test(line)) {
      flush();
      pending = { total: parseInt(line, 16), segments: [] };
      continue;
    }
    const segment = SEGMENT_LINE_RE.exec(line);
    if (segment) {
      const data = tryBytes(segment[2] ?? '');
      // Some clones omit the length line; the message then ends where the segments end.
      pending ??= { total: Number.POSITIVE_INFINITY, segments: [] };
      if (data) pending.segments.push({ seq: parseInt(segment[1] ?? '0', 16), data });
      else dropped += 1;
      continue;
    }
    const bytes = tryBytes(line);
    if (bytes) {
      flush();
      messages.push({ ecu: null, data: bytes });
    } else {
      dropped += 1;
    }
  }
  flush();
  return { messages, dropped };
}
