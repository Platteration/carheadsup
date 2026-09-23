/** Hex helpers shared by the driver, the parsers and the emulator. */

const HEX_RE = /^[0-9A-Fa-f]*$/;

/** True when `text` is a non-empty string of hex digits (no separators). */
export function isHex(text: string): boolean {
  return text.length > 0 && HEX_RE.test(text);
}

/** Two upper-case hex digits for a byte. */
export function hexByte(value: number): string {
  return (value & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

/** Upper-case hex of every byte, joined by `separator`. */
export function bytesToHex(bytes: ArrayLike<number>, separator = ''): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) parts.push(hexByte(bytes[i] ?? 0));
  return parts.join(separator);
}

/**
 * Parse an even-length hex string (whitespace ignored) into bytes.
 * @throws RangeError when the text is not whole bytes of hex.
 */
export function hexToBytes(text: string): Uint8Array {
  const compact = text.replace(/\s+/g, '');
  if (compact.length % 2 !== 0 || !HEX_RE.test(compact)) {
    throw new RangeError(`Not a whole number of hex bytes: ${JSON.stringify(text)}`);
  }
  const out = new Uint8Array(compact.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Concatenate byte arrays. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
