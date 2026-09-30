import { describe, expect, it } from 'vitest';
import {
  composeDiagnostics,
  diagnosticDtcs,
  diagnosticsPageKinds,
  gaugeStatus,
} from '../../src/compose/diagnostics.ts';
import { composeFrame } from '../../src/compose/compose.ts';
import { lookupDtc } from '../../src/obd/dtc-lookup.ts';
import { ALERT_SEVERITY_RANK } from '../../src/types/alerts.ts';
import type { DiagnosticsFrame } from '../../src/types/frame.ts';
import { L_PER_US_GAL, convertEconomy, kmToMi, roundTo } from '../../src/units.ts';
import { Harness, T0, makeConfig, persisted, type SignalValues } from '../state/fixtures.ts';

const DAY = 86_400_000;

/** Parked with the engine idling and the given readings. */
function parked(
  values: SignalValues,
  config = makeConfig(),
  odometerKm: number | null = 52_310,
): Harness {
  const h = new Harness(config, persisted({ odometerKm }));
  h.obdConnected(T0);
  h.samples(T0 + 100, values);
  expect(h.state.context.context).toBe('parked');
  return h;
}

function page(h: Harness, index: number): DiagnosticsFrame {
  h.state = { ...h.state, ui: { ...h.state.ui, page: index } };
  const frame = h.frame().diagnostics;
  if (frame === null) throw new Error('no diagnostics');
  return frame;
}

describe('pages', () => {
  it('lists only the pages with live data, in a fixed order', () => {
    const bare = new Harness();
    expect(bare.state.context.context).toBe('parked');
    expect(diagnosticsPageKinds(bare.state)).toEqual([
      'overview',
      'trouble-codes',
      'trip',
      'maintenance',
      'pair',
    ]);
    const h = parked({ rpm: 780, longFuelTrimB1: 4.7, controlModuleVoltage: 14.1 });
    expect(diagnosticsPageKinds(h.state)).toEqual([
      'overview',
      'engine',
      'fuel',
      'electrical',
      'trouble-codes',
      'trip',
      'maintenance',
      'pair',
    ]);
  });

  it('wraps the page index and carries titles and vehicle info', () => {
    const h = parked({ rpm: 780 });
    h.send({ type: 'obd/vin', vin: 'WVWZZZAUZKW123456', at: h.now });
    expect(page(h, 1)).toMatchObject({
      page: 'engine',
      pageIndex: 1,
      pageCount: 6,
      title: 'Engine',
    });
    expect(page(h, 8)).toMatchObject({
      page: 'trouble-codes',
      pageIndex: 2,
      title: 'Trouble codes',
    });
    expect(page(h, -1)).toMatchObject({ page: 'pair', pageIndex: 5, title: 'Pair a phone' });
    expect(page(h, -2)).toMatchObject({ page: 'maintenance', pageIndex: 4 });
    expect(page(h, 0).vehicle).toEqual({
      vin: 'WVWZZZAUZKW123456',
      adapter: 'ELM327 v1.5',
      protocol: 'ISO 15765-4 (CAN 11/500)',
    });
  });

  it('only exists while parked', () => {
    const h = parked({ rpm: 780 });
    h.run(h.now + 3000, { speed: 40, rpm: 1800 });
    expect(h.state.context.context).toBe('city');
    expect(h.frame().diagnostics).toBeNull();
  });
});

