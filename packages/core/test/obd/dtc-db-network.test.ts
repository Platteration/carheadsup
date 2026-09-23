import { describe, expect, it } from 'vitest';
import { DTC_DATABASE, type DtcDbEntry } from '../../src/obd/dtc-database.ts';
import { BCU_CODES } from '../../src/obd/dtc-db-network.ts';
import { isManufacturerSpecificDtc } from '../../src/obd/dtc-ranges.ts';
import { DTC_SHORT_MAX_LENGTH, lookupDtc } from '../../src/obd/dtc.ts';
import type { DtcSeverity } from '../../src/types/vehicle.ts';

const SEVERITIES: ReadonlySet<DtcSeverity> = new Set(['info', 'caution', 'warning', 'critical']);
/** Generic network codes: U0xxx and the joint ISO/SAE U3xxx range (U1/U2 are manufacturer's). */
const KEY_PATTERN = /^U[03][0-9A-F]{3}$/;

const LOST = 'Lost Communication With ';
const INVALID = 'Invalid Data Received From ';
const SOFTWARE = 'Software Incompatibility With ';

const entries = Object.entries(BCU_CODES);
const codeValue = (code: string): number => Number.parseInt(code.slice(1), 16);

function entry(code: string): DtcDbEntry {
  const found = Object.hasOwn(BCU_CODES, code) ? BCU_CODES[code] : undefined;
  if (!found) throw new Error(`${code} is not in BCU_CODES`);
  return found;
}

/** The module a lost-communication / invalid-data / software code is about, if any. */
function moduleOf(description: string): string | undefined {
  for (const prefix of [LOST, INVALID, SOFTWARE]) {
    if (description.startsWith(prefix)) return description.slice(prefix.length);
  }
  return undefined;
}

describe('BCU_CODES table invariants', () => {
  it('holds a comprehensive generic network table', () => {
    expect(entries.length).toBeGreaterThanOrEqual(600);
    const lost = entries.filter(([, e]) => e.description.startsWith(LOST));
    const invalid = entries.filter(([, e]) => e.description.startsWith(INVALID));
    expect(lost.length).toBeGreaterThanOrEqual(250);
    expect(invalid.length).toBeGreaterThanOrEqual(250);
  });

  it('keys every entry by an upper-case, SAE-controlled network code', () => {
    for (const [code] of entries) {
      expect(code, code).toMatch(KEY_PATTERN);
      expect(code, code).not.toBe('U0000');
      expect(isManufacturerSpecificDtc(code), code).toBe(false);
    }
  });

  it('lists codes in ascending hex order', () => {
    const codes = entries.map(([code]) => code);
    const sorted = [...codes].sort((a, b) => codeValue(a) - codeValue(b));
    expect(codes).toEqual(sorted);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every code trimmed, non-empty text and a valid severity', () => {
    for (const [code, { description, short, severity }] of entries) {
      expect(description.length, code).toBeGreaterThan(0);
      expect(short.length, code).toBeGreaterThan(0);
      expect(description, code).toBe(description.trim());
      expect(short, code).toBe(short.trim());
      expect(description, code).not.toMatch(/\s{2}|[\t\n]/);
      expect(short, code).not.toMatch(/\s{2}|[\t\n]/);
      expect(SEVERITIES.has(severity), `${code} severity ${severity}`).toBe(true);
    }
  });

  it('keeps every HUD label within the display limit, so lookups never truncate', () => {
    const tooLong = entries.filter(([, e]) => e.short.length > DTC_SHORT_MAX_LENGTH);
    expect(tooLong).toEqual([]);
  });

  it('gives every code its own description', () => {
    const seen = new Map<string, string>();
    for (const [code, { description }] of entries) {
      expect(seen.get(description), `${code} repeats ${seen.get(description)}`).toBeUndefined();
      seen.set(description, code);
    }
  });

  it('writes descriptions in J2012 typography', () => {
    for (const [code, { description }] of entries) {
      expect(description.split('"').length % 2, code).toBe(1);
      expect(description, code).not.toMatch(/\b(?:with|from)\b/);
      expect(description, code).not.toMatch(/Received From With/);
    }
  });

  it('phrases labels consistently per kind of network fault', () => {
    for (const [code, { description, short }] of entries) {
      if (description.startsWith(LOST)) expect(short, code).toMatch(/ offline$|link lost$/);
      if (description.startsWith(INVALID)) expect(short, code).toMatch(/: bad data$|control data$/);
      if (description.startsWith(SOFTWARE)) expect(short, code).toMatch(/: wrong software$/);
    }
  });

  it('keeps letter designators other than "A" in the label', () => {
    for (const [code, { description, short }] of entries) {
      for (const [, letter] of description.matchAll(/"([B-P])"/g)) {
        expect(short, code).toMatch(new RegExp(`(?<![A-Za-z])${letter}(?![a-z])`));
      }
    }
  });
});

