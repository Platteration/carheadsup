/**
 * Pure helpers for reading a CAN bus through can-utils' `candump` and checking the interface
 * with iproute2's `ip -details link show`.
 *
 * `candump -L` prints one frame per line in the log-file format:
 *
 *     (1690000000.123456) can0 5C1#0100000000000000       classic frame, 11-bit id
 *     (1690000000.123456) can0 18FF1234#01               classic frame, 29-bit id
 *     (1690000000.123456) can0 5C1#R                     remote request (no data)
 *     (1690000000.123456) can0 5C1#1122334455667788_E    classic frame with a raw DLC > 8
 *     (1690000000.123456) can0 5C1##1112233              CAN FD: "##", a flags nibble, data
 *
 * Standard ids have 3 hex digits and extended ids 8, exactly as `sensors.canButtons.rules[].id`
 * is written. Filters on the command line (`<ifname>,<id>:<mask>,…`) let the kernel drop every
 * other frame, which matters on a bus carrying thousands of frames per second.
 */
import { formatCanId, type CanId } from '@carheadsup/core';

export interface CanFrame {
  /** Interface the frame arrived on, e.g. "can0". */
  iface: string;
  /** Kernel receive time as candump printed it, in seconds since the epoch. */
  timestamp: number;
  id: number;
  extended: boolean;
  /** A CAN FD frame ("##" syntax). */
  fd: boolean;
  /** A remote-transmission request: carries no data. */
  remote: boolean;
  data: readonly number[];
}

const LOG_LINE = /^\s*\((\d+(?:\.\d+)?)\)\s+(\S+)\s+(\S+)(?:\s+\S+)*\s*$/;
const CLASSIC =
  /^([0-9A-Fa-f]{3}|[0-9A-Fa-f]{8})#(?:(R[0-9A-Fa-f]?)|([0-9A-Fa-f.]*?)(?:_[0-9A-Fa-f])?)$/;
const FD = /^([0-9A-Fa-f]{3}|[0-9A-Fa-f]{8})##([0-9A-Fa-f])([0-9A-Fa-f.]*)$/;

const MAX_ID = { standard: 0x7ff, extended: 0x1fffffff } as const;

function parseId(hex: string): CanId | null {
  const id = Number.parseInt(hex, 16);
  const extended = hex.length === 8;
  // Error frames carry CAN_ERR_FLAG in the id (e.g. 20000080) and are not button frames.
  return id <= (extended ? MAX_ID.extended : MAX_ID.standard) ? { id, extended } : null;
}

function parseData(hex: string, maxBytes: number): number[] | null {
  const digits = hex.replace(/\./g, '');
  if (digits.length % 2 !== 0 || digits.length / 2 > maxBytes) return null;
  const bytes: number[] = [];
  for (let i = 0; i < digits.length; i += 2)
    bytes.push(Number.parseInt(digits.slice(i, i + 2), 16));
  return bytes;
}

/**
 * Parse one line of `candump -L` output. Null for anything that is not a classic or FD frame
 * with a valid id and payload (error frames, CAN XL frames, stray text).
 */
export function parseCandumpLine(line: string): CanFrame | null {
  const match = LOG_LINE.exec(line);
  if (match === null) return null;
  const [, stamp = '', iface = '', token = ''] = match;
  const timestamp = Number(stamp);
  const fd = FD.exec(token);
  if (fd !== null) {
    const id = parseId(fd[1] ?? '');
    const data = parseData(fd[3] ?? '', 64);
    if (id === null || data === null) return null;
    return { iface, timestamp, ...id, fd: true, remote: false, data };
  }
  const classic = CLASSIC.exec(token);
  if (classic === null) return null;
  const id = parseId(classic[1] ?? '');
  if (id === null) return null;
  if (classic[2] !== undefined) {
    return { iface, timestamp, ...id, fd: false, remote: true, data: [] };
  }
  const data = parseData(classic[3] ?? '', 8);
  if (data === null) return null;
  return { iface, timestamp, ...id, fd: false, remote: false, data };
}

/** CAN_EFF_FLAG | CAN_RTR_FLAG: part of every filter mask, so a filter matches only data frames of its own format. */
const FORMAT_FLAGS = 0xc0000000;

/**
 * A candump filter that passes exactly the data frames with this id. candump sets
 * CAN_EFF_FLAG on filter ids written with 8 digits; the mask includes the EFF and RTR flags, so
 * an 11-bit filter does not also pass 29-bit frames whose low bits happen to match.
 */