describe('overview', () => {
  it('shows the key gauges in the driver’s units with statuses', () => {
    const h = parked({
      rpm: 0,
      coolantTemp: 91,
      batteryVoltage: 12.0,
      oilTemp: 97,
      ambientTemp: 17,
    });
    expect(page(h, 0).gauges).toEqual([
      {
        signal: 'coolantTemp',
        label: 'Coolant',
        value: 91,
        unit: '°C',
        decimals: 0,
        min: -40,
        max: 130,
        status: 'ok',
      },
      {
        signal: 'batteryVoltage',
        label: 'Battery',
        value: 12,
        unit: 'V',
        decimals: 1,
        min: 8,
        max: 16,
        status: 'warn',
      },
      {
        signal: 'fuelLevel',
        label: 'Fuel',
        value: null,
        unit: '%',
        decimals: 0,
        min: 0,
        max: 100,
        status: 'unknown',
      },
      {
        signal: 'oilTemp',
        label: 'Oil temp',
        value: 97,
        unit: '°C',
        decimals: 0,
        min: -40,
        max: 160,
        status: 'ok',
      },
      {
        signal: 'ambientTemp',
        label: 'Ambient',
        value: 17,
        unit: '°C',
        decimals: 0,
        min: -40,
        max: 60,
        status: 'ok',
      },
      {
        signal: 'odometer',
        label: 'Odometer',
        value: 52_310,
        unit: 'km',
        decimals: 0,
        min: 0,
        max: 999_999,
        status: 'ok',
      },
    ]);
  });

  it('converts to imperial units', () => {
    const config = makeConfig({ units: { system: 'imperial', temperature: 'F' } });
    const h = parked({ coolantTemp: 90 }, config, 1609.344);
    const gauges = page(h, 0).gauges;
    expect(gauges.find((g) => g.signal === 'coolantTemp')).toMatchObject({
      value: 194,
      unit: '°F',
      min: -40,
      max: 266,
    });
    expect(gauges.find((g) => g.signal === 'odometer')).toMatchObject({ value: 1000, unit: 'mi' });
  });

  it('falls back to the ECU voltage and adds tyres for TPMS vehicles', () => {
    const config = makeConfig({ vehicle: { hasTpms: true }, units: { pressure: 'psi' } });
    const h = parked(
      { controlModuleVoltage: 11.5, tirePressureFL: 150, tirePressureRR: 230 },
      config,
    );
    const gauges = page(h, 0).gauges;
    expect(gauges.find((g) => g.signal === 'controlModuleVoltage')).toMatchObject({
      value: 11.5,
      status: 'crit',
    });
    expect(gauges.filter((g) => g.signal.startsWith('tirePressure'))).toEqual([
      expect.objectContaining({
        signal: 'tirePressureFL',
        value: 21.8,
        unit: 'psi',
        decimals: 1,
        status: 'crit',
      }),
      expect.objectContaining({ signal: 'tirePressureFR', value: null, status: 'unknown' }),
      expect.objectContaining({ signal: 'tirePressureRL', value: null, status: 'unknown' }),
      expect.objectContaining({ signal: 'tirePressureRR', value: 33.4, status: 'ok' }),
    ]);
  });

  it('includes the trouble codes, MIL and due maintenance', () => {
    const h = new Harness(
      makeConfig(),
      persisted({
        odometerKm: 57_900,
        maintenanceRecords: [
          { itemId: 'oil', odometerKm: 50_000, at: T0 - 100 * DAY },
          { itemId: 'tyre-rotation', odometerKm: 55_000, at: T0 - 100 * DAY },
        ],
      }),
    );
    h.send({
      type: 'obd/dtcs',
      milOn: true,
      stored: ['P0420'],
      pending: [],
      permanent: [],
      at: T0 + 1,
    });
    const overview = page(h, 0);
    expect(overview.milOn).toBe(true);
    expect(overview.dtcs.map((d) => d.code)).toEqual(['P0420']);
    expect(overview.maintenance.map((m) => [m.itemId, m.status])).toEqual([['oil', 'due-soon']]);
  });
});

