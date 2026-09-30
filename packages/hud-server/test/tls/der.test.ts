import { describe, expect, it } from 'vitest';
import {
  bitString,
  boolean,
  derLength,
  explicit,
  generalizedTime,
  ia5String,
  implicitPrimitive,
  integer,
  nullValue,
  octetString,
  oid,
  sequence,
  set,
  utcTime,
  utf8String,
  x509Time,
} from '../../src/tls/der.ts';

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('DER lengths', () => {
  it.each([
    [0, '00'],
    [1, '01'],
    [127, '7f'],
    [128, '8180'],
    [255, '81ff'],
    [256, '820100'],
    [65_535, '82ffff'],
    [65_536, '83010000'],
  ])('encodes %i as %s (short form below 128, else minimal long form)', (length, expected) => {
    expect(hex(derLength(length))).toBe(expected);
  });

  it('refuses lengths that are not non-negative integers', () => {
    for (const bad of [-1, 1.5, Number.NaN]) expect(() => derLength(bad)).toThrow(RangeError);
  });

  it('frames long contents with a long-form length', () => {
    const encoded = octetString(Buffer.alloc(300, 0xaa));
    expect(hex(encoded.subarray(0, 4))).toBe('0482012c');
    expect(encoded.length).toBe(304);
  });
});

describe('DER integers', () => {
  it.each([
    [0, '020100'],
    [1, '020101'],
    [127, '02017f'],
    [128, '02020080'],
    [255, '020200ff'],
    [256, '02020100'],
    [2, '020102'],
  ])('encodes %i as %s (two’s complement, minimal)', (value, expected) => {
    expect(hex(integer(value))).toBe(expected);
  });

  it('encodes byte magnitudes without leading zeros, adding one before a set top bit', () => {
    expect(hex(integer(Buffer.from([0x00, 0x00, 0x7f])))).toBe('02017f');
    expect(hex(integer(Buffer.from([0x80, 0x01])))).toBe('0203008001');
    expect(hex(integer(Buffer.from([0x00])))).toBe('020100');
    expect(hex(integer(Buffer.alloc(0)))).toBe('020100');
  });

  it('refuses negative and unsafe numbers', () => {
    expect(() => integer(-1)).toThrow(RangeError);
    expect(() => integer(2 ** 60)).toThrow(RangeError);
  });
});

describe('DER object identifiers', () => {
  it.each([
    ['2.5.4.3', '0603550403'], // commonName
    ['2.5.29.17', '0603551d11'], // subjectAltName
    ['1.2.840.10045.4.3.2', '06082a8648ce3d040302'], // ecdsa-with-SHA256
    ['1.2.840.10045.2.1', '06072a8648ce3d0201'], // id-ecPublicKey
    ['1.3.6.1.5.5.7.3.1', '06082b06010505070301'], // serverAuth
    ['2.999.3', '0603883703'], // X.690 8.19.5's example: first subidentifier 1079
    ['0.0', '060100'],
  ])('encodes %s as %s', (dotted, expected) => {
    expect(hex(oid(dotted))).toBe(expected);
  });

  it('refuses malformed identifiers', () => {
    for (const bad of ['', '1', '3.1', '1.40', '1.2.x', '1..2', '.1.2']) {
      expect(() => oid(bad), bad).toThrow(RangeError);
    }
  });
});

describe('DER strings and simple values', () => {
  it('encodes strings, octets, bits, booleans and null', () => {
    expect(hex(utf8String('Grüße'))).toBe(`0c07${Buffer.from('Grüße').toString('hex')}`);
    expect(hex(ia5String('hud.local'))).toBe(`1609${Buffer.from('hud.local').toString('hex')}`);
    expect(() => ia5String('hüd')).toThrow(RangeError);
    expect(hex(octetString(Buffer.from([1, 2])))).toBe('04020102');
    expect(hex(bitString(Buffer.from([0x80]), 7))).toBe('03020780');
    expect(hex(bitString(Buffer.from([0xde, 0xad])))).toBe('030300dead');
    expect(() => bitString(Buffer.from([1]), 8)).toThrow(RangeError);
    expect(() => bitString(Buffer.alloc(0), 1)).toThrow(RangeError);
    expect(hex(boolean(true))).toBe('0101ff');
    expect(hex(boolean(false))).toBe('010100');
    expect(hex(nullValue())).toBe('0500');
  });

  it('builds sequences in order and sets in DER order', () => {
    expect(hex(sequence(integer(2), integer(1)))).toBe('3006020102020101');
    expect(hex(sequence())).toBe('3000');
    // SET OF sorts its elements by their encodings, so the input order does not matter.
    expect(hex(set(integer(2), integer(1)))).toBe('3106020101020102');
    expect(hex(set(integer(1), integer(2)))).toBe(hex(set(integer(2), integer(1))));
  });

  it('tags context-specific values', () => {
    expect(hex(explicit(0, integer(2)))).toBe('a003020102');
    expect(hex(explicit(3, sequence()))).toBe('a3023000');
    expect(hex(implicitPrimitive(2, Buffer.from('a')))).toBe('820161');
    expect(hex(implicitPrimitive(7, Buffer.from([127, 0, 0, 1])))).toBe('87047f000001');
    expect(() => explicit(31, sequence())).toThrow(RangeError);
    expect(() => implicitPrimitive(-1, Buffer.alloc(0))).toThrow(RangeError);
  });
});

describe('DER times', () => {
  it('writes UTCTime and GeneralizedTime in UTC to the second', () => {
    const at = new Date(Date.UTC(2026, 8, 30, 7, 5, 9, 999));
    expect(utcTime(at).toString('latin1', 2)).toBe('260930070509Z');
    expect(utcTime(at)[0]).toBe(0x17);
    expect(generalizedTime(at).toString('latin1', 2)).toBe('20260930070509Z');
    expect(generalizedTime(at)[0]).toBe(0x18);
  });

  it('picks UTCTime through 2049 and GeneralizedTime otherwise (RFC 5280)', () => {
    const tag = (date: Date) => x509Time(date)[0];
    expect(tag(new Date(Date.UTC(1950, 0, 1)))).toBe(0x17);
    expect(tag(new Date(Date.UTC(2049, 11, 31, 23, 59, 59)))).toBe(0x17);
    expect(tag(new Date(Date.UTC(2050, 0, 1)))).toBe(0x18);
    expect(tag(new Date(Date.UTC(1949, 11, 31)))).toBe(0x18);
    expect(x509Time(new Date(Date.UTC(9999, 11, 31, 23, 59, 59))).toString('latin1', 2)).toBe(
      '99991231235959Z',
    );
    expect(() => utcTime(new Date(Date.UTC(2050, 0, 1)))).toThrow(RangeError);
    expect(() => utcTime(new Date(Number.NaN))).toThrow(RangeError);
  });
});
