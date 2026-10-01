import { describe, expect, it } from 'vitest';
import { dismissAlert, evaluateAlerts } from '../../src/alerts/engine.ts';
import {
  CHECK_ENGINE_MIL_KEY,
  FUEL_LOW_HYSTERESIS_PCT,
  FUEL_VERY_LOW_RANGE_KM,
  ICE_RISK_REARM_C,
  ICE_RISK_SHOW_MS,
  OBD_LINK_ALERT_AFTER_MS,
  TPMS_CRITICAL_FRACTION,
  TPMS_HYSTERESIS_KPA,
} from '../../src/alerts/rules.ts';
import { isAlertLive } from '../../src/alerts/visibility.ts';
import { lookupDtc } from '../../src/obd/dtc-lookup.ts';
import { createInitialState } from '../../src/state/reducer.ts';
import type { Alert } from '../../src/types/alerts.ts';
import type { HudConfig } from '../../src/types/config.ts';
import type { MaintenanceItemStatus } from '../../src/types/records.ts';
import type { HudState } from '../../src/types/state.ts';
import type { DtcEntry } from '../../src/types/vehicle.ts';
import { T0, freezeDeep, makeConfig, persisted, type SignalValues } from '../state/fixtures.ts';

const DAY = 86_400_000;

/**
 * Evaluates alerts directly against hand-built states: `at()` moves the clock, stamps the given
 * signal values with it and re-evaluates, keeping the previous alerts like the reducer does.
 */
class Bench {
  state: HudState;
  readonly config: HudConfig;

  constructor(config: HudConfig = makeConfig()) {
    this.config = config;
    this.state = createInitialState(config, persisted(), T0);
  }

  at(now: number, values: SignalValues = {}, patch: (s: HudState) => HudState = (s) => s): Alert[] {
    const signals = { ...this.state.vehicle.signals };
    for (const [signal, value] of Object.entries(values)) {
      signals[signal as keyof typeof signals] = { value: value as number, at: now };
    }
    const next = patch({ ...this.state, now, vehicle: { ...this.state.vehicle, signals } });
    this.state = { ...next, alerts: evaluateAlerts(freezeDeep(next), this.config) };
    return this.state.alerts;
  }

  get(key: string): Alert | undefined {
    return this.state.alerts.find((a) => a.key === key);
  }

  live(key: string): boolean {
    const alert = this.get(key);
    return alert !== undefined && isAlertLive(alert, this.state.now);
  }

  dismiss(key: string, at = this.state.now): void {
    this.state = { ...this.state, alerts: dismissAlert(this.state.alerts, key, at) };
  }

  withDtcs(dtcs: Array<Omit<DtcEntry, 'firstSeenAt'>>): (s: HudState) => HudState {
    return (s) => ({
      ...s,
      vehicle: { ...s.vehicle, dtcs: dtcs.map((d) => ({ ...d, firstSeenAt: T0 })) },
    });
  }
}

describe('evaluateAlerts — general', () => {
  it('returns the previous array when nothing changed', () => {
    const b = new Bench();
    b.at(T0 + 100, { coolantTemp: 112 });
    const before = b.state.alerts;
    expect(b.at(T0 + 200, { coolantTemp: 112 })).toBe(before);
  });

  it('moves updatedAt only when an alert changes', () => {
    const b = new Bench();
    b.at(T0 + 100, { coolantTemp: 112 });
    b.at(T0 + 200, { coolantTemp: 112 });
    expect(b.get('coolant')?.updatedAt).toBe(T0 + 100);
    b.at(T0 + 300, { coolantTemp: 113 });
    expect(b.get('coolant')).toMatchObject({ raisedAt: T0 + 100, updatedAt: T0 + 300 });
  });

  it('keeps titles within 24 characters', () => {
    const config = makeConfig({ vehicle: { hasTpms: true } });
    const titles = new Set<string>();
    const scenarios: Array<[SignalValues, (s: HudState) => HudState]> = [
      [{ coolantTemp: 112, rpm: 800 }, (s) => s],
      [{ coolantTemp: 125, batteryVoltage: 11.5, rpm: 800 }, (s) => s],
      [{ batteryVoltage: 11.5 }, (s) => s],
      [{ batteryVoltage: 16 }, (s) => s],
      [{ fuelLevel: 3, tirePressureFL: 150, ambientTemp: 0 }, (s) => s],
    ];
    for (const [values, patch] of scenarios) {
      const b = new Bench(config);
      b.at(T0 + 100, values, patch);
      b.at(T0 + 70_000, values, patch);
      for (const alert of b.state.alerts) titles.add(alert.title);
    }
    titles.add('CHECK ENGINE');
    for (const title of titles) expect(title.length).toBeLessThanOrEqual(24);
    expect(titles.size).toBeGreaterThanOrEqual(8);
  });
});

