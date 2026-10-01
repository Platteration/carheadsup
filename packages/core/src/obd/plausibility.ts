import type { SignalId } from '../types/signals.ts';

/**
 * The values each signal can physically take, in canonical units (see `types/signals.ts`). A
 * reading outside is not data: a sensor fault (many report all bits set — 0xFF coolant decodes
 * to 215 °C, 0xFFFF rpm to 16 384), a garbled answer, or a custom-PID formula meeting a fault
 * value (an absolute-pressure formula on a tyre sensor's 0 gives −101 kPa). `applySamples` drops
 * such a reading and the signal reads as missing, as the staleness rule wants: no alert from a
 * value that cannot be true, and no old value shown in its place.
 *
 * The ranges are wide on purpose: they reject the impossible, not the alarming. Coolant goes up
 * to 200 °C so that a real overheating reading is never thrown away, only the 0xF1–0xFF fault
 * codes; battery voltages up to 30 V so a 24 V vehicle or a failed regulator still shows.
 */
export const SIGNAL_VALID_RANGE: Readonly<Record<SignalId, readonly [min: number, max: number]>> =
  Object.freeze({
    speed: [0, 300],
    rpm: [0, 12_000],
    engineLoad: [0, 100],
    absoluteLoad: [0, 1000],
    throttle: [0, 100],
    relativeThrottle: [0, 100],
    acceleratorPedal: [0, 100],
    timingAdvance: [-64, 64],
    transmissionGear: [0, 12],

    coolantTemp: [-40, 200],
    intakeAirTemp: [-40, 150],
    oilTemp: [-40, 200],
    ambientTemp: [-60, 70],
    catalystTempB1S1: [-40, 1300],

    maf: [0, 600],
    map: [0, 400],
    baroPressure: [50, 115],
    fuelLevel: [0, 100],
    fuelRate: [0, 300],
    fuelPressure: [0, 1000],
    fuelRailPressure: [0, 300_000],
    commandedLambda: [0, 2],
    ethanolPercent: [0, 100],
    shortFuelTrimB1: [-100, 100],
    longFuelTrimB1: [-100, 100],
    shortFuelTrimB2: [-100, 100],
    longFuelTrimB2: [-100, 100],

    controlModuleVoltage: [0, 30],
    batteryVoltage: [0, 30],

    odometer: [0, 10_000_000],
    runTime: [0, 65_535],
    distanceSinceClear: [0, 65_535],
    distanceWithMil: [0, 65_535],

    // kPa gauge: a little below 0 for a sensor's offset, 7 bar for a van's rear tyres and more.
    tirePressureFL: [-20, 700],
    tirePressureFR: [-20, 700],
    tirePressureRL: [-20, 700],
    tirePressureRR: [-20, 700],
  });

/** Whether `value` is a reading `signal` can physically have (finite and within its range). */
export function isPlausible(signal: SignalId, value: number): boolean {
  const range = SIGNAL_VALID_RANGE[signal];
  return Number.isFinite(value) && value >= range[0] && value <= range[1];
}
