import { describe, expect, it } from 'vitest';
import { DTC_DATABASE, type DtcDbEntry } from '../../src/obd/dtc-database.ts';
import { P2_P3_CODES } from '../../src/obd/dtc-db-p2.ts';
import { isManufacturerSpecificDtc } from '../../src/obd/dtc-ranges.ts';
import { DTC_SHORT_MAX_LENGTH } from '../../src/obd/dtc.ts';
import { lookupDtc } from '../../src/obd/dtc-lookup.ts';
import type { DtcSeverity } from '../../src/types/vehicle.ts';

const SEVERITIES: ReadonlySet<DtcSeverity> = new Set(['info', 'caution', 'warning', 'critical']);
/** Generic P2xxx, plus the generic part of P3xxx (P30xx–P33xx belong to the manufacturer). */
const KEY_PATTERN = /^P(?:2[0-9A-F]{3}|3[4-9A-F][0-9A-F]{2})$/;
/**
 * The single bank a description is about: a closing "(Bank 2 Sensor 1)", a leading "Bank 1 …" or a
 * same-bank sensor pair "(Bank 1 Sensor 2 / Bank 1 Sensor 3)".
 */
const BANK =
  /\(Bank ([12])(?: (?:Sensor|Unit|Catalyst) \d)?\)$|^Bank ([12]) |\(Bank ([12]) Sensor \d \/ Bank \3 Sensor \d\)$/;

const entries = Object.entries(P2_P3_CODES);
const codeValue = (code: string): number => Number.parseInt(code.slice(1), 16);

function entry(code: string): DtcDbEntry {
  const found = Object.hasOwn(P2_P3_CODES, code) ? P2_P3_CODES[code] : undefined;
  if (!found) throw new Error(`${code} is not in P2_P3_CODES`);
  return found;
}

function entriesBetween(from: string, to: string): [string, DtcDbEntry][] {
  const lo = codeValue(from);
  const hi = codeValue(to);
  return entries.filter(([code]) => codeValue(code) >= lo && codeValue(code) <= hi);
}

const count = (text: string, char: string): number => text.split(char).length - 1;

describe('P2_P3_CODES table invariants', () => {
  it('holds a comprehensive generic table', () => {
    expect(entries.length).toBeGreaterThanOrEqual(1500);
    for (const block of ['0', '1', '2', '3', '4', '5', '6', '7', '8']) {
      const inBlock = entries.filter(([code]) => code.startsWith(`P2${block}`));
      expect(inBlock.length, `P2${block}xx`).toBeGreaterThanOrEqual(90);
    }
    expect(entries.filter(([code]) => code.startsWith('P34')).length).toBeGreaterThanOrEqual(100);
  });

  it('keys every entry by an upper-case, SAE-controlled P2/P3 code', () => {
    for (const [code] of entries) {
      expect(code, code).toMatch(KEY_PATTERN);
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
      expect(count(description, '"') % 2, code).toBe(0);
      expect(count(description, '('), code).toBe(count(description, ')'));
      // Letter designators are quoted ("A", "B" …); "A/C" is air conditioning.
      expect(description, code).not.toMatch(/(?<![\w"/+-])[A-P](?![\w"/+-])/);
      // Bank qualifiers are parenthesised, never trailing bare text.
      expect(description, code).not.toMatch(/ Bank [12](?: Sensor \d)?$/);
      expect(description, code).not.toMatch(/\bEGR\b/);
    }
  });

  it('names the engine bank in the label exactly when the description names one', () => {
    for (const [code, { description, short }] of entries) {
      const match = BANK.exec(description);
      const bank = match?.[1] ?? match?.[2] ?? match?.[3];
      if (bank) expect(short, code).toContain(`(B${bank})`);
      else expect(short, code).not.toMatch(/\(B[12]\)/);
    }
  });

  it('names the cylinder in the label whenever the description names one', () => {
    for (const [code, { description, short }] of entries) {
      for (const [, cylinder] of description.matchAll(/Cylinder (\d+)/g)) {
        expect(short, code).toMatch(new RegExp(`\\b${cylinder}\\b`));
      }
    }
  });

  it('keeps letter designators other than "A" in the label', () => {
    // Over-temperature codes name only which sensor saw the heat; the driver needs no letter.
    const exempt = (e: DtcDbEntry): boolean => e.short.endsWith('overheating');
    for (const [code, e] of entries) {
      if (exempt(e)) continue;
      for (const [, letter] of e.description.matchAll(/"([B-P])"/g)) {
        expect(e.short, code).toMatch(new RegExp(`(?<![A-Za-z])${letter}(?![a-z])`));
      }
    }
  });
});