describe('coolant', () => {
  it('warns at the high threshold and goes critical at the critical threshold', () => {
    const b = new Bench();
    b.at(T0 + 100, { coolantTemp: 109 });
    expect(b.get('coolant')).toBeUndefined();
    b.at(T0 + 200, { coolantTemp: 110 });
    expect(b.get('coolant')).toMatchObject({
      kind: 'coolant',
      severity: 'warning',
      title: 'ENGINE HOT',
      detail: 'Coolant 110 °C',
      code: null,
      dismissible: true,
      raisedAt: T0 + 200,
      expiresAt: null,
    });
    b.at(T0 + 300, { coolantTemp: 118 });
    expect(b.get('coolant')).toMatchObject({
      severity: 'critical',
      title: 'OVERHEATING – STOP',
      dismissible: false,
      raisedAt: T0 + 300,
    });
  });

  it('shows the temperature in the driver’s units', () => {
    const b = new Bench(makeConfig({ units: { temperature: 'F' } }));
    b.at(T0 + 100, { coolantTemp: 112 });
    expect(b.get('coolant')?.detail).toBe('Coolant 234 °F');
  });

  it('clears only below threshold minus hysteresis', () => {
    const b = new Bench(); // 110 / 118, hysteresis 3
    b.at(T0 + 100, { coolantTemp: 119 });
    b.at(T0 + 200, { coolantTemp: 116 });
    expect(b.get('coolant')?.severity).toBe('critical');
    b.at(T0 + 300, { coolantTemp: 114.9 });
    expect(b.get('coolant')?.severity).toBe('warning');
    b.at(T0 + 400, { coolantTemp: 107 });
    expect(b.get('coolant')?.severity).toBe('warning');
    b.at(T0 + 500, { coolantTemp: 106.9 });
    expect(b.get('coolant')).toBeUndefined();
  });

  it('re-raises a dismissed warning when it escalates to critical', () => {
    const b = new Bench();
    b.at(T0 + 100, { coolantTemp: 112 });
    b.dismiss('coolant', T0 + 150);
    b.at(T0 + 200, { coolantTemp: 113 });
    expect(b.get('coolant')?.dismissedAt).toBe(T0 + 150);
    b.at(T0 + 300, { coolantTemp: 120 });
    expect(b.get('coolant')).toMatchObject({ dismissedAt: null, raisedAt: T0 + 300 });
    expect(b.live('coolant')).toBe(true);
  });

  it('keeps a dismissal when de-escalating', () => {
    const b = new Bench();
    b.at(T0 + 100, { coolantTemp: 112 });
    b.dismiss('coolant', T0 + 150);
    b.at(T0 + 300, { coolantTemp: 111 });
    expect(b.live('coolant')).toBe(false);
  });

  it('is dropped once the reading goes stale', () => {
    const b = new Bench();
    b.at(T0 + 100, { coolantTemp: 112 });
    b.at(T0 + 100 + 10_001);
    expect(b.get('coolant')).toBeUndefined();
  });
});

