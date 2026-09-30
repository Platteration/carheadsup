/**
 * A minimal DER (ASN.1 Distinguished Encoding Rules, X.690) encoder: just what a self-signed
 * X.509 certificate needs. Every function returns the complete encoding (tag, length, content)
 * of one value; constructed values take already encoded children.
 */

/** Universal tags used here. */
export const DER_TAG = {
  boolean: 0x01,
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  null: 0x05,
  oid: 0x06,
  utf8String: 0x0c,
  printableString: 0x13,
  ia5String: 0x16,
  utcTime: 0x17,
  generalizedTime: 0x18,
  sequence: 0x30,
  set: 0x31,
} as const;

/** The definite length octets: short form below 128, else 0x80 | n followed by n bytes. */
export function derLength(length: number): Buffer {
  if (!Number.isSafeInteger(length) || length < 0) throw new RangeError(`bad DER length ${length}`);
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** Tag, length and content. */
export function tlv(tag: number, content: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

export function sequence(...children: Uint8Array[]): Buffer {
  return tlv(DER_TAG.sequence, Buffer.concat(children));
}

/**
 * A SET OF: DER orders the elements by their encodings (X.690 11.6), so equal inputs in any
 * order encode the same.
 */
export function set(...children: Uint8Array[]): Buffer {
  const sorted = children.map((c) => Buffer.from(c)).sort(Buffer.compare);
  return tlv(DER_TAG.set, Buffer.concat(sorted));
}

/**
 * A non-negative INTEGER from its unsigned big-endian magnitude (or a number): minimal two's
 * complement, i.e. leading zero bytes dropped and one 0x00 added when the top bit is set.
 */
export function integer(value: Uint8Array | number): Buffer {
  let bytes: Buffer;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`DER integers here are non-negative safe integers, got ${value}`);
    }
    const out: number[] = [];
    for (let rest = value; rest > 0; rest = Math.floor(rest / 256)) out.unshift(rest % 256);
    bytes = Buffer.from(out);
  } else {
    bytes = Buffer.from(value);
  }
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  let content = bytes.subarray(start);
  if (content.length === 0) content = Buffer.from([0]);
  if ((content[0] ?? 0) & 0x80) content = Buffer.concat([Buffer.from([0]), content]);
  return tlv(DER_TAG.integer, content);
}

/** An OBJECT IDENTIFIER from dotted notation, e.g. "2.5.4.3". */
export function oid(dotted: string): Buffer {
  if (!/^[0-2](\.\d+)+$/.test(dotted)) throw new RangeError(`bad OID "${dotted}"`);
  const arcs = dotted.split('.').map((arc) => BigInt(arc));
  const [first = 0n, second = 0n, ...rest] = arcs;
  if (first < 2n && second > 39n) throw new RangeError(`bad OID "${dotted}"`);
  const out: number[] = [];
  for (const arc of [first * 40n + second, ...rest]) {
    const septets: number[] = [Number(arc & 0x7fn)];
    for (let value = arc >> 7n; value > 0n; value >>= 7n) {
      septets.unshift(Number(value & 0x7fn) | 0x80);
    }
    out.push(...septets);
  }
  return tlv(DER_TAG.oid, Buffer.from(out));
}

export function utf8String(text: string): Buffer {
  return tlv(DER_TAG.utf8String, Buffer.from(text, 'utf8'));
}

/** An IA5String (ASCII), as used by DNS names in subjectAltName. */
export function ia5String(text: string): Buffer {
  if (!/^[\x00-\x7f]*$/.test(text)) throw new RangeError('IA5String must be ASCII');
  return tlv(DER_TAG.ia5String, Buffer.from(text, 'ascii'));
}

export function octetString(content: Uint8Array): Buffer {
  return tlv(DER_TAG.octetString, content);
}

/** A BIT STRING of whole bytes, or with `unusedBits` (0–7) padding bits at the end. */
export function bitString(content: Uint8Array, unusedBits = 0): Buffer {
  if (!Number.isInteger(unusedBits) || unusedBits < 0 || unusedBits > 7) {
    throw new RangeError(`bad unused bit count ${unusedBits}`);
  }
  if (content.length === 0 && unusedBits !== 0)
    throw new RangeError('empty BIT STRING with padding');
  return tlv(DER_TAG.bitString, Buffer.concat([Buffer.from([unusedBits]), content]));
}

export function boolean(value: boolean): Buffer {
  return tlv(DER_TAG.boolean, Buffer.from([value ? 0xff : 0x00]));
}

export function nullValue(): Buffer {
  return tlv(DER_TAG.null, Buffer.alloc(0));
}

function twoDigits(n: number): string {
  return String(n).padStart(2, '0');
}

function assertValidDate(date: Date): void {
  if (!Number.isFinite(date.getTime())) throw new RangeError('invalid date');
}

/** UTCTime `YYMMDDHHMMSSZ` (years 1950–2049). Milliseconds are dropped. */
export function utcTime(date: Date): Buffer {
  assertValidDate(date);
  const year = date.getUTCFullYear();
  if (year < 1950 || year > 2049) throw new RangeError(`UTCTime covers 1950–2049, not ${year}`);
  const text =
    twoDigits(year % 100) +
    twoDigits(date.getUTCMonth() + 1) +
    twoDigits(date.getUTCDate()) +
    twoDigits(date.getUTCHours()) +
    twoDigits(date.getUTCMinutes()) +
    twoDigits(date.getUTCSeconds()) +
    'Z';
  return tlv(DER_TAG.utcTime, Buffer.from(text, 'ascii'));
}

/** GeneralizedTime `YYYYMMDDHHMMSSZ` (no fractional seconds, as RFC 5280 requires). */
export function generalizedTime(date: Date): Buffer {
  assertValidDate(date);
  const year = date.getUTCFullYear();
  if (year < 0 || year > 9999) throw new RangeError(`GeneralizedTime covers 0–9999, not ${year}`);
  const text =
    String(year).padStart(4, '0') +
    twoDigits(date.getUTCMonth() + 1) +
    twoDigits(date.getUTCDate()) +
    twoDigits(date.getUTCHours()) +
    twoDigits(date.getUTCMinutes()) +
    twoDigits(date.getUTCSeconds()) +
    'Z';
  return tlv(DER_TAG.generalizedTime, Buffer.from(text, 'ascii'));
}

/** An X.509 `Time`: UTCTime through 2049, GeneralizedTime otherwise (RFC 5280 4.1.2.5). */
export function x509Time(date: Date): Buffer {
  const year = date.getUTCFullYear();
  return year >= 1950 && year <= 2049 ? utcTime(date) : generalizedTime(date);
}

/** `[n] EXPLICIT`: a constructed context-specific tag around one encoded value. */
export function explicit(tagNumber: number, child: Uint8Array): Buffer {
  if (!Number.isInteger(tagNumber) || tagNumber < 0 || tagNumber > 30) {
    throw new RangeError(`bad context tag ${tagNumber}`);
  }
  return tlv(0xa0 | tagNumber, child);
}

/** `[n] IMPLICIT` of a primitive value: the context-specific tag replaces the universal one. */
export function implicitPrimitive(tagNumber: number, content: Uint8Array): Buffer {
  if (!Number.isInteger(tagNumber) || tagNumber < 0 || tagNumber > 30) {
    throw new RangeError(`bad context tag ${tagNumber}`);
  }
  return tlv(0x80 | tagNumber, content);
}
