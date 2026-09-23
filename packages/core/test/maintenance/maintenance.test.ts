import { describe, expect, it } from 'vitest';
import {
  createMaintenanceState,
  defaultMaintenanceItems,
  maintenanceStatus,
  recordService,
} from '../../src/maintenance/maintenance.ts';
import type { MaintenanceConfig, MaintenanceItemConfig } from '../../src/types/config.ts';
import type { MaintenanceRecord } from '../../src/types/records.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

const OIL: MaintenanceItemConfig = {
  id: 'oil',
  label: 'Oil & filter',
  intervalKm: 8000,
  intervalDays: 365,
  warnBeforeKm: 500,
  warnBeforeDays: 14,
};
const config = (...items: MaintenanceItemConfig[]): MaintenanceConfig => ({ items });

function statusOf(
  item: MaintenanceItemConfig,
  record: MaintenanceRecord | null,
  odometerKm: number | null,
) {
  const [status] = maintenanceStatus(config(item), record ? [record] : [], odometerKm, NOW);
  return status;
}

describe('defaultMaintenanceItems', () => {
  it('provides the standard schedule', () => {
    const items = defaultMaintenanceItems();
    expect(items.map((i) => i.id)).toEqual([
      'oil',
      'tyre-rotation',
      'air-filter',
      'brake-fluid',
      'cabin-filter',
      'coolant',
    ]);
    expect(items[0]).toEqual(OIL);
    expect(items.find((i) => i.id === 'tyre-rotation')).toMatchObject({
      intervalKm: 10_000,
      intervalDays: null,
      warnBeforeKm: 500,
    });
    expect(items.find((i) => i.id === 'air-filter')).toMatchObject({
      intervalKm: 20_000,
      intervalDays: 730,
    });
    expect(items.find((i) => i.id === 'brake-fluid')).toMatchObject({
      intervalKm: null,
      intervalDays: 730,
      warnBeforeDays: 30,
    });
    expect(items.find((i) => i.id === 'cabin-filter')).toMatchObject({
      intervalKm: 15_000,
      intervalDays: 365,
    });
    expect(items.find((i) => i.id === 'coolant')).toMatchObject({
      intervalKm: 100_000,
      intervalDays: 1825,
    });
  });

  it('gives every item at least one interval and a unique id', () => {
    const items = defaultMaintenanceItems();
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const i of items) expect(i.intervalKm !== null || i.intervalDays !== null).toBe(true);
  });

  it('returns fresh objects each time', () => {
    const a = defaultMaintenanceItems();
    (a[0] as MaintenanceItemConfig).intervalKm = 1;
    expect(defaultMaintenanceItems()[0]?.intervalKm).toBe(8000);
  });
});

