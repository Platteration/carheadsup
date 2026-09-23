import type { DtcSeverity } from '../types/vehicle.ts';

export interface DtcDbEntry {
  /** Official-style SAE J2012 description, e.g. "Catalyst System Efficiency Below Threshold (Bank 1)". */
  description: string;
  /** Glanceable HUD label ≤ 32 chars, e.g. "Catalytic converter efficiency". */
  short: string;
  severity: DtcSeverity;
}

/** Generic (SAE-defined) trouble codes, keyed by five-character code. */
export const DTC_DATABASE: Readonly<Record<string, DtcDbEntry>> = {};
