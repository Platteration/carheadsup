import type { DtcSeverity } from '../types/vehicle.ts';
import { BCU_CODES } from './dtc-db-network.ts';
import { P0_CODES } from './dtc-db-p0.ts';
import { P2_P3_CODES } from './dtc-db-p2.ts';

export interface DtcDbEntry {
  /** Official-style SAE J2012 description, e.g. "Catalyst System Efficiency Below Threshold (Bank 1)". */
  description: string;
  /** Glanceable HUD label ≤ 32 chars, e.g. "Catalytic converter efficiency". */
  short: string;
  severity: DtcSeverity;
}

/** Generic (SAE-defined) trouble codes, keyed by five-character code. */
export const DTC_DATABASE: Readonly<Record<string, DtcDbEntry>> = {
  ...P0_CODES,
  ...P2_P3_CODES,
  ...BCU_CODES,
};
