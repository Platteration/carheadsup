import { describe, expect, it } from 'vitest';
import type { EcuMessage } from '../src/frames.ts';
import { bytesToHex, hexToBytes } from '../src/hex.ts';
import {
  collectDtcs,
  collectMode01,
  decodeVin,
  negativeResponseCode,
  splitMode01Payload,
} from '../src/payloads.ts';

const msg = (ecu: string | null, hex: string): EcuMessage => ({ ecu, data: hexToBytes(hex) });
const split = (hex: string, pids: number[]): Record<string, string> =>
  Object.fromEntries(
    [...splitMode01Payload(hexToBytes(hex), pids)].map(([pid, data]) => [
      pid.toString(16).toUpperCase().padStart(2, '0'),
      bytesToHex(data, ' '),
    ]),
  );

describe('splitMode01Payload', () => {
  it('splits a six-PID answer using the J1979 lengths', () => {
    // 010D0C1149105E: speed 50, rpm 1726, throttle, pedal, MAF, fuel rate.
    expect(
      split(
        '41 0D 32 0C 1A F8 11 26 49 2E 10 01 F4 5E 00 50',
        [0x0d, 0x0c, 0x11, 0x49, 0x10, 0x5e],
      ),
    ).toEqual({
      '0D': '32',
      '0C': '1A F8',
      '11': '26',
      '49': '2E',
      '10': '01 F4',
      '5E': '00 50',
    });
  });

  it('only returns the PIDs the ECU answered', () => {
    expect(split('41 0C 1A F8 0D 32', [0x0d, 0x0c, 0x5e])).toEqual({ '0C': '1A F8', '0D': '32' });
  });

  it('stops at bytes that are not an outstanding requested PID (padding, repeats)', () => {
    expect(split('41 0D 32 00 00', [0x0d, 0x0c])).toEqual({ '0D': '32' });
    expect(split('41 0D 32 0D 33', [0x0d, 0x0c])).toEqual({ '0D': '32' });
  });

  it('stops when an answer is truncated', () => {
    expect(split('41 0D 32 0C 1A', [0x0d, 0x0c])).toEqual({ '0D': '32' });
  });

  it('gives a variable-length fuel trim PID the rest of the answer when it is last', () => {
    expect(split('41 05 7B 06 80 84', [0x05, 0x06])).toEqual({ '05': '7B', '06': '80 84' });
    expect(split('41 05 7B 06 80', [0x05, 0x06])).toEqual({ '05': '7B', '06': '80' });
  });

  it('takes everything after a single requested PID', () => {
    expect(split('41 0D 32 AA AA', [0x0d])).toEqual({ '0D': '32 AA AA' });
  });

  it('ignores non-service-01 payloads', () => {
    expect(split('7F 01 12', [0x0d])).toEqual({});
  });
});

describe('collectMode01', () => {
  it('decodes values, preferring the first ECU when several answer the same PID', () => {
    const result = collectMode01(
      [msg('7E8', '41 0D 32 0C 1A F8'), msg('7E9', '41 0D 33 A4 01 30 03 E8')],
      [0x0d, 0x0c, 0xa4],
    );
    expect(result.values).toEqual({ speed: 50, rpm: 1726, transmissionGear: 3 });
    expect(result.answers.get(0x0d)?.map((a) => a.ecu)).toEqual(['7E8', '7E9']);
    expect(result.answers.get(0xa4)?.map((a) => a.ecu)).toEqual(['7E9']);
  });

  it('keeps raw answers for PIDs the HUD does not decode (bitmaps)', () => {
    const result = collectMode01([msg('7E8', '41 00 BE 3F A8 13')], [0x00]);
    expect(bytesToHex(result.answers.get(0x00)?.[0]?.data ?? [])).toBe('BE3FA813');
    expect(result.values).toEqual({});
  });

  it('skips "not available" values (odometer 0xFFFFFFFF) but reports the answer', () => {
    const result = collectMode01([msg('7E8', '41 A6 FF FF FF FF')], [0xa6]);
    expect(result.values).toEqual({});
    expect(result.answers.has(0xa6)).toBe(true);
  });
});

