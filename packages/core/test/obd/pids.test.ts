import { describe, expect, it } from 'vitest';
import {
  MODE01_PIDS,
  PID_MONITOR_STATUS,
  SIGNAL_META,
  SUPPORTED_PIDS_BASES,
  decodeMode01,
  getPid,
  isSupportedPidsQuery,
  nextSupportedPidsBase,
  parseMonitorStatus,
  parseSupportedPids,
  pidForSignal,
  signalsForPids,
} from '../../src/obd/pids.ts';
import { SIGNAL_IDS } from '../../src/types/signals.ts';
import type { SignalId } from '../../src/types/signals.ts';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

/** The standard PID named in each SignalId's comment in types/signals.ts. */
const EXPECTED_PID_FOR_SIGNAL: Partial<Record<SignalId, number>> = {
  speed: 0x0d,
  rpm: 0x0c,
  engineLoad: 0x04,
  absoluteLoad: 0x43,
  throttle: 0x11,
  relativeThrottle: 0x45,
  acceleratorPedal: 0x49,
  timingAdvance: 0x0e,
  transmissionGear: 0xa4,
  coolantTemp: 0x05,
  intakeAirTemp: 0x0f,
  oilTemp: 0x5c,
  ambientTemp: 0x46,
  catalystTempB1S1: 0x3c,
  maf: 0x10,
  map: 0x0b,
  baroPressure: 0x33,
  fuelLevel: 0x2f,
  fuelRate: 0x5e,
  fuelPressure: 0x0a,
  fuelRailPressure: 0x23,
  commandedLambda: 0x44,
  ethanolPercent: 0x52,
  shortFuelTrimB1: 0x06,
  longFuelTrimB1: 0x07,
  shortFuelTrimB2: 0x08,
  longFuelTrimB2: 0x09,
  controlModuleVoltage: 0x42,
  odometer: 0xa6,
  runTime: 0x1f,
  distanceSinceClear: 0x31,
  distanceWithMil: 0x21,
};

const SIGNALS_WITHOUT_STANDARD_PID: SignalId[] = [
  'batteryVoltage',
  'tirePressureFL',
  'tirePressureFR',
  'tirePressureRL',
  'tirePressureRR',
];

/** Decode `data` for `pid` and return the single value it yields for `signal`. */
function decodeValue(pid: number, signal: SignalId, data: Uint8Array): number | null | undefined {
  const result = decodeMode01(pid, data);
  return result === null ? null : result[signal];
}

describe('MODE01_PIDS', () => {
  it('covers every signal whose comment names a standard PID', () => {
    for (const [signal, pid] of Object.entries(EXPECTED_PID_FOR_SIGNAL)) {
      expect(pidForSignal(signal as SignalId)?.pid, signal).toBe(pid);
    }
  });

  it('has no PID for signals that are not standard mode 01 PIDs', () => {
    for (const signal of SIGNALS_WITHOUT_STANDARD_PID) {
      expect(pidForSignal(signal), signal).toBeUndefined();
    }
    // Every signal is accounted for by one of the two lists above.
    expect(Object.keys(EXPECTED_PID_FOR_SIGNAL).length + SIGNALS_WITHOUT_STANDARD_PID.length).toBe(
      SIGNAL_IDS.length,
    );
  });

  it('defines each PID once, as service 01, with a name and at least one signal', () => {
    const numbers = MODE01_PIDS.map((def) => def.pid);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const def of MODE01_PIDS) {
      expect(def.mode).toBe(0x01);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.signals.length).toBeGreaterThan(0);
      expect(def.bytes).toBeGreaterThanOrEqual(1);
      expect(def.bytes).toBeLessThanOrEqual(4);
      expect(isSupportedPidsQuery(def.pid)).toBe(false);
    }
  });

  it('is frozen so consumers cannot mutate the shared table', () => {
    expect(Object.isFrozen(MODE01_PIDS)).toBe(true);
  });

  it.each(MODE01_PIDS.map((def) => [def.pid.toString(16).padStart(2, '0'), def] as const))(
    'PID 0x%s returns null for every payload shorter than its length',
    (_hex, def) => {
      for (let length = 0; length < def.bytes; length++) {
        expect(def.decode(new Uint8Array(length))).toBeNull();
      }
    },
  );

  it.each(MODE01_PIDS.map((def) => [def.pid.toString(16).padStart(2, '0'), def] as const))(
    'PID 0x%s decodes all-zero and all-0xFF payloads to finite values for its own signals only',
    (_hex, def) => {
      for (const fill of [0x00, 0xff]) {
        const result = def.decode(new Uint8Array(def.bytes).fill(fill));
        if (result === null) continue; // "not available" (e.g. odometer 0xFFFFFFFF, gear invalid)
        for (const [signal, value] of Object.entries(result)) {
          expect(def.signals).toContain(signal);
          expect(Number.isFinite(value)).toBe(true);
        }
      }
    },
  );
});

