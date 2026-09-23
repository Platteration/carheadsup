import { DEFAULT_CONFIG } from '@carheadsup/core';
import type {
  ApiDiagnostics,
  MaintenanceItemStatus,
  TripRecord,
  UnitsConfig,
} from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import {
  bestKnownOdometerKm,
  formatDateTime,
  formatEconomy,
  formatFuel,
  formatUptime,
  maintenanceIdFor,
  maintenanceLastDone,
  maintenanceRemaining,
  signalRows,
  sortMaintenance,
  tripTotals,
  tripView,
} from '../../src/settings/model/records.ts';
import { mockDiagnostics, mockMaintenance, mockTrips } from './mock-hud.ts';

const METRIC: UnitsConfig = { ...DEFAULT_CONFIG.units, currency: 'EUR' };
const US: UnitsConfig = {
  system: 'imperial',
  fuelEconomy: 'mpg-us',
  temperature: 'F',
  pressure: 'psi',
  clock: '12h',
  currency: 'USD',
};
const UK: UnitsConfig = { ...US, fuelEconomy: 'mpg-uk', temperature: 'C' };

const TRIP: TripRecord = mockTrips()[0]!;

describe('trips', () => {
  it('shows a trip in metric units', () => {
    const view = tripView(TRIP, METRIC);
    expect(view.distance).toBe('42.7 km');
    expect(view.duration).toBe('52 min');
    expect(view.fuel).toBe('3.10 L');
    expect(view.economy).toBe('7.3 L/100 km');
    expect(view.cost).toBe('€5.64');
  });

  it('shows a trip in US and UK units', () => {
    const us = tripView(TRIP, US);
    expect(us.distance).toBe('26.5 mi');
    expect(us.fuel).toBe('0.82 gal');
    expect(us.economy).toBe('32.4 mpg');
    expect(us.avgSpeed).toMatch(/ mph$/);
    const uk = tripView(TRIP, UK);
    expect(uk.fuel).toBe('0.68 gal');
    expect(uk.economy).toBe('38.9 mpg (UK)');
  });

  it('leaves unknown fuel and cost empty', () => {
    const view = tripView({ ...TRIP, fuelUsedL: null, avgLPer100km: null, cost: null }, METRIC);
    expect(view.fuel).toBeNull();
    expect(view.economy).toBeNull();
    expect(view.cost).toBeNull();
  });

  it('totals trips, averaging consumption only over trips with fuel data', () => {
    const trips = mockTrips();
    const totals = tripTotals(trips);
    expect(totals.count).toBe(5);
    expect(totals.distanceKm).toBeCloseTo(272.9, 6);
    expect(totals.durationS).toBe((52 + 25 + 118 + 19 + 34) * 60);
    expect(totals.fuelL).toBeCloseTo(18.5, 6);
    // The 8.1 km trip has no fuel data and is left out of the average.
    expect(totals.avgLPer100km).toBeCloseTo((18.5 / (272.9 - 8.1)) * 100, 6);
    expect(totals.costs).toEqual([{ currency: 'EUR', amount: 33.67 }]);
  });

  it('keeps currencies apart and handles no data', () => {
    const totals = tripTotals([
      { ...TRIP, cost: 5, currency: 'EUR' },
      { ...TRIP, id: 'b', cost: 7, currency: 'USD' },
    ]);
    expect(totals.costs).toEqual([
      { currency: 'EUR', amount: 5 },
      { currency: 'USD', amount: 7 },
    ]);
    expect(tripTotals([])).toEqual({
      count: 0,
      distanceKm: 0,
      durationS: 0,
      fuelL: null,
      avgLPer100km: null,
      costs: [],
    });
  });

  it('formats fuel, economy and dates', () => {
    expect(formatFuel(45.25, METRIC)).toBe('45.3 L');
    expect(formatEconomy(0, METRIC)).toBeNull();
    expect(formatDateTime(Date.UTC(2026, 4, 14, 15, 42), '24h', 'en-GB')).toMatch(
      /^Thu 14 May · \d{2}:42$/,
    );
    expect(formatDateTime(Date.UTC(2026, 4, 14, 15, 42), '12h', 'en-US')).toMatch(/(AM|PM)$/);
  });
});