describe('collectDtcs', () => {
  it('reads CAN answers with a count byte and merges ECUs without duplicates', () => {
    const messages = [
      msg('7E8', '43 04 01 43 01 96 02 34 02 35'),
      msg('7E9', '43 02 07 00 01 43'),
      msg('7EA', '7F 03 11'),
    ];
    expect(collectDtcs(messages, 0x03, true)).toEqual([
      'P0143',
      'P0196',
      'P0234',
      'P0235',
      'P0700',
    ]);
  });

  it('reads legacy answers without a count byte, dropping 0000 padding', () => {
    expect(collectDtcs([msg('10', '43 01 33 03 00 04 20 01 71 00 00 00 00')], 0x03, false)).toEqual(
      ['P0133', 'P0300', 'P0420', 'P0171'],
    );
  });

  it('returns nothing for an empty list', () => {
    expect(collectDtcs([msg('7E8', '47 00')], 0x07, true)).toEqual([]);
  });

  it('decodes all four code letters', () => {
    expect(collectDtcs([msg('7E8', '4A 04 C1 00 51 23 91 11 04 20')], 0x0a, true)).toEqual([
      'U0100',
      'C1123',
      'B1111',
      'P0420',
    ]);
  });
});

describe('decodeVin', () => {
  it('decodes a CAN VIN (number-of-items byte first)', () => {
    const data = `49 02 01 ${bytesToHex(
      [...'WP0ZZZ99ZTS392124'].map((c) => c.charCodeAt(0)),
      ' ',
    )}`;
    expect(decodeVin([msg('7E8', data)])).toBe('WP0ZZZ99ZTS392124');
  });

  it('decodes a legacy VIN padded with leading zero bytes', () => {
    const data = `49 02 00 00 00 ${bytesToHex(
      [...'1D4GP00R55B123456'].map((c) => c.charCodeAt(0)),
      ' ',
    )}`;
    expect(decodeVin([msg('10', data)])).toBe('1D4GP00R55B123456');
  });

  it('returns null when no VIN answer is present', () => {
    expect(decodeVin([])).toBeNull();
    expect(decodeVin([msg('7E8', '7F 09 12')])).toBeNull();
    expect(decodeVin([msg('7E8', '49 02 01 00 00 00')])).toBeNull();
  });

  it('rejects a truncated or invalid VIN so it is read again (obd-13)', () => {
    const ascii = (text: string): string =>
      bytesToHex(
        [...text].map((c) => c.charCodeAt(0)),
        ' ',
      );
    // An ISO 9141 answer whose last line was lost: 13 characters.
    expect(() => decodeVin([msg('10', `49 02 00 00 00 ${ascii('1HGCM82633A00')}`)])).toThrow(
      expect.objectContaining({ code: 'MALFORMED' }),
    );
    // I, O and Q never appear in a VIN.
    expect(() => decodeVin([msg('7E8', `49 02 01 ${ascii('1HGCM8263OA004352')}`)])).toThrow(
      expect.objectContaining({ code: 'MALFORMED' }),
    );
    // A complete VIN from another control unit wins over a partial one.
    expect(
      decodeVin([
        msg('7E8', `49 02 01 ${ascii('1HGCM826')}`),
        msg('7E9', `49 02 01 ${ascii('1HGCM82633A004352')}`),
      ]),
    ).toBe('1HGCM82633A004352');
  });
});

describe('negativeResponseCode', () => {
  it('reports the NRC but ignores "response pending"', () => {
    expect(negativeResponseCode([msg('7CE', '7F 22 78'), msg('7CE', '7F 22 31')], 0x22)).toBe(0x31);
    expect(negativeResponseCode([msg('7CE', '7F 22 78')], 0x22)).toBeNull();
    expect(negativeResponseCode([msg('7CE', '7F 21 31')], 0x22)).toBeNull();
  });
});
