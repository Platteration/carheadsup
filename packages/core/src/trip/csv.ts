import type { TripRecord } from '../types/records.ts';

type CsvValue = string | number | null;

/** Columns of the trip export, in order: header name and how to read it from a record. */
export const TRIP_CSV_COLUMNS: ReadonlyArray<
  readonly [header: string, read: (t: TripRecord) => CsvValue]
> = [
  ['id', (t) => t.id],
  ['started_at', (t) => isoTime(t.startedAt)],
  ['ended_at', (t) => isoTime(t.endedAt)],
  ['distance_km', (t) => t.distanceKm],
  ['duration_s', (t) => t.durationS],
  ['moving_s', (t) => t.movingS],
  ['idle_s', (t) => t.idleS],
  ['fuel_used_l', (t) => t.fuelUsedL],
  ['avg_l_per_100km', (t) => t.avgLPer100km],
  ['max_speed_kph', (t) => t.maxSpeedKph],
  ['avg_moving_speed_kph', (t) => t.avgMovingSpeedKph],
  ['cost', (t) => t.cost],
  ['currency', (t) => t.currency],
  ['start_odometer_km', (t) => t.startOdometerKm],
  ['end_odometer_km', (t) => t.endOdometerKm],
];

/** Largest |epoch ms| a JavaScript Date can represent. */
const MAX_DATE_MS = 8.64e15;

/** ISO-8601 UTC ("2026-09-23T07:30:00.000Z"), or null for an unrepresentable time. */
function isoTime(ms: number): string | null {
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_DATE_MS ? new Date(ms).toISOString() : null;
}

/**
 * One RFC 4180 field. Null and non-finite numbers become empty fields. Text that a spreadsheet
 * would evaluate as a formula (leading =, +, -, @, tab or CR) is prefixed with an apostrophe
 * (OWASP CSV-injection guidance); text containing a comma, quote or line break is quoted with
 * embedded quotes doubled.
 */
function csvField(value: CsvValue): string {
  if (value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Trips as CSV (RFC 4180): a header row, then one row per trip in the given order, CRLF line
 * endings (including after the last row), times as ISO-8601 UTC, unknown values empty.
 */
export function tripsToCsv(trips: readonly TripRecord[]): string {
  const rows = [TRIP_CSV_COLUMNS.map(([header]) => header).join(',')];
  for (const trip of trips)
    rows.push(TRIP_CSV_COLUMNS.map(([, read]) => csvField(read(trip))).join(','));
  return rows.map((row) => `${row}\r\n`).join('');
}
