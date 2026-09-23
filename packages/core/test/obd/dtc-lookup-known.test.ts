import { describe, expect, it, vi } from 'vitest';
import type { DtcDbEntry } from '../../src/obd/dtc-database.ts';
import { lookupDtc } from '../../src/obd/dtc.ts';

// The real database is filled by other modules; pin a small, known one so the "known code"
// path of lookupDtc can be tested deterministically. vi.mock is hoisted above the imports.
vi.mock('../../src/obd/dtc-database.ts', () => {
  const DTC_DATABASE: Record<string, DtcDbEntry> = {
    P0420: {
      description: 'Catalyst System Efficiency Below Threshold (Bank 1)',
      short: 'Catalytic converter efficiency',
      severity: 'caution',
    },
    P0217: {
      description: 'Engine Coolant Over Temperature Condition',
      short: '  Engine overheating  ',
      severity: 'critical',
    },
    P0442: {
      description: 'Evaporative Emission System Leak Detected (small leak)',
      short: 'Small EVAP leak',
      severity: 'info',
    },
    U0100: {
      description: 'Lost Communication With ECM/PCM "A"',
      short: 'Lost comms with engine ECU and more words',
      severity: 'warning',
    },
    B0001: {
      description: 'Driver Frontal Stage 1 Deployment Control',
      short: '',
      severity: 'warning',
    },
  };
  return { DTC_DATABASE };
});

describe('lookupDtc with a known database entry', () => {
  it('returns the database text and severity, marked known', () => {
    expect(lookupDtc('P0420')).toEqual({
      code: 'P0420',
      system: 'powertrain',
      description: 'Catalyst System Efficiency Below Threshold (Bank 1)',
      short: 'Catalytic converter efficiency',
      severity: 'caution',
      manufacturerSpecific: false,
      known: true,
    });
  });

  it('normalises the code before looking it up', () => {
    expect(lookupDtc(' p0420\t')).toMatchObject({ code: 'P0420', known: true });
    expect(lookupDtc('u0100')).toMatchObject({ code: 'U0100', system: 'network', known: true });
  });

  it('uses the database severity even where the range rubric would differ', () => {
    // P0442 sits in the EVAP group (caution by range), but a small leak is only "info".
    expect(lookupDtc('P0442')).toMatchObject({ severity: 'info', known: true });
    expect(lookupDtc('P0217')).toMatchObject({ severity: 'critical', known: true });
  });

  it('trims and clamps database labels to 32 characters', () => {
    expect(lookupDtc('P0217').short).toBe('Engine overheating');
    const clamped = lookupDtc('U0100').short;
    expect(clamped.length).toBeLessThanOrEqual(32);
    expect(clamped.endsWith('…')).toBe(true);
    expect(clamped.startsWith('Lost comms with engine ECU')).toBe(true);
  });

  it('falls back to the range label when an entry has no label', () => {
    expect(lookupDtc('B0001')).toMatchObject({
      known: true,
      short: 'Body system fault',
      description: 'Driver Frontal Stage 1 Deployment Control',
    });
  });

  it('synthesises codes that are missing from the database', () => {
    expect(lookupDtc('P0301')).toEqual({
      code: 'P0301',
      system: 'powertrain',
      description: 'Engine misfire detected (unlisted generic code in the P03xx range)',
      short: 'Engine misfire',
      severity: 'warning',
      manufacturerSpecific: false,
      known: false,
    });
  });

  it('never resolves prototype properties as database entries', () => {
    for (const input of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(lookupDtc(input)).toMatchObject({
        known: false,
        description: 'Unrecognised trouble code',
      });
    }
  });
});
