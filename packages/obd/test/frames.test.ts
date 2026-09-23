import { describe, expect, it } from 'vitest';
import { parseEcuMessages, type EcuMessage } from '../src/frames.ts';
import { bytesToHex, hexToBytes } from '../src/hex.ts';

const hex = (m: EcuMessage): string => bytesToHex(m.data, ' ');
const summary = (messages: EcuMessage[]): Array<[string | null, string]> =>
  messages.map((m) => [m.ecu, hex(m)]);

/** Append the ISO 9141 / KWP checksum (sum of all bytes, mod 256) to a header+data line. */
function withChecksum(line: string): string {
  const sum = [...hexToBytes(line)].reduce((a, b) => a + b, 0) & 0xff;
  return `${line} ${sum.toString(16).toUpperCase().padStart(2, '0')}`;
}

describe('CAN 11-bit, headers on', () => {
  const can11 = { family: 'can11', headers: true } as const;

  it('parses a single frame and uses the PCI length (padding ignored)', () => {
    expect(summary(parseEcuMessages(['7E8 06 41 00 BE 3F A8 13'], can11))).toEqual([
      ['7E8', '41 00 BE 3F A8 13'],
    ]);
    expect(summary(parseEcuMessages(['7E8 03 41 0D 32 AA AA AA AA'], can11))).toEqual([
      ['7E8', '41 0D 32'],
    ]);
  });

  it('parses spaceless output (AT S0)', () => {
    expect(summary(parseEcuMessages(['7E804410C1AF8'], can11))).toEqual([['7E8', '41 0C 1A F8']]);
  });

  it('separates multiple ECUs (engine 7E8 + transmission 7E9), sorted by id', () => {
    const lines = ['7E9 06 41 00 98 18 80 10', '7E8 06 41 00 BE 3F A8 13'];
    expect(summary(parseEcuMessages(lines, can11))).toEqual([
      ['7E8', '41 00 BE 3F A8 13'],
      ['7E9', '41 00 98 18 80 10'],
    ]);
  });

  it('reassembles an ISO-TP VIN (first frame + consecutive frames)', () => {
    const lines = [
      '7E8 10 14 49 02 01 57 50 30',
      '7E8 21 5A 5A 5A 39 39 5A 54',
      '7E8 22 53 33 39 32 31 32 34',
    ];
    const [message] = parseEcuMessages(lines, can11);
    expect(message?.ecu).toBe('7E8');
    expect(message?.data.length).toBe(0x14);
    expect(String.fromCharCode(...(message?.data.slice(3) ?? []))).toBe('WP0ZZZ99ZTS392124');
  });

  it('reassembles a multi-frame DTC answer and trims CF padding to the FF length', () => {
    const lines = ['7E8 10 0A 43 04 01 43 01 96', '7E8 21 02 34 02 35 00 00 00'];
    expect(summary(parseEcuMessages(lines, can11))).toEqual([
      ['7E8', '43 04 01 43 01 96 02 34 02 35'],
    ]);
  });

  it('reassembles two ECUs answering multi-frame at the same time (interleaved)', () => {
    const lines = [
      '7E8 10 0A 43 04 01 43 01 96',
      '7E9 04 43 01 07 00',
      '7E8 21 02 34 02 35 00 00 00',
    ];
    expect(summary(parseEcuMessages(lines, can11))).toEqual([
      ['7E8', '43 04 01 43 01 96 02 34 02 35'],
      ['7E9', '43 01 07 00'],
    ]);
  });

  it('accepts out-of-order consecutive frames', () => {
    const lines = [
      '7E8 10 14 49 02 01 57 50 30',
      '7E8 22 53 33 39 32 31 32 34',
      '7E8 21 5A 5A 5A 39 39 5A 54',
    ];
    const [message] = parseEcuMessages(lines, can11);
    expect(String.fromCharCode(...(message?.data.slice(3) ?? []))).toBe('WP0ZZZ99ZTS392124');
  });

  it('drops a multi-frame message with a missing consecutive frame', () => {
    const lines = ['7E8 10 14 49 02 01 57 50 30', '7E8 22 53 33 39 32 31 32 34'];
    expect(parseEcuMessages(lines, can11)).toEqual([]);
  });

  it('drops a message whose frames stop short of the announced length', () => {
    const lines = ['7E8 10 14 49 02 01 57 50 30', '7E8 21 5A 5A 5A 39 39 5A 54'];
    expect(parseEcuMessages(lines, can11)).toEqual([]);
  });

  it('keeps a negative response and a response-pending answer as messages', () => {
    const lines = ['7CE 03 7F 22 78', '7CE 05 62 40 01 08 FC'];
    expect(summary(parseEcuMessages(lines, can11))).toEqual([
      ['7CE', '7F 22 78'],
      ['7CE', '62 40 01 08 FC'],
    ]);
  });

  it('ignores frames with an impossible PCI byte and non-hex noise', () => {
    const lines = ['7E8 F6 41 00 BE 3F A8 13', '#%&@!', '7E8 03 41 0D 32'];
    expect(summary(parseEcuMessages(lines, can11))).toEqual([['7E8', '41 0D 32']]);
  });

  it('ignores flow-control frames', () => {
    expect(summary(parseEcuMessages(['7E0 30 00 00', '7E8 03 41 0D 32'], can11))).toEqual([
      ['7E8', '41 0D 32'],
    ]);
  });

  it('falls back to headerless parsing when a clone ignored AT H1', () => {
    expect(summary(parseEcuMessages(['41 0D 32'], can11))).toEqual([[null, '41 0D 32']]);
  });
});

