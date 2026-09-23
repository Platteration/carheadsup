/**
 * Canonical vehicle signals. Every value inside the system is stored in these
 * units; conversion to the driver's preferred units happens only when a frame
 * is composed for display (see `compose/`).
 *
 *   speed          km/h            rpm            rev/min
 *   temperatures   °C              pressures      kPa (absolute unless noted)
 *   voltage        V               percentages    0..100
 *   distance       km              flow           g/s (air), L/h (fuel)
 *   time           s               ratios         unitless
 */
export const SIGNAL_IDS = [
  // Core driving
  'speed', // km/h — PID 0x0D
  'rpm', // rev/min — PID 0x0C
  'engineLoad', // % — PID 0x04 (calculated load)
  'absoluteLoad', // % — PID 0x43
  'throttle', // % — PID 0x11 (absolute throttle position)
  'relativeThrottle', // % — PID 0x45
  'acceleratorPedal', // % — PID 0x49 (accelerator pedal position D)
  'timingAdvance', // ° before TDC — PID 0x0E
  'transmissionGear', // gear number, 0 = neutral — PID 0xA4 (where supported)

  // Temperatures
  'coolantTemp', // °C — PID 0x05
  'intakeAirTemp', // °C — PID 0x0F
  'oilTemp', // °C — PID 0x5C
  'ambientTemp', // °C — PID 0x46
  'catalystTempB1S1', // °C — PID 0x3C

  // Air / fuel
  'maf', // g/s — PID 0x10
  'map', // kPa absolute — PID 0x0B
  'baroPressure', // kPa absolute — PID 0x33
  'fuelLevel', // % — PID 0x2F
  'fuelRate', // L/h — PID 0x5E (engine fuel rate)
  'fuelPressure', // kPa gauge — PID 0x0A
  'fuelRailPressure', // kPa gauge — PID 0x23
  'commandedLambda', // equivalence ratio λ — PID 0x44
  'ethanolPercent', // % — PID 0x52
  'shortFuelTrimB1', // % — PID 0x06
  'longFuelTrimB1', // % — PID 0x07
  'shortFuelTrimB2', // % — PID 0x08
  'longFuelTrimB2', // % — PID 0x09

  // Electrical
  'controlModuleVoltage', // V — PID 0x42
  'batteryVoltage', // V — ELM327 `AT RV` (OBD port pin 16)

  // Distance / time
  'odometer', // km — PID 0xA6 (newer vehicles only)
  'runTime', // s since engine start — PID 0x1F
  'distanceSinceClear', // km since DTCs cleared — PID 0x31
  'distanceWithMil', // km travelled with MIL on — PID 0x21

  // Tyres (manufacturer-specific; populated via custom PIDs in config)
  'tirePressureFL', // kPa gauge
  'tirePressureFR', // kPa gauge
  'tirePressureRL', // kPa gauge
  'tirePressureRR', // kPa gauge
] as const;

export type SignalId = (typeof SIGNAL_IDS)[number];

export type SignalUnit =
  'km/h' | 'rpm' | '%' | '°' | '°C' | 'kPa' | 'g/s' | 'L/h' | 'λ' | 'V' | 'km' | 's' | 'gear';

/** Descriptive metadata about a signal, used by the diagnostics dashboard. */
export interface SignalMeta {
  id: SignalId;
  /** Short human label, e.g. "Coolant". */
  label: string;
  unit: SignalUnit;
  /** Plausible physical range, used for gauge scaling. */
  min: number;
  max: number;
  /** Number of decimals worth showing in canonical units. */
  decimals: number;
  /**
   * Values outside [normalMin, normalMax] are highlighted on the diagnostics
   * dashboard. Omitted when "normal" is not meaningful for the signal.
   */
  normalMin?: number;
  normalMax?: number;
}

export interface SignalSample {
  value: number;
  /** Epoch ms when the value was received from the vehicle. */
  at: number;
}

export type SignalMap = Partial<Record<SignalId, SignalSample>>;
