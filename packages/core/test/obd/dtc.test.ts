import { describe, expect, it } from 'vitest';
import {
  DTC_SHORT_MAX_LENGTH,
  decodeDtcBytes,
  isValidDtc,
  normalizeDtc,
  parseDtcPayload,
} from '../../src/obd/dtc.ts';
import { lookupDtc } from '../../src/obd/dtc-lookup.ts';
import { DTC_DATABASE } from '../../src/obd/dtc-database.ts';
import { describeDtcRange } from '../../src/obd/dtc-ranges.ts';
import type { DtcInfo, DtcSeverity } from '../../src/types/vehicle.ts';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const CAN = { hasCountByte: true };
const LEGACY = { hasCountByte: false };
const SEVERITIES: DtcSeverity[] = ['info', 'caution', 'warning', 'critical'];

describe('decodeDtcBytes', () => {
  it.each([
    // letter from bits 7–6 of A
    [0x04, 0x20, 'P0420'],
    [0x41, 0x23, 'C0123'],
    [0x80, 0x01, 'B0001'],
    [0xc1, 0x00, 'U0100'],
    // first digit 0–3 from bits 5–4 of A
    [0x01, 0x33, 'P0133'],
    [0x13, 0x45, 'P1345'],
    [0x21, 0x35, 'P2135'],
    [0x34, 0x00, 'P3400'],
    [0x5a, 0x7f, 'C1A7F'],
    [0x92, 0x10, 'B1210'],
    [0xa0, 0x01, 'B2001'],
    [0xe2, 0x00, 'U2200'],
    [0xf0, 0x00, 'U3000'],
    // hex digits A–F in every remaining position
    [0x0a, 0xbc, 'P0ABC'],
    [0x0f, 0xff, 'P0FFF'],
    [0x3f, 0xff, 'P3FFF'],
    [0xff, 0xff, 'U3FFF'],
    [0x00, 0x01, 'P0001'],
  ])('[%i, %i] → %s', (a, b, expected) => {
    expect(decodeDtcBytes(a, b)).toBe(expected);
  });

  it('returns null for 0x0000 padding', () => {
    expect(decodeDtcBytes(0x00, 0x00)).toBeNull();
  });

  it('always produces a valid code for every non-zero byte pair', () => {
    for (let a = 0; a <= 0xff; a++) {
      for (let b = 0; b <= 0xff; b++) {
        if (a === 0 && b === 0) continue;
        const code = decodeDtcBytes(a, b);
        expect(code !== null && isValidDtc(code)).toBe(true);
      }
    }
  });

  it('rejects values that are not bytes', () => {
    for (const [a, b] of [
      [0x100, 0],
      [0, 0x100],
      [-1, 0],
      [1.5, 0],
      [Number.NaN, 0],
    ] as const) {
      expect(() => decodeDtcBytes(a, b)).toThrow(RangeError);
    }
  });
});

describe('parseDtcPayload — CAN (count byte)', () => {
  it('reads the number of codes given by the count byte', () => {
    expect(parseDtcPayload(bytes(0x02, 0x04, 0x20, 0x01, 0x71), CAN)).toEqual(['P0420', 'P0171']);
    expect(parseDtcPayload(bytes(0x01, 0xc1, 0x00), CAN)).toEqual(['U0100']);
  });

  it('returns nothing for "no codes" responses', () => {
    expect(parseDtcPayload(bytes(0x00), CAN)).toEqual([]);
    expect(parseDtcPayload(bytes(), CAN)).toEqual([]);
  });

  it('ignores bytes beyond the counted codes (padding / trailing junk)', () => {
    expect(parseDtcPayload(bytes(0x01, 0x03, 0x01, 0x00, 0x00, 0x55, 0x55), CAN)).toEqual([
      'P0301',
    ]);
    expect(parseDtcPayload(bytes(0x00, 0x04, 0x20), CAN)).toEqual([]);
  });

  it('returns the codes actually present when the count overstates them (truncated frame)', () => {
    expect(parseDtcPayload(bytes(0x03, 0x04, 0x20), CAN)).toEqual(['P0420']);
    expect(parseDtcPayload(bytes(0x03, 0x04, 0x20, 0x01), CAN)).toEqual(['P0420']);
  });

  it('ignores a trailing odd byte', () => {
    expect(parseDtcPayload(bytes(0x02, 0x04, 0x20, 0x01, 0x71, 0x99), CAN)).toEqual([
      'P0420',
      'P0171',
    ]);
  });

  it('drops 0x0000 pairs and duplicates, preserving first-seen order', () => {
    expect(
      parseDtcPayload(bytes(0x04, 0x01, 0x71, 0x00, 0x00, 0x04, 0x20, 0x01, 0x71), CAN),
    ).toEqual(['P0171', 'P0420']);
  });

  it('decodes a multi-frame response reassembled into one payload', () => {
    const payload = bytes(0x05, 0x03, 0x01, 0x03, 0x02, 0x04, 0x20, 0x44, 0x35, 0xc1, 0x21);
    expect(parseDtcPayload(payload, CAN)).toEqual(['P0301', 'P0302', 'P0420', 'C0435', 'U0121']);
  });
});