describe('voltage', () => {
  it('flags a charging fault only after 60 s with the engine running', () => {
    const b = new Bench();
    b.at(T0, { rpm: 800, batteryVoltage: 11.9 });
    expect(b.get('voltage')).toMatchObject({
      severity: 'warning',
      title: 'CHARGING FAULT',
      detail: '11.9 V, engine running',
      raisedAt: T0 + 60_000,
    });
    expect(b.live('voltage')).toBe(false);
    b.at(T0 + 59_000, { rpm: 800, batteryVoltage: 12.3 }); // within hysteresis: still tracked
    expect(b.live('voltage')).toBe(false);
    b.at(T0 + 60_000, { rpm: 800, batteryVoltage: 12.1 });
    expect(b.live('voltage')).toBe(true);
  });

  it('restarts the timer when the voltage recovers in between', () => {
    const b = new Bench();
    b.at(T0, { rpm: 800, batteryVoltage: 11.9 });
    b.at(T0 + 30_000, { rpm: 800, batteryVoltage: 14.1 });
    expect(b.get('voltage')).toBeUndefined();
    b.at(T0 + 40_000, { rpm: 800, batteryVoltage: 11.9 });
    b.at(T0 + 99_000, { rpm: 800, batteryVoltage: 11.9 });
    expect(b.live('voltage')).toBe(false);
    b.at(T0 + 100_000, { rpm: 800, batteryVoltage: 11.9 });
    expect(b.live('voltage')).toBe(true);
  });

  it('warns of a weak battery with the engine off after it settles', () => {
    const b = new Bench();
    b.at(T0, { batteryVoltage: 11.7 });
    expect(b.live('voltage')).toBe(false);
    b.at(T0 + 10_000, { batteryVoltage: 11.7 });
    expect(b.get('voltage')).toMatchObject({
      severity: 'caution',
      title: 'BATTERY LOW',
      detail: '11.7 V, engine off',
    });
    expect(b.live('voltage')).toBe(true);
    // Hysteresis: 11.9 + 0.3.
    b.at(T0 + 11_000, { batteryVoltage: 12.2 });
    expect(b.live('voltage')).toBe(true);
    b.at(T0 + 12_000, { batteryVoltage: 12.25 });
    expect(b.get('voltage')).toBeUndefined();
  });

  it('ignores the cranking dip and start-up transients', () => {
    const b = new Bench();
    b.at(T0, { batteryVoltage: 12.5, rpm: 0 });
    // Cranking: the engine is not yet "running" and the voltage sags.
    b.at(T0 + 500, { batteryVoltage: 9.8, rpm: 200 });
    b.at(T0 + 1500, { batteryVoltage: 10.2, rpm: 250 });
    // Started: the regulator overshoots briefly.
    b.at(T0 + 2000, { batteryVoltage: 15.6, rpm: 1200 });
    b.at(T0 + 6000, { batteryVoltage: 15.4, rpm: 1000 });
    b.at(T0 + 9000, { batteryVoltage: 14.3, rpm: 850 });
    for (let at = T0 + 10_000; at <= T0 + 60_000; at += 5000) {
      b.at(at, { batteryVoltage: 14.2, rpm: 800 });
      expect(b.state.alerts.filter((a) => a.kind === 'voltage')).toEqual([]);
    }
  });

  it('flags sustained over-voltage', () => {
    const b = new Bench();
    b.at(T0, { batteryVoltage: 15.5, rpm: 2000 });
    b.at(T0 + 10_000, { batteryVoltage: 15.4, rpm: 2000 });
    expect(b.get('voltage')).toMatchObject({
      title: 'OVERVOLTAGE',
      severity: 'warning',
      detail: '15.4 V',
    });
    expect(b.live('voltage')).toBe(true);
    b.at(T0 + 11_000, { batteryVoltage: 15.0, rpm: 2000 });
    expect(b.live('voltage')).toBe(true);
    b.at(T0 + 12_000, { batteryVoltage: 14.9, rpm: 2000 });
    expect(b.get('voltage')).toBeUndefined();
  });

  it('falls back to the ECU supply voltage', () => {
    const b = new Bench();
    b.at(T0, { controlModuleVoltage: 11.5 });
    b.at(T0 + 10_000, { controlModuleVoltage: 11.5 });
    expect(b.live('voltage')).toBe(true);
  });

  it('treats a different fault as a new alert', () => {
    const b = new Bench();
    b.at(T0, { batteryVoltage: 11.5 });
    b.at(T0 + 10_000, { batteryVoltage: 11.5 });
    b.dismiss('voltage', T0 + 11_000);
    // Engine started but the alternator is dead: a new (pending) charging fault.
    b.at(T0 + 12_000, { batteryVoltage: 11.8, rpm: 900 });
    expect(b.get('voltage')).toMatchObject({
      title: 'CHARGING FAULT',
      dismissedAt: null,
      raisedAt: T0 + 72_000,
    });
  });
});

