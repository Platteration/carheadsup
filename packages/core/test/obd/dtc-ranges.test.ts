import { describe, expect, it } from 'vitest';
import {
  describeDtcRange,
  dtcRangeLabel,
  dtcSystemOf,
  isManufacturerSpecificDtc,
} from '../../src/obd/dtc-ranges.ts';
import type { DtcSeverity } from '../../src/types/vehicle.ts';

describe('dtcSystemOf', () => {
  it('maps the first letter to the system', () => {
    expect(dtcSystemOf('P0420')).toBe('powertrain');
    expect(dtcSystemOf('C0035')).toBe('chassis');
    expect(dtcSystemOf('B0001')).toBe('body');
    expect(dtcSystemOf('U0100')).toBe('network');
    expect(dtcSystemOf('u0100')).toBe('network');
  });

  it('falls back to powertrain for anything else', () => {
    expect(dtcSystemOf('')).toBe('powertrain');
    expect(dtcSystemOf('X1234')).toBe('powertrain');
  });
});

describe('isManufacturerSpecificDtc', () => {
  it('flags P1xxx and P30xx–P33xx only among powertrain codes', () => {
    for (const digit of '0123') {
      for (const block of '0123456789ABCDEF') {
        const code = `P${digit}${block}00`;
        const expected = digit === '1' || (digit === '3' && '0123'.includes(block));
        expect(isManufacturerSpecificDtc(code), code).toBe(expected);
      }
    }
  });

  it('flags B1/B2, C1/C2 and U1/U2', () => {
    for (const letter of 'BCU') {
      expect(isManufacturerSpecificDtc(`${letter}0123`)).toBe(false);
      expect(isManufacturerSpecificDtc(`${letter}1123`)).toBe(true);
      expect(isManufacturerSpecificDtc(`${letter}2123`)).toBe(true);
      expect(isManufacturerSpecificDtc(`${letter}3123`)).toBe(false);
    }
  });
});

describe('dtcRangeLabel', () => {
  it.each([
    ['P0301', 'P03xx'],
    ['P0A0F', 'P0Axx'],
    ['P2135', 'P21xx'],
    ['P3400', 'P34xx'],
    ['P1234', 'P1xxx'],
    ['P3012', 'P30xx–P33xx'],
    ['P33FF', 'P30xx–P33xx'],
    ['U0100', 'U01xx'],
    ['U1234', 'U1xxx'],
    ['U3000', 'U3xxx'],
    ['C0035', 'C0xxx'],
    ['B1234', 'B1xxx'],
  ])('%s → %s', (code, label) => {
    expect(dtcRangeLabel(code)).toBe(label);
  });
});

describe('describeDtcRange — SAE J2012 generic powertrain blocks', () => {
  it.each([
    ['P0001', 'Fuel and air metering and auxiliary emission controls', 'caution'],
    ['P0180', 'Fuel and air metering', 'caution'],
    ['P0261', 'Fuel and air metering', 'caution'],
    ['P0370', 'Ignition system or misfire', 'warning'],
    ['P0480', 'Auxiliary emission controls', 'caution'],
    ['P0540', 'Vehicle speed control, idle control and auxiliary inputs', 'caution'],
    ['P0601', 'Computer and auxiliary output circuits', 'warning'],
    ['P0700', 'Transmission', 'warning'],
    ['P0800', 'Transmission', 'warning'],
    ['P09FF', 'Transmission', 'warning'],
    ['P0A80', 'Hybrid / electric propulsion system', 'warning'],
    ['P0B3B', 'Hybrid / electric propulsion system', 'warning'],
    ['P0C73', 'Hybrid / electric propulsion system', 'warning'],
    ['P0D27', 'Hybrid / electric propulsion system', 'warning'],
    ['P0E55', 'Hybrid / electric propulsion system', 'warning'],
    ['P0F00', 'Generic powertrain code', 'caution'],
    ['P2000', 'Fuel and air metering and auxiliary emission controls', 'caution'],
    ['P2200', 'Fuel and air metering and auxiliary emission controls', 'caution'],
    ['P2300', 'Ignition system or misfire', 'warning'],
    ['P2400', 'Auxiliary emission controls', 'caution'],
    ['P2500', 'Auxiliary inputs', 'caution'],
    ['P2600', 'Computer and auxiliary output circuits', 'warning'],
    ['P2700', 'Transmission', 'warning'],
    ['P2800', 'Transmission', 'warning'],
    ['P2A00', 'Fuel and air metering and auxiliary emission controls', 'caution'],
    ['P2900', 'Generic powertrain code', 'caution'],
    ['P2F00', 'Generic powertrain code', 'caution'],
    ['P3400', 'Cylinder deactivation system', 'caution'],
    ['P3500', 'Generic powertrain code', 'caution'],
    ['P3FFF', 'Generic powertrain code', 'caution'],
  ] as const)('%s → %s (%s)', (code, description, severity) => {
    expect(describeDtcRange(code)).toMatchObject({ description, severity });
  });
});