describe('P2_P3_CODES severity rubric', () => {
  it('marks every forced engine shutdown and stuck-open throttle critical', () => {
    const shutdowns = entries.filter(([, e]) =>
      /Forced Engine Shutdown|Throttle Actuator.* - Stuck Open/.test(e.description),
    );
    expect(shutdowns.length).toBeGreaterThanOrEqual(8);
    for (const [code, { severity }] of shutdowns) expect(severity, code).toBe('critical');
  });

  it('treats throttle actuator faults as at least drivability warnings', () => {
    const throttle = entriesBetween('P2100', 'P2119');
    expect(throttle.length).toBeGreaterThanOrEqual(20);
    for (const [code, { severity }] of throttle) {
      expect(['warning', 'critical'], code).toContain(severity);
    }
  });

  it('treats throttle/pedal position sensor faults as warnings', () => {
    const pedal = entries.filter(([, e]) => e.description.startsWith('Throttle/Pedal Position'));
    expect(pedal.length).toBeGreaterThanOrEqual(30);
    for (const [code, { severity }] of pedal) expect(severity, code).toBe('warning');
  });

  it('treats O2 and NOx sensors and catalyst efficiency as emissions cautions', () => {
    const emissions = entries.filter(([, e]) =>
      /^(?:O2 Sensor|NOx Sensor)|Catalyst Efficiency Below Threshold/.test(e.description),
    );
    expect(emissions.length).toBeGreaterThanOrEqual(150);
    for (const [code, { severity }] of emissions) expect(severity, code).toBe('caution');
  });

  it('treats transmission and torque converter over-temperature as critical', () => {
    const hot = entries.filter(([, e]) =>
      /^Transmission Fluid Temperature Sensor .* Over Temperature Condition$|^Torque Converter Temperature Too High$/.test(
        e.description,
      ),
    );
    expect(hot.map(([code]) => code)).toEqual(['P273F', 'P274F', 'P275F', 'P2783']);
    for (const [code, { severity }] of hot) expect(severity, code).toBe('critical');
  });

  it('keeps critical for conditions that risk immediate damage or safety', () => {
    const critical = entries.filter(([, e]) => e.severity === 'critical').map(([code]) => code);
    expect(critical).toEqual([
      'P2105',
      'P2111',
      'P211A',
      'P213E',
      'P213F',
      'P228A',
      'P228B',
      'P232A',
      'P240D',
      'P240E',
      'P250F',
      'P25BD',
      'P270A',
      'P270B',
      'P270C',
      'P270D',
      'P270E',
      'P270F',
      'P273F',
      'P274F',
      'P275F',
      'P2783',
      'P2787',
      'P2883',
    ]);
  });

  it('treats an overheating transmission clutch like an overheating transmission', () => {
    const clutches = entries.filter(([, e]) =>
      /^(?:Transmission Friction Element "[A-H]"|Clutch|Engine Disconnect Clutch) Temperature Too High$/.test(
        e.description,
      ),
    );
    expect(clutches).toHaveLength(8);
    for (const [code, { severity }] of clutches) expect(severity, code).toBe('critical');
    // An overheating actuator motor only disables shifting: limp home, not immediate damage.
    expect(entry('P2785').severity).toBe('warning');
    expect(entry('P2786').severity).toBe('warning');
  });

  it('treats catalyst and filter over-temperature as damage-if-ignored warnings', () => {
    const hot = entries.filter(([, e]) =>
      /^(?:SCR NOx (?:Pre-)?Catalyst|NOx Adsorber|Catalyst System|Particulate Filter).*(?:Over Temperature|Temperature Too High)/.test(
        e.description,
      ),
    );
    expect(hot.length).toBeGreaterThanOrEqual(14);
    for (const [code, { severity }] of hot) expect(severity, code).toBe('warning');
    expect(entry('P214A')).toMatchObject({ short: 'NOx catalyst inlet too hot' });
    expect(entry('P22FF').severity).toBe('caution'); // too cold only delays NOx conversion
  });

  it('rates starter relay faults like the generic starter relay "A" codes', () => {
    const relays = entries.filter(([, e]) => e.description.startsWith('Starter Relay'));
    expect(relays).toHaveLength(7);
    // A relay stuck on keeps the starter engaged; stuck off or open means no restart.
    const p0Severity = DTC_DATABASE['P0615']?.severity;
    expect(p0Severity).toBeDefined();
    for (const [code, { severity }] of relays) expect(severity, code).toBe(p0Severity);
  });

  it('treats the engine-off timers that gate the EVAP monitor as emissions cautions', () => {
    expect(entry('P2610')).toMatchObject({
      description: 'ECM/PCM Engine Off Timer Performance',
      severity: 'caution',
    });
    expect(entry('P262B').severity).toBe('caution');
  });
});