describe('maintenanceStatus', () => {
  it("is 'unknown' for items never recorded", () => {
    expect(statusOf(OIL, null, 50_000)).toEqual({
      itemId: 'oil',
      label: 'Oil & filter',
      lastDoneAt: null,
      lastDoneKm: null,
      dueAtKm: null,
      dueAtEpochMs: null,
      remainingKm: null,
      remainingDays: null,
      status: 'unknown',
    });
  });

  it("is 'ok' when far from due by both distance and time", () => {
    const record = { itemId: 'oil', odometerKm: 40_000, at: NOW - 100 * DAY };
    expect(statusOf(OIL, record, 43_000)).toEqual({
      itemId: 'oil',
      label: 'Oil & filter',
      lastDoneAt: NOW - 100 * DAY,
      lastDoneKm: 40_000,
      dueAtKm: 48_000,
      dueAtEpochMs: NOW + 265 * DAY,
      remainingKm: 5000,
      remainingDays: 265,
      status: 'ok',
    });
  });

  it.each([
    [47_400, 'ok', 600],
    [47_500, 'due-soon', 500],
    [47_900.4, 'due-soon', 100],
    [48_000, 'due-soon', 0],
    [48_000.3, 'overdue', 0],
    [48_750, 'overdue', -750],
  ] as const)('by distance: at %s km it is %s (%s km left)', (odometer, status, remainingKm) => {
    const s = statusOf(OIL, { itemId: 'oil', odometerKm: 40_000, at: NOW - 10 * DAY }, odometer);
    expect(s).toMatchObject({ status, remainingKm });
  });

  it.each([
    [300, 'ok', 65],
    [351, 'due-soon', 14],
    [364.6, 'due-soon', 0],
    [366, 'overdue', -1],
    [400, 'overdue', -35],
  ] as const)(
    'by date: %s days after the service it is %s (%s days left)',
    (daysAgo, status, remainingDays) => {
      const s = statusOf(
        OIL,
        { itemId: 'oil', odometerKm: 40_000, at: NOW - daysAgo * DAY },
        40_100,
      );
      expect(s).toMatchObject({ status, remainingDays });
    },
  );

  it('uses whichever of distance or time comes first', () => {
    // Plenty of time left but almost out of distance …
    expect(
      statusOf(OIL, { itemId: 'oil', odometerKm: 40_000, at: NOW - 30 * DAY }, 47_800)?.status,
    ).toBe('due-soon');
    // … and the reverse: a low-mileage car still needs its yearly oil change.
    expect(
      statusOf(OIL, { itemId: 'oil', odometerKm: 40_000, at: NOW - 370 * DAY }, 41_000)?.status,
    ).toBe('overdue');
    // Overdue by distance beats due-soon by date.
    expect(
      statusOf(OIL, { itemId: 'oil', odometerKm: 40_000, at: NOW - 355 * DAY }, 48_100)?.status,
    ).toBe('overdue');
  });

  it('handles distance-only and time-only items', () => {
    const tyres = defaultMaintenanceItems().find(
      (i) => i.id === 'tyre-rotation',
    ) as MaintenanceItemConfig;
    const brakes = defaultMaintenanceItems().find(
      (i) => i.id === 'brake-fluid',
    ) as MaintenanceItemConfig;
    const tyreStatus = statusOf(
      tyres,
      { itemId: 'tyre-rotation', odometerKm: 20_000, at: NOW - 5000 * DAY },
      29_600,
    );
    expect(tyreStatus).toMatchObject({
      status: 'due-soon',
      remainingKm: 400,
      dueAtEpochMs: null,
      remainingDays: null,
    });
    const brakeStatus = statusOf(
      brakes,
      { itemId: 'brake-fluid', odometerKm: null, at: NOW - 710 * DAY },
      null,
    );
    expect(brakeStatus).toMatchObject({
      status: 'due-soon',
      remainingDays: 20,
      dueAtKm: null,
      remainingKm: null,
    });
  });

  it("falls back to time when distance cannot be evaluated, and to 'unknown' when nothing can", () => {
    // No odometer on the record: only the date counts.
    expect(
      statusOf(OIL, { itemId: 'oil', odometerKm: null, at: NOW - 10 * DAY }, 99_999),
    ).toMatchObject({
      status: 'ok',
      dueAtKm: null,
      remainingKm: null,
      remainingDays: 355,
    });
    // Current odometer unknown: the due distance is known but not what is left.
    expect(
      statusOf(OIL, { itemId: 'oil', odometerKm: 40_000, at: NOW - 10 * DAY }, null),
    ).toMatchObject({
      dueAtKm: 48_000,
      remainingKm: null,
      status: 'ok',
    });
    const tyres = { ...OIL, id: 'tyres', intervalDays: null };
    expect(statusOf(tyres, { itemId: 'tyres', odometerKm: 40_000, at: NOW }, null)?.status).toBe(
      'unknown',
    );
    expect(statusOf(tyres, { itemId: 'tyres', odometerKm: null, at: NOW }, 41_000)?.status).toBe(
      'unknown',
    );
  });

  it('uses the latest record when several exist for an item', () => {
    const records = [
      { itemId: 'oil', odometerKm: 40_000, at: NOW - 300 * DAY },
      { itemId: 'oil', odometerKm: 47_000, at: NOW - 10 * DAY },
      { itemId: 'oil', odometerKm: 30_000, at: NOW - 500 * DAY },
    ];
    const [status] = maintenanceStatus(config(OIL), records, 47_500, NOW);
    expect(status).toMatchObject({ lastDoneKm: 47_000, remainingKm: 7500, status: 'ok' });
  });

  it('reports every configured item in config order and ignores records for unknown items', () => {
    const items = defaultMaintenanceItems();
    const records = [
      { itemId: 'coolant', odometerKm: 10_000, at: NOW - 100 * DAY },
      { itemId: 'turbo-encabulator', odometerKm: 1, at: NOW },
    ];
    const statuses = maintenanceStatus(config(...items), records, 20_000, NOW);
    expect(statuses.map((s) => s.itemId)).toEqual(items.map((i) => i.id));
    expect(statuses.filter((s) => s.status !== 'unknown').map((s) => s.itemId)).toEqual([
      'coolant',
    ]);
  });

  it('treats an invalid odometer as unknown', () => {
    const record = { itemId: 'oil', odometerKm: 40_000, at: NOW - 10 * DAY };
    expect(statusOf(OIL, record, Number.NaN)?.remainingKm).toBeNull();
    expect(statusOf(OIL, record, -5)?.remainingKm).toBeNull();
  });

  it('never reports negative zero', () => {
    const s = statusOf(
      OIL,
      { itemId: 'oil', odometerKm: 40_000, at: NOW - 365 * DAY - DAY / 4 },
      48_000.2,
    );
    expect(Object.is(s?.remainingDays, -0)).toBe(false);
    expect(Object.is(s?.remainingKm, -0)).toBe(false);
  });
});

