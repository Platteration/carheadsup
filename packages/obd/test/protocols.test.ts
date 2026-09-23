import { describe, expect, it } from 'vitest';
import { familyFromDescription, inferFamily, normalizeProtocolSetting } from '../src/protocols.ts';

describe('normalizeProtocolSetting', () => {
  it('accepts every form the config schema allows (obd-12)', () => {
    expect(normalizeProtocolSetting('0')).toBe('0');
    expect(normalizeProtocolSetting('6')).toBe('6');
    expect(normalizeProtocolSetting('c')).toBe('C');
    expect(normalizeProtocolSetting('A6')).toBe('A6');
    expect(normalizeProtocolSetting('ac')).toBe('AC');
    expect(normalizeProtocolSetting('6A')).toBe('A6'); // "6, else search"
    expect(normalizeProtocolSetting('AA')).toBe('AA');
    expect(normalizeProtocolSetting('A0')).toBe('0'); // automatic either way
    expect(normalizeProtocolSetting('0a')).toBe('0');
  });

  it('rejects anything else', () => {
    for (const bad of ['', 'Z', 'D', 'AD', 'DA', '66', 'A6A']) {
      expect(() => normalizeProtocolSetting(bad), bad).toThrow(RangeError);
    }
  });
});

describe('inferFamily', () => {
  it('reads the framing from visible headers', () => {
    expect(inferFamily(['7E8 06 41 00 BE 3F A8 13'])).toBe('can11');
    expect(inferFamily(['7E8064100BE3FA813'])).toBe('can11');
    expect(inferFamily(['18 DA F1 10 06 41 00 BE 3F A8 13'])).toBe('can29');
    expect(inferFamily(['48 6B 10 41 00 BE 3F B8 13 B9'])).toBe('legacy');
    expect(inferFamily(['41 6B 10 41 00 BE 3F B8 13 B9'])).toBe('legacy'); // J1850 PWM
  });

  it('does not guess from a headerless answer, which every bus prints alike (obd-10)', () => {
    expect(inferFamily(['41 00 BE 3F A8 13'])).toBeNull();
    expect(inferFamily(['4100BE3FA813'])).toBeNull();
  });
});

describe('familyFromDescription', () => {
  it('reads the framing from an AT DP description (obd-10)', () => {
    expect(familyFromDescription('AUTO, ISO 15765-4 (CAN 11/500)')).toBe('can11');
    expect(familyFromDescription('ISO 15765-4 (CAN 29/250)')).toBe('can29');
    expect(familyFromDescription('SAE J1939 (CAN 29/250)')).toBe('can29');
    expect(familyFromDescription('USER1 (CAN 11/125)')).toBe('can11');
    expect(familyFromDescription('AUTO, ISO 9141-2')).toBe('legacy');
    expect(familyFromDescription('ISO 14230-4 (KWP FAST)')).toBe('legacy');
    expect(familyFromDescription('SAE J1850 VPW')).toBe('legacy');
    expect(familyFromDescription('AUTO')).toBeNull();
    expect(familyFromDescription(null)).toBeNull();
  });
});
