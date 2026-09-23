import { describe, expect, it } from 'vitest';
import { DTC_DATABASE, type DtcDbEntry } from '../../src/obd/dtc-database.ts';
import { P0_CODES } from '../../src/obd/dtc-db-p0.ts';
import { DTC_SHORT_MAX_LENGTH, lookupDtc } from '../../src/obd/dtc.ts';
import type { DtcSeverity } from '../../src/types/vehicle.ts';

const SEVERITIES: readonly DtcSeverity[] = ['info', 'caution', 'warning', 'critical'];
const KEY_PATTERN = /^P0[0-9A-F]{3}$/;

/** Decimal codes deliberately left out of the table (see the module doc comment). */
const KNOWN_GAPS: ReadonlySet<string> = new Set(['P0364']);

const entries = Object.entries(P0_CODES);
const codeValue = (code: string): number => Number.parseInt(code.slice(1), 16);
const decimalCode = (n: number): string => `P0${String(n).padStart(3, '0')}`;

function entry(code: string): DtcDbEntry {
  const found = Object.hasOwn(P0_CODES, code) ? P0_CODES[code] : undefined;
  if (!found) throw new Error(`${code} is not in P0_CODES`);
  return found;
}

/** Entries whose code lies in [from, to] (inclusive, compared as hex values like the DTC bytes). */
function entriesBetween(from: string, to: string): [string, DtcDbEntry][] {
  const lo = codeValue(from);
  const hi = codeValue(to);
  return entries.filter(([code]) => codeValue(code) >= lo && codeValue(code) <= hi);
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

describe('P0_CODES coverage', () => {
  it('holds a comprehensive generic table', () => {
    expect(entries.length).toBeGreaterThanOrEqual(800);
  });

  it('lists every decimal code P0001–P0999 apart from documented gaps', () => {
    const missing: string[] = [];
    for (let n = 1; n <= 999; n++) {
      const code = decimalCode(n);
      if (!Object.hasOwn(P0_CODES, code)) missing.push(code);
    }
    expect(missing.filter((code) => !KNOWN_GAPS.has(code))).toEqual([]);
  });

  it('covers every hundred block and the hybrid block', () => {
    for (const block of ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '0A']) {
      const inBlock = entries.filter(([code]) => code.slice(1, 3) === block);
      expect(inBlock.length, `P${block}xx`).toBeGreaterThanOrEqual(90);
    }
  });

  it('does not list P0000, which is not a fault', () => {
    expect(Object.hasOwn(P0_CODES, 'P0000')).toBe(false);
  });

  it('includes commonly reported hex-lettered codes in hex order', () => {
    const keys = Object.keys(P0_CODES);
    for (const [before, code, after] of [
      ['P0009', 'P000A', 'P0010'],
      ['P000D', 'P000F', 'P0010'],
      ['P0079', 'P007A', 'P0080'],
      ['P0099', 'P00B6', 'P0100'],
      ['P0129', 'P012B', 'P0130'],
      ['P0139', 'P013A', 'P0140'],
      ['P0259', 'P025A', 'P0260'],
      ['P0509', 'P050D', 'P0510'],
      ['P0699', 'P069E', 'P06A3'],
      ['P0699', 'P06DD', 'P0700'],
    ] as const) {
      expect(keys.indexOf(before)).toBeLessThan(keys.indexOf(code));
      expect(keys.indexOf(code)).toBeLessThan(keys.indexOf(after));
    }
    expect(entry('P000A')).toEqual({
      description: '"A" Camshaft Position Slow Response (Bank 1)',
      short: 'Cam timing A slow (B1)',
      severity: 'warning',
    });
    expect(entry('P013E').description).toBe(
      'O2 Sensor Delayed Response - Rich to Lean (Bank 1 Sensor 2)',
    );
    expect(entry('P06DD').severity).toBe('warning');
  });
});

