import {
  DEFAULT_CONFIG,
  EMPTY_PERSISTED_STATE,
  composeFrame,
  createInitialState,
  diagnosticsPageKinds,
  reduce,
} from '@carheadsup/core';
import type {
  DiagnosticGauge,
  DiagnosticsMaintenanceItem,
  DiagnosticsTrip,
  DisplayDistance,
  HudConfig,
  HudEvent,
  HudState,
  SignalId,
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
import { FIXTURE_TIME, SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';
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

const ITEM: DiagnosticsMaintenanceItem = {
  itemId: 'oil',
  label: 'Oil & filter',
  status: 'unknown',
  remaining: null,
  remainingDays: null,
  dueAtEpochMs: null,
};

/** A remaining service distance as the composer sends it (signed value, unsigned text). */
const left = (value: number, unit: 'km' | 'mi' = 'km'): DisplayDistance => ({
  value,
  unit,
  text: `${Math.abs(value)} ${unit}`,
});

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
  it('describes what remains, in the units the frame carries', () => {
    expect(maintenanceRemaining({ ...ITEM, remaining: left(1240), remainingDays: 45 })).toBe(
      'in 1240 km · 45 days',
    );
    expect(maintenanceRemaining({ ...ITEM, remaining: left(12_420) })).toBe('in 12\u2009420 km');
    expect(maintenanceRemaining({ ...ITEM, remaining: left(261, 'mi') })).toBe('in 261 mi');
    expect(maintenanceRemaining({ ...ITEM, remainingDays: 1 })).toBe('in 1 day');
    expect(maintenanceRemaining({ ...ITEM, remaining: left(0), remainingDays: 0 })).toBe(
      'in 0 km · 0 days',
    );
  });

  it('describes what is overdue, keeping mixed limits apart', () => {
    expect(maintenanceRemaining({ ...ITEM, remaining: left(-320), remainingDays: -12 })).toBe(
      '320 km · 12 days overdue',
    );
    expect(maintenanceRemaining({ ...ITEM, remaining: left(420), remainingDays: -3 })).toBe(
      'in 420 km · 3 days overdue',
    );
    expect(maintenanceRemaining({ ...ITEM, remaining: left(-199, 'mi'), remainingDays: 30 })).toBe(
      'in 30 days · 199 mi overdue',
    );
  });

  it('is null when nothing is known', () => {
    expect(maintenanceRemaining(ITEM)).toBeNull();
    expect(maintenanceRemaining({ ...ITEM, remaining: left(Number.NaN) })).toBeNull();
    expect(maintenanceRemaining({ ...ITEM, remainingDays: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe('tripTiles', () => {
  const trip: DiagnosticsTrip = {
    completed: false,
    distance: { value: 26.5, unit: 'mi', text: '26.5 mi' },
    durationS: 3120,
    movingS: 2710,
    averageEconomy: 32.3,
    economyUnit: 'mpg-us',
    fuelUsed: 0.82,
    fuelUnit: 'gal',
    cost: 3.1,
    currency: 'USD',
  };
  const flat = (tiles: ReturnType<typeof tripTiles>) =>
    tiles.map((t) => `${t.label}=${t.value}${t.unit ? ` ${t.unit}` : ''}`);

  it('shows the trip in the units the frame carries', () => {
    expect(flat(tripTiles(trip))).toEqual([
      'Distance=26.5 mi',
      'Driving time=52 min',
      'Moving=45 min',
      'Average=32.3 mpg',
      'Fuel used=0.8 gal',
      'Cost=$3.10',
    ]);
  });

  it('shows dashes without units for unknown economy, fuel and cost', () => {
    const unknown = { ...trip, averageEconomy: null, fuelUsed: null, cost: Number.NaN };
    expect(flat(tripTiles(unknown))).toEqual([
      'Distance=26.5 mi',
      'Driving time=52 min',
      'Moving=45 min',
      'Average=–',
      'Fuel used=–',
      'Cost=–',
    ]);
  });

  it('is empty without a trip', () => {
    expect(tripTiles(null)).toEqual([]);
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

  it('marks an estimated odometer with ≈', () => {
    const odometer: DiagnosticGauge = {
      signal: 'odometer',
      label: 'Odometer',
      value: 58_100,
      unit: 'km',
      decimals: 0,
      min: 0,
      max: 999_999,
      status: 'ok',
    };
    const overview = SAMPLE_FRAMES['parked-overview']!;
    const page = (gauge: DiagnosticGauge) =>
      textOf(
        renderHud({ ...overview, diagnostics: { ...overview.diagnostics!, gauges: [gauge] } }),
      );
    expect(page({ ...odometer, estimated: true })).toMatch(/Odometer ≈ 58\s?100 km/);
    expect(page(odometer)).not.toContain('≈');
    expect(page({ ...odometer, value: null, estimated: true })).not.toContain('≈');
  });

  it('says so when there are no trouble codes', () => {
    const html = renderHud({ ...parked, diagnostics: { ...diag, dtcs: [], milOn: false } });
    expect(textOf(html)).toContain('No trouble codes Check-engine light off');
    expect(html).not.toContain('hud-diag__mil');
  });

  it('says whether the trip page shows the trip in progress or the last one', () => {
    const tripFrame = SAMPLE_FRAMES['parked-trip']!;
    const live = textOf(renderHud(tripFrame));
    expect(live).toContain('In progress');
    expect(live).not.toContain('Last trip');
    const trip = tripFrame.diagnostics!.trip!;
    const done = renderHud({
      ...tripFrame,
      widgets: tripFrame.widgets.filter((w) => w.id !== 'tripSummary'),
      diagnostics: { ...tripFrame.diagnostics!, trip: { ...trip, completed: true } },
    });
    expect(textOf(done)).toContain('Last trip');
    expect(done).toContain('data-completed="true"');
    // The page needs no trip widget: everything comes from the dashboard frame.
    expect(textOf(done)).toContain('42.7 km');
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

describe('dashboard composed end to end in the driver’s units', () => {
  const DAY = 86_400_000;
  const imperial: HudConfig = {
    ...DEFAULT_CONFIG,
    units: {
      ...DEFAULT_CONFIG.units,
      system: 'imperial',
      fuelEconomy: 'mpg-us',
      temperature: 'F',
      pressure: 'psi',
      currency: 'USD',
    },
  };

  function showPage(state: HudState, config: HudConfig, kind: 'trip' | 'maintenance'): string {
    const page = diagnosticsPageKinds(state).indexOf(kind);
    const frame = composeFrame({ ...state, ui: { ...state.ui, page } }, config);
    expect(frame.diagnostics?.page).toBe(kind);
    return textOf(renderHud(frame));
  }

  it('shows an imperial driver miles on the maintenance page, never kilometres', () => {
    const state = createInitialState(
      imperial,
      {
        ...EMPTY_PERSISTED_STATE,
        odometerKm: 55_790,
        maintenanceRecords: [
          { itemId: 'oil', odometerKm: 48_210, at: FIXTURE_TIME - 345 * DAY },
          { itemId: 'tyre-rotation', odometerKm: 45_000, at: FIXTURE_TIME - 90 * DAY },
        ],
      },
      FIXTURE_TIME,
    );
    const text = showPage(state, imperial, 'maintenance');
    expect(text).toContain('Oil & filter Due soon in 261 mi · 20 days');
    expect(text).toContain('Tyre rotation Overdue 491 mi overdue'); // 790 km
    expect(text).not.toMatch(/\bkm\b/);
  });

  it('shows an imperial driver the trip in miles, gallons and mpg', () => {
    const t0 = FIXTURE_TIME - 200_000;
    let state = createInitialState(imperial, EMPTY_PERSISTED_STATE, t0);
    const send = (event: HudEvent) => {
      state = reduce(state, event, imperial);
    };
    const samples = (at: number, values: Partial<Record<SignalId, number>>) =>
      send({
        type: 'obd/samples',
        samples: Object.entries(values).map(([signal, value]) => ({
          signal: signal as SignalId,
          value: value ?? 0,
        })),
        at,
      });
    send({ type: 'obd/link', state: 'connected', at: t0 });
    for (let at = t0 + 500; at <= t0 + 60_000; at += 500) {
      samples(at, { speed: 60, rpm: 2000, fuelRate: 4 });
    }
    for (let at = t0 + 60_500; at <= t0 + 63_000; at += 500) samples(at, { speed: 0, rpm: 0 });
    for (let at = t0 + 65_000; at <= FIXTURE_TIME; at += 5000) send({ type: 'tick', at });
    expect(state.context.context).toBe('parked');
    expect(state.trip.current).not.toBeNull();

    const text = showPage(state, imperial, 'trip');
    expect(text).toContain('In progress');
    expect(text).toMatch(/Distance 0\.6 mi/);
    expect(text).toMatch(/Average \d+\.\d mpg/);
    expect(text).toMatch(/Fuel used \d\.\d gal/);
    expect(text).toMatch(/Cost \$\d+\.\d\d/);
    expect(text).not.toMatch(/\bkm\b|\bL\b/);
  });
});
