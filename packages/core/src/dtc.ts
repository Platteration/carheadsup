/**
 * `@carheadsup/core/dtc` — trouble-code descriptions: `lookupDtc` and the SAE J2012 database
 * behind it (~4,000 entries, hundreds of kB of text).
 *
 * This is a separate entry point so that bundles built from the main `@carheadsup/core` index
 * never carry the database by accident: the HUD kiosk needs none of it (frames and
 * `/api/diagnostics` already carry decoded descriptions), and the dev console loads it lazily.
 * Code syntax helpers (`normalizeDtc`, `isValidDtc`, `parseDtcPayload` …) stay in the main index.
 * The frame composer and alert rules use the lookup internally.
 */
export { lookupDtc } from './obd/dtc-lookup.ts';
export { DTC_DATABASE } from './obd/dtc-database.ts';
export type { DtcDbEntry } from './obd/dtc-database.ts';