describe('check engine', () => {
  it('raises one alert per code with its decoded description', () => {
    const b = new Bench();
    b.at(
      T0 + 100,
      {},
      b.withDtcs([
        { code: 'P0420', kind: 'stored' },
        { code: 'P0420', kind: 'permanent' },
        { code: 'P0301', kind: 'stored' },
      ]),
    );
    const p0420 = lookupDtc('P0420');
    expect(b.state.alerts.map((a) => a.key)).toEqual(['check-engine:P0420', 'check-engine:P0301']);
    expect(b.get('check-engine:P0420')).toMatchObject({
      kind: 'check-engine',
      title: 'CHECK ENGINE',
      detail: `P0420 – ${p0420.short}`,
      code: 'P0420',
      severity: p0420.severity,
    });
    expect(b.get('check-engine:P0301')?.severity).toBe(lookupDtc('P0301').severity);
  });

  it('marks pending-only codes informational and re-raises them once confirmed', () => {
    const b = new Bench();
    b.at(T0 + 100, {}, b.withDtcs([{ code: 'P0301', kind: 'pending' }]));
    expect(b.get('check-engine:P0301')?.severity).toBe('info');
    b.dismiss('check-engine:P0301', T0 + 200);
    b.at(
      T0 + 300,
      {},
      b.withDtcs([
        { code: 'P0301', kind: 'stored' },
        { code: 'P0301', kind: 'pending' },
      ]),
    );
    expect(b.get('check-engine:P0301')).toMatchObject({
      severity: lookupDtc('P0301').severity,
      dismissedAt: null,
      raisedAt: T0 + 300,
    });
  });

  it('makes codes with a critical rating non-dismissible', () => {
    const b = new Bench();
    b.at(T0 + 100, {}, b.withDtcs([{ code: 'P0217', kind: 'stored' }]));
    const alert = b.get('check-engine:P0217');
    expect(alert?.severity).toBe(lookupDtc('P0217').severity);
    expect(alert?.dismissible).toBe(alert?.severity !== 'critical');
  });

  it('clears when the codes are gone', () => {
    const b = new Bench();
    b.at(T0 + 100, {}, b.withDtcs([{ code: 'P0420', kind: 'stored' }]));
    b.at(T0 + 200, {}, b.withDtcs([]));
    expect(b.state.alerts).toEqual([]);
  });

  it('warns about a lit MIL when no confirmed code is known', () => {
    const b = new Bench();
    const mil =
      (on: boolean) =>
      (s: HudState): HudState => ({ ...s, vehicle: { ...s.vehicle, milOn: on } });
    b.at(T0 + 100, {}, mil(true));
    expect(b.get(CHECK_ENGINE_MIL_KEY)).toMatchObject({
      kind: 'check-engine',
      severity: 'warning',
      title: 'CHECK ENGINE',
      detail: 'Lamp on – no code read',
      code: null,
      dismissible: true,
    });
    // A pending code does not explain the lamp …
    b.at(T0 + 200, {}, (s) => b.withDtcs([{ code: 'P0301', kind: 'pending' }])(mil(true)(s)));
    expect(b.state.alerts.map((a) => a.key)).toEqual([CHECK_ENGINE_MIL_KEY, 'check-engine:P0301']);
    // … a confirmed one does, and takes over.
    b.at(T0 + 300, {}, (s) => b.withDtcs([{ code: 'P0301', kind: 'stored' }])(mil(true)(s)));
    expect(b.state.alerts.map((a) => a.key)).toEqual(['check-engine:P0301']);
    b.at(T0 + 400, {}, (s) => b.withDtcs([])(mil(false)(s)));
    expect(b.state.alerts).toEqual([]);
  });
});

