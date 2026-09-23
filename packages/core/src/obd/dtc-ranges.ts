import type { DtcSeverity, DtcSystem } from '../types/vehicle.ts';

/**
 * SAE J2012 / ISO 15031-6 structure of a five-character trouble code, used to describe codes
 * that are not in the code database.
 *
 *   P 0 4 2 0
 *   │ │ └─┴─┴── three hex digits; the first of them selects the sub-system "hundred block"
 *   │ └──────── 0–3: who controls the definition (SAE vs manufacturer), per letter
 *   └────────── P powertrain, C chassis, B body, U network
 *
 * Severity follows the project-wide rubric:
 *   critical — continuing to drive risks immediate engine damage or safety
 *   warning  — drivability / limp mode / damage if ignored
 *   caution  — emissions or economy faults
 *   info     — minor
 */

/** Description of a range of codes, used when a code is not in the database. */
export interface DtcRangeInfo {
  /** Official-style description of the range, e.g. "Ignition system or misfire". */
  description: string;
  /** Glanceable HUD label, ≤ 32 characters. */
  short: string;
  severity: DtcSeverity;
}

const SYSTEM_BY_LETTER: Readonly<Record<string, DtcSystem>> = {
  P: 'powertrain',
  C: 'chassis',
  B: 'body',
  U: 'network',
};

/** The system a code belongs to, from its first letter (powertrain for anything unrecognised). */
export function dtcSystemOf(code: string): DtcSystem {
  return SYSTEM_BY_LETTER[code.charAt(0).toUpperCase()] ?? 'powertrain';
}

/**
 * True for manufacturer-controlled ranges: P1xxx, P30xx–P33xx, B1xxx/B2xxx, C1xxx/C2xxx,
 * U1xxx/U2xxx. Expects a valid, normalised code.
 */
export function isManufacturerSpecificDtc(code: string): boolean {
  const letter = code.charAt(0);
  const digit = code.charAt(1);
  if (letter === 'P') {
    return digit === '1' || (digit === '3' && '0123'.includes(code.charAt(2)));
  }
  return digit === '1' || digit === '2';
}

const range = (description: string, short: string, severity: DtcSeverity): DtcRangeInfo => ({
  description,
  short,
  severity,
});

// J2012 powertrain "hundred blocks" (third character of the code).
const FUEL_AIR_AUX = range(
  'Fuel and air metering and auxiliary emission controls',
  'Fuel/air or emissions fault',
  'caution',
);
const FUEL_AIR = range('Fuel and air metering', 'Fuel/air metering fault', 'caution');
const IGNITION = range('Ignition system or misfire', 'Ignition or misfire fault', 'warning');
const AUX_EMISSION = range('Auxiliary emission controls', 'Emission control fault', 'caution');
const SPEED_IDLE_INPUTS = range(
  'Vehicle speed control, idle control and auxiliary inputs',
  'Speed/idle control fault',
  'caution',
);
const AUX_INPUTS = range('Auxiliary inputs', 'Auxiliary input fault', 'caution');
const COMPUTER_OUTPUTS = range(
  'Computer and auxiliary output circuits',
  'Engine computer/output fault',
  'warning',
);
const TRANSMISSION = range('Transmission', 'Transmission fault', 'warning');
const HYBRID = range('Hybrid / electric propulsion system', 'Hybrid/EV system fault', 'warning');
const CYLINDER_DEACTIVATION = range(
  'Cylinder deactivation system',
  'Cylinder deactivation fault',
  'caution',
);
const GENERIC_POWERTRAIN = range('Generic powertrain code', 'Powertrain fault', 'caution');

/** P0xxx blocks, indexed by the third character. */
const P0_BLOCKS: Readonly<Record<string, DtcRangeInfo>> = {
  '0': FUEL_AIR_AUX,
  '1': FUEL_AIR,
  '2': FUEL_AIR,
  '3': IGNITION,
  '4': AUX_EMISSION,
  '5': SPEED_IDLE_INPUTS,
  '6': COMPUTER_OUTPUTS,
  '7': TRANSMISSION,
  '8': TRANSMISSION,
  '9': TRANSMISSION,
  A: HYBRID,
  B: HYBRID,
  C: HYBRID,
  D: HYBRID,
  E: HYBRID,
};

