import { describe, expect, it, vi } from 'vitest';
import type { DtcDbEntry } from '../../src/obd/dtc-database.ts';
import { explainDtc } from '../../src/obd/dtc-explainer.ts';

// Pin a small, known database so the explainer can be tested deterministically.
// vi.mock is hoisted above the imports.
vi.mock('../../src/obd/dtc-database.ts', () => {
  const DTC_DATABASE: Record<string, DtcDbEntry> = {
    P0420: {
      description: 'Catalyst System Efficiency Below Threshold (Bank 1)',
      short: 'Catalytic converter efficiency',
      severity: 'caution',
    },
    P0300: {
      description: 'Random/Multiple Cylinder Misfire Detected',
      short: 'Random misfire',
      severity: 'warning',
    },
    P0217: {
      description: 'Engine Coolant Over Temperature Condition',
      short: 'Engine overheating',
      severity: 'critical',
    },
    P0442: {
      description: 'Evaporative Emission System Leak Detected (small leak)',
      short: 'Small EVAP leak',
      severity: 'info',
    },
  };
  return { DTC_DATABASE };
});

describe('explainDtc', () => {
  it('adds curated causes and a verdict to a known code', () => {
    const explained = explainDtc('P0420');
    expect(explained.code).toBe('P0420');
    expect(explained.known).toBe(true);
    expect(explained.causes).toContain('Aging catalytic converter losing efficiency');
    expect(explained.verdict).toBe('schedule-service');
    expect(explained.guidance).toContain('Safe to keep driving normally');
  });

  it('maps severity to the safe-to-drive verdict', () => {
    expect(explainDtc('P0217').verdict).toBe('stop-now');
    expect(explainDtc('P0217').guidance).toContain('Pull over safely');
    expect(explainDtc('P0300').verdict).toBe('drive-cautiously');
    expect(explainDtc('P0442').verdict).toBe('no-action');
  });

  it('uses curated guidance overrides where present', () => {
    expect(explainDtc('P0300').guidance).toContain('flashing');
    expect(explainDtc('P0442').guidance).toContain('gas cap');
  });

  it('matches code families by pattern', () => {
    const explained = explainDtc('P0304');
    expect(explained.causes).toContain(
      'Worn spark plug on the indicated cylinder',
    );
    expect(explained.verdict).toBe('drive-cautiously');
  });

  it('falls back to system causes for unlisted codes', () => {
    const explained = explainDtc('P0999');
    expect(explained.known).toBe(false);
    expect(explained.causes.length).toBeGreaterThan(1);
    expect(explained.causes[0]).toContain('transmission');
  });

  it('never throws on invalid input', () => {
    const explained = explainDtc('not-a-code');
    expect(explained.known).toBe(false);
    expect(explained.verdict).toBe('schedule-service');
    expect(explained.causes.length).toBeGreaterThan(0);
    expect(explained.guidance.length).toBeGreaterThan(0);
  });

  it('normalises the code before explaining', () => {
    expect(explainDtc(' p0420\t')).toMatchObject({ code: 'P0420', known: true });
  });
});