describe('fuel low', () => {
  function withFuel(level: number, rangeKm: number | null) {
    return (s: HudState): HudState => ({
      ...s,
      fuel: { ...s.fuel, readings: { ...s.fuel.readings, levelPct: level, rangeKm } },
    });
  }

  it('cautions at the threshold, with the remaining range', () => {
    const b = new Bench();
    b.at(T0 + 100, { fuelLevel: 13 }, withFuel(12.5, 80));
    expect(b.get('fuel-low')).toBeUndefined();
    b.at(T0 + 200, { fuelLevel: 12 }, withFuel(12, 76.4));
    expect(b.get('fuel-low')).toMatchObject({
      severity: 'caution',
      title: 'FUEL LOW',
      detail: 'Range 76 km',
    });
  });

  it('uses miles for imperial drivers and the level without a range', () => {
    const b = new Bench(makeConfig({ units: { system: 'imperial' } }));
    b.at(T0 + 100, { fuelLevel: 10 }, withFuel(10, 80));
    expect(b.get('fuel-low')?.detail).toBe('Range 50 mi');
    b.at(T0 + 200, { fuelLevel: 10 }, withFuel(9.6, null));
    expect(b.get('fuel-low')?.detail).toBe('10 % left');
  });

  it('applies hysteresis and ignores a stale level', () => {
    const b = new Bench();
    b.at(T0 + 100, { fuelLevel: 11 }, withFuel(11, null));
    b.at(T0 + 200, { fuelLevel: 13 }, withFuel(12 + FUEL_LOW_HYSTERESIS_PCT, null));
    expect(b.get('fuel-low')).toBeDefined();
    b.at(T0 + 300, { fuelLevel: 15 }, withFuel(14.5, null));
    expect(b.get('fuel-low')).toBeUndefined();
    b.at(T0 + 400, { fuelLevel: 5 }, withFuel(5, null));
    b.at(T0 + 400 + 120_001);
    expect(b.get('fuel-low')).toBeUndefined();
  });

  it('comes back as a warning when the tank runs nearly dry after a dismissal (regression: core-9)', () => {
    const b = new Bench();
    b.at(T0 + 100, { fuelLevel: 11 }, withFuel(11, null));
    b.dismiss('fuel-low');
    b.at(T0 + 200, { fuelLevel: 7 }, withFuel(7, null));
    expect(b.live('fuel-low')).toBe(false);
    b.at(T0 + 300, { fuelLevel: 6 }, withFuel(6, null));
    expect(b.get('fuel-low')).toMatchObject({
      severity: 'warning',
      title: 'FUEL VERY LOW',
      dismissedAt: null,
      dismissible: true,
    });
    expect(b.live('fuel-low')).toBe(true);
    // Hysteresis: it stays a warning until clearly above half the threshold again.
    b.at(T0 + 400, { fuelLevel: 7 }, withFuel(6 + FUEL_LOW_HYSTERESIS_PCT, null));
    expect(b.get('fuel-low')?.severity).toBe('warning');
    b.at(T0 + 500, { fuelLevel: 9 }, withFuel(8.5, null));
    expect(b.get('fuel-low')?.severity).toBe('caution');
  });

  it('also escalates on a short remaining range', () => {
    const b = new Bench();
    b.at(T0 + 100, { fuelLevel: 11 }, withFuel(11, 60));
    expect(b.get('fuel-low')?.severity).toBe('caution');
    b.at(T0 + 200, { fuelLevel: 10 }, withFuel(10, FUEL_VERY_LOW_RANGE_KM));
    expect(b.get('fuel-low')).toMatchObject({ severity: 'warning', detail: 'Range 30 km' });
    b.at(T0 + 300, { fuelLevel: 10 }, withFuel(10, FUEL_VERY_LOW_RANGE_KM + 4));
    expect(b.get('fuel-low')?.severity).toBe('warning');
    b.at(T0 + 400, { fuelLevel: 10 }, withFuel(10, FUEL_VERY_LOW_RANGE_KM + 6));
    expect(b.get('fuel-low')?.severity).toBe('caution');
  });
});