describe('P2_P3_CODES label wording', () => {
  it('never lets a sensor or control-circuit fault read like the measured condition', () => {
    const circuits = entries.filter(([, e]) =>
      /^(?:Exhaust Gas Temperature Sensor|Piston Cooling Oil Control|Injector Control Pressure Regulator|Fuel Pressure Regulator \d Control|Vacuum Reservoir Control|Vacuum Pump Control) Circuit (?:Low|High|Range\/Performance)/.test(
        e.description,
      ),
    );
    expect(circuits.length).toBeGreaterThanOrEqual(36);
    for (const [code, { short }] of circuits) {
      expect(short, code).toMatch(/\b(?:sensor|circuit|control)\b/);
    }
    expect(entry('P2033').short).toBe('Exhaust temp sensor 2 high (B1)');
    expect(entry('P2080').short).toBe('Exhaust temp sensor 1 fault (B1)');
    expect(entry('P25AA').short).toBe('Piston cooling control low');
  });

  it('gives each code its own label unless the codes mean the same to the driver', () => {
    const byLabel = new Map<string, string[]>();
    for (const [code, { short }] of entries)
      byLabel.set(short, [...(byLabel.get(short) ?? []), code]);
    const shared = [...byLabel].filter(([, codes]) => codes.length > 1);
    // Three fluid temperature sensors reporting the same over-temperature.
    expect(shared).toEqual([['Transmission overheating', ['P273F', 'P274F', 'P275F']]]);
  });

  it('separates the aftertreatment injector and glow plug control circuits from their own', () => {
    expect(entry('P20CB').short).toBe('Exhaust injector A control open');
    expect(entry('P2697').short).toBe('Exhaust injector A circuit open');
    expect(entry('P269D').short).toBe('Exhaust glow plug control low');
    expect(entry('P26A1').short).toBe('Exhaust glow plug circuit low');
  });

  it('names the polarity of wide-band O2 current control circuits', () => {
    for (const [code, e] of entries) {
      if (e.description.startsWith('O2 Sensor Positive Current Control')) {
        expect(e.short, code).toContain('O2 +current');
      }
      if (e.description.startsWith('O2 Sensor Negative Current Control')) {
        expect(e.short, code).toContain('O2 -current');
      }
    }
    expect(entry('P2251').short).toBe('Upstream O2 -current open (B1)');
    expect(entry('P2A06').short).toBe('Upstream O2 below 0 V (B1)');
  });

  it('names alternative fuel, not "gas", in leak warnings', () => {
    expect(entry('P240D')).toMatchObject({
      description: 'Alternative Fuel Low Pressure System Leak',
      short: 'Alt-fuel leak (low pressure)',
      severity: 'critical',
    });
    expect(entry('P240E').short).toBe('Alt-fuel leak (high pressure)');
  });

  it('uses the current J2012 wording for fuel pressure regulator 2 (P2294)', () => {
    expect(entry('P2294')).toEqual({
      description: 'Fuel Pressure Regulator 2 Control Circuit/Open',
      short: 'Fuel pressure reg 2 circuit open',
      severity: 'warning',
    });
  });
});

