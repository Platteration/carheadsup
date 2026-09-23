/**
 * Trouble-code syntax: decoding the raw bytes of service 03/07/0A responses, normalising and
 * validating codes. Deliberately free of the description database, which lives behind
 * `lookupDtc` in `dtc-lookup.ts` (the `@carheadsup/core/dtc` entry point).
 */

/** Maximum length of `DtcInfo.short`, the glanceable HUD label. */
export const DTC_SHORT_MAX_LENGTH = 32;

const DTC_LETTERS = ['P', 'C', 'B', 'U'] as const;
const DTC_PATTERN = /^[PCBU][0-3][0-9A-F]{3}$/;

const isByte = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 0xff;
const hexNibble = (n: number): string => (n & 0x0f).toString(16).toUpperCase();

/**
 * Decode the two raw bytes of a DTC into its five-character form (SAE J2012),
 * e.g. [0x04, 0x20] → "P0420", [0xC1, 0x00] → "U0100". Returns null for 0x0000 padding.
 *
 * Byte A bits 7–6 select the letter (P/C/B/U), bits 5–4 the first digit (0–3) and bits 3–0
 * the second; byte B supplies the last two hex digits.
 *
 * @throws RangeError when either argument is not an integer in 0–255.
 */
export function decodeDtcBytes(a: number, b: number): string | null {
  if (!isByte(a) || !isByte(b)) {
    throw new RangeError(`DTC bytes must be integers in 0–255, got ${a}, ${b}`);
  }
  if (a === 0 && b === 0) return null;
  const letter = DTC_LETTERS[a >> 6] ?? 'P';
  return `${letter}${(a >> 4) & 0x03}${hexNibble(a)}${hexNibble(b >> 4)}${hexNibble(b)}`;
}

/**
 * Parse the data bytes of a service 03 / 07 / 0A response, i.e. everything AFTER the
 * response service byte (0x43 / 0x47 / 0x4A), already reassembled across frames.
 * On CAN (ISO 15765) the first byte is the DTC count; on legacy protocols there is no
 * count byte and codes are padded with 0x0000. Duplicates are removed, order preserved.
 *
 * Tolerant of imperfect responses: a CAN count larger than the codes actually present yields
 * the codes that are present, bytes beyond the counted codes are ignored, 0x0000 pairs are
 * dropped wherever they appear, and a trailing odd byte is ignored.
 */
export function parseDtcPayload(data: Uint8Array, opts: { hasCountByte: boolean }): string[] {
  let start = 0;
  let pairs = Math.floor(data.length / 2);
  if (opts.hasCountByte) {
    if (data.length === 0) return [];
    start = 1;
    pairs = Math.min(data[0] ?? 0, Math.floor((data.length - 1) / 2));
  }

  const codes: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < pairs; i++) {
    const offset = start + i * 2;
    const code = decodeDtcBytes(data[offset] ?? 0, data[offset + 1] ?? 0);
    if (code !== null && !seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }
  return codes;
}

/** Trim and upper-case a code as typed by a person or returned by another tool. */
export function normalizeDtc(code: string): string {
  return code.trim().toUpperCase();
}

/** True for syntactically valid codes like "P0420", "C1234", "U0100" (after trimming/upper-casing). */
export function isValidDtc(code: string): boolean {
  return DTC_PATTERN.test(normalizeDtc(code));
}