/** P2xxx blocks, indexed by the third character. */
const P2_BLOCKS: Readonly<Record<string, DtcRangeInfo>> = {
  '0': FUEL_AIR_AUX,
  '1': FUEL_AIR_AUX,
  '2': FUEL_AIR_AUX,
  '3': IGNITION,
  '4': AUX_EMISSION,
  '5': AUX_INPUTS,
  '6': COMPUTER_OUTPUTS,
  '7': TRANSMISSION,
  '8': TRANSMISSION,
  A: FUEL_AIR_AUX,
};

/**
 * Well-known narrower J2012 groups inside the generic P0/P2 blocks. They refine both the
 * description and the severity (e.g. an over-temperature code is critical even though its
 * block, fuel and air metering, is only a caution). Bounds are inclusive, as hex code values.
 */
const P_SUBRANGES: readonly (readonly [from: number, to: number, info: DtcRangeInfo])[] = [
  [
    0x0010,
    0x0025,
    range('Camshaft position actuator / timing (VVT)', 'Cam timing (VVT) fault', 'warning'),
  ],
  [0x0100, 0x0104, range('Mass air flow (MAF) sensor circuit', 'Mass air flow sensor', 'caution')],
  [
    0x0105,
    0x0109,
    range(
      'Manifold absolute / barometric pressure sensor circuit',
      'Pressure sensor (MAP/baro)',
      'caution',
    ),
  ],
  [
    0x0110,
    0x0114,
    range('Intake air temperature sensor circuit', 'Intake air temp sensor', 'caution'),
  ],
  [
    0x0115,
    0x0119,
    range('Engine coolant temperature sensor circuit', 'Coolant temp sensor', 'caution'),
  ],
  [
    0x0120,
    0x0124,
    range('Throttle/pedal position sensor A circuit', 'Throttle position sensor', 'warning'),
  ],
  [0x0130, 0x0147, range('Oxygen (O2) sensor circuit (bank 1)', 'Oxygen sensor fault', 'caution')],
  [0x0150, 0x0167, range('Oxygen (O2) sensor circuit (bank 2)', 'Oxygen sensor fault', 'caution')],
  [
    0x0170,
    0x0175,
    range('Fuel trim (system too lean or too rich)', 'Fuel mixture lean/rich', 'caution'),
  ],
  [0x0200, 0x0212, range('Fuel injector circuit', 'Fuel injector circuit', 'warning')],
  [
    0x0217,
    0x0217,
    range('Engine coolant over temperature condition', 'Engine overheating', 'critical'),
  ],
  [
    0x0220,
    0x0229,
    range('Throttle/pedal position sensor B/C circuit', 'Throttle position sensor', 'warning'),
  ],
  [0x0230, 0x0233, range('Fuel pump circuit', 'Fuel pump circuit', 'warning')],
  [0x0298, 0x0298, range('Engine oil over temperature', 'Engine oil overheating', 'critical')],
  [0x0300, 0x0316, range('Engine misfire detected', 'Engine misfire', 'warning')],
  [0x0325, 0x0334, range('Knock sensor circuit', 'Knock sensor fault', 'caution')],
  [
    0x0335,
    0x0349,
    range('Crankshaft/camshaft position sensor circuit', 'Crank/cam sensor fault', 'warning'),
  ],
  [0x0350, 0x0362, range('Ignition coil circuit', 'Ignition coil circuit', 'warning')],
  [0x0400, 0x0409, range('Exhaust gas recirculation (EGR) system', 'EGR system fault', 'caution')],
  [0x0410, 0x0419, range('Secondary air injection system', 'Secondary air injection', 'caution')],
  [
    0x0420,
    0x0439,
    range('Catalyst system efficiency / temperature', 'Catalytic converter fault', 'caution'),
  ],
  [0x0440, 0x0457, range('Evaporative emission (EVAP) system', 'EVAP system fault', 'caution')],
  [0x0500, 0x0503, range('Vehicle speed sensor circuit', 'Vehicle speed sensor', 'warning')],
  [0x0505, 0x0509, range('Idle air control system', 'Idle control fault', 'caution')],
  [
    0x0520,
    0x0523,
    range('Engine oil pressure sensor/switch circuit', 'Oil pressure sensor', 'warning'),
  ],
  [0x0524, 0x0524, range('Engine oil pressure too low', 'Low oil pressure', 'critical')],
  [0x0560, 0x0563, range('System voltage', 'System voltage fault', 'warning')],
  [0x2100, 0x2119, range('Throttle actuator control system', 'Throttle actuator fault', 'warning')],
  [
    0x2120,
    0x2140,
    range(
      'Throttle/pedal position sensor D/E/F circuit or correlation',
      'Pedal/throttle sensor fault',
      'warning',
    ),
  ],
];