describe('decodeMode01 — J1979 formulas with real-world and boundary bytes', () => {
  type Case = [pid: number, signal: SignalId, data: number[], expected: number | null];
  const cases: Case[] = [
    // 0x04 calculated load: 100/255 · A
    [0x04, 'engineLoad', [0x00], 0],
    [0x04, 'engineLoad', [0x80], 50.196],
    [0x04, 'engineLoad', [0xff], 100],
    // 0x05 coolant: A − 40
    [0x05, 'coolantTemp', [0x00], -40],
    [0x05, 'coolantTemp', [0x7b], 83],
    [0x05, 'coolantTemp', [0xff], 215],
    // 0x06–0x09 fuel trims: (A − 128) · 100/128
    [0x06, 'shortFuelTrimB1', [0x00], -100],
    [0x06, 'shortFuelTrimB1', [0x80], 0],
    [0x06, 'shortFuelTrimB1', [0x85], 3.90625],
    [0x06, 'shortFuelTrimB1', [0xff], 99.21875],
    [0x07, 'longFuelTrimB1', [0x7a], -4.6875],
    [0x08, 'shortFuelTrimB2', [0x8a], 7.8125],
    [0x09, 'longFuelTrimB2', [0x66], -20.3125],
    // 0x0A fuel pressure (gauge): 3A kPa
    [0x0a, 'fuelPressure', [0x00], 0],
    [0x0a, 'fuelPressure', [0x64], 300],
    [0x0a, 'fuelPressure', [0xff], 765],
    // 0x0B MAP: A kPa
    [0x0b, 'map', [0x21], 33],
    [0x0b, 'map', [0xff], 255],
    // 0x0C rpm: (256A + B) / 4
    [0x0c, 'rpm', [0x00, 0x00], 0],
    [0x0c, 'rpm', [0x0b, 0xb8], 750],
    [0x0c, 'rpm', [0x1a, 0xf8], 1726],
    [0x0c, 'rpm', [0xff, 0xff], 16383.75],
    // 0x0D speed: A km/h
    [0x0d, 'speed', [0x00], 0],
    [0x0d, 'speed', [0x64], 100],
    [0x0d, 'speed', [0xff], 255],
    // 0x0E timing advance: A/2 − 64
    [0x0e, 'timingAdvance', [0x00], -64],
    [0x0e, 'timingAdvance', [0x94], 10],
    [0x0e, 'timingAdvance', [0xff], 63.5],
    // 0x0F intake air: A − 40
    [0x0f, 'intakeAirTemp', [0x3c], 20],
    // 0x10 MAF: (256A + B) / 100 g/s
    [0x10, 'maf', [0x01, 0xf4], 5],
    [0x10, 'maf', [0xff, 0xff], 655.35],
    // 0x11 throttle: 100/255 · A
    [0x11, 'throttle', [0x26], 14.902],
    [0x11, 'throttle', [0xff], 100],
    // 0x1F run time: 256A + B s
    [0x1f, 'runTime', [0x01, 0x2c], 300],
    [0x1f, 'runTime', [0xff, 0xff], 65535],
    // 0x21 distance with MIL on: 256A + B km
    [0x21, 'distanceWithMil', [0x00, 0x7b], 123],
    // 0x23 fuel rail gauge pressure: 10 · (256A + B) kPa
    [0x23, 'fuelRailPressure', [0x12, 0x34], 46600],
    [0x23, 'fuelRailPressure', [0xff, 0xff], 655350],
    // 0x2F fuel level: 100/255 · A
    [0x2f, 'fuelLevel', [0x80], 50.196],
    // 0x31 distance since codes cleared: 256A + B km
    [0x31, 'distanceSinceClear', [0x13, 0x88], 5000],
    // 0x33 barometric pressure: A kPa
    [0x33, 'baroPressure', [0x65], 101],
    // 0x3C catalyst temperature: (256A + B)/10 − 40
    [0x3c, 'catalystTempB1S1', [0x00, 0x00], -40],
    [0x3c, 'catalystTempB1S1', [0x13, 0x88], 460],
    [0x3c, 'catalystTempB1S1', [0xff, 0xff], 6513.5],
    // 0x42 control module voltage: (256A + B)/1000 V
    [0x42, 'controlModuleVoltage', [0x36, 0xb0], 14],
    [0x42, 'controlModuleVoltage', [0xff, 0xff], 65.535],
    // 0x43 absolute load: 100/255 · (256A + B)
    [0x43, 'absoluteLoad', [0x00, 0xff], 100],
    [0x43, 'absoluteLoad', [0xff, 0xff], 25700],
    // 0x44 commanded lambda: 2/65536 · (256A + B)
    [0x44, 'commandedLambda', [0x80, 0x00], 1],
    [0x44, 'commandedLambda', [0x00, 0x00], 0],
    [0x44, 'commandedLambda', [0xff, 0xff], 1.99997],
    // 0x45 relative throttle, 0x49 pedal, 0x52 ethanol: 100/255 · A
    [0x45, 'relativeThrottle', [0xff], 100],
    [0x49, 'acceleratorPedal', [0x33], 20],
    [0x52, 'ethanolPercent', [0xd9], 85.098],
    // 0x46 ambient, 0x5C oil: A − 40
    [0x46, 'ambientTemp', [0x32], 10],
    [0x5c, 'oilTemp', [0x82], 90],
    [0x5c, 'oilTemp', [0xff], 215],
    // 0x5E fuel rate: (256A + B)/20 L/h
    [0x5e, 'fuelRate', [0x00, 0x64], 5],
    [0x5e, 'fuelRate', [0xff, 0xff], 3276.75],
    // 0xA6 odometer: (A·2^24 + B·2^16 + C·2^8 + D)/10 km, 0xFFFFFFFF = not available
    [0xa6, 'odometer', [0x00, 0x00, 0x00, 0x00], 0],
    [0xa6, 'odometer', [0x00, 0x01, 0xe2, 0x40], 12345.6],
    [0xa6, 'odometer', [0xff, 0xff, 0xff, 0xfe], 429496729.4],
    [0xa6, 'odometer', [0xff, 0xff, 0xff, 0xff], null],
  ];

  it.each(cases)('PID %i → %s %j = %s', (pid, signal, data, expected) => {
    const value = decodeValue(pid, signal, bytes(...data));
    if (expected === null) expect(value).toBeNull();
    else expect(value).toBeCloseTo(expected, 3);
  });

  it('ignores bytes beyond the defined length (e.g. bank 3 trim in byte B of PID 0x06)', () => {
    expect(decodeMode01(0x06, bytes(0x80, 0x90))).toEqual({ shortFuelTrimB1: 0 });
    expect(decodeMode01(0x0d, bytes(0x3c, 0x00, 0x00))).toEqual({ speed: 60 });
  });

  it('returns only the signal the PID carries', () => {
    expect(decodeMode01(0x0c, bytes(0x0b, 0xb8))).toEqual({ rpm: 750 });
  });

  it('returns null for unknown PIDs and for the non-signal PIDs 0x00/0x01', () => {
    expect(decodeMode01(0x99, bytes(1, 2, 3, 4))).toBeNull();
    expect(decodeMode01(0x00, bytes(0xbe, 0x1f, 0xa8, 0x13))).toBeNull();
    expect(decodeMode01(PID_MONITOR_STATUS, bytes(0x81, 0x07, 0x65, 0x04))).toBeNull();
    expect(decodeMode01(-1, bytes(1))).toBeNull();
  });

  it('returns null for truncated payloads', () => {
    expect(decodeMode01(0x0c, bytes(0x1a))).toBeNull();
    expect(decodeMode01(0x0d, bytes())).toBeNull();
    expect(decodeMode01(0xa6, bytes(0x00, 0x01, 0xe2))).toBeNull();
  });
});

