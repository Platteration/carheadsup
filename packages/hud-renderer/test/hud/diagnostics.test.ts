import type {
  DiagnosticGauge,
  MaintenanceItemStatus,
  TripSummary,
  TripSummaryWidget,
} from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import {
  MAX_DTC_ROWS,
  gaugeFraction,
  gaugeGridShape,
  maintenanceRemaining,
  tripTiles,
  vehicleLine,
} from '../../src/hud/diagnostics/Diagnostics.tsx';
import { SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';
import { renderHud, textOf } from './render.ts';

const GAUGE: DiagnosticGauge = {
  signal: 'coolantTemp',
  label: 'Coolant',
  value: 85,
  unit: '°C',
  decimals: 0,
  min: 40,
  max: 130,
  status: 'ok',
};

const ITEM: MaintenanceItemStatus = {
  itemId: 'oil',
  label: 'Oil & filter',
  lastDoneAt: null,
  lastDoneKm: null,
  dueAtKm: null,
  dueAtEpochMs: null,
  remainingKm: null,
  remainingDays: null,
  status: 'unknown',
};

describe('gaugeGridShape', () => {
  it('keeps tiles large and never exceeds five columns', () => {
    expect([0, 1, 3, 4, 5, 6, 7, 8, 9, 12, 13, 20].map((n) => gaugeGridShape(n))).toEqual([
      { columns: 1, rows: 1 },
      { columns: 1, rows: 1 },
      { columns: 3, rows: 1 },
      { columns: 4, rows: 1 },
      { columns: 3, rows: 2 },
      { columns: 3, rows: 2 },
      { columns: 4, rows: 2 },
      { columns: 4, rows: 2 },
      { columns: 4, rows: 3 },
      { columns: 4, rows: 3 },
      { columns: 5, rows: 3 },
      { columns: 5, rows: 4 },
    ]);
  });
});

describe('gaugeFraction', () => {
  it('places the value within the range, clamped', () => {
    expect(gaugeFraction(GAUGE)).toBeCloseTo(0.5);
    expect(gaugeFraction({ ...GAUGE, value: 10 })).toBe(0);
    expect(gaugeFraction({ ...GAUGE, value: 500 })).toBe(1);
  });

  it('is 0 for missing values and empty or inverted ranges', () => {
    expect(gaugeFraction({ ...GAUGE, value: null })).toBe(0);
    expect(gaugeFraction({ ...GAUGE, min: 100, max: 100 })).toBe(0);
    expect(gaugeFraction({ ...GAUGE, min: 100, max: 0 })).toBe(0);
  });
});

describe('maintenanceRemaining', () => {
  it('describes what remains', () => {
    expect(maintenanceRemaining({ ...ITEM, remainingKm: 1240, remainingDays: 45 })).toBe(
      'in 1240 km · 45 days',
    );
    expect(maintenanceRemaining({ ...ITEM, remainingKm: 12_420 })).toBe('in 12 420 km');
    expect(maintenanceRemaining({ ...ITEM, remainingDays: 1 })).toBe('in 1 day');
  });

  it('describes what is overdue, keeping mixed limits apart', () => {
    expect(maintenanceRemaining({ ...ITEM, remainingKm: -320, remainingDays: -12 })).toBe(
      '320 km · 12 days overdue',
    );
    expect(maintenanceRemaining({ ...ITEM, remainingKm: 420, remainingDays: -3 })).toBe(
      'in 420 km · 3 days overdue',
    );
  });

  it('is null when nothing is known', () => {
    expect(maintenanceRemaining(ITEM)).toBeNull();
    expect(maintenanceRemaining({ ...ITEM, remainingKm: Number.NaN })).toBeNull();
  });
});

describe('tripTiles', () => {
  const trip: TripSummary = {
    startedAt: 0,
    distanceKm: 42.66,
    durationS: 3120,
    movingS: 2710,
    fuelUsedL: null,
    avgLPer100km: null,
    cost: null,
    currency: 'EUR',
  };
  const widget: TripSummaryWidget = {
    id: 'tripSummary',
    zone: 'bottom',
    distance: { value: 26.5, unit: 'mi', text: '26.5 mi' },
    durationS: 3120,
    averageEconomy: 32.3,
    economyUnit: 'mpg-us',
    fuelUsed: 0.82,
    fuelUnit: 'gal',
    cost: 3.1,
    currency: 'USD',
  };
  const flat = (tiles: ReturnType<typeof tripTiles>) =>
    tiles.map((t) => `${t.label}=${t.value}${t.unit ? ` ${t.unit}` : ''}`);

  it('prefers the display-unit widget', () => {
    expect(flat(tripTiles(trip, widget))).toEqual([
      'Distance=26.5 mi',
      'Driving time=52 min',
      'Moving=45 min',
      'Average=32.3 mpg',
      'Fuel used=0.8 gal',
      'Cost=$3.10',
    ]);
  });

  it('falls back to the canonical summary with dashes for unknowns', () => {
    expect(flat(tripTiles(trip, null))).toEqual([
      'Distance=42.7 km',
      'Driving time=52 min',
      'Moving=45 min',
      'Average=–',
      'Fuel used=–',
      'Cost=–',
    ]);
  });

  it('is empty without a trip', () => {
    expect(tripTiles(null, null)).toEqual([]);
  });
});

describe('vehicleLine', () => {
  it('joins what is known', () => {
    expect(vehicleLine({ vin: 'VIN123', adapter: 'ELM327 v1.5', protocol: null })).toBe(
      'VIN VIN123  ·  ELM327 v1.5',
    );
    expect(vehicleLine({ vin: null, adapter: '  ', protocol: null })).toBeNull();
  });
});

describe('dashboard pages', () => {
  const parked = SAMPLE_FRAMES['parked-trouble-codes']!;
  const diag = parked.diagnostics!;

  it('summarises trouble codes that do not fit', () => {
    const dtcs = Array.from({ length: MAX_DTC_ROWS + 2 }, (_, i) => ({
      ...diag.dtcs[0]!,
      code: `P03${String(i).padStart(2, '0')}`,
    }));
    const html = renderHud({ ...parked, diagnostics: { ...diag, dtcs } });
    expect(html.match(/class="hud-dtc hud-tone/g)).toHaveLength(MAX_DTC_ROWS);
    expect(textOf(html)).toContain('+2 more');
  });

  it('says so when there are no trouble codes', () => {
    const html = renderHud({ ...parked, diagnostics: { ...diag, dtcs: [], milOn: false } });
    expect(textOf(html)).toContain('No trouble codes Check-engine light off');
    expect(html).not.toContain('hud-diag__mil');
  });

  it('handles empty trip, maintenance and gauge pages', () => {
    const page = (p: typeof diag.page) =>
      textOf(
        renderHud({
          ...parked,
          diagnostics: { ...diag, page: p, gauges: [], trip: null, maintenance: [] },
        }),
      );
    expect(page('trip')).toContain('No trip in progress');
    expect(page('maintenance')).toContain('No service items');
    expect(page('engine')).toContain('No live data');
    expect(page('overview')).toContain('No live data');
  });

  it('shows gauge pages with missing values as dashes and no bar', () => {
    const html = renderHud({
      ...parked,
      diagnostics: {
        ...diag,
        page: 'electrical',
        gauges: [{ ...GAUGE, value: null, status: 'unknown' }],
      },
    });
    expect(textOf(html)).toContain('Coolant – °C');
    expect(html).not.toContain('hud-gauge__fill');
    expect(html).toContain('hud-tone--unknown');
  });

  it('summarises codes and due services on the overview page', () => {
    const overview = SAMPLE_FRAMES['parked-overview']!;
    const html = renderHud({
      ...overview,
      diagnostics: { ...overview.diagnostics!, dtcs: diag.dtcs },
    });
    expect(textOf(html)).toContain('4 trouble codes');
    expect(textOf(html)).toContain('Oil & filter: Due soon');
  });

  it('caps the page dots', () => {
    const html = renderHud({ ...parked, diagnostics: { ...diag, pageCount: 40, pageIndex: 2 } });
    expect(html.match(/class="hud-diag__dot[ "]/g)).toHaveLength(12);
    const single = renderHud({ ...parked, diagnostics: { ...diag, pageCount: 1, pageIndex: 0 } });
    expect(single).not.toContain('hud-diag__dots');
  });
});
