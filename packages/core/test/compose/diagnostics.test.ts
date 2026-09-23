import { describe, expect, it } from 'vitest';
import {
  composeDiagnostics,
  diagnosticDtcs,
  diagnosticsPageKinds,
  gaugeStatus,
} from '../../src/compose/diagnostics.ts';
import { lookupDtc } from '../../src/obd/dtc.ts';
import { ALERT_SEVERITY_RANK } from '../../src/types/alerts.ts';
import type { DiagnosticsFrame } from '../../src/types/frame.ts';
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
    expect(diagnosticsPageKinds(bare.state)).toEqual([
      'overview',
      'trouble-codes',
      'trip',
      'maintenance',
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
    ]);
  });

  it('wraps the page index and carries titles and vehicle info', () => {
    const h = parked({ rpm: 780 });
    h.send({ type: 'obd/vin', vin: 'WVWZZZAUZKW123456', at: h.now });
    expect(page(h, 1)).toMatchObject({
      page: 'engine',
      pageIndex: 1,
      pageCount: 5,
      title: 'Engine',
    });
    expect(page(h, 7)).toMatchObject({
      page: 'trouble-codes',
      pageIndex: 2,
      title: 'Trouble codes',
    });
    expect(page(h, -1)).toMatchObject({ page: 'maintenance', pageIndex: 4 });
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
  it('shows the current trip, then the last completed one', () => {
    const h = new Harness();
    h.obdConnected(T0);
    h.run(T0 + 60_000, { speed: 60, rpm: 2000, fuelRate: 4 }, 500);
    h.run(h.now + 3000, { speed: 0, rpm: 0 });
    h.idle(h.now + 125_000, 5000);
    expect(h.state.context.context).toBe('parked');
    const pages = diagnosticsPageKinds(h.state);
    const tripIndex = pages.indexOf('trip');
    expect(page(h, tripIndex).trip).toEqual(h.state.trip.current);
    h.idle(h.now + 300_000, 5000);
    expect(h.state.trip.current).toBeNull();
    const last = h.state.trip.lastCompleted;
    expect(page(h, diagnosticsPageKinds(h.state).indexOf('trip')).trip).toEqual({
      startedAt: last?.startedAt,
      distanceKm: last?.distanceKm,
      durationS: last?.durationS,
      movingS: last?.movingS,
      fuelUsedL: last?.fuelUsedL,
      avgLPer100km: last?.avgLPer100km,
      cost: last?.cost,
      currency: last?.currency,
    });
  });

  it('is empty before the first trip', () => {
    const h = new Harness();
    expect(page(h, 2)).toMatchObject({ page: 'trip', trip: null });
  });
});

describe('maintenance page', () => {
  it('lists every item, most urgent first', () => {
    const h = new Harness(
      makeConfig(),
      persisted({
        odometerKm: 57_900,
        maintenanceRecords: [
          { itemId: 'oil', odometerKm: 50_000, at: T0 - 100 * DAY },
          { itemId: 'brake-fluid', odometerKm: null, at: T0 - 742 * DAY },
          { itemId: 'tyre-rotation', odometerKm: 52_000, at: T0 - 90 * DAY },
        ],
      }),
    );
    const frame = page(h, 3);
    expect(frame.page).toBe('maintenance');
    expect(frame.maintenance.map((m) => [m.itemId, m.status])).toEqual([
      ['brake-fluid', 'overdue'],
      ['oil', 'due-soon'],
      ['tyre-rotation', 'ok'],
      ['air-filter', 'unknown'],
      ['cabin-filter', 'unknown'],
      ['coolant', 'unknown'],
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
