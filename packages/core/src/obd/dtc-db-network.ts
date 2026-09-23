import type { DtcDbEntry } from './dtc-database.ts';

/** Generic network (U0xxx/U3xxx), body (B0xxx) and chassis (C0xxx) codes (SAE J2012). */
export const BCU_CODES: Readonly<Record<string, DtcDbEntry>> = {};
