import { describe, expect, it } from 'vitest';
import {
  dashboardMaintenanceItem,
  dashboardTrip,
  displayTrip,
  longDisplayDistance,
  type TripFigures,
} from '../../src/compose/records.ts';
import type { UnitsConfig } from '../../src/types/config.ts';
import type { MaintenanceItemStatus } from '../../src/types/records.ts';
import { makeConfig } from '../state/fixtures.ts';

const METRIC: UnitsConfig = makeConfig().units;
const US: UnitsConfig = makeConfig({ units: { system: 'imperial', fuelEconomy: 'mpg-us' } }).units;
const UK: UnitsConfig = makeConfig({ units: { system: 'imperial', fuelEconomy: 'mpg-uk' } }).units;

const TRIP: TripFigures = {
  distanceKm: 42.66,
  durationS: 3120,
  fuelUsedL: 3.1,
  avgLPer100km: 7.27,
  cost: 5.58,
  currency: 'EUR',
};

const ITEM: MaintenanceItemStatus = {
  itemId: 'oil',
  label: 'Oil & filter',
  lastDoneAt: 1000,
  lastDoneKm: 48_210,
  dueAtKm: 56_210,
  dueAtEpochMs: 2000,
  remainingKm: 420,
  remainingDays: 20,
  status: 'due-soon',
};

describe('longDisplayDistance', () => {
  it('rounds in the driver’s long unit with a fixed number of decimals', () => {
    expect(longDisplayDistance(42.66, 'metric', 1)).toEqual({
      value: 42.7,
      unit: 'km',
      text: '42.7 km',
    });
    expect(longDisplayDistance(12, 'metric', 1)).toEqual({
      value: 12,
      unit: 'km',
      text: '12.0 km',
    });
    expect(longDisplayDistance(420, 'imperial', 0)).toEqual({
      value: 261,
      unit: 'mi',
      text: '261 mi',
    });
  });

  it('keeps the sign in the value but not in the text, and never produces −0', () => {
    expect(longDisplayDistance(-320, 'imperial', 0)).toEqual({
      value: -199,
      unit: 'mi',
      text: '199 mi',
    });
    const tiny = longDisplayDistance(-0.4, 'metric', 0);
    expect(Object.is(tiny.value, -0)).toBe(false);
    expect(tiny).toEqual({ value: 0, unit: 'km', text: '0 km' });
  });
});

describe('displayTrip', () => {
  it('keeps metric figures, rounded', () => {
    expect(displayTrip(TRIP, METRIC)).toEqual({
      distance: { value: 42.7, unit: 'km', text: '42.7 km' },
      durationS: 3120,
      averageEconomy: 7.3,
      economyUnit: 'L/100km',
      fuelUsed: 3.1,
      fuelUnit: 'L',
      cost: 5.58,
      currency: 'EUR',
    });
  });

  it('uses US or imperial gallons to match the economy unit', () => {
    expect(displayTrip(TRIP, US)).toMatchObject({
      distance: { value: 26.5, unit: 'mi', text: '26.5 mi' },
      averageEconomy: 32.4,
      economyUnit: 'mpg-us',
      fuelUsed: 0.82,
      fuelUnit: 'gal',
    });
    expect(displayTrip(TRIP, UK)).toMatchObject({
      averageEconomy: 38.9,
      economyUnit: 'mpg-uk',
      fuelUsed: 0.68,
      fuelUnit: 'gal',
    });
  });

  it('leaves unknown or invalid fuel figures unknown', () => {
    const unknown = { ...TRIP, fuelUsedL: null, avgLPer100km: null, cost: null };
    expect(displayTrip(unknown, US)).toMatchObject({
      averageEconomy: null,
      fuelUsed: null,
      cost: null,
    });
    expect(displayTrip({ ...TRIP, fuelUsedL: Number.NaN, avgLPer100km: 0 }, METRIC)).toMatchObject({
      fuelUsed: null,
      averageEconomy: null,
    });
  });
});

describe('dashboardTrip', () => {
  it('adds the moving time and whether the trip is finished', () => {
    const trip = dashboardTrip({ ...TRIP, movingS: 2710 }, true, METRIC);
    expect(trip).toEqual({ completed: true, ...displayTrip(TRIP, METRIC), movingS: 2710 });
    expect(dashboardTrip({ ...TRIP, movingS: 0 }, false, METRIC).completed).toBe(false);
  });
});

describe('dashboardMaintenanceItem', () => {
  it('drops odometer figures and converts the remaining distance', () => {
    expect(dashboardMaintenanceItem(ITEM, METRIC)).toEqual({
      itemId: 'oil',
      label: 'Oil & filter',
      status: 'due-soon',
      remaining: { value: 420, unit: 'km', text: '420 km' },
      remainingDays: 20,
      dueAtEpochMs: 2000,
    });
    expect(dashboardMaintenanceItem(ITEM, US).remaining).toEqual({
      value: 261,
      unit: 'mi',
      text: '261 mi',
    });
  });

  it('keeps unknown and invalid figures unknown', () => {
    const unknown = { ...ITEM, remainingKm: null, remainingDays: null, dueAtEpochMs: null };
    expect(dashboardMaintenanceItem(unknown, US)).toMatchObject({
      remaining: null,
      remainingDays: null,
      dueAtEpochMs: null,
    });
    const invalid = { ...ITEM, remainingKm: Number.NaN, remainingDays: Number.POSITIVE_INFINITY };
    expect(dashboardMaintenanceItem(invalid, METRIC)).toMatchObject({
      remaining: null,
      remainingDays: null,
    });
  });

  it('reports overdue distances as negative values', () => {
    const overdue = { ...ITEM, status: 'overdue' as const, remainingKm: -161, remainingDays: -3 };
    expect(dashboardMaintenanceItem(overdue, US)).toMatchObject({
      status: 'overdue',
      remaining: { value: -100, unit: 'mi', text: '100 mi' },
      remainingDays: -3,
    });
  });
});