describe('maintenance due', () => {
  function withStatus(items: Array<Partial<MaintenanceItemStatus>>) {
    return (s: HudState): HudState => ({
      ...s,
      maintenance: {
        ...s.maintenance,
        status: items.map((item) => ({
          itemId: 'oil',
          label: 'Oil & filter',
          lastDoneAt: T0 - 100 * DAY,
          lastDoneKm: 50_000,
          dueAtKm: 58_000,
          dueAtEpochMs: T0 + 265 * DAY,
          remainingKm: 3000,
          remainingDays: 265,
          status: 'ok',
          ...item,
        })),
      },
    });
  }

  it('is informational when due soon and a caution when overdue', () => {
    const b = new Bench();
    b.at(
      T0 + 100,
      {},
      withStatus([
        { itemId: 'oil', status: 'due-soon', remainingKm: 420 },
        {
          itemId: 'brake-fluid',
          label: 'Brake fluid',
          status: 'overdue',
          remainingKm: null,
          remainingDays: -12,
        },
        { itemId: 'air-filter', label: 'Air filter', status: 'ok' },
        { itemId: 'cabin-filter', label: 'Cabin filter', status: 'unknown' },
      ]),
    );
    expect(b.state.alerts).toEqual([
      expect.objectContaining({
        key: 'maintenance-due:oil',
        kind: 'maintenance-due',
        severity: 'info',
        title: 'SERVICE DUE',
        detail: 'Oil & filter – in 420 km',
      }),
      expect.objectContaining({
        key: 'maintenance-due:brake-fluid',
        severity: 'caution',
        title: 'SERVICE OVERDUE',
        detail: 'Brake fluid – 12 days overdue',
      }),
    ]);
  });

  it('names the dimension that is due', () => {
    const b = new Bench(makeConfig({ units: { system: 'imperial' } }));
    b.at(
      T0 + 100,
      {},
      withStatus([
        { itemId: 'oil', status: 'due-soon', remainingKm: 3000, remainingDays: 10 },
        {
          itemId: 'coolant',
          label: 'Coolant',
          status: 'overdue',
          remainingKm: -161,
          remainingDays: 5,
        },
        {
          itemId: 'air-filter',
          label: 'Air filter',
          status: 'overdue',
          remainingKm: 0,
          remainingDays: 20,
        },
      ]),
    );
    expect(b.state.alerts.map((a) => a.detail)).toEqual([
      'Oil & filter – in 10 days',
      'Coolant – 100 mi overdue',
      'Air filter – due now',
    ]);
  });
});

