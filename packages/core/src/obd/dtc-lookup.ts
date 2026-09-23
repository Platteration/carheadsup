import type { DtcInfo } from '../types/vehicle.ts';
import { DTC_DATABASE } from './dtc-database.ts';
import {
  describeDtcRange,
  dtcRangeLabel,
  dtcSystemOf,
  isManufacturerSpecificDtc,
} from './dtc-ranges.ts';
import { DTC_SHORT_MAX_LENGTH, isValidDtc, normalizeDtc } from './dtc.ts';

/**
 * Trouble-code descriptions backed by the ~4,000-entry SAE J2012 database. The database is large
 * (hundreds of kB), so the main index does not export this module: other packages import it from
 * the `@carheadsup/core/dtc` entry point. Inside core, the frame composer and alert rules use it.
 */

/** Clamp a HUD label to {@link DTC_SHORT_MAX_LENGTH}, marking truncation with an ellipsis. */
function clampShort(short: string): string {
  const trimmed = short.trim();
  return trimmed.length <= DTC_SHORT_MAX_LENGTH
    ? trimmed
    : `${trimmed.slice(0, DTC_SHORT_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * Human-friendly information about a code. Unknown codes still return a useful result
 * synthesised from the code's system and range (e.g. "P03xx → Ignition system / misfire").
 *
 * Input is trimmed and upper-cased first. Syntactically invalid input never throws; it returns
 * `known: false` with an "Unrecognised trouble code" description.
 */
export function lookupDtc(code: string): DtcInfo {
  const normalized = normalizeDtc(code);
  const system = dtcSystemOf(normalized);

  if (!isValidDtc(normalized)) {
    return {
      code: normalized,
      system,
      description: 'Unrecognised trouble code',
      short: 'Unrecognised code',
      severity: 'caution',
      manufacturerSpecific: false,
      known: false,
    };
  }

  const manufacturerSpecific = isManufacturerSpecificDtc(normalized);
  const range = describeDtcRange(normalized);
  const entry = Object.hasOwn(DTC_DATABASE, normalized) ? DTC_DATABASE[normalized] : undefined;
  if (entry) {
    return {
      code: normalized,
      system,
      description: entry.description,
      // The HUD always needs a label; fall back to the range label if an entry lacks one.
      short: clampShort(entry.short) || clampShort(range.short),
      severity: entry.severity,
      manufacturerSpecific,
      known: true,
    };
  }

  const rangeLabel = dtcRangeLabel(normalized);
  const description = manufacturerSpecific
    ? `${range.description} (${rangeLabel} range); see the vehicle's service information`
    : `${range.description} (unlisted generic code in the ${rangeLabel} range)`;
  return {
    code: normalized,
    system,
    description,
    short: clampShort(range.short),
    severity: range.severity,
    manufacturerSpecific,
    known: false,
  };
}