describe('PID 0xA4 transmission actual gear', () => {
  it('reports the gear from B bits 7–4 when A bit 0 (gear supported) is set', () => {
    expect(decodeMode01(0xa4, bytes(0x01, 0x30, 0x05, 0xdc))).toEqual({ transmissionGear: 3 });
    expect(decodeMode01(0xa4, bytes(0x03, 0x10, 0x0e, 0x74))).toEqual({ transmissionGear: 1 });
    expect(decodeMode01(0xa4, bytes(0xff, 0xf0, 0x00, 0x00))).toEqual({ transmissionGear: 15 });
  });

  it('reports neutral as gear 0', () => {
    expect(decodeMode01(0xa4, bytes(0x01, 0x00, 0x00, 0x00))).toEqual({ transmissionGear: 0 });
  });

  it('ignores the reserved low nibble of B', () => {
    expect(decodeMode01(0xa4, bytes(0x01, 0x4f, 0x03, 0xe8))).toEqual({ transmissionGear: 4 });
  });

  it('returns null when the gear is not flagged as valid', () => {
    expect(decodeMode01(0xa4, bytes(0x00, 0x30, 0x05, 0xdc))).toBeNull();
    // Only the ratio (A bit 1) is supported: the gear nibble must not be trusted.
    expect(decodeMode01(0xa4, bytes(0x02, 0x30, 0x05, 0xdc))).toBeNull();
  });

  it('returns null for short payloads even when the validity bit is set', () => {
    expect(decodeMode01(0xa4, bytes(0x01, 0x30))).toBeNull();
    expect(decodeMode01(0xa4, bytes(0x01, 0x30, 0x05))).toBeNull();
  });
});

