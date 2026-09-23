import { describe, expect, it } from 'vitest';
import { ElmError } from '../src/errors.ts';
import { classifyResponse, cleanResponse, parseVoltage, splitLines } from '../src/response.ts';

const classify = (raw: string, command: string, kind: 'at' | 'obd' = 'obd'): string[] =>
  classifyResponse(cleanResponse(raw, command), command, kind);

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof ElmError ? err.code : `not an ElmError: ${String(err)}`;
  }
}

describe('splitLines', () => {
  it('splits on CR and CRLF, trims, drops blank lines and NUL bytes', () => {
    expect(splitLines('\r\r41 0C 1A F8 \r\n\r\n\0 NO DATA\r')).toEqual(['41 0C 1A F8', 'NO DATA']);
  });
});

describe('cleanResponse', () => {
  it('strips the command echo (echo still on, e.g. right after ATZ)', () => {
    expect(cleanResponse('ATE0\rOK\r\r', 'ATE0')).toEqual(['OK']);
    expect(cleanResponse('010C\r41 0C 1A F8\r\r', '010C')).toEqual(['41 0C 1A F8']);
  });

  it('matches the echo regardless of spacing and case', () => {
    expect(cleanResponse('01 0c\r41 0C 1A F8\r', '010C')).toEqual(['41 0C 1A F8']);
  });

  it('removes SEARCHING... on its own line and in front of data', () => {
    expect(cleanResponse('SEARCHING...\r7E8 06 41 00 BE 3F A8 13\r\r', '0100')).toEqual([
      '7E8 06 41 00 BE 3F A8 13',
    ]);
    expect(cleanResponse('SEARCHING...7E8064100BE3FA813\r', '0100')).toEqual(['7E8064100BE3FA813']);
  });

  it('removes a successful BUS INIT line (ISO 9141 / KWP)', () => {
    expect(cleanResponse('BUS INIT: ...OK\r48 6B 10 41 0D 32 A3\r\r', '010D')).toEqual([
      '48 6B 10 41 0D 32 A3',
    ]);
    expect(cleanResponse('BUS INIT: OK\r41 0D 32\r', '010D')).toEqual(['41 0D 32']);
  });

  it('keeps the ATZ banner', () => {
    expect(cleanResponse('ATZ\r\r\rELM327 v1.5\r\r', 'ATZ')).toEqual(['ELM327 v1.5']);
  });
});

describe('classifyResponse', () => {
  it('returns data lines', () => {
    expect(classify('41 0D 32\r\r', '010D')).toEqual(['41 0D 32']);
  });

  it('treats NO DATA as an empty result, not an error', () => {
    expect(classify('NO DATA\r\r', '0152')).toEqual([]);
    expect(classify('SEARCHING...\rNO DATA\r\r', '0100')).toEqual([]);
  });

  it('ignores a stray NO DATA next to real data', () => {
    expect(classify('7E8 03 41 0D 32\rNO DATA\r', '010D')).toEqual(['7E8 03 41 0D 32']);
  });

  it.each([
    ['?', 'UNSUPPORTED'],
    ['SEARCHING...\rUNABLE TO CONNECT', 'UNABLE_TO_CONNECT'],
    ['BUS INIT: ...ERROR', 'BUS_INIT_ERROR'],
    ['BUS INIT:ERROR', 'BUS_INIT_ERROR'],
    ['CAN ERROR', 'CAN_ERROR'],
    ['BUS ERROR', 'BUS_ERROR'],
    ['BUS BUSY', 'BUS_BUSY'],
    ['FB ERROR', 'FB_ERROR'],
    ['BUFFER FULL', 'BUFFER_FULL'],
    ['STOPPED', 'STOPPED'],
    ['7E8 03 41 0D <DATA ERROR', 'DATA_ERROR'],
    ['DATA ERROR', 'DATA_ERROR'],
    ['7E8 03 41 0D 32 <RX ERROR', 'RX_ERROR'],
    ['ACT ALERT', 'ACT_ALERT'],
    ['LP ALERT', 'LP_ALERT'],
    ['LV RESET', 'LV_RESET'],
    ['ERR94', 'INTERNAL_ERROR'],
  ])('classifies %j as %s', (raw, code) => {
    expect(codeOf(() => classify(`${raw}\r\r`, '010D'))).toBe(code);
  });

  it('flags an identification banner inside an OBD response as an adapter reset', () => {
    expect(codeOf(() => classify('\r\rELM327 v1.5\r\r', '010C'))).toBe('ADAPTER_RESET');
  });

  it('accepts the banner for AT commands (ATI, ATZ)', () => {
    expect(classify('ELM327 v1.5\r\r', 'ATI', 'at')).toEqual(['ELM327 v1.5']);
  });

  it('carries the command and response on the error', () => {
    try {
      classify('CAN ERROR\r\r', '010C');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ElmError);
      const e = err as ElmError;
      expect(e.command).toBe('010C');
      expect(e.response).toEqual(['CAN ERROR']);
      expect(e.message).toContain('010C');
    }
  });
});

describe('parseVoltage', () => {
  it.each([
    [['12.6V'], 12.6],
    [['14.21 V'], 14.21],
    [['12V'], 12],
    [['?'], null],
    [['OK'], null],
    [['99.9V'], null],
    [[], null],
  ])('%j → %s', (lines, expected) => {
    expect(parseVoltage(lines)).toBe(expected);
  });
});
