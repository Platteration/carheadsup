/**
 * Service-level interpretation of assembled ECU messages: splitting multi-PID service 01
 * answers, merging DTC lists across ECUs, decoding the VIN, and extracting negative responses.
 */
import {
  MODE01_PIDS,
  SUPPORTED_PIDS_BASES,
  decodeMode01,
  parseDtcPayload,
  type SignalId,
} from '@carheadsup/core';
import { ElmError } from './errors.ts';
import type { EcuMessage } from './frames.ts';

/**
 * Exact data lengths of service 01 PIDs (SAE J1979), used to split multi-PID answers.
 * Includes PIDs the HUD does not decode so that discovery and custom queries parse too.
 */
export const MODE01_DATA_LENGTHS: ReadonlyMap<number, number> = (() => {
  const lengths = new Map<number, number>();
  for (const base of SUPPORTED_PIDS_BASES) lengths.set(base, 4);
  const extra: ReadonlyArray<[number, number]> = [
    [0x01, 4], // monitor status
    [0x02, 2], // freeze-frame DTC
    [0x03, 2], // fuel system status
    [0x12, 1], // commanded secondary air
    [0x13, 1], // O2 sensors present
    [0x1c, 1], // OBD standard
    [0x1d, 1], // O2 sensors present (4 banks)
    [0x1e, 1], // auxiliary input status
    [0x22, 2], // fuel rail pressure (relative to vacuum)
    [0x2c, 1], // commanded EGR
    [0x2d, 1], // EGR error
    [0x2e, 1], // commanded evaporative purge
    [0x30, 1], // warm-ups since codes cleared
    [0x32, 2], // evap system vapour pressure
    [0x41, 4], // monitor status this drive cycle
    [0x47, 1],
    [0x48, 1],
    [0x4a, 1],
    [0x4b, 1],
    [0x4c, 1],
    [0x4d, 2],
    [0x4e, 2],
    [0x51, 1], // fuel type
    [0x53, 2],
    [0x59, 2],
    [0x5a, 1],
    [0x5b, 1],
    [0x5d, 2],
    [0x5f, 1],
    [0x61, 1],
    [0x62, 1],
    [0x63, 2],
  ];
  for (const [pid, length] of extra) lengths.set(pid, length);
  for (let pid = 0x14; pid <= 0x1b; pid++) lengths.set(pid, 2); // O2 sensor voltage + trim
  for (let pid = 0x24; pid <= 0x2b; pid++) lengths.set(pid, 4); // wide-band O2 (λ + V)
  for (let pid = 0x34; pid <= 0x3b; pid++) lengths.set(pid, 4); // wide-band O2 (λ + mA)
  for (let pid = 0x3c; pid <= 0x3f; pid++) lengths.set(pid, 2); // catalyst temperatures
  for (const def of MODE01_PIDS) lengths.set(def.pid, def.bytes);
  return lengths;
})();

/**
 * PIDs whose answer length varies by engine: fuel trims 0x06–0x09 append a bank 3/4 byte on
 * some engines. In a multi-PID request they must be the last PID so their length is "the rest".
 */
export const VARIABLE_LENGTH_PIDS: ReadonlySet<number> = new Set([0x06, 0x07, 0x08, 0x09]);

/**
 * Split one ECU's service 01 answer (`data` starting with 0x41) into per-PID data bytes.
 * ECUs answer only the PIDs they support, in request order; parsing stops at the first byte
 * that is not an outstanding requested PID (e.g. padding) or when the data runs out.
 */
export function splitMode01Payload(
  data: Uint8Array,
  requested: readonly number[],
): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  if (data[0] !== 0x41) return out;
  const outstanding = new Set(requested);
  let i = 1;
  while (i < data.length) {
    const pid = data[i];
    if (pid === undefined || !outstanding.has(pid)) break;
    outstanding.delete(pid);
    const known = MODE01_DATA_LENGTHS.get(pid);
    let length: number;
    if (outstanding.size === 0 && (requested.length === 1 || known === undefined)) {
      length = data.length - i - 1; // single PID or unknown last PID: everything left
    } else if (VARIABLE_LENGTH_PIDS.has(pid) && outstanding.size === 0) {
      length = Math.min(data.length - i - 1, (known ?? 1) + 1);
    } else if (known !== undefined) {
      length = known;
    } else {
      break; // unknown length in the middle of an answer: cannot continue safely
    }
    const bytes = data.slice(i + 1, i + 1 + length);
    if (bytes.length < length || length <= 0) break;
    out.set(pid, bytes);
    i += 1 + length;
  }
  return out;
}

export interface Mode01Answer {
  ecu: string | null;
  data: Uint8Array;
}

export interface Mode01Result {
  /** Raw data bytes per answered PID, one entry per answering ECU (ECU order). */
  answers: Map<number, Mode01Answer[]>;
  /** Decoded canonical values; when several ECUs answer a PID the first ECU's value wins. */
  values: Partial<Record<SignalId, number>>;
  /**
   * Some of the response had to be dropped — typically a multi-frame answer that lost its
   * consecutive frames (a clone without working ISO-TP flow control) while another ECU's
   * single-frame answer came through — so PIDs missing from `answers` may have been answered.
   */
  incomplete?: boolean;
}

