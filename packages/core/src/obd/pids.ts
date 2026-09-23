import { SIGNAL_IDS } from '../types/signals.ts';
import type { SignalId, SignalMeta } from '../types/signals.ts';

/**
 * OBD-II service 01 PID definitions (SAE J1979) and decoders.
 * Decoders take the data bytes AFTER the "41 <pid>" echo and return canonical-unit values.
 */
export interface PidDefinition {
  /** Service/mode, always 0x01 here. */
  mode: 0x01;
  pid: number;
  /** Number of data bytes in the response. */
  bytes: number;
  name: string;
  /** Signals this PID populates (some PIDs carry several). */
  signals: SignalId[];
  /** Returns null when the payload is too short or reports "not available". */
  decode(data: Uint8Array): Partial<Record<SignalId, number>> | null;
}

/** Service 01 PID 0x01: monitor status since DTCs cleared (MIL + DTC count). */
export const PID_MONITOR_STATUS = 0x01;

/**
 * The "PIDs supported" bitmap PIDs. Each answers for the 32 PIDs that follow it; the last bit
 * of each bitmap says whether the next bitmap PID is itself supported.
 */
export const SUPPORTED_PIDS_BASES = [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0, 0xe0] as const;

/** True for the "PIDs supported" bitmap PIDs (0x00, 0x20 … 0xE0). */
export function isSupportedPidsQuery(pid: number): boolean {
  return Number.isInteger(pid) && pid >= 0 && pid <= 0xe0 && pid % 0x20 === 0;
}

// ---------------------------------------------------------------------------------------------
// Decoder helpers. Every decoder is only reached after the payload length has been validated,
// so the `?? 0` fallbacks below exist purely to satisfy noUncheckedIndexedAccess.
// ---------------------------------------------------------------------------------------------

/** Byte at index `i` (A = 0, B = 1 …). */
const byte = (d: Uint8Array, i: number): number => d[i] ?? 0;

/** Big-endian 16-bit word starting at index `i` (256A + B for i = 0). */
const word = (d: Uint8Array, i: number): number => byte(d, i) * 256 + byte(d, i + 1);

/** 100/255 · A — the standard 0–100 % scaling. */
const percent = (d: Uint8Array): number => (100 * byte(d, 0)) / 255;

/** A − 40 — the standard 1-byte temperature scaling (−40 … 215 °C). */
const temperature = (d: Uint8Array): number => byte(d, 0) - 40;

/** (A − 128) · 100/128 — fuel trims, −100 % (lean correction) … +99.2 % (rich correction). */
const fuelTrim = (d: Uint8Array): number => ((byte(d, 0) - 128) * 100) / 128;

/**
 * Define a PID that yields a single signal. `bytes` is the minimum payload length; longer
 * payloads are accepted (e.g. PIDs 0x06–0x09 append bank 3/4 trims in byte B on some engines).
 * `convert` may return null to report "not available".
 */
function singleSignalPid(
  pid: number,
  bytes: number,
  name: string,
  signal: SignalId,
  convert: (data: Uint8Array) => number | null,
): PidDefinition {
  return {
    mode: 0x01,
    pid,
    bytes,
    name,
    signals: [signal],
    decode(data) {
      if (data.length < bytes) return null;
      const value = convert(data);
      if (value === null || !Number.isFinite(value)) return null;
      return { [signal]: value };
    },
  };
}

/**
 * PID 0xA4 "Transmission Actual Gear" (J1979, 4 bytes):
 *   A bit 0 = actual gear supported, A bit 1 = actual gear ratio supported;
 *   B bits 7–4 = actual gear (0 = neutral, 1–15 = gear), B bits 3–0 reserved;
 *   C, D = actual gear ratio, 0.001 per bit.
 * The gear is only reported when A bit 0 says it is valid.
 */
function decodeActualGear(data: Uint8Array): number | null {
  if ((byte(data, 0) & 0x01) === 0) return null;
  return byte(data, 1) >> 4;
}

/**
 * PID 0xA6 odometer: 32-bit big-endian, 0.1 km per bit. 0xFFFFFFFF means "not available".
 * Multiplication (not bit shifts) keeps the value unsigned.
 */
function decodeOdometer(data: Uint8Array): number | null {
  const raw = byte(data, 0) * 2 ** 24 + byte(data, 1) * 2 ** 16 + word(data, 2);
  return raw === 0xffffffff ? null : raw / 10;
}

