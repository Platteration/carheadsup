import { FormulaError, KM_PER_MI, SIGNAL_IDS, compileFormula, roundTo } from '@carheadsup/core';
import type { CustomPidConfig, SignalId, UnitSystem } from '@carheadsup/core';
import type { UnitSpec } from './units.ts';

/** Vehicle-specific helpers: gear ratios and manufacturer PIDs. */

/**
 * Starting point when switching gear ratios from "learn" to "enter manually": overall ratios of
 * a typical 6-speed car in rpm per km/h (≈ 3000 rpm at 25 / 45 / 65 / 86 / 105 / 125 km/h).
 */
export const TYPICAL_GEAR_RATIOS: readonly number[] = [120, 67, 46, 35, 28.5, 24];

/** Most gears the schema accepts. */
export const MAX_GEARS = 12;

/** Gear ratios are edited in rpm per km/h, or rpm per mph for imperial drivers. */
export function gearRatioUnit(system: UnitSystem): UnitSpec {
  return system === 'imperial'
    ? {
        label: 'rpm per mph',
        decimals: 1,
        toDisplay: (perKph) => perKph * KM_PER_MI,
        fromDisplay: (perMph) => perMph / KM_PER_MI,
      }
    : { label: 'rpm per km/h', decimals: 1, toDisplay: (v) => v, fromDisplay: (v) => v };
}

/** Add a gear after the last one, continuing the spacing of the last two (or a typical step). */
export function withExtraGear(ratios: readonly number[]): number[] {
  const last = ratios[ratios.length - 1];
  const prev = ratios[ratios.length - 2];
  if (last === undefined) return [TYPICAL_GEAR_RATIOS[0] ?? 120];
  const step = prev !== undefined && prev > last ? last / prev : 0.82;
  return [...ratios, roundTo(last * step, 1)];
}

/** Bytes used to try out a formula (A=0x12, B=0x34, C=0x56, D=0x78). */
export const SAMPLE_BYTES = new Uint8Array([0x12, 0x34, 0x56, 0x78]);

export type FormulaCheck = { ok: true; sample: number } | { ok: false; error: string };

/**
 * Compile a Torque-style formula with the same compiler the HUD uses, and evaluate it on sample
 * bytes so the person can sanity-check the scaling.
 */
export function checkFormula(formula: string): FormulaCheck {
  if (formula.trim() === '') return { ok: false, error: 'Enter a formula, e.g. ((A*256)+B)/10' };
  try {
    const evaluate = compileFormula(formula);
    const sample = evaluate(SAMPLE_BYTES);
    if (!Number.isFinite(sample)) {
      return { ok: false, error: 'The formula does not give a number (division by zero?)' };
    }
    return { ok: true, sample };
  } catch (error) {
    if (error instanceof FormulaError) {
      const marker = `at position ${error.position}: `;
      const at = error.message.indexOf(marker);
      const detail = at >= 0 ? error.message.slice(at + marker.length) : error.message;
      return { ok: false, error: `At character ${error.position}: ${detail}` };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid formula' };
  }
}

export const TYRE_SIGNALS: readonly SignalId[] = [
  'tirePressureFL',
  'tirePressureFR',
  'tirePressureRL',
  'tirePressureRR',
];

/** Tyre-pressure signals that have no custom PID yet. */
export function missingTyrePids(pids: readonly CustomPidConfig[]): SignalId[] {
  const mapped = new Set(pids.map((p) => p.signal));
  return TYRE_SIGNALS.filter((s) => !mapped.has(s));
}

/**
 * Signals most often missing from standard OBD-II and read through manufacturer PIDs instead,
 * in the order a new row suggests them.
 */
export const COMMON_CUSTOM_SIGNALS: readonly SignalId[] = [
  'oilTemp',
  ...TYRE_SIGNALS,
  'odometer',
  'transmissionGear',
  'fuelLevel',
  'ambientTemp',
];

/**
 * A new custom PID row: the first unmapped tyre signal when TPMS is wanted, else the first
 * unmapped common one, else any unmapped signal. Mode 22 (manufacturer-specific) with an empty
 * PID for the person to fill in.
 */
export function newCustomPid(
  existing: readonly CustomPidConfig[],
  preferTyres: boolean,
): CustomPidConfig {
  const used = new Set(existing.map((p) => p.signal));
  const tyre = preferTyres ? TYRE_SIGNALS.find((s) => !used.has(s)) : undefined;
  const signal =
    tyre ??
    COMMON_CUSTOM_SIGNALS.find((s) => !used.has(s)) ??
    SIGNAL_IDS.find((s) => !used.has(s)) ??
    'oilTemp';
  return { signal, mode: '22', pid: '', header: null, formula: 'A', intervalMs: 1000 };
}