describe('getPid / pidForSignal', () => {
  it('looks PIDs up by number', () => {
    expect(getPid(0x0c)?.signals).toEqual(['rpm']);
    expect(getPid(0x0c)?.bytes).toBe(2);
    expect(getPid(0xa6)?.bytes).toBe(4);
    expect(getPid(0x99)).toBeUndefined();
    expect(getPid(0x01)).toBeUndefined();
  });

  it('pidForSignal and getPid agree', () => {
    for (const def of MODE01_PIDS) {
      for (const signal of def.signals) expect(pidForSignal(signal)).toBe(def);
      expect(getPid(def.pid)).toBe(def);
    }
  });
});

describe('parseSupportedPids', () => {
  it('decodes the classic "BE 1F A8 13" bitmap (bit 7 of A = base+1)', () => {
    expect(parseSupportedPids(0x00, bytes(0xbe, 0x1f, 0xa8, 0x13))).toEqual([
      0x01, 0x03, 0x04, 0x05, 0x06, 0x07, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x13, 0x15, 0x1c,
      0x1f, 0x20,
    ]);
  });

  it('offsets by the base PID', () => {
    expect(parseSupportedPids(0x20, bytes(0x80, 0x00, 0x00, 0x00))).toEqual([0x21]);
    expect(parseSupportedPids(0x40, bytes(0x00, 0x00, 0x00, 0x01))).toEqual([0x60]);
    expect(parseSupportedPids(0xa0, bytes(0x10, 0x00, 0x00, 0x00))).toEqual([0xa4]);
    expect(parseSupportedPids(0xe0, bytes(0x00, 0x00, 0x00, 0x01))).toEqual([0x100]);
  });

  it('returns all 32 PIDs for an all-ones bitmap and none for all zeros', () => {
    const all = parseSupportedPids(0x20, bytes(0xff, 0xff, 0xff, 0xff));
    expect(all).toHaveLength(32);
    expect(all[0]).toBe(0x21);
    expect(all[31]).toBe(0x40);
    expect(parseSupportedPids(0x20, bytes(0, 0, 0, 0))).toEqual([]);
  });

  it('includes the continuation bit (base+32) like any other PID', () => {
    expect(parseSupportedPids(0x00, bytes(0x00, 0x00, 0x00, 0x01))).toEqual([0x20]);
  });

  it('returns no PIDs for short payloads and ignores extra bytes', () => {
    expect(parseSupportedPids(0x00, bytes(0xbe, 0x1f, 0xa8))).toEqual([]);
    expect(parseSupportedPids(0x00, bytes())).toEqual([]);
    expect(parseSupportedPids(0x00, bytes(0x80, 0x00, 0x00, 0x00, 0xff))).toEqual([0x01]);
  });

  it('rejects bases that are not bitmap PIDs', () => {
    for (const base of [0x01, 0x10, 0x21, -0x20, 0x100, 1.5, Number.NaN]) {
      expect(() => parseSupportedPids(base, bytes(0, 0, 0, 0))).toThrow(RangeError);
    }
  });
});