/** All mode 01 PIDs the HUD understands. */
export const MODE01_PIDS: readonly PidDefinition[] = Object.freeze([
  singleSignalPid(0x04, 1, 'Calculated engine load', 'engineLoad', percent),
  singleSignalPid(0x05, 1, 'Engine coolant temperature', 'coolantTemp', temperature),
  singleSignalPid(0x06, 1, 'Short term fuel trim — bank 1', 'shortFuelTrimB1', fuelTrim),
  singleSignalPid(0x07, 1, 'Long term fuel trim — bank 1', 'longFuelTrimB1', fuelTrim),
  singleSignalPid(0x08, 1, 'Short term fuel trim — bank 2', 'shortFuelTrimB2', fuelTrim),
  singleSignalPid(0x09, 1, 'Long term fuel trim — bank 2', 'longFuelTrimB2', fuelTrim),
  singleSignalPid(0x0a, 1, 'Fuel pressure (gauge)', 'fuelPressure', (d) => 3 * byte(d, 0)),
  singleSignalPid(0x0b, 1, 'Intake manifold absolute pressure', 'map', (d) => byte(d, 0)),
  singleSignalPid(0x0c, 2, 'Engine speed', 'rpm', (d) => word(d, 0) / 4),
  singleSignalPid(0x0d, 1, 'Vehicle speed', 'speed', (d) => byte(d, 0)),
  singleSignalPid(0x0e, 1, 'Timing advance', 'timingAdvance', (d) => byte(d, 0) / 2 - 64),
  singleSignalPid(0x0f, 1, 'Intake air temperature', 'intakeAirTemp', temperature),
  singleSignalPid(0x10, 2, 'Mass air flow rate', 'maf', (d) => word(d, 0) / 100),
  singleSignalPid(0x11, 1, 'Throttle position', 'throttle', percent),
  singleSignalPid(0x1f, 2, 'Run time since engine start', 'runTime', (d) => word(d, 0)),
  singleSignalPid(0x21, 2, 'Distance travelled with MIL on', 'distanceWithMil', (d) => word(d, 0)),
  singleSignalPid(0x23, 2, 'Fuel rail gauge pressure', 'fuelRailPressure', (d) => 10 * word(d, 0)),
  singleSignalPid(0x2f, 1, 'Fuel tank level input', 'fuelLevel', percent),
  singleSignalPid(0x31, 2, 'Distance since codes cleared', 'distanceSinceClear', (d) => word(d, 0)),
  singleSignalPid(0x33, 1, 'Absolute barometric pressure', 'baroPressure', (d) => byte(d, 0)),
  singleSignalPid(
    0x3c,
    2,
    'Catalyst temperature — bank 1 sensor 1',
    'catalystTempB1S1',
    (d) => word(d, 0) / 10 - 40,
  ),
  singleSignalPid(
    0x42,
    2,
    'Control module voltage',
    'controlModuleVoltage',
    (d) => word(d, 0) / 1000,
  ),
  singleSignalPid(0x43, 2, 'Absolute load value', 'absoluteLoad', (d) => (100 * word(d, 0)) / 255),
  singleSignalPid(
    0x44,
    2,
    'Commanded air-fuel equivalence ratio',
    'commandedLambda',
    (d) => (2 * word(d, 0)) / 65536,
  ),
  singleSignalPid(0x45, 1, 'Relative throttle position', 'relativeThrottle', percent),
  singleSignalPid(0x46, 1, 'Ambient air temperature', 'ambientTemp', temperature),
  singleSignalPid(0x49, 1, 'Accelerator pedal position D', 'acceleratorPedal', percent),
  singleSignalPid(0x52, 1, 'Ethanol fuel percentage', 'ethanolPercent', percent),
  singleSignalPid(0x5c, 1, 'Engine oil temperature', 'oilTemp', temperature),
  singleSignalPid(0x5e, 2, 'Engine fuel rate', 'fuelRate', (d) => word(d, 0) / 20),
  singleSignalPid(0xa4, 4, 'Transmission actual gear', 'transmissionGear', decodeActualGear),
  singleSignalPid(0xa6, 4, 'Odometer', 'odometer', decodeOdometer),
]);

// ---------------------------------------------------------------------------------------------
// Signal metadata
// ---------------------------------------------------------------------------------------------

type MetaSpec = Omit<SignalMeta, 'id'>;