describe('parseDtcPayload — legacy protocols (no count byte)', () => {
  it('reads codes in pairs and drops 0x0000 padding', () => {
    expect(parseDtcPayload(bytes(0x01, 0x33, 0x00, 0x00, 0x00, 0x00), LEGACY)).toEqual(['P0133']);
  });

  it('reads several padded 6-byte frames reassembled into one payload', () => {
    const payload = bytes(
      ...[0x01, 0x33, 0x04, 0x20, 0x03, 0x01], // frame 1: three codes
      ...[0x07, 0x00, 0x00, 0x00, 0x00, 0x00], // frame 2: one code + padding
    );
    expect(parseDtcPayload(payload, LEGACY)).toEqual(['P0133', 'P0420', 'P0301', 'P0700']);
  });

  it('returns nothing for empty or all-padding payloads', () => {
    expect(parseDtcPayload(bytes(), LEGACY)).toEqual([]);
    expect(parseDtcPayload(bytes(0, 0, 0, 0, 0, 0), LEGACY)).toEqual([]);
  });

  it('does not treat the first byte as a count', () => {
    // Under CAN rules this would read as "2 codes: 0x0420, 0x0171…"; legacy reads pairs from 0.
    expect(parseDtcPayload(bytes(0x02, 0x04, 0x20, 0x01), LEGACY)).toEqual(['P0204', 'P2001']);
  });

  it('ignores a trailing odd byte', () => {
    expect(parseDtcPayload(bytes(0x04, 0x20, 0x01), LEGACY)).toEqual(['P0420']);
    expect(parseDtcPayload(bytes(0x04), LEGACY)).toEqual([]);
  });

  it('removes duplicates reported by several ECUs, preserving order', () => {
    expect(
      parseDtcPayload(bytes(0x04, 0x20, 0x00, 0x00, 0x01, 0x71, 0x04, 0x20, 0x00, 0x00), LEGACY),
    ).toEqual(['P0420', 'P0171']);
  });
});

describe('normalizeDtc / isValidDtc', () => {
  it('trims and upper-cases', () => {
    expect(normalizeDtc('  p0420\n')).toBe('P0420');
  });

  it.each(['P0420', 'C1234', 'B2FFF', 'U0100', 'U3000', 'P0ABC', ' p0420 ', 'u0100', 'c0a1f'])(
    'accepts %j',
    (code) => {
      expect(isValidDtc(code)).toBe(true);
    },
  );

  it.each([
    '',
    '   ',
    'P042',
    'P04200',
    'P4420', // first digit must be 0–3
    'X0420',
    'P0G20',
    'PO420', // letter O, not zero
    'P 0420',
    'P0420-00',
    '0420',
    'constructor',
    '__proto__',
  ])('rejects %j', (code) => {
    expect(isValidDtc(code)).toBe(false);
  });
});

/**
 * Check a lookup result whatever state the (concurrently maintained) database is in: known
 * codes must mirror their entry, unknown codes must be synthesised from the J2012 range.
 */