describe('engine, fuel and electrical pages', () => {
  it('show only signals with live values', () => {
    const h = parked({
      rpm: 780,
      map: 32,
      intakeAirTemp: 30,
      fuelRate: 0.8,
      longFuelTrimB1: 11.7,
      batteryVoltage: 14.2,
    });
    expect(page(h, 1).gauges.map((g) => g.signal)).toEqual(['rpm', 'intakeAirTemp', 'map']);
    expect(page(h, 2).gauges).toEqual([
      expect.objectContaining({ signal: 'fuelRate', value: 0.8, unit: 'L/h' }),
      expect.objectContaining({ signal: 'longFuelTrimB1', value: 11.7, status: 'warn' }),
    ]);
    expect(page(h, 3).gauges).toEqual([
      expect.objectContaining({ signal: 'batteryVoltage', value: 14.2, status: 'ok' }),
    ]);
  });

  it('converts pressures and flows for imperial drivers', () => {
    const config = makeConfig({ units: { system: 'imperial', pressure: 'bar' } });
    const h = parked({ rpm: 780, map: 32, fuelRate: 3.785411784 }, config);
    expect(page(h, 1).gauges.find((g) => g.signal === 'map')).toMatchObject({
      value: 0.32,
      unit: 'bar',
      decimals: 2,
      max: 2.55,
    });
    expect(page(h, 2).gauges[0]).toMatchObject({ value: 1, unit: 'gal/h' });
  });
});