function meta(
  label: string,
  unit: SignalMeta['unit'],
  min: number,
  max: number,
  decimals: number,
  normal?: readonly [min: number, max: number],
): MetaSpec {
  return normal
    ? { label, unit, min, max, decimals, normalMin: normal[0], normalMax: normal[1] }
    : { label, unit, min, max, decimals };
}

/** Battery / module supply voltage band: below ~12.2 V is a discharged battery, above ~14.8 V overcharging. */
const VOLTAGE_NORMAL = [12.2, 14.8] as const;
/** Fuel trims beyond ±10 % mean the ECU is compensating for a real mixture fault. */
const FUEL_TRIM_NORMAL = [-10, 10] as const;
/** Typical passenger-car cold tyre pressures (kPa gauge); outside this band is worth a look. */
const TYRE_NORMAL = [180, 300] as const;

const META_SPECS: Record<SignalId, MetaSpec> = {
  speed: meta('Speed', 'km/h', 0, 255, 0),
  rpm: meta('RPM', 'rpm', 0, 8000, 0),
  engineLoad: meta('Engine load', '%', 0, 100, 0),
  // Absolute load exceeds 100 % on boosted engines (J1979 range 0–25 700 %).
  absoluteLoad: meta('Absolute load', '%', 0, 300, 0),
  throttle: meta('Throttle', '%', 0, 100, 0),
  relativeThrottle: meta('Rel. throttle', '%', 0, 100, 0),
  acceleratorPedal: meta('Pedal', '%', 0, 100, 0),
  timingAdvance: meta('Timing', '°', -30, 60, 1),
  transmissionGear: meta('Gear', 'gear', 0, 10, 0),

  coolantTemp: meta('Coolant', '°C', -40, 130, 0, [70, 105]),
  intakeAirTemp: meta('Intake air', '°C', -40, 80, 0),
  oilTemp: meta('Oil temp', '°C', -40, 160, 0, [70, 130]),
  ambientTemp: meta('Ambient', '°C', -40, 60, 0),
  // Below ~250 °C the catalyst has not lit off; above ~900 °C it is at risk of damage.
  catalystTempB1S1: meta('Catalyst B1S1', '°C', -40, 1000, 0, [250, 900]),

  maf: meta('MAF', 'g/s', 0, 250, 1),
  map: meta('MAP', 'kPa', 0, 255, 0),
  baroPressure: meta('Baro', 'kPa', 50, 110, 0),
  fuelLevel: meta('Fuel', '%', 0, 100, 0, [10, 100]),
  fuelRate: meta('Fuel rate', 'L/h', 0, 60, 1),
  fuelPressure: meta('Fuel pressure', 'kPa', 0, 765, 0),
  // Diesel common rail reaches ~2500 bar; gasoline direct injection ~350 bar.
  fuelRailPressure: meta('Rail pressure', 'kPa', 0, 250_000, 0),
  commandedLambda: meta('Lambda', 'λ', 0.5, 1.5, 3),
  ethanolPercent: meta('Ethanol', '%', 0, 100, 0),
  shortFuelTrimB1: meta('STFT B1', '%', -25, 25, 1, FUEL_TRIM_NORMAL),
  longFuelTrimB1: meta('LTFT B1', '%', -25, 25, 1, FUEL_TRIM_NORMAL),
  shortFuelTrimB2: meta('STFT B2', '%', -25, 25, 1, FUEL_TRIM_NORMAL),
  longFuelTrimB2: meta('LTFT B2', '%', -25, 25, 1, FUEL_TRIM_NORMAL),

  controlModuleVoltage: meta('ECU voltage', 'V', 8, 16, 1, VOLTAGE_NORMAL),
  batteryVoltage: meta('Battery', 'V', 8, 16, 1, VOLTAGE_NORMAL),

  odometer: meta('Odometer', 'km', 0, 999_999, 0),
  runTime: meta('Run time', 's', 0, 65_535, 0),
  distanceSinceClear: meta('Since DTC clear', 'km', 0, 65_535, 0),
  // Any distance driven with the MIL on is worth highlighting.
  distanceWithMil: meta('Dist. with MIL', 'km', 0, 65_535, 0, [0, 0]),

  tirePressureFL: meta('Tyre FL', 'kPa', 0, 400, 0, TYRE_NORMAL),
  tirePressureFR: meta('Tyre FR', 'kPa', 0, 400, 0, TYRE_NORMAL),
  tirePressureRL: meta('Tyre RL', 'kPa', 0, 400, 0, TYRE_NORMAL),
  tirePressureRR: meta('Tyre RR', 'kPa', 0, 400, 0, TYRE_NORMAL),
};