/** Collect a service 01 response from all ECUs. */
export function collectMode01(
  messages: readonly EcuMessage[],
  requested: readonly number[],
): Mode01Result {
  const answers = new Map<number, Mode01Answer[]>();
  const values: Partial<Record<SignalId, number>> = {};
  for (const message of messages) {
    for (const [pid, data] of splitMode01Payload(message.data, requested)) {
      const list = answers.get(pid);
      const answer = { ecu: message.ecu, data };
      if (list) list.push(answer);
      else answers.set(pid, [answer]);
      const decoded = decodeMode01(pid, data);
      if (!decoded) continue;
      for (const [signal, value] of Object.entries(decoded) as Array<[SignalId, number]>) {
        if (values[signal] === undefined && Number.isFinite(value)) values[signal] = value;
      }
    }
  }
  return { answers, values };
}

/** Positive responses to `service` (i.e. messages starting with service + 0x40). */
export function positiveResponses(messages: readonly EcuMessage[], service: number): EcuMessage[] {
  return messages.filter((m) => m.data[0] === service + 0x40);
}

/**
 * Whether every message answers `service`: a positive response (echoing one of `pids`, when
 * given) or a negative response to that service. Anything else is the answer to a different
 * request, i.e. the adapter's replies are out of step with the commands.
 */
export function answersRequest(
  messages: readonly EcuMessage[],
  service: number,
  pids?: readonly number[],
): boolean {
  return messages.every((m) => {
    if (m.data[0] === 0x7f) return m.data[1] === service;
    if (m.data[0] !== service + 0x40) return false;
    const pid = m.data[1];
    return pids === undefined || (pid !== undefined && pids.includes(pid));
  });
}

/**
 * Negative response codes after which asking again may well succeed: the control unit has an
 * answer but could not give it now. Other refusals (service not supported, request out of
 * range …) are permanent, so retrying would fail forever; they mean that unit reports nothing.
 */
const TRANSIENT_NRCS: ReadonlySet<number> = new Set([
  0x10, // general reject
  0x21, // busy, repeat request
  0x22, // conditions not correct
  0x78, // response pending — and the answer never came
]);

/**
 * The control unit whose answer to `service` is missing although it responded: it refused
 * with a transient negative response (busy, conditions not correct, "response pending" not
 * followed by the answer …) and sent no positive response. Null when every responder answered.
 */
export function transientRefusal(
  messages: readonly EcuMessage[],
  service: number,
): { ecu: string | null; nrc: number } | null {
  const answered = new Set(positiveResponses(messages, service).map((m) => m.ecu));
  for (const m of messages) {
    if (m.data[0] !== 0x7f || m.data[1] !== service) continue;
    const nrc = m.data[2] ?? 0;
    if (!TRANSIENT_NRCS.has(nrc)) continue;
    // "Response pending" followed by the answer. Without headers the answer cannot be tied to
    // the unit that asked for patience, so any answer is taken to be it.
    if (nrc === 0x78 && answered.has(m.ecu)) continue;
    return { ecu: m.ecu, nrc };
  }
  return null;
}

/**
 * The first negative response code for `service`, ignoring "response pending" (0x78), which
 * an ECU sends before its real answer.
 */
export function negativeResponseCode(
  messages: readonly EcuMessage[],
  service: number,
): number | null {
  for (const m of messages) {
    if (m.data[0] === 0x7f && m.data[1] === service && m.data[2] !== 0x78) {
      return m.data[2] ?? null;
    }
  }
  return null;
}

/**
 * Trouble codes from a service 03 / 07 / 0A response, merged across ECUs in ECU order
 * without duplicates. CAN responses start with a count byte; legacy ones do not.
 */
export function collectDtcs(
  messages: readonly EcuMessage[],
  service: 0x03 | 0x07 | 0x0a,
  hasCountByte: boolean,
): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const message of positiveResponses(messages, service)) {
    for (const code of parseDtcPayload(message.data.slice(1), { hasCountByte })) {
      if (!seen.has(code)) {
        seen.add(code);
        codes.push(code);
      }
    }
  }
  return codes;
}

/** A complete VIN: 17 characters, letters I, O and Q excluded (ISO 3779). */
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

/**
 * Decode the VIN from a service 09 PID 02 response. CAN answers carry a "number of data
 * items" byte before the 17 ASCII characters; legacy answers are padded with leading zero
 * bytes. Anything that is not a VIN character is discarded and the last 17 kept. Returns null
 * when no control unit reports a VIN (e.g. an unprogrammed one answering with zero bytes).
 *
 * @throws ElmError MALFORMED when the only VIN answers are incomplete or invalid (e.g. a lost
 * line of a multi-line legacy answer), so the caller can retry instead of keeping it.
 */
export function decodeVin(messages: readonly EcuMessage[]): string | null {
  let partial: string | null = null;
  for (const message of positiveResponses(messages, 0x09)) {
    if (message.data[1] !== 0x02) continue;
    let text = '';
    for (const byte of message.data.slice(2)) {
      const ch = String.fromCharCode(byte).toUpperCase();
      if (/[A-Z0-9]/.test(ch)) text += ch;
    }
    if (text.length === 0) continue;
    const vin = text.length > 17 ? text.slice(-17) : text;
    if (VIN_RE.test(vin)) return vin;
    partial ??= vin;
  }
  if (partial !== null) {
    throw new ElmError('MALFORMED', `Incomplete or invalid VIN "${partial}"`, { command: '0902' });
  }
  return null;
}