function expectConsistentLookup(info: DtcInfo, code: string): void {
  expect(info.code).toBe(code);
  const entry = Object.hasOwn(DTC_DATABASE, code) ? DTC_DATABASE[code] : undefined;
  if (entry) {
    expect(info.known).toBe(true);
    expect(info.description).toBe(entry.description);
    expect(info.severity).toBe(entry.severity);
  } else {
    const range = describeDtcRange(code);
    expect(info.known).toBe(false);
    expect(info.severity).toBe(range.severity);
    expect(info.short).toBe(range.short);
    expect(info.description.startsWith(range.description)).toBe(true);
  }
  expect(info.short.length).toBeGreaterThan(0);
  expect(info.short.length).toBeLessThanOrEqual(DTC_SHORT_MAX_LENGTH);
  expect(SEVERITIES).toContain(info.severity);
}

describe('lookupDtc', () => {
  it('normalises its input', () => {
    const info = lookupDtc('  p0420 ');
    expect(info.code).toBe('P0420');
    expect(info.system).toBe('powertrain');
    expectConsistentLookup(info, 'P0420');
  });

  it.each([
    ['P0420', 'powertrain'],
    ['C0035', 'chassis'],
    ['B0001', 'body'],
    ['U0100', 'network'],
  ] as const)('derives the system of %s from its letter', (code, system) => {
    expect(lookupDtc(code).system).toBe(system);
  });

  it.each([
    ['P1234', true],
    ['P1FFF', true],
    ['P3000', true],
    ['P3399', true],
    ['P33FF', true],
    ['P3400', false],
    ['P0420', false],
    ['P2135', false],
    ['B1000', true],
    ['B2ABC', true],
    ['B0001', false],
    ['B3000', false],
    ['C1234', true],
    ['C2000', true],
    ['C0035', false],
    ['U1000', true],
    ['U2100', true],
    ['U0100', false],
    ['U3000', false],
  ] as const)('%s manufacturerSpecific = %s', (code, expected) => {
    expect(lookupDtc(code).manufacturerSpecific).toBe(expected);
  });

  it('synthesises a range description for manufacturer codes', () => {
    // Manufacturer codes are never in the generic database.
    const info = lookupDtc('P1234');
    expect(info).toMatchObject({
      code: 'P1234',
      system: 'powertrain',
      known: false,
      manufacturerSpecific: true,
      severity: 'caution',
    });
    expect(info.description).toContain('Manufacturer-specific');
    expect(info.description).toContain('P1xxx');
    expect(lookupDtc('P3012').description).toContain('P30xx–P33xx');
    expect(lookupDtc('C1241')).toMatchObject({ system: 'chassis', severity: 'warning' });
    expect(lookupDtc('U1000').description).toContain('U1xxx');
  });

  it('synthesises a range description for unknown generic codes', () => {
    // P0Fxx is an ISO/SAE reserved range, so it is not expected in the database.
    const reserved = lookupDtc('P0FAB');
    expectConsistentLookup(reserved, 'P0FAB');
    if (!reserved.known) {
      expect(reserved.description).toContain('P0Fxx');
      expect(reserved.manufacturerSpecific).toBe(false);
    }
    for (const code of ['P0301', 'P03FE', 'P0217', 'P07FF', 'P0AFF', 'P2A99', 'P3499', 'U04FF']) {
      expectConsistentLookup(lookupDtc(code), code);
    }
  });

  it('is consistent with the database and the range table for every possible code', () => {
    const hex = '0123456789ABCDEF';
    for (const letter of 'PCBU') {
      for (const digit of '0123') {
        for (const x of hex) {
          for (const y of hex) {
            for (const z of hex) {
              const code = `${letter}${digit}${x}${y}${z}`;
              expectConsistentLookup(lookupDtc(code), code);
            }
          }
        }
      }
    }
  });

  it.each(['', 'hello', 'P999', 'P4420', 'X0420', 'constructor', '__proto__', 'toString'])(
    'returns an "Unrecognised trouble code" result for %j instead of throwing',
    (input) => {
      const info = lookupDtc(input);
      expect(info.known).toBe(false);
      expect(info.description).toBe('Unrecognised trouble code');
      expect(info.code).toBe(input.trim().toUpperCase());
      expect(info.short.length).toBeLessThanOrEqual(DTC_SHORT_MAX_LENGTH);
      expect(info.manufacturerSpecific).toBe(false);
      expect(SEVERITIES).toContain(info.severity);
    },
  );

  it('keeps the letter-derived system for invalid codes when it can', () => {
    expect(lookupDtc('U99').system).toBe('network');
    expect(lookupDtc('zzz').system).toBe('powertrain');
  });
});