describe('tyre pressure', () => {
  const tpms = makeConfig({ vehicle: { hasTpms: true } });

  it('warns and names the lowest tyre', () => {
    const b = new Bench(tpms);
    b.at(T0 + 100, {
      tirePressureFL: 231,
      tirePressureFR: 229,
      tirePressureRL: 168,
      tirePressureRR: 226,
    });
    expect(b.get('tpms')).toMatchObject({
      severity: 'warning',
      title: 'TYRE PRESSURE LOW',
      detail: 'Rear left 168 kPa',
    });
    b.at(T0 + 200, { tirePressureFR: 175 });
    expect(b.get('tpms')?.detail).toBe('Rear left 168 kPa +1');
  });

  it('uses the driver’s pressure unit', () => {
    const b = new Bench(makeConfig({ vehicle: { hasTpms: true }, units: { pressure: 'psi' } }));
    b.at(T0 + 100, { tirePressureRR: 150 });
    expect(b.get('tpms')?.detail).toBe('Rear right 21.8 psi');
  });

  it('applies hysteresis when the tyre is re-inflated', () => {
    const b = new Bench(tpms);
    b.at(T0 + 100, { tirePressureFL: 170 });
    b.at(T0 + 200, { tirePressureFL: 180 + TPMS_HYSTERESIS_KPA - 1 });
    expect(b.get('tpms')).toBeDefined();
    b.at(T0 + 300, { tirePressureFL: 180 + TPMS_HYSTERESIS_KPA });
    expect(b.get('tpms')).toBeUndefined();
  });

  it('turns critical when a dismissed low tyre goes on deflating (regression: core-9)', () => {
    const b = new Bench(tpms);
    b.at(T0 + 100, { tirePressureFL: 175 });
    b.dismiss('tpms');
    b.at(T0 + 200, { tirePressureFL: 140 });
    expect(b.live('tpms')).toBe(false);
    b.at(T0 + 300, { tirePressureFL: 90 });
    expect(b.get('tpms')).toMatchObject({
      severity: 'critical',
      title: 'TYRE PRESSURE CRITICAL',
      detail: 'Front left 90 kPa',
      dismissible: false,
      dismissedAt: null,
    });
    expect(b.live('tpms')).toBe(true);
    // Back to a warning only clearly above the critical limit.
    const criticalKpa = 180 * TPMS_CRITICAL_FRACTION;
    b.at(T0 + 400, { tirePressureFL: criticalKpa + TPMS_HYSTERESIS_KPA - 1 });
    expect(b.get('tpms')?.severity).toBe('critical');
    b.at(T0 + 500, { tirePressureFL: criticalKpa + TPMS_HYSTERESIS_KPA });
    expect(b.get('tpms')).toMatchObject({ severity: 'warning', title: 'TYRE PRESSURE LOW' });
  });

  it('stays silent for vehicles without TPMS', () => {
    const b = new Bench();
    b.at(T0 + 100, { tirePressureFL: 100 });
    expect(b.state.alerts).toEqual([]);
  });
});

describe('ice risk', () => {
  it('shows briefly and re-arms only after it warms up clearly', () => {
    const b = new Bench(); // threshold 3 °C
    b.at(T0, { ambientTemp: 3.5 });
    expect(b.get('ice-risk')).toBeUndefined();
    b.at(T0 + 1000, { ambientTemp: 3 });
    expect(b.get('ice-risk')).toMatchObject({
      severity: 'caution',
      title: 'ICE RISK',
      detail: 'Outside 3 °C',
      expiresAt: T0 + 1000 + ICE_RISK_SHOW_MS,
    });
    expect(b.live('ice-risk')).toBe(true);
    b.at(T0 + 1000 + ICE_RISK_SHOW_MS, { ambientTemp: 2 });
    expect(b.live('ice-risk')).toBe(false);
    // Latched: hovering around the threshold does not nag.
    b.at(T0 + 60_000, { ambientTemp: 4.9 });
    b.at(T0 + 70_000, { ambientTemp: 1 });
    expect(b.live('ice-risk')).toBe(false);
    // An unknown temperature keeps the latch.
    b.at(T0 + 70_000 + 120_001);
    expect(b.get('ice-risk')).toBeDefined();
    b.at(T0 + 200_000, { ambientTemp: 3 + ICE_RISK_REARM_C + 0.5 });
    expect(b.get('ice-risk')).toBeUndefined();
    b.at(T0 + 210_000, { ambientTemp: 2 });
    expect(b.live('ice-risk')).toBe(true);
  });
});