describe('nextSupportedPidsBase', () => {
  it('follows the continuation bit (bit 0 of byte D)', () => {
    expect(nextSupportedPidsBase(0x00, bytes(0xbe, 0x1f, 0xa8, 0x13))).toBe(0x20);
    expect(nextSupportedPidsBase(0x20, bytes(0x00, 0x00, 0x00, 0x01))).toBe(0x40);
    expect(nextSupportedPidsBase(0xc0, bytes(0x00, 0x00, 0x00, 0x01))).toBe(0xe0);
  });

  it('stops when the bit is clear, the payload is short, or at the last range', () => {
    expect(nextSupportedPidsBase(0x00, bytes(0xff, 0xff, 0xff, 0xfe))).toBeNull();
    expect(nextSupportedPidsBase(0x00, bytes(0xff, 0xff, 0xff))).toBeNull();
    expect(nextSupportedPidsBase(0xe0, bytes(0xff, 0xff, 0xff, 0xff))).toBeNull();
    expect(nextSupportedPidsBase(0x05, bytes(0xff, 0xff, 0xff, 0xff))).toBeNull();
  });
});

describe('isSupportedPidsQuery / SUPPORTED_PIDS_BASES', () => {
  it('recognises exactly the eight bitmap PIDs', () => {
    const recognised = Array.from({ length: 0x101 }, (_, pid) => pid).filter(isSupportedPidsQuery);
    expect(recognised).toEqual([...SUPPORTED_PIDS_BASES]);
  });
});

describe('signalsForPids', () => {
  it('maps PIDs to signals in SIGNAL_IDS order without duplicates', () => {
    expect(signalsForPids([0x0c, 0x0d, 0x0c])).toEqual(['speed', 'rpm']);
  });

  it('ignores unknown and non-signal PIDs', () => {
    expect(signalsForPids([0x00, 0x01, 0x20, 0x99, 0xff])).toEqual([]);
    expect(signalsForPids([])).toEqual([]);
  });

  it('turns a real supported-PIDs response into signals', () => {
    const pids = parseSupportedPids(0x00, bytes(0xbe, 0x1f, 0xa8, 0x13));
    expect(signalsForPids(pids)).toEqual([
      'speed',
      'rpm',
      'engineLoad',
      'throttle',
      'timingAdvance',
      'coolantTemp',
      'intakeAirTemp',
      'maf',
      'shortFuelTrimB1',
      'longFuelTrimB1',
      'runTime',
    ]);
  });

  it('maps every defined PID back to its signals', () => {
    const all = signalsForPids(MODE01_PIDS.map((def) => def.pid));
    expect(all).toHaveLength(Object.keys(EXPECTED_PID_FOR_SIGNAL).length);
  });
});