export function candumpFilter(canId: CanId): string {
  const idMask = canId.extended ? MAX_ID.extended : MAX_ID.standard;
  const mask = ((FORMAT_FLAGS | idMask) >>> 0).toString(16).toUpperCase();
  return `${formatCanId(canId)}:${mask}`;
}

/**
 * Arguments for `candump`: log format, the interface and one filter per distinct id. candump
 * only ever receives; nothing here makes it transmit.
 */
export function buildCandumpArgs(iface: string, ids: readonly CanId[]): string[] {
  const filters = [...new Set(ids.map(candumpFilter))];
  return ['-L', [iface, ...filters].join(',')];
}

export type CandumpProblem = 'no-device' | 'down' | 'no-can-support' | 'permission' | 'other';

/** Explain a candump failure from its stderr, with a hint for the log. */
export function classifyCandumpError(
  stderr: readonly string[],
  iface: string,
): { kind: CandumpProblem; hint: string | null } {
  const text = stderr.join('\n');
  if (/no such device|SIOCGIFINDEX/i.test(text)) {
    return {
      kind: 'no-device',
      hint: `interface ${iface} does not exist — is the CAN HAT's overlay loaded ("ip link" lists the CAN interfaces)?`,
    };
  }
  if (/network is down/i.test(text)) {
    return { kind: 'down', hint: `interface ${iface} is down — ${bringUpHint(iface, null)}` };
  }
  if (/address family not supported/i.test(text)) {
    return {
      kind: 'no-can-support',
      hint: 'CAN sockets are unavailable — load the "can" kernel module, and allow AF_CAN in the service (RestrictAddressFamilies)',
    };
  }
  if (/permission denied|operation not permitted/i.test(text)) {
    return { kind: 'permission', hint: 'not allowed to open a CAN socket' };
  }
  return { kind: 'other', hint: null };
}

/** The command that brings `iface` up without ever acknowledging or disturbing bus traffic. */
export function bringUpHint(iface: string, bitrate: number | null): string {
  return `bring it up in listen-only mode: "sudo ip link set ${iface} down; sudo ip link set ${iface} up type can bitrate ${bitrate ?? 500000} listen-only on"`;
}

export interface CanLinkInfo {
  /** The interface is administratively up. */
  up: boolean;
  /**
   * 'can' = a CAN controller whose mode `ip` reports; 'virtual' = vcan / vxcan; 'can-unknown' = a
   * CAN link without controller details (e.g. slcan); 'other' = not a CAN link at all.
   */
  kind: 'can' | 'virtual' | 'can-unknown' | 'other';
  /** Controller in listen-only mode; null when not a real CAN controller. */
  listenOnly: boolean | null;
  /** Controller state, e.g. "ERROR-ACTIVE", "BUS-OFF", "STOPPED". */
  state: string | null;
  bitrate: number | null;
}

/**
 * Parse `ip -details link show <iface>`:
 *
 *     3: can0: <NOARP,UP,LOWER_UP,ECHO> mtu 16 qdisc pfifo_fast state UP …
 *         link/can  promiscuity 0 …
 *         can <LISTEN-ONLY> state ERROR-ACTIVE (berr-counter tx 0 rx 0) restart-ms 0
 *               bitrate 500000 sample-point 0.875
 *
 * Null when the output does not describe an interface at all.
 */
export function parseIpLinkDetails(text: string): CanLinkInfo | null {
  const head = /^\s*\d+:\s+[^:\s]+(?:@\S+)?:\s+<([^>]*)>/m.exec(text);
  if (head === null) return null;
  const up = (head[1] ?? '').split(',').includes('UP');
  const controller = /^\s*can\s+(?:<([^>]*)>\s+)?state\s+(\S+)/m.exec(text);
  const bitrate = /\bbitrate\s+(\d+)/.exec(text);
  if (controller !== null) {
    const flags = (controller[1] ?? '').split(',').map((f) => f.trim());
    return {
      up,
      kind: 'can',
      listenOnly: flags.includes('LISTEN-ONLY'),
      state: controller[2] ?? null,
      bitrate: bitrate !== null ? Number(bitrate[1]) : null,
    };
  }
  const kind = /^\s*(?:vcan|vxcan)\b/m.test(text)
    ? 'virtual'
    : /\blink\/can\b/.test(text)
      ? 'can-unknown'
      : 'other';
  return { up, kind, listenOnly: null, state: null, bitrate: null };
}