/** Network (U0xxx) blocks, indexed by the third character. */
const U0_BLOCKS: Readonly<Record<string, DtcRangeInfo>> = {
  '0': range('Network electrical', 'Network wiring fault', 'warning'),
  '1': range(
    'Network communication — lost communication with a module',
    'Lost module communication',
    'warning',
  ),
  '2': range(
    'Network communication — lost communication with a module',
    'Lost module communication',
    'warning',
  ),
  '3': range('Network software incompatibility', 'Module software mismatch', 'caution'),
  '4': range(
    'Network data — invalid data received from a module',
    'Invalid module data',
    'caution',
  ),
  '5': range(
    'Network data — invalid data received from a module',
    'Invalid module data',
    'caution',
  ),
};

const GENERIC_NETWORK = range('Generic network communication code', 'Network fault', 'caution');
const GENERIC_CHASSIS = range(
  'Generic chassis code (brakes, steering, suspension)',
  'Chassis system fault',
  'warning',
);
const GENERIC_BODY = range('Generic body code', 'Body system fault', 'caution');

const MANUFACTURER: Readonly<Record<DtcSystem, DtcRangeInfo>> = {
  powertrain: range(
    'Manufacturer-specific powertrain code',
    'Maker-specific engine fault',
    'caution',
  ),
  // Chassis codes cover brakes (ABS), stability control and steering, so assume a safety impact.
  chassis: range('Manufacturer-specific chassis code', 'Maker-specific chassis fault', 'warning'),
  body: range('Manufacturer-specific body code', 'Maker-specific body fault', 'caution'),
  network: range('Manufacturer-specific network code', 'Maker-specific network fault', 'caution'),
};

/**
 * The J2012 range a valid, normalised code falls into, e.g. "P0301" → misfire (warning),
 * "P1234" → manufacturer-specific powertrain, "U0100" → lost communication.
 */
export function describeDtcRange(code: string): DtcRangeInfo {
  const system = dtcSystemOf(code);
  if (isManufacturerSpecificDtc(code)) return MANUFACTURER[system];

  const digit = code.charAt(1);
  const block = code.charAt(2);
  switch (system) {
    case 'powertrain': {
      const value = Number.parseInt(code.slice(1), 16);
      for (const [from, to, info] of P_SUBRANGES) {
        if (value >= from && value <= to) return info;
      }
      if (digit === '0') return P0_BLOCKS[block] ?? GENERIC_POWERTRAIN;
      if (digit === '2') return P2_BLOCKS[block] ?? GENERIC_POWERTRAIN;
      if (digit === '3' && block === '4') return CYLINDER_DEACTIVATION;
      return GENERIC_POWERTRAIN;
    }
    case 'network':
      return (digit === '0' ? U0_BLOCKS[block] : undefined) ?? GENERIC_NETWORK;
    case 'chassis':
      return GENERIC_CHASSIS;
    case 'body':
      return GENERIC_BODY;
  }
}

/**
 * Human-readable label of the range a code belongs to, for synthesised descriptions:
 * "P03xx", "P1xxx", "P30xx–P33xx", "U01xx", "C0xxx" …
 */
export function dtcRangeLabel(code: string): string {
  const letter = code.charAt(0);
  const digit = code.charAt(1);
  if (letter === 'P') {
    if (digit === '1') return 'P1xxx';
    if (digit === '3' && isManufacturerSpecificDtc(code)) return 'P30xx–P33xx';
    return `${code.slice(0, 3)}xx`;
  }
  if (letter === 'U' && digit === '0') return `${code.slice(0, 3)}xx`;
  return `${code.slice(0, 2)}xxx`;
}