describe('BCU_CODES severity rubric', () => {
  it('treats lost communication with engine, transmission and brake modules as warnings', () => {
    const drivetrain = entries.filter(([, e]) =>
      /^Lost Communication With (?:ECM\/PCM|TCM|Anti-Lock Brake System)/.test(e.description),
    );
    expect(drivetrain.map(([code]) => code)).toEqual(['U0100', 'U0101', 'U0115', 'U0121']);
    for (const [code, { severity }] of drivetrain) expect(severity, code).toBe('warning');
  });

  it('rates a module the same whether it went silent, sent bad data or has wrong software', () => {
    const byModule = new Map<string, Set<DtcSeverity>>();
    for (const [, { description, severity }] of entries) {
      const module = moduleOf(description)?.replace(/ \(ABS\)| \(IPC\)/, '');
      if (!module) continue;
      byModule.set(module, (byModule.get(module) ?? new Set()).add(severity));
    }
    const mixed = [...byModule].filter(([, severities]) => severities.size > 1);
    expect(mixed).toEqual([]);
  });

  it('never rates a network fault critical', () => {
    // Loss of a module is reported by other modules; the module's own fault codes carry the risk.
    expect(entries.filter(([, e]) => e.severity === 'critical')).toEqual([]);
  });

  it('keeps comfort and infotainment modules at info', () => {
    for (const code of ['U0184', 'U0197', 'U0208', 'U0485', 'U0509']) {
      expect(entry(code).severity, code).toBe('info');
    }
  });
});

describe('BCU_CODES well-known codes', () => {
  it('decodes lost communication with the engine and transmission computers', () => {
    expect(entry('U0100')).toEqual({
      description: 'Lost Communication With ECM/PCM "A"',
      short: 'Engine computer offline',
      severity: 'warning',
    });
    expect(entry('U0101')).toEqual({
      description: 'Lost Communication With TCM',
      short: 'Transmission computer offline',
      severity: 'warning',
    });
    expect(entry('U0115').short).toBe('Engine computer B offline');
  });

  it('decodes lost communication with the ABS and body control modules', () => {
    expect(entry('U0121')).toEqual({
      description: 'Lost Communication With Anti-Lock Brake System (ABS) Control Module',
      short: 'ABS module offline',
      severity: 'warning',
    });
    expect(entry('U0140')).toEqual({
      description: 'Lost Communication With Body Control Module',
      short: 'Body control module offline',
      severity: 'warning',
    });
    expect(entry('U0141').short).toBe('Body control module A offline');
  });

  it('decodes other frequently reported network codes', () => {
    expect(entry('U0073')).toMatchObject({
      description: 'Control Module Communication Bus A Off',
      short: 'Module comms bus A off',
      severity: 'warning',
    });
    expect(entry('U0155')).toMatchObject({
      short: 'Instrument cluster offline',
      severity: 'warning',
    });
    expect(entry('U0151')).toMatchObject({ short: 'Airbag module offline', severity: 'warning' });
    expect(entry('U0401')).toEqual({
      description: 'Invalid Data Received From ECM/PCM "A"',
      short: 'Engine computer: bad data',
      severity: 'warning',
    });
    expect(entry('U0415').short).toBe('ABS module: bad data');
    expect(entry('U0302')).toMatchObject({
      description: 'Software Incompatibility With Transmission Control Module',
      short: 'Trans computer: wrong software',
    });
  });

  it('decodes communication bus faults', () => {
    expect(entry('U0001')).toEqual({
      description: 'High Speed CAN Communication Bus',
      short: 'High-speed CAN bus fault',
      severity: 'warning',
    });
    expect(entry('U0009').short).toBe('High-speed CAN bus +/- shorted');
    expect(entry('U0019').severity).toBe('caution');
    expect(entry('U0088').description).toBe('Vehicle Communication Bus F (-) shorted to Bus F (+)');
  });

  it('decodes module self-diagnostics (U30xx)', () => {
    expect(entry('U3000')).toMatchObject({ short: 'Control module fault', severity: 'warning' });
    expect(entry('U3003')).toEqual({
      description: 'Battery Voltage',
      short: 'Battery voltage fault',
      severity: 'warning',
    });
    expect(entry('U3006').description).toBe('Control Module Input Power "A"');
  });
});

