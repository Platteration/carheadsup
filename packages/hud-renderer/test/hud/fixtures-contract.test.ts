/**
 * The sample frames stand in for `composeFrame` output in the renderer's tests, the dev-console
 * gallery and the documentation screenshots, so they must be frames the composer could actually
 * produce. These checks pin them to the core's layout presets, formatting, thresholds, alert
 * rules, DTC database and maintenance schedule.
 */
import {
  ALERT_SEVERITY_RANK,
  BOOST_GAUGE_MAX_KPA,
  BOOST_GAUGE_MIN_KPA,
  DEFAULT_CONFIG,
  DIAGNOSTICS_PAGE_TITLES,
  EMPTY_PERSISTED_STATE,
  KM_PER_MI,
  KPA_PER_PSI,
  LAYOUT_PRESETS,
  MIN_EFFECTIVE_BRIGHTNESS,
  M_PER_FT,
  NAV_APPROACH_M,
  NAV_IMMINENT_M,
  SIGNAL_META,
  callControls,
  clamp,
  composeFrame,
  createInitialState,
  diagnosticDtcs,
  fToC,
  formatNavDistance,
  hazardLabel,
  isAlertShownInContext,
  reduce,
  roundTo,
  type AlertFrame,
  type DisplayDistance,
  type DtcKind,
  type HudConfig,
  type HudEvent,
  type HudFrame,
  type HudState,
  type MaintenanceStatusKind,
  type SignalId,
  type UnitSystem,
  type WidgetFrameById,
  type WidgetId,
} from '@carheadsup/core';
import { lookupDtc } from '@carheadsup/core/dtc';
import { describe, expect, it } from 'vitest';
import { FIXTURE_TIME, SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';

const FRAMES = Object.entries(SAMPLE_FRAMES);
const LIVE = FRAMES.filter(([, frame]) => !frame.blanked);
const A = DEFAULT_CONFIG.alerts;

function widget<I extends WidgetId>(frame: HudFrame, id: I): WidgetFrameById<I> | undefined {
  return frame.widgets.find((w): w is WidgetFrameById<I> => w.id === id);
}

function systemOf(frame: HudFrame): UnitSystem {
  const unit = widget(frame, 'speed')?.unit ?? widget(frame, 'speedLimit')?.unit;
  return unit === 'mph' ? 'imperial' : 'metric';
}

/**
 * The built-in preset whose placements explain every widget of the frame — each widget in its
 * zone, allowed in the frame's context, in placement (priority) order — or null.
 */
function explainingPreset(frame: HudFrame): string | null {
  for (const [name, placements] of Object.entries(LAYOUT_PRESETS)) {
    let previous = -1;
    const explained = frame.widgets.every((w) => {
      const index = placements.findIndex((p) => p.id === w.id);
      const placement = placements[index];
      if (placement === undefined || placement.zone !== w.zone) return false;
      if (!placement.contexts.includes(frame.context) || index <= previous) return false;
      previous = index;
      return true;
    });
    if (explained) return name;
  }
  return null;
}

function metres(d: DisplayDistance): number {
  switch (d.unit) {
    case 'm':
      return d.value;
    case 'km':
      return d.value * 1000;
    case 'ft':
      return d.value * M_PER_FT;
    case 'mi':
      return d.value * KM_PER_MI * 1000;
  }
}

/** The true distances (m) that `formatNavDistance` rounds to `d`. */
function roundingRange(d: DisplayDistance): [number, number] {
  const m = metres(d);
  const half =
    d.unit === 'm'
      ? d.value < 100
        ? 5
        : 25
      : d.unit === 'ft'
        ? 25 * M_PER_FT
        : d.unit === 'km'
          ? (d.value < 10 ? 0.05 : 0.5) * 1000
          : (d.value < 10 ? 0.05 : 0.5) * KM_PER_MI * 1000;
  return [Math.max(0, m - half), m + half];
}

function routeDistances(frame: HudFrame): DisplayDistance[] {
  const out: DisplayDistance[] = [];
  for (const w of frame.widgets) {
    if (w.id === 'nav' && w.distance) out.push(w.distance);
    if (w.id === 'eta' && w.remainingDistance) out.push(w.remainingDistance);
    if (w.id === 'hazard' && w.distance) out.push(w.distance);
  }
  return out;
}

const celsius = (value: number, unit: '°C' | '°F'): number => (unit === '°F' ? fToC(value) : value);

describe('sample frames vs composeFrame', () => {
  it.each(LIVE)('%s places widgets as a built-in layout preset would', (_, frame) => {
    expect(explainingPreset(frame)).not.toBeNull();
    const ids = frame.widgets.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('withholds everything but critical alerts and the collision cue when blanked', () => {
    const blanked = FRAMES.filter(([, frame]) => frame.blanked);
    expect(blanked.length).toBeGreaterThan(0);
    for (const [name, frame] of blanked) {
      expect(frame.widgets, name).toEqual([]);
      expect(frame.toast, name).toBeNull();
      expect(frame.call, name).toBeNull();
      expect(frame.shiftLight, name).toBeNull();
      expect(frame.diagnostics, name).toBeNull();
      expect(frame.blindSpot, name).toEqual({ left: false, right: false });
      for (const alert of frame.alerts) expect(alert.severity, name).toBe('critical');
    }
  });

  it.each(LIVE)('%s shows the dashboard exactly when parked', (_, frame) => {
    expect(frame.diagnostics !== null).toBe(frame.context === 'parked');
    if (frame.context === 'parked') expect(frame.shiftLight).toBeNull();
    expect(frame.theme.brightness).toBeGreaterThanOrEqual(MIN_EFFECTIVE_BRIGHTNESS);
    expect(frame.theme.brightness).toBeLessThanOrEqual(1);
  });

  it.each(FRAMES)('%s formats route distances like formatNavDistance', (_, frame) => {
    for (const d of routeDistances(frame)) {
      expect(formatNavDistance(metres(d), systemOf(frame))).toEqual(d);
    }
  });

  it.each(FRAMES)('%s derives the nav countdown emphasis from the distance', (_, frame) => {
    const nav = widget(frame, 'nav');
    if (!nav) return;
    if (nav.distance === null) {
      expect(nav.imminent).toBe(false);
      expect(nav.approach).toBeNull();
      return;
    }
    const [lo, hi] = roundingRange(nav.distance);
    if (hi < NAV_IMMINENT_M) expect(nav.imminent).toBe(true);
    if (lo >= NAV_IMMINENT_M) expect(nav.imminent).toBe(false);
    if (lo > NAV_APPROACH_M) expect(nav.approach).toBeNull();
    if (hi <= NAV_APPROACH_M) {
      expect(nav.approach).toBeGreaterThanOrEqual(roundTo(1 - hi / NAV_APPROACH_M, 2));
      expect(nav.approach).toBeLessThanOrEqual(roundTo(1 - lo / NAV_APPROACH_M, 2));
    }
  });

  it.each(FRAMES)('%s keeps speed, limit and overspeed consistent', (_, frame) => {
    const speed = widget(frame, 'speed');
    const limit = widget(frame, 'speedLimit');
    if (limit?.unlimited) expect(limit.value).toBeNull();
    else if (limit) expect(limit.value).toBeGreaterThan(0);
    if (!speed) return;
    expect(speed.overLimit).toBe(speed.overBy !== null);
    if (limit) expect(limit.unit).toBe(speed.unit);
    const posted = limit?.value ?? null;
    if (posted === null) {
      expect(speed.overBy).toBeNull();
      return;
    }
    if (speed.overBy !== null) expect(speed.overBy).toBe(Math.max(1, speed.value - posted));
    if (speed.unit === 'km/h') {
      const tolerance = Math.max(A.overspeedToleranceKph, (posted * A.overspeedTolerancePct) / 100);
      expect(speed.overLimit).toBe(speed.value > posted + tolerance);
    }
  });

  it.each(FRAMES)('%s rounds and classifies readings like the composer', (_, frame) => {
    const system = systemOf(frame);
    for (const w of frame.widgets) {
      switch (w.id) {
        case 'tachometer':
          expect(w.fraction).toBe(roundTo(clamp(w.rpm / w.redlineRpm, 0, 1), 3));
          break;
        case 'boost': {
          const kpa =
            w.unit === 'bar' ? w.value * 100 : w.unit === 'psi' ? w.value * KPA_PER_PSI : w.value;
          const span = BOOST_GAUGE_MAX_KPA - BOOST_GAUGE_MIN_KPA;
          expect(w.fraction).toBeCloseTo(clamp((kpa - BOOST_GAUGE_MIN_KPA) / span, 0, 1), 2);
          break;
        }
        case 'coolant': {
          const c = celsius(w.value, w.unit);
          expect(c).toBeGreaterThanOrEqual(A.coolantHighC);
          expect(w.status).toBe(c >= A.coolantCriticalC ? 'critical' : 'hot');
          break;
        }
        case 'voltage':
          if (w.status === 'low') {
            expect(w.value).toBeLessThanOrEqual(Math.max(A.voltageLowRunningV, A.voltageLowOffV));
          } else {
            expect(w.value).toBeGreaterThanOrEqual(A.voltageHighV);
          }
          break;
        case 'tpms': {
          const tyres = [w.fl, w.fr, w.rl, w.rr];
          if (w.unit === 'kPa') {
            for (const t of tyres) expect(t.low).toBe(t.value !== null && t.value < A.tpmsLowKpa);
          }
          expect(w.anyLow).toBe(tyres.some((t) => t.low));
          if (frame.context === 'city' || frame.context === 'highway') expect(w.anyLow).toBe(true);
          break;
        }
        case 'fuel':
          expect(w.rangeUnit).toBe(system === 'imperial' ? 'mi' : 'km');
          expect(w.low).toBe(w.levelPct !== null && w.levelPct <= A.fuelLowPct);
          break;
        case 'outsideTemp':
          expect(w.iceRisk).toBe(celsius(w.value, w.unit) <= A.iceRiskC);
          break;
        case 'gear':
          expect(w.gear).toMatch(/^(?:[1-9]|1[0-2]|N)$/);
          break;
        case 'hazard': {
          // Camera limits use the driver's configured sign, like the speed-limit widget.
          const limit = widget(frame, 'speedLimit');
          if (limit) expect(w.limitStyle).toBe(limit.style);
          else expect(w.limitStyle).toBe(DEFAULT_CONFIG.display.speedLimitSign);
          if (w.type !== 'other') {
            expect(w.label).toBe(
              hazardLabel({
                id: 'h',
                type: w.type,
                distanceM: null,
                speedLimitKph: null,
                delaySeconds: null,
                description: null,
                updatedAt: 0,
              }),
            );
          }
          break;
        }
        case 'media':
          expect(w.playing).toBe(true);
          expect(w.title).not.toBe('');
          break;
        default:
          break;
      }
    }
  });

  it.each(LIVE)('%s shows alerts the way the alert engine selects them', (_, frame) => {
    expect(frame.alerts.length).toBeLessThanOrEqual(DEFAULT_CONFIG.display.maxAlerts);
    const ranks = frame.alerts.map((a) => ALERT_SEVERITY_RANK[a.severity]);
    expect(ranks).toEqual([...ranks].sort((x, y) => y - x));
    for (const a of frame.alerts) {
      expect(a.dismissible).toBe(a.severity !== 'critical');
      expect(a.title.length).toBeLessThanOrEqual(24);
      const alert = {
        ...a,
        raisedAt: frame.at,
        updatedAt: frame.at,
        expiresAt: null,
        dismissedAt: null,
      };
      expect(isAlertShownInContext(alert, frame.context, DEFAULT_CONFIG)).toBe(true);
      if (a.kind === 'check-engine') {
        const info = lookupDtc(a.code ?? '');
        expect(a.key).toBe(`check-engine:${info.code}`);
        expect(a.title).toBe('CHECK ENGINE');
        expect(a.detail).toBe(`${info.code} – ${info.short}`);
        expect([info.severity, 'info']).toContain(a.severity);
      }
    }
  });

  it.each(FRAMES)('%s has a call card and toast the composer would draw', (_, frame) => {
    const { call, toast } = frame;
    if (call) {
      const controls = callControls({
        id: 'c',
        state: call.state,
        callerName: call.name,
        number: call.number,
        startedAt: 0,
        updatedAt: 0,
      });
      expect({ canAccept: call.canAccept, canDecline: call.canDecline }).toEqual(controls);
      expect(call.durationS === null).toBe(call.state !== 'active' && call.state !== 'held');
      expect(call.name.trim()).not.toBe('');
      // No toast competes with a live call.
      if (call.state !== 'ended') expect(toast).toBeNull();
    }
    if (toast) {
      expect(toast.opacity).toBeGreaterThan(0);
      expect(toast.opacity).toBeLessThanOrEqual(1);
    }
  });

  it.each(FRAMES.filter(([, frame]) => frame.diagnostics !== null))(
    '%s dashboard matches the composer (titles, gauges, codes, services)',
    (_, frame) => {
      const d = frame.diagnostics;
      if (d === null) return;
      expect(d.title).toBe(DIAGNOSTICS_PAGE_TITLES[d.page]);
      expect(d.pageIndex).toBeGreaterThanOrEqual(0);
      expect(d.pageIndex).toBeLessThan(d.pageCount);
      for (const g of d.gauges) {
        // All dashboard fixtures use metric units, where gauges keep the canonical metadata.
        const meta = SIGNAL_META[g.signal];
        expect({
          label: g.label,
          unit: g.unit,
          decimals: g.decimals,
          min: g.min,
          max: g.max,
        }).toEqual({
          label: meta.label,
          unit: meta.unit,
          decimals: meta.decimals,
          min: meta.min,
          max: meta.max,
        });
      }
      const kindRank: Record<DtcKind, number> = { permanent: 0, stored: 1, pending: 2 };
      d.dtcs.forEach((dtc, i) => {
        const info = lookupDtc(dtc.code);
        expect(dtc).toEqual({
          code: info.code,
          kind: dtc.kind,
          description: info.description,
          short: info.short,
          severity: info.severity,
        });
        const prev = d.dtcs[i - 1];
        if (prev) {
          const order =
            ALERT_SEVERITY_RANK[prev.severity] - ALERT_SEVERITY_RANK[dtc.severity] ||
            kindRank[dtc.kind] - kindRank[prev.kind] ||
            (dtc.code > prev.code ? 1 : -1);
          expect(order).toBeGreaterThan(0);
        }
      });
      const statusRank: Record<MaintenanceStatusKind, number> = {
        overdue: 0,
        'due-soon': 1,
        ok: 2,
        unknown: 3,
      };
      const ranks = d.maintenance.map((m) => statusRank[m.status]);
      expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
      const longUnit = systemOf(frame) === 'imperial' ? 'mi' : 'km';
      for (const item of d.maintenance) {
        const configured = DEFAULT_CONFIG.maintenance.items.find((i) => i.id === item.itemId);
        expect(configured?.label).toBe(item.label);
        if (d.page === 'overview') expect(['due-soon', 'overdue']).toContain(item.status);
        // Display-ready: whole units of the driver's system, the text unsigned.
        if (item.remaining) {
          expect(item.remaining.unit).toBe(longUnit);
          expect(Number.isInteger(item.remaining.value)).toBe(true);
          expect(item.remaining.text).toBe(`${Math.abs(item.remaining.value)} ${longUnit}`);
        }
        if (item.remainingDays !== null) expect(Number.isInteger(item.remainingDays)).toBe(true);
        if (item.status === 'unknown') expect(item.remaining ?? item.remainingDays).toBeNull();
        if (item.status === 'overdue') {
          expect(
            (item.remaining?.value ?? 0) < 0 || (item.remainingDays ?? 0) < 0,
            `${item.itemId} is overdue by distance or time`,
          ).toBe(true);
        }
      }
      if (d.trip) {
        expect(d.page).toBe('trip');
        expect(d.trip.distance.unit).toBe(longUnit);
        expect(d.trip.distance.text).toBe(`${d.trip.distance.value.toFixed(1)} ${longUnit}`);
        expect(d.trip.movingS).toBeLessThanOrEqual(d.trip.durationS);
        // The trip in progress is the one the trip-summary widget shows.
        const summary = widget(frame, 'tripSummary');
        if (!d.trip.completed && summary) {
          const { id: _id, zone: _zone, ...shown } = summary;
          expect(d.trip).toMatchObject(shown);
        }
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Frames composed from equivalent state

type Sample = { signal: SignalId; value: number };

/** Up to five banners, so the cap never hides what is being compared. */
function testConfig(patch: Partial<HudConfig['vehicle']> = {}): HudConfig {
  return {
    ...DEFAULT_CONFIG,
    vehicle: { ...DEFAULT_CONFIG.vehicle, ...patch },
    display: { ...DEFAULT_CONFIG.display, maxAlerts: 5 },
  };
}

/** Feed the same samples once a second for `seconds` s after connecting. */
function drive(
  config: HudConfig,
  samples: Sample[],
  seconds: number,
  extra: HudEvent[] = [],
): HudState {
  const t0 = FIXTURE_TIME - (seconds + 1) * 1000;
  let state = createInitialState(config, EMPTY_PERSISTED_STATE, t0);
  state = reduce(state, { type: 'obd/link', state: 'connected', at: t0 }, config);
  for (const event of extra) state = reduce(state, { ...event, at: t0 }, config);
  for (let s = 0; s <= seconds; s++) {
    state = reduce(state, { type: 'obd/samples', samples, at: t0 + (s + 1) * 1000 }, config);
  }
  return state;
}

function fixture(name: string): HudFrame {
  const frame = SAMPLE_FRAMES[name];
  if (!frame) throw new Error(`missing fixture ${name}`);
  return frame;
}

function expectAlertsAndWidgets(frame: HudFrame, composed: HudFrame, widgetIds: WidgetId[]) {
  for (const alert of frame.alerts) expect(composed.alerts).toContainEqual<AlertFrame>(alert);
  for (const id of widgetIds) expect(composed.widgets).toContainEqual(widget(frame, id));
}

describe('sample frames vs frames composed from the same readings', () => {
  it('message-toast: a WhatsApp message the phone reads aloud', () => {
    const config = testConfig();
    let state = createInitialState(config, EMPTY_PERSISTED_STATE, FIXTURE_TIME - 1000);
    state = reduce(
      state,
      { type: 'phone/link', connected: true, deviceName: 'Pixel', at: FIXTURE_TIME - 1000 },
      config,
    );
    state = reduce(
      state,
      {
        type: 'message/received',
        message: {
          id: 'm1',
          sender: 'Alex Chen',
          app: 'WhatsApp',
          receivedAt: FIXTURE_TIME,
          readingAloud: true,
        },
        at: FIXTURE_TIME,
      },
      config,
    );
    expect(composeFrame(state, config).toast).toEqual(fixture('message-toast').toast);
  });

  it('speed-camera: the camera and its limit sign as composed', () => {
    const config = testConfig();
    const t0 = FIXTURE_TIME - 13_000;
    let state = createInitialState(config, EMPTY_PERSISTED_STATE, t0);
    state = reduce(state, { type: 'obd/link', state: 'connected', at: t0 }, config);
    state = reduce(state, { type: 'phone/link', connected: true, at: t0 }, config);
    for (let at = t0 + 500; at <= FIXTURE_TIME; at += 500) {
      state = reduce(
        state,
        {
          type: 'obd/samples',
          samples: [
            { signal: 'speed', value: 118 },
            { signal: 'rpm', value: 2600 },
          ],
          at,
        },
        config,
      );
    }
    state = reduce(
      state,
      {
        type: 'hazards/update',
        hazards: [
          {
            id: 'cam',
            type: 'speed-camera',
            distanceM: 800,
            speedLimitKph: 120,
            delaySeconds: null,
            description: null,
            updatedAt: FIXTURE_TIME,
          },
        ],
        at: FIXTURE_TIME,
      },
      config,
    );
    const composed = composeFrame(state, config);
    expect(composed.context).toBe('highway');
    expect(composed.widgets).toContainEqual(widget(fixture('speed-camera'), 'hazard'));
  });

  it('traffic-jam: a jam 2.4 km ahead on the highway, with its delay, as composed', () => {
    const config = testConfig();
    const t0 = FIXTURE_TIME - 13_000;
    let state = createInitialState(config, EMPTY_PERSISTED_STATE, t0);
    state = reduce(state, { type: 'obd/link', state: 'connected', at: t0 }, config);
    state = reduce(state, { type: 'phone/link', connected: true, at: t0 }, config);
    for (let at = t0 + 500; at <= FIXTURE_TIME; at += 500) {
      state = reduce(
        state,
        {
          type: 'obd/samples',
          samples: [
            { signal: 'speed', value: 118 },
            { signal: 'rpm', value: 2600 },
          ],
          at,
        },
        config,
      );
    }
    state = reduce(
      state,
      {
        type: 'hazards/update',
        hazards: [
          {
            id: 'tomtom-4819f7d0a15db3d9b0c3cd9203be7ba5',
            type: 'traffic-jam',
            distanceM: 2400,
            speedLimitKph: null,
            delaySeconds: 470,
            description: 'Stationary traffic',
            updatedAt: FIXTURE_TIME,
          },
        ],
        at: FIXTURE_TIME,
      },
      config,
    );
    const composed = composeFrame(state, config);
    expect(composed.context).toBe('highway');
    expect(composed.widgets).toContainEqual(widget(fixture('traffic-jam'), 'hazard'));
  });

  it('engine-hot: coolant 121 °C while driving', () => {
    const config = testConfig();
    const state = drive(
      config,
      [
        { signal: 'speed', value: 36 },
        { signal: 'rpm', value: 1500 },
        { signal: 'coolantTemp', value: 121 },
      ],
      3,
    );
    expectAlertsAndWidgets(fixture('engine-hot'), composeFrame(state, config), [
      'coolant',
      'speed',
    ]);
  });

  it('low-voltage: 11.6 V with the engine running for over a minute', () => {
    const config = testConfig();
    const state = drive(
      config,
      [
        { signal: 'speed', value: 52 },
        { signal: 'rpm', value: 2000 },
        { signal: 'batteryVoltage', value: 11.6 },
      ],
      61,
    );
    expectAlertsAndWidgets(fixture('low-voltage'), composeFrame(state, config), ['voltage']);
  });

  it('tpms-low: rear left at 168 kPa', () => {
    const config = testConfig({ hasTpms: true });
    const state = drive(
      config,
      [
        { signal: 'speed', value: 58 },
        { signal: 'rpm', value: 1800 },
        { signal: 'tirePressureFL', value: 231 },
        { signal: 'tirePressureFR', value: 229 },
        { signal: 'tirePressureRL', value: 168 },
        { signal: 'tirePressureRR', value: 226 },
      ],
      3,
    );
    expectAlertsAndWidgets(fixture('tpms-low'), composeFrame(state, config), ['tpms']);
  });

  it('check-engine: a stored P0420 while stopped', () => {
    const config = testConfig();
    const dtcs: HudEvent = {
      type: 'obd/dtcs',
      milOn: true,
      stored: ['P0420'],
      pending: [],
      permanent: [],
      at: 0,
    };
    const state = drive(
      config,
      [
        { signal: 'speed', value: 0 },
        { signal: 'rpm', value: 800 },
      ],
      3,
      [dtcs],
    );
    expectAlertsAndWidgets(fixture('check-engine'), composeFrame(state, config), []);
  });

  it('parked-trouble-codes: the decoded list for the same read', () => {
    const config = testConfig();
    const dtcs: HudEvent = {
      type: 'obd/dtcs',
      milOn: true,
      stored: ['P0301', 'P0420'],
      pending: ['P0171'],
      permanent: ['U0100'],
      at: 0,
    };
    const state = drive(config, [{ signal: 'rpm', value: 0 }], 1, [dtcs]);
    expect(diagnosticDtcs(state)).toEqual(fixture('parked-trouble-codes').diagnostics?.dtcs);
  });

  it('parked-maintenance: the schedule computed from the same service records', () => {
    const DAY = 86_400_000;
    const config = testConfig();
    let state = createInitialState(
      config,
      {
        ...EMPTY_PERSISTED_STATE,
        odometerKm: 55_790,
        maintenanceRecords: [
          { itemId: 'brake-fluid', odometerKm: null, at: FIXTURE_TIME - 742 * DAY },
          { itemId: 'oil', odometerKm: 48_210, at: FIXTURE_TIME - 345 * DAY },
          { itemId: 'tyre-rotation', odometerKm: 52_000, at: FIXTURE_TIME - 90 * DAY },
          { itemId: 'air-filter', odometerKm: 48_210, at: FIXTURE_TIME - 320 * DAY },
        ],
      },
      FIXTURE_TIME,
    );
    // The maintenance page is the last one.
    state = reduce(state, { type: 'input', action: 'prev-page', at: FIXTURE_TIME }, config);
    const composed = composeFrame(state, config).diagnostics;
    expect(composed?.page).toBe('maintenance');
    expect(composed?.maintenance).toEqual(fixture('parked-maintenance').diagnostics?.maintenance);

    // The same schedule for an imperial driver: miles on the dashboard, never kilometres.
    const imperial = { ...config, units: { ...config.units, system: 'imperial' as const } };
    const miles = composeFrame(state, imperial).diagnostics?.maintenance ?? [];
    expect(miles.map((m) => m.remaining?.text ?? null)).toEqual([
      null,
      '261 mi',
      '3859 mi',
      '7717 mi',
      null,
      null,
    ]);
  });
});
