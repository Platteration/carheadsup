import type { ApiSystemHealth } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { systemHealthSummary } from '../../src/settings/sections/status.tsx';

const FINE: ApiSystemHealth = {
  socTempC: 54.3,
  underVoltage: false,
  underVoltageSeen: false,
  throttled: false,
  throttledSeen: false,
};

describe('systemHealthSummary', () => {
  it('is OK with the temperature and the supply', () => {
    expect(systemHealthSummary(FINE)).toEqual({
      tone: 'ok',
      value: 'OK',
      sub: '54 °C · supply OK',
      note: null,
    });
  });

  it('puts an under-voltage first, then throttling, then heat', () => {
    expect(
      systemHealthSummary({ ...FINE, underVoltage: true, underVoltageSeen: true, throttled: true }),
    ).toMatchObject({
      tone: 'critical',
      value: 'Under-voltage',
      sub: '54 °C · check the 5 V supply',
    });
    expect(systemHealthSummary({ ...FINE, throttled: true, socTempC: 84 })).toMatchObject({
      tone: 'caution',
      value: 'Slowed down',
    });
    expect(systemHealthSummary({ ...FINE, socTempC: 81 })).toMatchObject({
      tone: 'caution',
      value: 'Hot',
    });
  });

  it('says what happened earlier', () => {
    expect(
      systemHealthSummary({ ...FINE, underVoltageSeen: true, throttledSeen: true }).note,
    ).toMatch(/supply sagged/);
    expect(systemHealthSummary({ ...FINE, throttledSeen: true }).note).toMatch(/Slowed down since/);
  });

  it('copes with what a machine does not report', () => {
    expect(
      systemHealthSummary({
        socTempC: null,
        underVoltage: null,
        underVoltageSeen: null,
        throttled: null,
        throttledSeen: null,
      }),
    ).toEqual({ tone: 'ok', value: 'OK', sub: null, note: null });
  });
});