describe('P2_P3_CODES well-known codes', () => {
  it('decodes the throttle/pedal sensor A/B correlation (P2135)', () => {
    expect(entry('P2135')).toEqual({
      description: 'Throttle/Pedal Position Sensor/Switch "A"/"B" Voltage Correlation',
      short: 'Throttle/pedal A/B mismatch',
      severity: 'warning',
    });
    expect(entry('P2138').short).toBe('Throttle/pedal D/E mismatch');
  });

  it('decodes post-catalyst fuel trim (P2096–P2099)', () => {
    expect(entry('P2096')).toEqual({
      description: 'Post Catalyst Fuel Trim System Too Lean (Bank 1)',
      short: 'Lean after catalyst (B1)',
      severity: 'caution',
    });
    expect(entry('P2099').short).toBe('Rich after catalyst (B2)');
  });

  it('decodes particulate filter soot and ash restriction', () => {
    expect(entry('P2463')).toEqual({
      description: 'Particulate Filter Restriction - Soot Accumulation (Bank 1)',
      short: 'Exhaust filter soot buildup (B1)',
      severity: 'warning',
    });
    expect(entry('P242F')).toMatchObject({
      short: 'Exhaust filter ash buildup (B1)',
      severity: 'warning',
    });
    expect(entry('P2002')).toMatchObject({
      description: 'Particulate Filter Efficiency Below Threshold (Bank 1)',
      severity: 'caution',
    });
  });

  it('decodes SCR/DEF aftertreatment codes', () => {
    expect(entry('P20EE')).toEqual({
      description: 'SCR NOx Catalyst Efficiency Below Threshold (Bank 1)',
      short: 'NOx catalyst efficiency low (B1)',
      severity: 'caution',
    });
    expect(entry('P2047')).toMatchObject({
      description: 'Reductant Injection Valve Circuit/Open (Bank 1 Unit 1)',
      short: 'DEF injector circuit open (B1)',
    });
    expect(entry('P2053').short).toBe('DEF injector 2 circuit open (B1)');
    expect(entry('P203F')).toMatchObject({ short: 'DEF level too low', severity: 'warning' });
    expect(entry('P2BAD')).toEqual({
      description: 'NOx Exceedence - Root Cause Unknown',
      short: 'NOx too high, cause unknown',
      severity: 'warning',
    });
  });

  it('decodes throttle actuator codes', () => {
    expect(entry('P2100')).toEqual({
      description: 'Throttle Actuator "A" Control Motor Circuit/Open',
      short: 'Throttle motor circuit open',
      severity: 'warning',
    });
    expect(entry('P2105')).toMatchObject({
      description: 'Throttle Actuator Control System - Forced Engine Shutdown',
      severity: 'critical',
    });
    expect(entry('P2106').short).toBe('Throttle fault: reduced power');
    expect(entry('P210F').short).toBe('Throttle B fault: RPM limited');
  });

  it('decodes O2 sensor codes with upstream/downstream positions', () => {
    expect(entry('P2195')).toMatchObject({
      description: 'O2 Sensor Signal Biased/Stuck Lean (Bank 1 Sensor 1)',
      short: 'Upstream O2 stuck lean (B1)',
    });
    expect(entry('P2270').short).toBe('Downstream O2 stuck lean (B1)');
    expect(entry('P2274').short).toBe('O2 sensor 3 stuck lean (B1)');
    expect(entry('P2A00').short).toBe('Upstream O2 sensor fault (B1)');
  });

  it('decodes other frequently reported codes', () => {
    expect(entry('P2279')).toMatchObject({ short: 'Intake air leak', severity: 'caution' });
    expect(entry('P2181')).toMatchObject({ short: 'Cooling system fault', severity: 'warning' });
    expect(entry('P2503')).toMatchObject({ short: 'Charging voltage low', severity: 'warning' });
    expect(entry('P2646')).toMatchObject({
      description: '"A" Rocker Arm Actuator System Performance/Stuck Off (Bank 1)',
      short: 'Rocker arm A stuck off (B1)',
    });
    expect(entry('P2A12').description).toBe(
      'Injection Pump Fuel Metering Control "C" (Cam/Rotor/Injector)',
    );
  });

  it('decodes cylinder deactivation codes (P34xx)', () => {
    expect(entry('P3400')).toEqual({
      description: 'Cylinder Deactivation System (Bank 1)',
      short: 'Cylinder deactivation fault (B1)',
      severity: 'caution',
    });
    expect(entry('P3401').short).toBe('Cyl 1 deactivation circuit open');
    expect(entry('P3497').short).toBe('Cylinder deactivation fault (B2)');
  });
});

describe('P2_P3_CODES curation', () => {
  it('leaves out codes that could not be verified, so the range fallback describes them', () => {
    for (const code of ['P26EA', 'P2BB0', 'P2C00', 'P2D00', 'P2E00', 'P3500']) {
      expect(Object.hasOwn(P2_P3_CODES, code), code).toBe(false);
      expect(lookupDtc(code), code).toMatchObject({ known: false, manufacturerSpecific: false });
    }
  });

  it('never lists manufacturer-controlled codes', () => {
    for (const code of ['P3000', 'P3300', 'P33FF']) {
      expect(Object.hasOwn(P2_P3_CODES, code), code).toBe(false);
    }
  });
});

describe('P2_P3_CODES through lookupDtc', () => {
  it('is merged into the database unchanged', () => {
    for (const [code, e] of entries) {
      expect(DTC_DATABASE[code], code).toBe(e);
    }
  });

  it('decodes every code as a known generic powertrain code with its own text', () => {
    for (const [code, e] of entries) {
      expect(lookupDtc(code), code).toEqual({
        code,
        system: 'powertrain',
        description: e.description,
        short: e.short,
        severity: e.severity,
        manufacturerSpecific: false,
        known: true,
      });
    }
  });

  it('finds codes typed in lower case or with surrounding whitespace', () => {
    expect(lookupDtc(' p2135 ')).toMatchObject({ code: 'P2135', known: true });
    expect(lookupDtc('p20ee')).toMatchObject({ code: 'P20EE', known: true });
  });
});
