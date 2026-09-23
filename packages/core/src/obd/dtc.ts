import type { DtcInfo } from '../types/vehicle.ts';
import { notImplemented } from '../todo.ts';

/**
 * Decode the two raw bytes of a DTC into its five-character form (SAE J2012),
 * e.g. [0x04, 0x20] → "P0420", [0xC1, 0x00] → "U0100". Returns null for 0x0000 padding.
 */
export function decodeDtcBytes(a: number, b: number): string | null {
  return notImplemented(`decodeDtcBytes(${a}, ${b})`);
}

/**
 * Parse the data bytes of a service 03 / 07 / 0A response, i.e. everything AFTER the
 * response service byte (0x43 / 0x47 / 0x4A), already reassembled across frames.
 * On CAN (ISO 15765) the first byte is the DTC count; on legacy protocols there is no
 * count byte and codes are padded with 0x0000. Duplicates are removed, order preserved.
 */
export function parseDtcPayload(data: Uint8Array, opts: { hasCountByte: boolean }): string[] {
  return notImplemented(`parseDtcPayload(${data.length}, ${opts.hasCountByte})`);
}

/** True for syntactically valid codes like "P0420", "C1234", "U0100". */
export function isValidDtc(code: string): boolean {
  return notImplemented(`isValidDtc(${code})`);
}

/**
 * Human-friendly information about a code. Unknown codes still return a useful result
 * synthesised from the code's system and range (e.g. "P03xx → Ignition system / misfire").
 */
export function lookupDtc(code: string): DtcInfo {
  return notImplemented(`lookupDtc(${code})`);
}