describe('P0_CODES invariants', () => {
  it('uses uppercase five-character P0 keys', () => {
    const bad = entries.map(([code]) => code).filter((code) => !KEY_PATTERN.test(code));
    expect(bad).toEqual([]);
  });

  it('keeps keys in strictly ascending code order', () => {
    const keys = Object.keys(P0_CODES);
    const outOfOrder = keys.filter((code, i) => {
      const previous = keys[i - 1];
      return previous !== undefined && codeValue(previous) >= codeValue(code);
    });
    expect(outOfOrder).toEqual([]);
  });

  it('gives every entry exactly the DtcDbEntry fields', () => {
    for (const [code, e] of entries) {
      expect(Object.keys(e).sort(), code).toEqual(['description', 'severity', 'short']);
    }
  });

  it('uses a valid severity everywhere', () => {
    const bad = entries.filter(([, e]) => !SEVERITIES.includes(e.severity));
    expect(bad).toEqual([]);
  });

  it('has clean, official-style descriptions', () => {
    for (const [code, { description }] of entries) {
      expect(description.length, code).toBeGreaterThan(0);
      expect(description, code).toBe(description.trim());
      expect(description, code).not.toMatch(/\s{2,}/);
      // Title Case as in J2012: starts with a capital, a digit or a quoted "A"-style designator.
      expect(description, code).toMatch(/^["0-9A-Z]/);
      expect(count(description, '"') % 2, `${code} unbalanced quotes`).toBe(0);
      expect(count(description, '('), `${code} unbalanced parentheses`).toBe(
        count(description, ')'),
      );
      expect(description, code).not.toMatch(/\bP0[0-9A-F]{3}\b/);
    }
  });

  it('has glanceable short labels', () => {
    for (const [code, { short, description }] of entries) {
      expect(short.length, code).toBeGreaterThan(0);
      expect(short.length, `${code} "${short}"`).toBeLessThanOrEqual(DTC_SHORT_MAX_LENGTH);
      expect(short, code).toBe(short.trim());
      expect(short, code).not.toMatch(/\s{2,}/);
      expect(short, code).toMatch(/^[0-9A-Z]/);
      expect(short, `${code} has a code prefix`).not.toMatch(/\bP[0-3][0-9A-F]{3}\b/);
      expect(short, code).not.toMatch(/[.,:;\-–—]$/);
      expect(short.toLowerCase(), `${code} short repeats the description`).not.toBe(
        description.toLowerCase(),
      );
    }
  });

  it('keeps bank qualifiers consistent between description and short', () => {
    for (const [code, { short, description }] of entries) {
      const shortBank = /\(B([12])\)/.exec(short)?.[1];
      if (shortBank !== undefined) {
        expect(description, code).toContain(`Bank ${shortBank}`);
      }
      // Bank 2 faults must be distinguishable from their bank 1 twins at a glance.
      if (/\(Bank 2\b/.test(description)) {
        expect(short, code).toContain('(B2)');
      }
    }
  });

  it('names the O2 sensor position in plain words', () => {
    for (const [code, { short, description }] of entries) {
      const o2 = /^(?:O2 Sensor|HO2S) (?!Signals Swapped).*\(Bank [12] Sensor ([1-3])\)$/.exec(
        description,
      );
      if (!o2) continue;
      const expected = { '1': 'Upstream O2', '2': 'Downstream O2', '3': 'O2 sensor 3' }[
        o2[1] as '1' | '2' | '3'
      ];
      expect(short.startsWith(expected), `${code} "${short}"`).toBe(true);
    }
  });
});

describe('P0_CODES label accuracy', () => {
  /** Word test that ignores case, e.g. hasWord('Fan Speed Low', 'low'). */
  const hasWord = (text: string, word: string): boolean =>
    new RegExp(`\\b${word}\\b`, 'i').test(text);

  it('never swaps low and high between description and label', () => {
    for (const [code, { short, description }] of entries) {
      // "Low Pressure Fuel System" / "Low-side" name a subsystem, not a signal level.
      const desc = description.replace('Low Pressure Fuel System', '');
      const label = short.replace(/low-side/i, '');
      if (hasWord(desc, 'low') && !hasWord(desc, 'high')) {
        expect(hasWord(label, 'high'), `${code} "${short}"`).toBe(false);
      }
      if (hasWord(desc, 'high') && !hasWord(desc, 'low')) {
        expect(hasWord(label, 'low'), `${code} "${short}"`).toBe(false);
      }
    }
  });

  it('does not claim an open circuit for J2012 "Circuit/Open" codes', () => {
    const circuitOrOpen = entries.filter(([, e]) =>
      /Circuit(?: "[A-Z]")?\/Open/.test(e.description),
    );
    expect(circuitOrOpen.length).toBeGreaterThan(50);
    for (const [code, { short }] of circuitOrOpen) {
      expect(hasWord(short, 'open'), `${code} "${short}"`).toBe(false);
    }
  });

  it('keeps "open" on plain "Circuit Open" codes', () => {
    for (const code of ['P0413', 'P0416', 'P0444', 'P0447', 'P0543']) {
      expect(entry(code).description, code).toMatch(/Circuit Open$/);
      expect(hasWord(entry(code).short, 'open'), code).toBe(true);
    }
  });

  it('labels intermittent faults as intermittent or erratic', () => {
    for (const [code, { short, description }] of entries) {
      if (!/Intermittent|Erratic/.test(description)) continue;
      expect(short, code).toMatch(/intermittent|erratic/i);
    }
  });

  it('keeps single letter designators ("A", "B", ...) consistent with the label', () => {
    for (const [code, { short, description }] of entries) {
      const letters = new Set([...description.matchAll(/"([A-Z])"/g)].map((m) => m[1]));
      if (letters.size !== 1) continue;
      // "A/C" and "A/D" are abbreviations, not designators.
      const labelLetters = [...short.replace(/\bA\/[CD]\b/g, '').matchAll(/\b([A-F])\b/g)].map(
        (m) => m[1],
      );
      for (const letter of labelLetters)
        expect(letters.has(letter), `${code} "${short}"`).toBe(true);
    }
  });

  it('keeps the cylinder number in cylinder-specific labels', () => {
    for (const [code, { short, description }] of entries) {
      const cylinder = /^Cylinder (\d+)\b/.exec(description)?.[1];
      if (cylinder === undefined) continue;
      expect(short, code).toMatch(new RegExp(`^(?:Cylinder|Cyl) ${cylinder}\\b`));
    }
  });

  it('says "signal" where a low/high reading could be mistaken for the condition itself', () => {
    const expected: Record<string, string> = {
      P0117: 'Coolant temp sensor signal low',
      P0118: 'Coolant temp sensor signal high',
      P0197: 'Oil temp sensor signal low',
      P0198: 'Oil temp sensor signal high',
      P0462: 'Fuel level sensor signal low',
      P0463: 'Fuel level sensor signal high',
      P0522: 'Oil pressure sensor signal low',
      P0523: 'Oil pressure sensor signal high',
      P0712: 'Trans fluid temp signal low',
      P0713: 'Trans fluid temp signal high',
    };
    for (const [code, short] of Object.entries(expected))
      expect(entry(code).short, code).toBe(short);
    // The genuine conditions keep their plain wording.
    expect(entry('P0524').short).toBe('Oil pressure too low');
    expect(entry('P0217').short).toBe('Engine overheating');
  });

  it('does not blame the injector for a cylinder contribution/balance fault', () => {
    const balance = entries.filter(([, e]) => /Contribution\/Balance$/.test(e.description));
    expect(balance).toHaveLength(12);
    for (const [code, { short }] of balance) {
      expect(short, code).toMatch(/^Cylinder \d+ power balance fault$/);
    }
  });

  it('gives near-identical codes distinguishable labels', () => {
    const pairs = [
      ['P0412', 'P0413'],
      ['P0415', 'P0416'],
      ['P0396', 'P0399'],
      ['P0881', 'P0884'],
      ['P0A18', 'P0A21'],
      ['P0A4C', 'P0A4F'],
    ] as const;
    for (const [a, b] of pairs) expect(entry(a).short, `${a}/${b}`).not.toBe(entry(b).short);
  });
});

describe('P0_CODES verified corrections and additions', () => {
  it('uses the OEM service wording for the cold-start idle monitor', () => {
    expect(entry('P050A').description).toBe('Cold Start Idle Air Control System Performance');
  });

  it('uses the later knock sensor designators consistently', () => {
    expect(entry('P0325')).toMatchObject({
      description: 'Knock/Combustion Vibration Sensor "A" Circuit',
      short: 'Knock sensor A circuit',
    });
    expect(entry('P0330')).toMatchObject({
      description: 'Knock/Combustion Vibration Sensor "B" Circuit',
      short: 'Knock sensor B circuit',
    });
  });

  it.each<[string, DtcDbEntry]>([
    [
      'P000E',
      {
        description: 'Fuel Volume Regulator Control Exceeded Learning Limit',
        short: 'Fuel volume regulator at limit',
        severity: 'warning',
      },
    ],
    [
      'P000F',
      {
        description: 'Fuel System Over Pressure Relief Valve Activated',
        short: 'Fuel pressure relief valve open',
        severity: 'warning',
      },
    ],
    [
      'P007A',
      {
        description: 'Charge Air Cooler Temperature Sensor Circuit (Bank 1)',
        short: 'Intercooler temp sensor circuit',
        severity: 'caution',
      },
    ],
    [
      'P00B6',
      {
        description: 'Radiator Coolant Temperature/Engine Coolant Temperature Correlation',
        short: 'Radiator/engine temp mismatch',
        severity: 'warning',
      },
    ],
    [
      'P012B',
      {
        description: 'Turbocharger/Supercharger Inlet Pressure Sensor Circuit Range/Performance',
        short: 'Turbo inlet sensor out of range',
        severity: 'warning',
      },
    ],
    [
      'P025A',
      {
        description: 'Fuel Pump Module "A" Control Circuit/Open',
        short: 'Fuel pump module circuit',
        severity: 'warning',
      },
    ],
    [
      'P069E',
      {
        description: 'Fuel Pump Control Module Requested MIL Illumination',
        short: 'Fuel pump module fault reported',
        severity: 'warning',
      },
    ],
  ])('adds %s', (code, expected) => {
    expect(entry(code)).toEqual(expected);
  });

  it('adds complete families rather than isolated codes', () => {
    for (const family of [
      ['P007A', 'P007B', 'P007C', 'P007D', 'P007E'],
      ['P00B1', 'P00B2', 'P00B3', 'P00B4', 'P00B5', 'P00B6'],
      ['P012A', 'P012B', 'P012C', 'P012D', 'P012E'],
      ['P025A', 'P025B', 'P025C', 'P025D'],
    ]) {
      for (const code of family) expect(Object.hasOwn(P0_CODES, code), code).toBe(true);
    }
  });
});

describe('P0_CODES severity rubric', () => {
  it('reserves critical for conditions that risk immediate damage or safety', () => {
    const critical = entries.filter(([, e]) => e.severity === 'critical').map(([code]) => code);
    expect(critical).toEqual(['P0093', 'P0217', 'P0218', 'P0298', 'P0524', 'P0A7E', 'P0AA6']);
  });

  it('labels each cylinder misfire as a warning', () => {
    for (let n = 1; n <= 12; n++) {
      expect(entry(decimalCode(300 + n))).toEqual({
        description: `Cylinder ${n} Misfire Detected`,
        short: `Cylinder ${n} misfire`,
        severity: 'warning',
      });
    }
  });

  it('treats drivability faults as warnings', () => {
    const drivability = [
      ...entriesBetween('P0120', 'P0124'), // throttle/pedal position "A"
      ...entriesBetween('P0220', 'P0229'), // throttle/pedal position "B"/"C"
      ...entriesBetween('P0230', 'P0233'), // fuel pump
      ...entriesBetween('P0201', 'P0212'), // injector circuits
      ...entriesBetween('P0335', 'P0349'), // crank/cam position sensors
      ...entriesBetween('P0351', 'P0362'), // ignition coils
      ...entriesBetween('P0500', 'P0503'), // vehicle speed sensor
      ...entriesBetween('P0700', 'P0702'), // transmission control system
      ...entriesBetween('P0730', 'P0736'), // incorrect gear ratio
    ];
    expect(drivability.length).toBeGreaterThan(60);
    for (const [code, e] of drivability) expect(e.severity, code).toBe('warning');
  });

  it('treats emissions and economy faults as cautions', () => {
    const emissions = [
      ...entriesBetween('P0100', 'P0104'), // mass air flow
      ...entriesBetween('P0130', 'P0147'), // O2 sensors, bank 1
      ...entriesBetween('P0150', 'P0167'), // O2 sensors, bank 2
      ...entriesBetween('P0171', 'P0175'), // lean / rich
      ...entriesBetween('P0400', 'P0409'), // EGR
      ...entriesBetween('P0420', 'P0424'), // catalyst efficiency, bank 1
      ...entriesBetween('P0430', 'P0434'), // catalyst efficiency, bank 2
    ];
    for (const [code, e] of [...emissions, ['P0128', entry('P0128')] as const]) {
      expect(e.severity, code).toBe('caution');
    }
  });

  it('keeps transmission faults at caution or above, except indicator and mode switches', () => {
    const minor = entriesBetween('P0700', 'P09FF')
      .filter(([, e]) => e.severity === 'info')
      .map(([code]) => code);
    expect(minor).toEqual(['P0790', 'P0804']);
  });

  it('grades EVAP leaks by size', () => {
    expect(entry('P0442').severity).toBe('info');
    expect(entry('P0456').severity).toBe('info');
    expect(entry('P0457').severity).toBe('info');
    expect(entry('P0455').severity).toBe('caution');
  });
});

describe('well-known P0 codes', () => {
  it.each<[string, DtcDbEntry]>([
    [
      'P0171',
      {
        description: 'System Too Lean (Bank 1)',
        short: 'Engine running lean (B1)',
        severity: 'caution',
      },
    ],
    [
      'P0300',
      {
        description: 'Random/Multiple Cylinder Misfire Detected',
        short: 'Random/multiple misfire',
        severity: 'warning',
      },
    ],
    [
      'P0420',
      {
        description: 'Catalyst System Efficiency Below Threshold (Bank 1)',
        short: 'Catalytic converter efficiency',
        severity: 'caution',
      },
    ],
    [
      'P0442',
      {
        description: 'Evaporative Emission System Leak Detected (small leak)',
        short: 'Small fuel vapor leak (EVAP)',
        severity: 'info',
      },
    ],
    [
      'P0455',
      {
        description: 'Evaporative Emission System Leak Detected (large leak)',
        short: 'Large fuel vapor leak (EVAP)',
        severity: 'caution',
      },
    ],
    [
      'P0500',
      {
        description: 'Vehicle Speed Sensor "A" Circuit',
        short: 'Vehicle speed sensor circuit',
        severity: 'warning',
      },
    ],
    [
      'P0700',
      {
        description: 'Transmission Control System (MIL Request)',
        short: 'Transmission fault reported',
        severity: 'warning',
      },
    ],
    [
      'P0217',
      {
        description: 'Engine Coolant Over Temperature Condition',
        short: 'Engine overheating',
        severity: 'critical',
      },
    ],
    [
      'P0524',
      {
        description: 'Engine Oil Pressure Too Low',
        short: 'Oil pressure too low',
        severity: 'critical',
      },
    ],
  ])('%s', (code, expected) => {
    expect(entry(code)).toEqual(expected);
  });

  it('distinguishes bank 2 twins of bank 1 codes', () => {
    expect(entry('P0174').short).toBe('Engine running lean (B2)');
    expect(entry('P0430').description).toBe('Catalyst System Efficiency Below Threshold (Bank 2)');
    expect(entry('P0430').short).toContain('(B2)');
  });

  it('labels O2 sensors by position', () => {
    expect(entry('P0131').short).toBe('Upstream O2 sensor low (B1)');
    expect(entry('P0137').short).toBe('Downstream O2 sensor low (B1)');
    expect(entry('P0157').description).toBe('O2 Sensor Circuit Low Voltage (Bank 2 Sensor 2)');
  });

  it('includes hybrid codes', () => {
    expect(entry('P0A80')).toEqual({
      description: 'Replace Hybrid/EV Battery Pack',
      short: 'Replace hybrid battery',
      severity: 'warning',
    });
    expect(entry('P0AA6').severity).toBe('critical');
  });
});

describe('P0_CODES in the merged database', () => {
  it('is merged into DTC_DATABASE without being overridden', () => {
    const replaced = entries
      .filter(([code, e]) => (Object.hasOwn(DTC_DATABASE, code) ? DTC_DATABASE[code] : null) !== e)
      .map(([code]) => code);
    expect(replaced).toEqual([]);
  });

  it('decodes known codes through lookupDtc', () => {
    expect(lookupDtc(' p0420 ')).toEqual({
      code: 'P0420',
      system: 'powertrain',
      description: 'Catalyst System Efficiency Below Threshold (Bank 1)',
      short: 'Catalytic converter efficiency',
      severity: 'caution',
      manufacturerSpecific: false,
      known: true,
    });
    expect(lookupDtc('P0A7E')).toMatchObject({ known: true, severity: 'critical' });
  });

  it('falls back to the range description for a deliberate gap', () => {
    expect(lookupDtc('P0364')).toMatchObject({ known: false, severity: 'warning' });
  });
});
