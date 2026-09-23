/**
 * Typed errors for everything that can go wrong between the HUD and the vehicle: adapter
 * status messages (ELM327 datasheet "Messages and Errors"), ECU negative responses, and
 * link-level failures (timeouts, disconnects).
 */

export const ELM_ERROR_CODES = [
  /** "?" — the adapter did not understand the command (common on clones for optional ATs). */
  'UNSUPPORTED',
  /** The vehicle did not answer the first request (NO DATA during initialisation). */
  'NO_RESPONSE',
  /** "UNABLE TO CONNECT" — no supported protocol found (ignition off, wrong protocol). */
  'UNABLE_TO_CONNECT',
  /** "BUS INIT: ...ERROR" — ISO 9141 / KWP initialisation failed. */
  'BUS_INIT_ERROR',
  /** "CAN ERROR" — the CAN controller could not send or receive (bus off, wrong bit rate). */
  'CAN_ERROR',
  /** "BUS ERROR" — invalid signal on the bus (wiring, short). */
  'BUS_ERROR',
  /** "BUS BUSY" — too much activity to insert a message. */
  'BUS_BUSY',
  /** "FB ERROR" — J1850 feedback error (output does not match input). */
  'FB_ERROR',
  /** "BUFFER FULL" — the adapter's receive buffer overflowed (host reading too slowly). */
  'BUFFER_FULL',
  /** "STOPPED" — the request was interrupted by a character from the host. */
  'STOPPED',
  /** "<DATA ERROR" / "DATA ERROR" — corrupt response (checksum/CRC mismatch). */
  'DATA_ERROR',
  /** "<RX ERROR" — CAN receive error. */
  'RX_ERROR',
  /** "ACT ALERT" — no bus activity; the adapter is about to enter low-power mode. */
  'ACT_ALERT',
  /** "LP ALERT" — low-power mode is about to be entered. */
  'LP_ALERT',
  /** "LV RESET" — the adapter reset itself after a supply voltage dip. */
  'LV_RESET',
  /** The adapter's identification banner appeared unexpectedly: it reset and lost its settings. */
  'ADAPTER_RESET',
  /** "ERRnn" — internal adapter error. */
  'INTERNAL_ERROR',
  /** The ECU answered with a negative response (0x7F service NRC). */
  'NEGATIVE_RESPONSE',
  /** The response could not be parsed. */
  'MALFORMED',
  /** No prompt within the command timeout. */
  'TIMEOUT',
  /** After a timeout the adapter could not be brought back in step with the host. */
  'DESYNC',
  /** The link (transport) is closed. */
  'CLOSED',
] as const;

export type ElmErrorCode = (typeof ELM_ERROR_CODES)[number];

export interface ElmErrorDetails {
  command?: string | null;
  response?: readonly string[];
  /** Negative response code, for NEGATIVE_RESPONSE. */
  nrc?: number | null;
  cause?: unknown;
}

export class ElmError extends Error {
  readonly code: ElmErrorCode;
  /** The command that failed, when known. */
  readonly command: string | null;
  /** The cleaned response lines that caused the error. */
  readonly response: readonly string[];
  readonly nrc: number | null;

  constructor(code: ElmErrorCode, message: string, details: ElmErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'ElmError';
    this.code = code;
    this.command = details.command ?? null;
    this.response = details.response ?? [];
    this.nrc = details.nrc ?? null;
  }
}

export function isElmError(err: unknown, code?: ElmErrorCode): err is ElmError {
  return err instanceof ElmError && (code === undefined || err.code === code);
}

const LINK_FATAL: ReadonlySet<ElmErrorCode> = new Set([
  'CLOSED',
  'DESYNC',
  'ADAPTER_RESET',
  'LV_RESET',
]);

/** Errors after which the adapter session is unusable and must be re-established. */
export function isLinkFatal(err: unknown): boolean {
  return err instanceof ElmError && LINK_FATAL.has(err.code);
}

const VEHICLE_SILENCE: ReadonlySet<ElmErrorCode> = new Set([
  'UNABLE_TO_CONNECT',
  'BUS_INIT_ERROR',
  'CAN_ERROR',
  'BUS_ERROR',
  'FB_ERROR',
  'NO_RESPONSE',
]);

/**
 * Errors that mean "the adapter is fine but nothing on the vehicle side answered", which is
 * what an ELM327 reports once the ignition is switched off.
 */
export function isVehicleSilence(err: unknown): boolean {
  return err instanceof ElmError && VEHICLE_SILENCE.has(err.code);
}

/** ISO 14229 / ISO 15765 negative response codes seen from OBD ECUs. */
const NRC_TEXT: Readonly<Record<number, string>> = {
  0x10: 'general reject',
  0x11: 'service not supported',
  0x12: 'sub-function not supported',
  0x13: 'incorrect message length or format',
  0x14: 'response too long',
  0x21: 'busy, repeat request',
  0x22: 'conditions not correct',
  0x24: 'request sequence error',
  0x31: 'request out of range',
  0x33: 'security access denied',
  0x72: 'general programming failure',
  0x78: 'response pending',
  0x7e: 'sub-function not supported in active session',
  0x7f: 'service not supported in active session',
};

/** Describe a negative response code, e.g. 0x22 → "conditions not correct (0x22)". */
export function describeNrc(nrc: number): string {
  const hex = `0x${nrc.toString(16).toUpperCase().padStart(2, '0')}`;
  const text = NRC_TEXT[nrc];
  return text ? `${text} (${hex})` : `negative response ${hex}`;
}