describe('parseMonitorStatus', () => {
  it('reads the MIL from bit 7 and the DTC count from bits 6–0 of byte A', () => {
    expect(parseMonitorStatus(bytes(0x83, 0x07, 0x65, 0x04))).toEqual({ milOn: true, dtcCount: 3 });
    expect(parseMonitorStatus(bytes(0x00, 0x07, 0xe5, 0x00))).toEqual({
      milOn: false,
      dtcCount: 0,
    });
  });

  it('handles the extremes of byte A', () => {
    expect(parseMonitorStatus(bytes(0xff, 0, 0, 0))).toEqual({ milOn: true, dtcCount: 127 });
    expect(parseMonitorStatus(bytes(0x7f, 0, 0, 0))).toEqual({ milOn: false, dtcCount: 127 });
    expect(parseMonitorStatus(bytes(0x80, 0, 0, 0))).toEqual({ milOn: true, dtcCount: 0 });
  });

  it('returns null for payloads shorter than 4 bytes', () => {
    expect(parseMonitorStatus(bytes())).toBeNull();
    expect(parseMonitorStatus(bytes(0x81, 0x07, 0x65))).toBeNull();
  });
});

describe('SIGNAL_META', () => {
  it('has well-formed metadata for every SignalId', () => {
    expect(Object.keys(SIGNAL_META).sort()).toEqual([...SIGNAL_IDS].sort());
    for (const id of SIGNAL_IDS) {
      const meta = SIGNAL_META[id];
      expect(meta.id).toBe(id);
      expect(meta.label.trim().length, id).toBeGreaterThan(0);
      expect(meta.label.length, id).toBeLessThanOrEqual(16);
      expect(meta.min, id).toBeLessThan(meta.max);
      expect(Number.isInteger(meta.decimals) && meta.decimals >= 0, id).toBe(true);
      // Normal bands come in pairs and sit inside the gauge range.
      expect(meta.normalMin === undefined, id).toBe(meta.normalMax === undefined);
      if (meta.normalMin !== undefined && meta.normalMax !== undefined) {
        expect(meta.normalMin, id).toBeGreaterThanOrEqual(meta.min);
        expect(meta.normalMax, id).toBeLessThanOrEqual(meta.max);
        expect(meta.normalMin, id).toBeLessThanOrEqual(meta.normalMax);
      }
    }
  });

  it('uses the canonical unit for each signal', () => {
    expect(SIGNAL_META.speed.unit).toBe('km/h');
    expect(SIGNAL_META.rpm.unit).toBe('rpm');
    expect(SIGNAL_META.coolantTemp.unit).toBe('°C');
    expect(SIGNAL_META.map.unit).toBe('kPa');
    expect(SIGNAL_META.maf.unit).toBe('g/s');
    expect(SIGNAL_META.fuelRate.unit).toBe('L/h');
    expect(SIGNAL_META.commandedLambda.unit).toBe('λ');
    expect(SIGNAL_META.batteryVoltage.unit).toBe('V');
    expect(SIGNAL_META.odometer.unit).toBe('km');
    expect(SIGNAL_META.runTime.unit).toBe('s');
    expect(SIGNAL_META.transmissionGear.unit).toBe('gear');
    expect(SIGNAL_META.timingAdvance.unit).toBe('°');
    expect(SIGNAL_META.tirePressureFL.unit).toBe('kPa');
  });

  it('defines the project normal bands', () => {
    expect(SIGNAL_META.coolantTemp).toMatchObject({ normalMin: 70, normalMax: 105 });
    expect(SIGNAL_META.batteryVoltage).toMatchObject({ normalMin: 12.2, normalMax: 14.8 });
    expect(SIGNAL_META.controlModuleVoltage).toMatchObject({ normalMin: 12.2, normalMax: 14.8 });
    for (const trim of [
      'shortFuelTrimB1',
      'longFuelTrimB1',
      'shortFuelTrimB2',
      'longFuelTrimB2',
    ] as const) {
      expect(SIGNAL_META[trim]).toMatchObject({ normalMin: -10, normalMax: 10 });
    }
    // "Normal" is meaningless for driver-controlled signals.
    expect(SIGNAL_META.speed.normalMin).toBeUndefined();
    expect(SIGNAL_META.throttle.normalMax).toBeUndefined();
  });

  it('covers the signals that have no standard PID', () => {
    for (const signal of SIGNALS_WITHOUT_STANDARD_PID) {
      expect(SIGNAL_META[signal].label.length).toBeGreaterThan(0);
    }
  });

  it('is immutable', () => {
    expect(Object.isFrozen(SIGNAL_META)).toBe(true);
    expect(Object.isFrozen(SIGNAL_META.speed)).toBe(true);
  });
});
