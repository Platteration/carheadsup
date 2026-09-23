import type { DtcDbEntry } from './dtc-database.ts';

/** Generic powertrain codes P2000–P2FFF and P3400–P3FFF (SAE J2012). */
export const P2_P3_CODES: Readonly<Record<string, DtcDbEntry>> = {};
