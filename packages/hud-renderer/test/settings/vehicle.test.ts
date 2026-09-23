import { KM_PER_MI } from '@carheadsup/core';
import type { CustomPidConfig } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import {
  COMMON_CUSTOM_SIGNALS,
  TYPICAL_GEAR_RATIOS,
  checkFormula,
  gearRatioUnit,
  missingTyrePids,
  newCustomPid,
  withExtraGear,
} from '../../src/settings/model/vehicle.ts';

describe('gear ratios', () => {
  it('starts from decreasing typical ratios', () => {
    for (let i = 1; i < TYPICAL_GEAR_RATIOS.length; i++) {
      expect(TYPICAL_GEAR_RATIOS[i]!).toBeLessThan(TYPICAL_GEAR_RATIOS[i - 1]!);
    }
  });

  it('adds a gear continuing the spacing', () => {
    expect(withExtraGear([100, 50])).toEqual([100, 50, 25]);
    expect(withExtraGear([40])).toEqual([40, 32.8]);
    expect(withExtraGear([])).toEqual([120]);
  });

  it('edits ratios per km/h or per mph', () => {
    const imperial = gearRatioUnit('imperial');
    expect(imperial.toDisplay(60)).toBeCloseTo(60 * KM_PER_MI, 9);
    expect(imperial.fromDisplay(imperial.toDisplay(37))).toBeCloseTo(37, 9);
    expect(gearRatioUnit('metric').toDisplay(60)).toBe(60);
  });
});

describe('checkFormula', () => {
  it('compiles valid formulas and evaluates them on sample bytes', () => {
    expect(checkFormula('((A*256)+B)/10')).toEqual({ ok: true, sample: (0x12 * 256 + 0x34) / 10 });
    expect(checkFormula('A-40')).toEqual({ ok: true, sample: 0x12 - 40 });
    expect(checkFormula('{B:0}')).toEqual({ ok: true, sample: 0 });
  });

  it('explains syntax errors with a position', () => {
    const result = checkFormula('(A*256');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^At character \d+: /);
    const unknown = checkFormula('A + foo');
    expect(unknown.ok).toBe(false);
  });

  it('rejects empty formulas and formulas that do not give a number', () => {
    expect(checkFormula('  ')).toEqual({
      ok: false,
      error: 'Enter a formula, e.g. ((A*256)+B)/10',
    });
    const divByZero = checkFormula('A/(B-B)');
    expect(divByZero.ok).toBe(false);
  });
});

describe('custom PIDs', () => {
  const pid = (signal: CustomPidConfig['signal']): CustomPidConfig => ({
    signal,
    mode: '22',
    pid: '1234',
    header: null,
    formula: 'A',
    intervalMs: 1000,
  });

  it('reports which tyre signals still need a PID', () => {
    expect(missingTyrePids([])).toEqual([
      'tirePressureFL',
      'tirePressureFR',
      'tirePressureRL',
      'tirePressureRR',
    ]);
    expect(missingTyrePids([pid('tirePressureFL'), pid('oilTemp')])).toEqual([
      'tirePressureFR',
      'tirePressureRL',
      'tirePressureRR',
    ]);
  });

  it('suggests the next unmapped signal for a new row', () => {
    expect(newCustomPid([], true).signal).toBe('tirePressureFL');
    expect(newCustomPid([pid('tirePressureFL')], true).signal).toBe('tirePressureFR');
    expect(newCustomPid([], false).signal).toBe('oilTemp');
    expect(newCustomPid([pid('oilTemp')], false)).toEqual({
      signal: 'tirePressureFL',
      mode: '22',
      pid: '',
      header: null,
      formula: 'A',
      intervalMs: 1000,
    });
    const common = COMMON_CUSTOM_SIGNALS.map(pid);
    expect(newCustomPid(common, false).signal).toBe('speed');
  });
});