describe('trouble codes', () => {
  it('lists each code once, most severe first', () => {
    const h = parked({ rpm: 780, distanceWithMil: 12 });
    h.send({
      type: 'obd/dtcs',
      milOn: true,
      stored: ['P0420', 'P0301'],
      pending: ['P0171', 'P0301'],
      permanent: ['U0100', 'P0420'],
      at: h.now,
    });
    const frame = page(h, 2);
    expect(frame.page).toBe('trouble-codes');
    expect(frame.gauges).toEqual([
      expect.objectContaining({ signal: 'distanceWithMil', value: 12, status: 'warn' }),
    ]);
    const kinds = Object.fromEntries(frame.dtcs.map((d) => [d.code, d.kind]));
    expect(kinds).toEqual({
      P0420: 'permanent',
      P0301: 'stored',
      P0171: 'pending',
      U0100: 'permanent',
    });
    for (const dtc of frame.dtcs) {
      const info = lookupDtc(dtc.code);
      expect(dtc).toEqual({
        code: dtc.code,
        kind: dtc.kind,
        description: info.description,
        short: info.short,
        severity: info.severity,
      });
    }
    const ranks = frame.dtcs.map((d) => ALERT_SEVERITY_RANK[d.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(diagnosticDtcs(h.state)).toEqual(frame.dtcs);
  });
});

describe('trip page', () => {
  /** A 60 km/h drive of one minute at 4 L/h, then parked with the engine off. */
  function afterDrive(config = makeConfig()): Harness {
    const h = new Harness(config);
    h.obdConnected(T0);
    h.run(T0 + 60_000, { speed: 60, rpm: 2000, fuelRate: 4 }, 500);
    h.run(h.now + 3000, { speed: 0, rpm: 0 });
    h.idle(h.now + 125_000, 5000);
    expect(h.state.context.context).toBe('parked');
    return h;
  }

  const tripPage = (h: Harness): DiagnosticsFrame =>
    page(h, diagnosticsPageKinds(h.state).indexOf('trip'));

  it('shows the trip in progress in the driver’s units, like the trip widget', () => {
    const h = afterDrive();
    const current = h.state.trip.current;
    expect(current).not.toBeNull();
    const trip = tripPage(h).trip;
    expect(trip).toEqual({
      completed: false,
      distance: {
        value: roundTo(current?.distanceKm ?? 0, 1),
        unit: 'km',
        text: `${(current?.distanceKm ?? 0).toFixed(1)} km`,
      },
      durationS: current?.durationS,
      movingS: current?.movingS,
      averageEconomy: roundTo(current?.avgLPer100km ?? 0, 1),
      economyUnit: 'L/100km',
      fuelUsed: roundTo(current?.fuelUsedL ?? 0, 2),
      fuelUnit: 'L',
      cost: current?.cost,
      currency: current?.currency,
    });
    expect(trip?.movingS).toBeGreaterThan(55);
    expect(trip?.movingS).toBeLessThanOrEqual(trip?.durationS ?? 0);
  });

  it('then shows the last completed trip, marked as completed', () => {
    const h = afterDrive();
    h.idle(h.now + 300_000, 5000);
    expect(h.state.trip.current).toBeNull();
    const last = h.state.trip.lastCompleted;
    expect(last).not.toBeNull();
    expect(tripPage(h).trip).toMatchObject({
      completed: true,
      distance: { value: roundTo(last?.distanceKm ?? 0, 1), unit: 'km' },
      durationS: last?.durationS,
      movingS: last?.movingS,
      fuelUsed: roundTo(last?.fuelUsedL ?? 0, 2),
      cost: last?.cost,
    });
  });

  it('converts to miles, gallons and mpg for imperial drivers', () => {
    const config = makeConfig({
      units: { system: 'imperial', fuelEconomy: 'mpg-us', currency: 'USD' },
    });
    const h = afterDrive(config);
    const current = h.state.trip.current;
    const miles = roundTo(kmToMi(current?.distanceKm ?? 0), 1);
    const trip = tripPage(h).trip;
    expect(trip).toMatchObject({
      completed: false,
      distance: { value: miles, unit: 'mi', text: `${miles.toFixed(1)} mi` },
      economyUnit: 'mpg-us',
      averageEconomy: convertEconomy(current?.avgLPer100km ?? null, 'mpg-us'),
      fuelUnit: 'gal',
      fuelUsed: roundTo((current?.fuelUsedL ?? 0) / L_PER_US_GAL, 2),
      currency: 'USD',
    });
    // The dashboard and the trip-summary widget always agree.
    const widget = composeFrame(h.state, h.config).widgets.find((w) => w.id === 'tripSummary');
    expect(widget).toBeDefined();
    const { id: _id, zone: _zone, ...shown } = widget ?? {};
    expect(trip).toMatchObject(shown);
  });

  it('keeps unknown fuel figures unknown', () => {
    const h = new Harness();
    h.obdConnected(T0);
    h.run(T0 + 60_000, { speed: 60, rpm: 2000 }, 500);
    h.run(h.now + 3000, { speed: 0, rpm: 0 });
    h.idle(h.now + 125_000, 5000);
    expect(tripPage(h).trip).toMatchObject({
      completed: false,
      averageEconomy: null,
      fuelUsed: null,
      cost: null,
    });
  });

  it('is empty before the first trip', () => {
    const h = new Harness();
    expect(page(h, 2)).toMatchObject({ page: 'trip', trip: null });
  });
});

describe('maintenance page', () => {
  const records = [
    { itemId: 'oil', odometerKm: 50_000, at: T0 - 100 * DAY },
    { itemId: 'brake-fluid', odometerKm: null, at: T0 - 742 * DAY },
    { itemId: 'tyre-rotation', odometerKm: 52_000, at: T0 - 90 * DAY },
    { itemId: 'air-filter', odometerKm: 37_000, at: T0 - 10 * DAY },
  ];

  function maintenancePage(config = makeConfig()): DiagnosticsFrame {
    const h = new Harness(config, persisted({ odometerKm: 57_900, maintenanceRecords: records }));
    const frame = page(h, diagnosticsPageKinds(h.state).indexOf('maintenance'));
    expect(frame.page).toBe('maintenance');
    return frame;
  }

  it('lists every item, most urgent first', () => {
    expect(maintenancePage().maintenance.map((m) => [m.itemId, m.status])).toEqual([
      ['air-filter', 'overdue'],
      ['brake-fluid', 'overdue'],
      ['oil', 'due-soon'],
      ['tyre-rotation', 'ok'],
      ['cabin-filter', 'unknown'],
      ['coolant', 'unknown'],
    ]);
  });

  it('carries remaining distance and days, not odometer figures', () => {
    const [air, brake, oil, tyres, cabin] = maintenancePage().maintenance;
    expect(brake).toEqual({
      itemId: 'brake-fluid',
      label: 'Brake fluid',
      status: 'overdue',
      remaining: null,
      remainingDays: -12,
      dueAtEpochMs: T0 - 12 * DAY,
    });
    // Overdue by distance (900 km past 57 000 km) but not by time.
    expect(air).toMatchObject({
      status: 'overdue',
      remaining: { value: -900, unit: 'km', text: '900 km' },
      remainingDays: 720,
    });
    expect(oil).toEqual({
      itemId: 'oil',
      label: 'Oil & filter',
      status: 'due-soon',
      remaining: { value: 100, unit: 'km', text: '100 km' },
      remainingDays: 265,
      dueAtEpochMs: T0 + 265 * DAY,
    });
    expect(tyres).toMatchObject({
      remaining: { value: 4100, unit: 'km', text: '4100 km' },
      remainingDays: null,
      dueAtEpochMs: null,
    });
    expect(cabin).toEqual({
      itemId: 'cabin-filter',
      label: 'Cabin filter',
      status: 'unknown',
      remaining: null,
      remainingDays: null,
      dueAtEpochMs: null,
    });
  });

  it('converts distances to miles, overdue distances negative with an unsigned text', () => {
    const h = new Harness(
      makeConfig({ units: { system: 'imperial' } }),
      persisted({
        odometerKm: 58_322,
        maintenanceRecords: [
          { itemId: 'oil', odometerKm: 50_000, at: T0 - 10 * DAY },
          { itemId: 'tyre-rotation', odometerKm: 52_000, at: T0 - 10 * DAY },
        ],
      }),
    );
    const items = page(h, diagnosticsPageKinds(h.state).indexOf('maintenance')).maintenance;
    expect(items.find((m) => m.itemId === 'oil')).toMatchObject({
      status: 'overdue',
      remaining: { value: -200, unit: 'mi', text: '200 mi' }, // 322 km over
    });
    expect(items.find((m) => m.itemId === 'tyre-rotation')).toMatchObject({
      status: 'ok',
      remaining: { value: 2285, unit: 'mi', text: '2285 mi' }, // 3678 km left
    });
  });

  it('never shows a negative zero', () => {
    const h = new Harness(
      makeConfig({ units: { system: 'imperial' } }),
      persisted({
        odometerKm: 58_000,
        maintenanceRecords: [{ itemId: 'oil', odometerKm: 50_000, at: T0 }],
      }),
    );
    const oil = page(h, diagnosticsPageKinds(h.state).indexOf('maintenance')).maintenance.find(
      (m) => m.itemId === 'oil',
    );
    expect(oil?.remaining).toEqual({ value: 0, unit: 'mi', text: '0 mi' });
    expect(Object.is(oil?.remaining?.value, -0)).toBe(false);
    expect(Object.is(oil?.remainingDays, -0)).toBe(false);
  });

  it('shows only due and overdue items on the overview, in the driver’s units', () => {
    const overview = page(
      new Harness(
        makeConfig({ units: { system: 'imperial' } }),
        persisted({ odometerKm: 57_900, maintenanceRecords: records }),
      ),
      0,
    );
    expect(overview.maintenance.map((m) => [m.itemId, m.remaining])).toEqual([
      ['air-filter', { value: -559, unit: 'mi', text: '559 mi' }],
      ['brake-fluid', null],
      ['oil', { value: 62, unit: 'mi', text: '62 mi' }],
    ]);
  });
});

describe('gaugeStatus', () => {
  it('uses alert thresholds for critical and normal bands for warnings', () => {
    const h = new Harness();
    const { state, config } = h;
    expect(gaugeStatus(state, config, 'coolantTemp', 60)).toBe('warn');
    expect(gaugeStatus(state, config, 'coolantTemp', 95)).toBe('ok');
    expect(gaugeStatus(state, config, 'coolantTemp', 107)).toBe('warn');
    expect(gaugeStatus(state, config, 'coolantTemp', 110)).toBe('crit');
    expect(gaugeStatus(state, config, 'batteryVoltage', 12.5)).toBe('ok');
    expect(gaugeStatus(state, config, 'batteryVoltage', 11.9)).toBe('crit');
    expect(gaugeStatus(state, config, 'batteryVoltage', 15.3)).toBe('crit');
    expect(gaugeStatus(state, config, 'rpm', 7000)).toBe('ok');
  });

  it('is part of the composed frame only when parked', () => {
    const h = new Harness();
    expect(composeDiagnostics(h.state, h.config).page).toBe('overview');
  });
});