describe('BCU_CODES curation', () => {
  it('leaves generic body and chassis codes to the range fallback', () => {
    // SAE and manufacturers (e.g. GM) assign different meanings to the same B0/C0 numbers.
    expect(entries.filter(([code]) => !code.startsWith('U'))).toEqual([]);
    expect(lookupDtc('C0035')).toMatchObject({ system: 'chassis', known: false });
    expect(lookupDtc('B0012')).toMatchObject({ system: 'body', known: false });
  });

  it('leaves out network codes whose definition could not be verified', () => {
    expect(Object.hasOwn(BCU_CODES, 'U02A0')).toBe(false);
    expect(lookupDtc('U02A0')).toMatchObject({ known: false, manufacturerSpecific: false });
  });

  it('uses the corrected J2012 text for U040A, the invalid-data twin of U010F', () => {
    // The 2002 table repeated U048A's "Digital Disc Player/Changer Module C" text at U040A.
    expect(entry('U040A')).toEqual({
      description: 'Invalid Data Received From Air Conditioning Control Module',
      short: 'A/C module: bad data',
      severity: 'info',
    });
    expect(entry('U010F').description).toBe(
      'Lost Communication With Air Conditioning Control Module',
    );
    expect(entry('U048A').description).toBe(
      'Invalid Data Received From Digital Disc Player/Changer Module "C"',
    );
  });

  it('labels ignition-input self-diagnostics as faults, never as an ignition status', () => {
    const inputs = entries.filter(([, e]) => /^Ignition (?:Input|Switch)\b/.test(e.description));
    expect(inputs.map(([code]) => code)).toEqual([
      'U300A',
      'U300B',
      'U300C',
      'U300D',
      'U300E',
      'U300F',
      'U3010',
      'U3011',
    ]);
    for (const [code, { short }] of inputs) expect(short, code).toMatch(/ fault$/);
    expect(entry('U300E').short).toBe('Ignition on input fault');
  });

  it('never lists manufacturer-controlled network codes', () => {
    for (const code of ['U1000', 'U2100', 'U1FFF']) {
      expect(Object.hasOwn(BCU_CODES, code), code).toBe(false);
      expect(lookupDtc(code).manufacturerSpecific, code).toBe(true);
    }
  });
});

describe('BCU_CODES through lookupDtc', () => {
  it('is merged into the database unchanged', () => {
    for (const [code, e] of entries) {
      expect(DTC_DATABASE[code], code).toBe(e);
    }
  });

  it('decodes every code as a known generic network code with its own text', () => {
    for (const [code, e] of entries) {
      expect(lookupDtc(code), code).toEqual({
        code,
        system: 'network',
        description: e.description,
        short: e.short,
        severity: e.severity,
        manufacturerSpecific: false,
        known: true,
      });
    }
  });

  it('finds codes typed in lower case or with surrounding whitespace', () => {
    expect(lookupDtc('\tu0100 ')).toMatchObject({ code: 'U0100', known: true });
  });
});