describe('maintenance', () => {
  const [oil, brake, tyres, cabin] = mockMaintenance() as [
    MaintenanceItemStatus,
    MaintenanceItemStatus,
    MaintenanceItemStatus,
    MaintenanceItemStatus,
  ];

  it('describes what is left, in the driver’s units', () => {
    expect(maintenanceRemaining(oil, METRIC)).toBe('420 km or 20 days left');
    expect(maintenanceRemaining(oil, US)).toBe('261 mi or 20 days left');
    expect(maintenanceRemaining(tyres, METRIC)).toBe('6210 km left');
    expect(maintenanceRemaining({ ...oil, remainingDays: 1 }, METRIC)).toBe('420 km or 1 day left');
  });

  it('describes overdue items and items without history', () => {
    expect(maintenanceRemaining(brake, METRIC)).toBe('Overdue by 12 days');
    expect(maintenanceRemaining({ ...oil, remainingKm: -150, remainingDays: -3 }, METRIC)).toBe(
      'Overdue by 150 km and 3 days',
    );
    expect(maintenanceRemaining({ ...oil, remainingKm: -150 }, METRIC)).toBe('Overdue by 150 km');
    expect(maintenanceRemaining(cabin, METRIC)).toBe('Log the last service to start tracking');
  });

  it('describes the last service', () => {
    expect(maintenanceLastDone(oil, METRIC, 'en-GB')).toBe('Last done at 50 210 km, 3 Jun 2025');
    expect(maintenanceLastDone(brake, METRIC, 'en-GB')).toBe('Last done 2 May 2024');
    expect(maintenanceLastDone(cabin, METRIC)).toBeNull();
  });

  it('sorts the most urgent first', () => {
    expect(sortMaintenance([tyres, cabin, oil, brake]).map((i) => i.status)).toEqual([
      'overdue',
      'due-soon',
      'unknown',
      'ok',
    ]);
  });

  it('derives unique item ids from labels', () => {
    expect(maintenanceIdFor('Spark plugs', [])).toBe('spark-plugs');
    expect(maintenanceIdFor('Spark plugs', ['spark-plugs', 'spark-plugs-2'])).toBe('spark-plugs-3');
    expect(maintenanceIdFor('  ***  ', [])).toBe('item');
    expect(maintenanceIdFor('Bremsflüssigkeit', [])).toBe('bremsflussigkeit');
  });

  it('pre-fills the odometer from the car, the last trip, or the last service', () => {
    const diag = mockDiagnostics();
    expect(bestKnownOdometerKm(diag, mockTrips(), [oil])).toBe(58_012.4);
    const noOdo: ApiDiagnostics = { ...diag, signals: {} };
    expect(bestKnownOdometerKm(noOdo, mockTrips(), [oil])).toBeCloseTo(58_042.7, 6);
    expect(bestKnownOdometerKm(null, [], [oil, tyres])).toBe(54_000);
    expect(bestKnownOdometerKm(null, [{ ...TRIP, endOdometerKm: null }], [cabin])).toBeNull();
  });
});

describe('signalRows', () => {
  it('lists signals in canonical order with display units', () => {
    const rows = signalRows(mockDiagnostics(), US);
    expect(rows[0]).toMatchObject({ id: 'speed', value: '0', unit: 'mph' });
    const coolant = rows.find((r) => r.id === 'coolantTemp');
    expect(coolant).toMatchObject({ value: '196', unit: '°F', stale: false, abnormal: false });
    expect(rows.find((r) => r.id === 'odometer')).toMatchObject({ unit: 'mi' });
    expect(rows.find((r) => r.id === 'maf')).toMatchObject({ unit: 'g/s' });
  });

  it('marks values outside the normal band', () => {
    const rows = signalRows(mockDiagnostics(), METRIC);
    expect(rows.find((r) => r.id === 'longFuelTrimB1')?.abnormal).toBe(true);
  });

  it('marks samples stale relative to the newest one, and everything stale without a link', () => {
    const diag = mockDiagnostics();
    const rows = signalRows(diag, METRIC);
    // Oil temperature is 60 s older than the newest sample; its limit is 10 s.
    expect(rows.find((r) => r.id === 'oilTemp')?.stale).toBe(true);
    // Fuel level is 4 s old but may be up to 120 s old.
    expect(rows.find((r) => r.id === 'fuelLevel')?.stale).toBe(false);
    const down = signalRows({ ...diag, link: { ...diag.link, state: 'disconnected' } }, METRIC);
    expect(down.every((r) => r.stale)).toBe(true);
  });

  it('skips non-finite samples and handles no signals', () => {
    const diag = mockDiagnostics();
    const rows = signalRows({ ...diag, signals: { rpm: { value: Number.NaN, at: 1 } } }, METRIC);
    expect(rows).toEqual([]);
  });
});

describe('formatUptime', () => {
  it('picks a sensible unit', () => {
    expect(formatUptime(40)).toBe('40 s');
    expect(formatUptime(12 * 60 + 5)).toBe('12 min');
    expect(formatUptime(2 * 3600 + 5 * 60)).toBe('2 h 05 min');
    expect(formatUptime(3 * 86_400 + 4 * 3600)).toBe('3 d 4 h');
    expect(formatUptime(-5)).toBe('0 s');
    expect(formatUptime(Number.NaN)).toBe('0 s');
  });
});
