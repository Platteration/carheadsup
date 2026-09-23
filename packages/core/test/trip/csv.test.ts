import { describe, expect, it } from 'vitest';
import { TRIP_CSV_COLUMNS, tripsToCsv } from '../../src/trip/trip.ts';
import type { TripRecord } from '../../src/types/records.ts';

const HEADER =
  'id,started_at,ended_at,distance_km,duration_s,moving_s,idle_s,fuel_used_l,avg_l_per_100km,' +
  'max_speed_kph,avg_moving_speed_kph,cost,currency,start_odometer_km,end_odometer_km';

function trip(overrides: Partial<TripRecord> = {}): TripRecord {
  return {
    id: 'trip-loyw3v28',
    startedAt: Date.UTC(2026, 8, 23, 7, 30, 0),
    endedAt: Date.UTC(2026, 8, 23, 8, 5, 12, 500),
    distanceKm: 31.425,
    durationS: 2112,
    movingS: 1900,
    idleS: 180,
    fuelUsedL: 2.214,
    avgLPer100km: 7.05,
    maxSpeedKph: 112.5,
    avgMovingSpeedKph: 59.5,
    cost: 3.99,
    currency: 'EUR',
    startOdometerKm: 48_211.3,
    endOdometerKm: 48_242.7,
    ...overrides,
  };
}

/** Minimal RFC 4180 parser, used to check that the output round-trips. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  if (field !== '' || row.length > 0) throw new Error('missing final CRLF');
  return rows;
}

describe('tripsToCsv', () => {
  it('writes only the header row for no trips', () => {
    expect(tripsToCsv([])).toBe(`${HEADER}\r\n`);
    expect(TRIP_CSV_COLUMNS).toHaveLength(15);
  });

  it('writes one CRLF-terminated row per trip with ISO-8601 UTC times', () => {
    expect(tripsToCsv([trip()])).toBe(
      `${HEADER}\r\n` +
        'trip-loyw3v28,2026-09-23T07:30:00.000Z,2026-09-23T08:05:12.500Z,31.425,2112,1900,180,' +
        '2.214,7.05,112.5,59.5,3.99,EUR,48211.3,48242.7\r\n',
    );
  });

  it('keeps the given order', () => {
    const rows = parseCsv(tripsToCsv([trip({ id: 'b' }), trip({ id: 'a' })]));
    expect(rows.map((r) => r[0])).toEqual(['id', 'b', 'a']);
  });

  it('leaves unknown values empty', () => {
    const rows = parseCsv(
      tripsToCsv([
        trip({
          fuelUsedL: null,
          avgLPer100km: null,
          cost: null,
          startOdometerKm: null,
          endOdometerKm: null,
        }),
      ]),
    );
    expect(rows[1]?.slice(7, 9)).toEqual(['', '']);
    expect(rows[1]?.slice(11)).toEqual(['', 'EUR', '', '']);
  });

  it('leaves non-finite numbers and unrepresentable times empty', () => {
    const rows = parseCsv(
      tripsToCsv([trip({ distanceKm: Number.NaN, maxSpeedKph: Infinity, endedAt: 9e15 })]),
    );
    expect(rows[1]?.[2]).toBe('');
    expect(rows[1]?.[3]).toBe('');
    expect(rows[1]?.[9]).toBe('');
  });

  it('quotes fields containing commas, quotes or line breaks (RFC 4180)', () => {
    const text = tripsToCsv([trip({ id: 'a,b', currency: 'say "hi"\r\nbye' })]);
    expect(text).toContain('"a,b",');
    expect(text).toContain(',"say ""hi""\r\nbye",');
    const rows = parseCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveLength(15);
    expect(rows[1]?.[0]).toBe('a,b');
    expect(rows[1]?.[12]).toBe('say "hi"\r\nbye');
  });

  it('defuses text a spreadsheet would run as a formula', () => {
    for (const evil of ['=HYPERLINK("x")', '+1', '-1+2', '@SUM(A1)', '\tx']) {
      const cell = parseCsv(tripsToCsv([trip({ id: evil })]))[1]?.[0];
      expect(cell).toBe(`'${evil}`);
    }
    // Negative numbers are numbers, not text, and stay as they are.
    expect(parseCsv(tripsToCsv([trip({ cost: -1.5 })]))[1]?.[11]).toBe('-1.5');
  });

  it('round-trips every column through a CSV parser', () => {
    const rows = parseCsv(tripsToCsv([trip(), trip({ id: 'trip-2', currency: 'USD' })]));
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveLength(TRIP_CSV_COLUMNS.length);
    expect(rows[0]?.join(',')).toBe(HEADER);
  });
});