describe('describeDtcRange — refined sub-ranges and the severity rubric', () => {
  it.each([
    // critical: continuing to drive risks immediate engine damage
    ['P0217', 'critical', 'Engine overheating'],
    ['P0298', 'critical', 'Engine oil overheating'],
    ['P0524', 'critical', 'Low oil pressure'],
    // warning: drivability, limp mode, damage if ignored
    ['P0300', 'warning', 'Engine misfire'],
    ['P0304', 'warning', 'Engine misfire'],
    ['P0316', 'warning', 'Engine misfire'],
    ['P0011', 'warning', 'Cam timing (VVT) fault'],
    ['P0122', 'warning', 'Throttle position sensor'],
    ['P0201', 'warning', 'Fuel injector circuit'],
    ['P0230', 'warning', 'Fuel pump circuit'],
    ['P0335', 'warning', 'Crank/cam sensor fault'],
    ['P0340', 'warning', 'Crank/cam sensor fault'],
    ['P0351', 'warning', 'Ignition coil circuit'],
    ['P0500', 'warning', 'Vehicle speed sensor'],
    ['P0521', 'warning', 'Oil pressure sensor'],
    ['P0562', 'warning', 'System voltage fault'],
    ['P2101', 'warning', 'Throttle actuator fault'],
    ['P2135', 'warning', 'Pedal/throttle sensor fault'],
    // caution: emissions / economy
    ['P0101', 'caution', 'Mass air flow sensor'],
    ['P0133', 'caution', 'Oxygen sensor fault'],
    ['P0155', 'caution', 'Oxygen sensor fault'],
    ['P0171', 'caution', 'Fuel mixture lean/rich'],
    ['P0174', 'caution', 'Fuel mixture lean/rich'],
    ['P0401', 'caution', 'EGR system fault'],
    ['P0420', 'caution', 'Catalytic converter fault'],
    ['P0430', 'caution', 'Catalytic converter fault'],
    ['P0455', 'caution', 'EVAP system fault'],
  ] as const)('%s → %s (%s)', (code, severity, short) => {
    expect(describeDtcRange(code)).toMatchObject({ severity, short });
  });

  it('keeps sub-range boundaries tight', () => {
    // Neighbours of the single-code critical entries fall back to their block.
    expect(describeDtcRange('P0216').severity).toBe('caution');
    expect(describeDtcRange('P0218').severity).toBe('caution');
    expect(describeDtcRange('P0297').severity).toBe('caution');
    expect(describeDtcRange('P0299').severity).toBe('caution');
    expect(describeDtcRange('P0525').severity).toBe('caution');
    // P0148/P0149 sit between the bank 1 and bank 2 O2 sensor groups.
    expect(describeDtcRange('P0148').short).toBe('Fuel/air metering fault');
    expect(describeDtcRange('P0147').short).toBe('Oxygen sensor fault');
    expect(describeDtcRange('P0150').short).toBe('Oxygen sensor fault');
    // Misfire group ends at P0316; the rest of P03xx is still ignition (warning).
    expect(describeDtcRange('P0317')).toMatchObject({
      short: 'Ignition or misfire fault',
      severity: 'warning',
    });
  });
});

describe('describeDtcRange — network, chassis, body and manufacturer codes', () => {
  it.each([
    ['U0001', 'Network wiring fault', 'warning'],
    ['U0100', 'Lost module communication', 'warning'],
    ['U0101', 'Lost module communication', 'warning'],
    ['U0200', 'Lost module communication', 'warning'],
    ['U0301', 'Module software mismatch', 'caution'],
    ['U0401', 'Invalid module data', 'caution'],
    ['U0500', 'Invalid module data', 'caution'],
    ['U0600', 'Network fault', 'caution'],
    ['U3000', 'Network fault', 'caution'],
    ['C0035', 'Chassis system fault', 'warning'],
    ['C3000', 'Chassis system fault', 'warning'],
    ['B0001', 'Body system fault', 'caution'],
    ['B3000', 'Body system fault', 'caution'],
    ['P1234', 'Maker-specific engine fault', 'caution'],
    ['P3000', 'Maker-specific engine fault', 'caution'],
    ['C1241', 'Maker-specific chassis fault', 'warning'],
    ['B1000', 'Maker-specific body fault', 'caution'],
    ['U2100', 'Maker-specific network fault', 'caution'],
  ] as const)('%s → %s (%s)', (code, short, severity) => {
    expect(describeDtcRange(code)).toMatchObject({ short, severity });
  });

  it('never treats a manufacturer code as one of the generic sub-ranges', () => {
    // 0x1217 would be "over temperature" if the P0 sub-range table leaked into P1xxx.
    expect(describeDtcRange('P1217').severity).toBe('caution');
    expect(describeDtcRange('P1300').short).toBe('Maker-specific engine fault');
  });
});

describe('describeDtcRange — every code', () => {
  it('yields a short label within 32 characters and a valid severity', () => {
    const severities: DtcSeverity[] = ['info', 'caution', 'warning', 'critical'];
    const hex = '0123456789ABCDEF';
    for (const letter of 'PCBU') {
      for (const digit of '0123') {
        for (const x of hex) {
          for (const y of hex) {
            const info = describeDtcRange(`${letter}${digit}${x}${y}0`);
            expect(info.short.length).toBeGreaterThan(0);
            expect(info.short.length).toBeLessThanOrEqual(32);
            expect(info.description.length).toBeGreaterThan(0);
            expect(severities).toContain(info.severity);
          }
        }
      }
    }
  });
});