describe('forward collision', () => {
  function collision(level: 'none' | 'caution' | 'warning', at: number, connected = true) {
    return (s: HudState): HudState => ({
      ...s,
      adas: {
        ...s.adas,
        moduleConnected: connected,
        collision: level,
        ttcSeconds: 1.24,
        collisionUpdatedAt: at,
      },
    });
  }

  it('is critical while the module warns, a caution while it cautions', () => {
    const b = new Bench();
    b.at(T0, {}, collision('caution', T0));
    expect(b.get('forward-collision')).toMatchObject({
      severity: 'caution',
      title: 'VEHICLE AHEAD',
      detail: 'Impact in 1.2 s',
      dismissible: true,
    });
    b.dismiss('forward-collision');
    b.at(T0 + 100, {}, collision('warning', T0 + 100));
    expect(b.get('forward-collision')).toMatchObject({
      severity: 'critical',
      title: 'BRAKE!',
      dismissible: false,
      dismissedAt: null,
    });
  });

  it('ends as soon as the reading is older than 1 s or the module is gone', () => {
    const b = new Bench();
    b.at(T0, {}, collision('warning', T0));
    b.at(T0 + 1000);
    expect(b.get('forward-collision')).toBeDefined();
    b.at(T0 + 1001);
    expect(b.get('forward-collision')).toBeUndefined();
    b.at(T0 + 2000, {}, collision('warning', T0 + 2000, false));
    expect(b.get('forward-collision')).toBeUndefined();
    b.at(T0 + 3000, {}, collision('none', T0 + 3000));
    expect(b.get('forward-collision')).toBeUndefined();
  });
});

describe('OBD link', () => {
  function link(state: 'connected' | 'error' | 'connecting', message: string | null = null) {
    return (s: HudState): HudState => ({
      ...s,
      vehicle: { ...s.vehicle, link: { ...s.vehicle.link, state, message, since: s.now } },
    });
  }

  it('appears 10 s after data stopped while the link is down', () => {
    const b = new Bench();
    b.at(T0, { rpm: 800 }, link('connected'));
    b.at(T0 + 1000, {}, link('error', 'NO DATA'));
    b.at(T0 + OBD_LINK_ALERT_AFTER_MS - 1);
    expect(b.get('obd-link')).toBeUndefined();
    b.at(T0 + OBD_LINK_ALERT_AFTER_MS, {}, link('connecting'));
    expect(b.get('obd-link')).toMatchObject({
      severity: 'info',
      title: 'OBD LINK LOST',
      detail: 'Reconnecting…',
    });
    b.at(T0 + 20_000, {}, link('error', 'Serial port /dev/rfcomm0 closed unexpectedly by peer'));
    expect(b.get('obd-link')?.detail).toBe('Serial port /dev/rfcomm0 closed unexpec…');
    expect(b.get('obd-link')?.detail).toHaveLength(40);
    b.at(T0 + 25_000, { rpm: 800 }, link('connected'));
    expect(b.get('obd-link')).toBeUndefined();
  });

  it('stays quiet until the vehicle has delivered data', () => {
    const b = new Bench();
    b.at(T0 + 60_000, {}, link('error'));
    expect(b.state.alerts).toEqual([]);
  });
});

describe('dismissAlert', () => {
  it('dismisses only dismissible, not yet dismissed alerts', () => {
    const b = new Bench();
    b.at(T0, { coolantTemp: 125 });
    const alerts = b.state.alerts;
    expect(dismissAlert(alerts, 'coolant', T0 + 1)).toBe(alerts);
    expect(dismissAlert(alerts, 'nope', T0 + 1)).toBe(alerts);
    b.at(T0 + 100, { coolantTemp: 112 });
    const once = dismissAlert(b.state.alerts, 'coolant', T0 + 200);
    expect(once[0]?.dismissedAt).toBe(T0 + 200);
    expect(dismissAlert(once, 'coolant', T0 + 300)).toBe(once);
  });
});