describe('CAN 29-bit, headers on', () => {
  const can29 = { family: 'can29', headers: true } as const;

  it('parses single frames with a four-byte id', () => {
    const lines = ['18 DA F1 10 06 41 00 BE 3F A8 13', '18 DA F1 18 06 41 00 80 00 00 01'];
    expect(summary(parseEcuMessages(lines, can29))).toEqual([
      ['18DAF110', '41 00 BE 3F A8 13'],
      ['18DAF118', '41 00 80 00 00 01'],
    ]);
  });

  it('parses spaceless output', () => {
    expect(summary(parseEcuMessages(['18DAF11003410D32'], can29))).toEqual([
      ['18DAF110', '41 0D 32'],
    ]);
  });

  it('reassembles ISO-TP multi-frame answers', () => {
    const lines = [
      '18 DA F1 10 10 14 49 02 01 57 50 30',
      '18 DA F1 10 21 5A 5A 5A 39 39 5A 54',
      '18 DA F1 10 22 53 33 39 32 31 32 34',
    ];
    const [message] = parseEcuMessages(lines, can29);
    expect(message?.ecu).toBe('18DAF110');
    expect(String.fromCharCode(...(message?.data.slice(3) ?? []))).toBe('WP0ZZZ99ZTS392124');
  });
});

describe('CAN, headers off', () => {
  const off = { family: 'can11', headers: false } as const;

  it('parses bare single-frame payloads, one message per line', () => {
    expect(summary(parseEcuMessages(['41 0C 1A F8'], off))).toEqual([[null, '41 0C 1A F8']]);
    expect(summary(parseEcuMessages(['41 00 BE 3F A8 13', '41 00 98 18 80 10'], off))).toEqual([
      [null, '41 00 BE 3F A8 13'],
      [null, '41 00 98 18 80 10'],
    ]);
  });

  it('reassembles "014" / "0:" segment output (ELM327 datasheet VIN example)', () => {
    const lines = [
      '014',
      '0: 49 02 01 31 44 34',
      '1: 47 50 30 30 52 35 35',
      '2: 42 31 32 33 34 35 36',
    ];
    const [message] = parseEcuMessages(lines, off);
    expect(message?.data.length).toBe(20);
    expect(String.fromCharCode(...(message?.data.slice(3) ?? []))).toBe('1D4GP00R55B123456');
  });

  it('reassembles spaceless segments and trims padding', () => {
    const lines = ['00A', '0:430401430196', '1:02340235000000'];
    expect(summary(parseEcuMessages(lines, off))).toEqual([
      [null, '43 04 01 43 01 96 02 34 02 35'],
    ]);
  });

  it('handles segment output without a length line (some clones)', () => {
    const lines = ['0: 49 02 01 31 44 34', '1: 47 50 30 30 52 35 35', '2: 42 31 32 33 34 35 36'];
    const [message] = parseEcuMessages(lines, off);
    expect(String.fromCharCode(...(message?.data.slice(3) ?? []))).toBe('1D4GP00R55B123456');
  });

  it('drops segment output with a gap', () => {
    const lines = ['014', '0: 49 02 01 31 44 34', '2: 42 31 32 33 34 35 36'];
    expect(parseEcuMessages(lines, off)).toEqual([]);
  });
});