/** Metadata for every SignalId (labels, units, ranges, normal bands). */
export const SIGNAL_META: Readonly<Record<SignalId, SignalMeta>> = Object.freeze(
  Object.fromEntries(
    SIGNAL_IDS.map((id) => [id, Object.freeze({ id, ...META_SPECS[id] })] as const),
  ) as Record<SignalId, SignalMeta>,
);

// ---------------------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------------------

const PIDS_BY_NUMBER: ReadonlyMap<number, PidDefinition> = new Map(
  MODE01_PIDS.map((def) => [def.pid, def]),
);

const PIDS_BY_SIGNAL: ReadonlyMap<SignalId, PidDefinition> = (() => {
  const map = new Map<SignalId, PidDefinition>();
  for (const def of MODE01_PIDS) {
    for (const signal of def.signals) if (!map.has(signal)) map.set(signal, def);
  }
  return map;
})();

export function getPid(pid: number): PidDefinition | undefined {
  return PIDS_BY_NUMBER.get(pid);
}

/** The PID that provides a signal, if any standard PID does. */
export function pidForSignal(signal: SignalId): PidDefinition | undefined {
  return PIDS_BY_SIGNAL.get(signal);
}

/** Decode a mode 01 response payload for `pid`. Unknown PIDs return null. */
export function decodeMode01(
  pid: number,
  data: Uint8Array,
): Partial<Record<SignalId, number>> | null {
  return getPid(pid)?.decode(data) ?? null;
}

/**
 * Parse a "supported PIDs" bitmap response (PIDs 0x00, 0x20, 0x40 … 0xE0).
 * Returns the supported PID numbers in [base+1, base+32].
 *
 * Bit 7 of byte A flags PID base+1 and bit 0 of byte D flags base+32; when base+32 is itself
 * a bitmap PID (the "continuation bit"), it is included like any other PID — see
 * {@link nextSupportedPidsBase}. A payload shorter than 4 bytes yields no PIDs.
 *
 * @throws RangeError when `basePid` is not one of 0x00, 0x20 … 0xE0.
 */
export function parseSupportedPids(basePid: number, data: Uint8Array): number[] {
  if (!isSupportedPidsQuery(basePid)) {
    throw new RangeError(`Invalid supported-PIDs base 0x${basePid.toString(16)}`);
  }
  if (data.length < 4) return [];
  const pids: number[] = [];
  for (let i = 0; i < 4; i++) {
    const bits = byte(data, i);
    for (let bit = 0; bit < 8; bit++) {
      if (bits & (0x80 >> bit)) pids.push(basePid + 1 + i * 8 + bit);
    }
  }
  return pids;
}

/**
 * The next bitmap PID to query after `basePid`, or null when the continuation bit (bit 0 of
 * byte D) is clear, the payload is short, or `basePid` is the last range (0xE0).
 */
export function nextSupportedPidsBase(basePid: number, data: Uint8Array): number | null {
  if (!isSupportedPidsQuery(basePid) || basePid >= 0xe0 || data.length < 4) return null;
  return (byte(data, 3) & 0x01) !== 0 ? basePid + 0x20 : null;
}

/** Map supported PID numbers to the signals they provide (in SIGNAL_IDS order, no duplicates). */
export function signalsForPids(pids: readonly number[]): SignalId[] {
  const provided = new Set<SignalId>();
  for (const pid of pids) {
    for (const signal of getPid(pid)?.signals ?? []) provided.add(signal);
  }
  return SIGNAL_IDS.filter((id) => provided.has(id));
}

/**
 * Decode service 01 PID 0x01 (monitor status since DTCs cleared).
 * Byte A: bit 7 = MIL on, bits 6–0 = number of confirmed emission-related DTCs.
 * Bytes B–D (readiness tests) are required to be present but not decoded here.
 */
export function parseMonitorStatus(data: Uint8Array): { milOn: boolean; dtcCount: number } | null {
  if (data.length < 4) return null;
  const a = byte(data, 0);
  return { milOn: (a & 0x80) !== 0, dtcCount: a & 0x7f };
}