describe('maintenance state', () => {
  it('keeps the latest record per item from persisted data', () => {
    const state = createMaintenanceState([
      { itemId: 'oil', odometerKm: 40_000, at: NOW - 300 * DAY },
      { itemId: 'coolant', odometerKm: Number.NaN, at: NOW - 30 * DAY },
      { itemId: 'oil', odometerKm: 47_000, at: NOW - 10 * DAY },
    ]);
    expect(state).toEqual({
      records: [
        { itemId: 'oil', odometerKm: 47_000, at: NOW - 10 * DAY },
        { itemId: 'coolant', odometerKm: null, at: NOW - 30 * DAY },
      ],
      status: [],
      checkedAt: null,
    });
  });

  it('recordService replaces the previous record, keeps others, and marks status stale', () => {
    let state = createMaintenanceState([
      { itemId: 'oil', odometerKm: 40_000, at: NOW - 300 * DAY },
      { itemId: 'coolant', odometerKm: 10_000, at: NOW - 30 * DAY },
    ]);
    state = {
      ...state,
      status: maintenanceStatus(config(OIL), state.records, 47_900, NOW),
      checkedAt: NOW,
    };
    const next = recordService(state, 'oil', 47_900, NOW);
    expect(next.records).toEqual([
      { itemId: 'oil', odometerKm: 47_900, at: NOW },
      { itemId: 'coolant', odometerKm: 10_000, at: NOW - 30 * DAY },
    ]);
    expect(next.checkedAt).toBeNull();
    expect(state.records[0]?.odometerKm).toBe(40_000); // not mutated
    expect(maintenanceStatus(config(OIL), next.records, 47_900, NOW)[0]).toMatchObject({
      status: 'ok',
      remainingKm: 8000,
      remainingDays: 365,
    });
  });

  it('recordService appends a first record and sanitises the odometer', () => {
    const next = recordService(createMaintenanceState([]), 'brake-fluid', Number.NaN, NOW);
    expect(next.records).toEqual([{ itemId: 'brake-fluid', odometerKm: null, at: NOW }]);
  });

  it('is JSON-serialisable', () => {
    const state = recordService(createMaintenanceState([]), 'oil', 1000, NOW);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