describe('legacy protocols (ISO 9141-2, ISO 14230-4 KWP, SAE J1850)', () => {
  const legacy = { family: 'legacy', headers: true } as const;

  it('strips the 3-byte header and checksum (ISO 9141-2)', () => {
    const lines = [withChecksum('48 6B 10 41 0C 1A F8')];
    expect(summary(parseEcuMessages(lines, legacy))).toEqual([['10', '41 0C 1A F8']]);
  });

  it('separates ECUs by source address', () => {
    const lines = [
      withChecksum('48 6B 18 41 00 80 00 00 00'),
      withChecksum('48 6B 10 41 00 BE 3F B8 13'),
    ];
    expect(summary(parseEcuMessages(lines, legacy))).toEqual([
      ['10', '41 00 BE 3F B8 13'],
      ['18', '41 00 80 00 00 00'],
    ]);
  });

  it('concatenates multi-line DTC answers without a count byte', () => {
    const lines = [
      withChecksum('48 6B 10 43 01 33 03 00 04 20'),
      withChecksum('48 6B 10 43 01 71 00 00 00 00'),
    ];
    expect(summary(parseEcuMessages(lines, legacy))).toEqual([
      ['10', '43 01 33 03 00 04 20 01 71 00 00 00 00'],
    ]);
  });

  it('orders and joins a multi-line VIN by its sequence byte', () => {
    const lines = [
      withChecksum('48 6B 10 49 02 01 00 00 00 31'),
      withChecksum('48 6B 10 49 02 03 30 30 52 35'),
      withChecksum('48 6B 10 49 02 02 44 34 47 50'),
      withChecksum('48 6B 10 49 02 04 35 42 31 32'),
      withChecksum('48 6B 10 49 02 05 33 34 35 36'),
    ];
    const [message] = parseEcuMessages(lines, legacy);
    expect(message?.ecu).toBe('10');
    const text = String.fromCharCode(...(message?.data.slice(2) ?? [])).replace(/\0/g, '');
    expect(text).toBe('1D4GP00R55B123456');
  });

  it('drops a legacy VIN with a missing line', () => {
    const lines = [
      withChecksum('48 6B 10 49 02 01 00 00 00 31'),
      withChecksum('48 6B 10 49 02 03 30 30 52 35'),
    ];
    expect(parseEcuMessages(lines, legacy)).toEqual([]);
  });

  it('uses the KWP format byte length (3-byte header)', () => {
    expect(summary(parseEcuMessages([withChecksum('83 F1 11 41 0D 32')], legacy))).toEqual([
      ['11', '41 0D 32'],
    ]);
  });

  it('handles the KWP 4-byte header with a separate length byte', () => {
    expect(summary(parseEcuMessages([withChecksum('80 F1 10 03 41 0D 32')], legacy))).toEqual([
      ['10', '41 0D 32'],
    ]);
  });

  it('parses SAE J1850 PWM and VPW frames', () => {
    expect(summary(parseEcuMessages(['41 6B 10 41 0D 32 7C'], legacy))).toEqual([
      ['10', '41 0D 32'],
    ]);
    expect(summary(parseEcuMessages(['48 6B 10 41 0D 32 D4'], legacy))).toEqual([
      ['10', '41 0D 32'],
    ]);
  });

  it('parses headerless legacy output and joins multi-line DTCs', () => {
    const off = { family: 'legacy', headers: false } as const;
    expect(
      summary(parseEcuMessages(['43 01 33 03 00 04 20', '43 01 71 00 00 00 00'], off)),
    ).toEqual([[null, '43 01 33 03 00 04 20 01 71 00 00 00 00']]);
  });

  it('drops lines too short to carry header, data and checksum', () => {
    expect(parseEcuMessages(['48 6B 10 41'], legacy)).toEqual([]);
  });
});
