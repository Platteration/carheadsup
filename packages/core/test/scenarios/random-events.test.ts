import { describe, expect, it } from 'vitest';
import { composeFrame } from '../../src/compose/compose.ts';
import { LAYOUT_ZONES, WIDGET_IDS } from '../../src/config/config.ts';
import { deriveEffects } from '../../src/state/effects.ts';
import { createInitialState, extractPersisted, reduce } from '../../src/state/reducer.ts';
import { ALERT_SEVERITY_RANK } from '../../src/types/alerts.ts';
import type { AlertSeverity } from '../../src/types/alerts.ts';
import { DRIVING_CONTEXTS } from '../../src/types/config.ts';
import type { HudConfig } from '../../src/types/config.ts';
import type { HudEffect } from '../../src/types/effects.ts';
import { INPUT_ACTIONS } from '../../src/types/events.ts';
import type { HudEvent } from '../../src/types/events.ts';
import type { HudFrame } from '../../src/types/frame.ts';
import { HAZARD_TYPES, MANEUVER_TYPES } from '../../src/types/nav.ts';
import type { Hazard, Lane, NavInfo } from '../../src/types/nav.ts';
import type { CallState } from '../../src/types/phone.ts';
import { SIGNAL_IDS } from '../../src/types/signals.ts';
import type { SignalId } from '../../src/types/signals.ts';
import type { HudState } from '../../src/types/state.ts';
import type { ObdLinkState } from '../../src/types/vehicle.ts';
import { T0, freezeDeep, makeConfig, persisted } from '../state/fixtures.ts';

/**
 * Property test: long random-but-valid event streams (seeded, so failures reproduce) must never
 * make `reduce` throw or mutate its input, and every composed frame must be structurally valid.
 */

type Rand = () => number;

/** mulberry32: a tiny, fast, deterministic PRNG, so every failure is reproducible by seed. */
function prng(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: Rand, items: readonly T[]): T => {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error('empty choice');
  return item;
};
const between = (rand: Rand, lo: number, hi: number): number => lo + rand() * (hi - lo);
const chance = (rand: Rand, p: number): boolean => rand() < p;

const CONFIGS: readonly HudConfig[] = [
  makeConfig(),
  makeConfig({
    units: {
      system: 'imperial',
      temperature: 'F',
      pressure: 'psi',
      fuelEconomy: 'mpg-us',
      clock: '12h',
    },
    vehicle: { hasTpms: true, transmission: 'manual', gearRatiosRpmPerKph: [120, 70, 48, 36, 29] },
    display: { layout: { preset: 'sport' }, maxAlerts: 1 },
    shiftLight: { enabled: true },
  }),
  makeConfig({
    display: {
      layout: { preset: 'minimal' },
      brightness: { mode: 'manual', manualLevel: 0.3 },
      highwayNavRevealM: 500,
    },
    alerts: { showDtcWhileDriving: true },
    phone: { showMedia: false },
    sensors: { fallbackLocation: { lat: -33.9, lon: 151.2 } },
  }),
  makeConfig({
    units: { pressure: 'bar', fuelEconomy: 'mpg-uk' },
    vehicle: { transmission: 'cvt', hasTpms: true },
    display: {
      layout: {
        preset: 'custom',
        widgets: WIDGET_IDS.map((id, i) => ({
          id,
          zone: LAYOUT_ZONES[i % LAYOUT_ZONES.length] ?? 'center',
          contexts: [...DRIVING_CONTEXTS],
        })),
      },
      maxAlerts: 5,
    },
  }),
];

const DTC_POOL = ['P0420', 'P0301', 'P0171', 'P0217', 'U0100', 'C0035', 'B1234', 'P1234', 'p0442 '];
const LINK_STATES: readonly ObdLinkState[] = [
  'disconnected',
  'connecting',
  'initializing',
  'connected',
  'error',
];
const CALL_STATES: readonly CallState[] = ['ringing', 'dialing', 'active', 'held', 'ended'];
const MAINTENANCE_IDS = [
  'oil',
  'tyre-rotation',
  'air-filter',
  'brake-fluid',
  'cabin-filter',
  'coolant',
  'unknown-item',
];

/** Plausible values per signal, with the odd junk reading. */
function sampleValue(rand: Rand, signal: SignalId, speed: number): number {
  if (chance(rand, 0.01)) return pick(rand, [Number.NaN, Number.POSITIVE_INFINITY, -1]);
  switch (signal) {
    case 'speed':
      return Math.round(speed);
    case 'rpm':
      return speed < 1 ? pick(rand, [0, 800, 850]) : between(rand, 900, 6800);
    case 'coolantTemp':
      return between(rand, -10, 125);
    case 'batteryVoltage':
    case 'controlModuleVoltage':
      return between(rand, 9.5, 16);
    case 'fuelLevel':
      return between(rand, 0, 100);
    case 'ambientTemp':
      return between(rand, -15, 40);
    case 'odometer':
      return 50_000 + between(rand, 0, 5);
    case 'transmissionGear':
      return Math.floor(between(rand, 0, 7));
    default:
      return between(rand, 0, 200);
  }
}

function lanes(rand: Rand): Lane[] | null {
  if (chance(rand, 0.4)) return null;
  const count = Math.floor(between(rand, 0, 5));
  return Array.from({ length: count }, () => ({
    directions: [pick(rand, ['straight', 'left', 'right', 'slight-right'] as const)],
    recommended: chance(rand, 0.5),
  }));
}

function nav(rand: Rand, at: number): NavInfo {
  return {
    source: 'fuzz',
    maneuver: {
      type: pick(rand, MANEUVER_TYPES),
      roundaboutExit: chance(rand, 0.2) ? 2 : null,
      instruction: chance(rand, 0.5) ? 'Turn somewhere' : null,
    },
    distanceToManeuverM: chance(rand, 0.1) ? null : between(rand, 0, 8000),
    street: chance(rand, 0.3) ? null : 'Some Street',
    currentStreet: null,
    thenManeuver: chance(rand, 0.3) ? { type: pick(rand, MANEUVER_TYPES) } : null,
    lanes: lanes(rand),
    etaEpochMs: chance(rand, 0.3) ? null : at + between(rand, 0, 3_600_000),
    remainingDistanceM: chance(rand, 0.3) ? null : between(rand, 0, 50_000),
    remainingSeconds: chance(rand, 0.3) ? null : between(rand, 0, 3600),
    iconPng: null,
    updatedAt: at,
  };
}

function hazards(rand: Rand, at: number): Hazard[] {
  return Array.from({ length: Math.floor(between(rand, 0, 4)) }, (_, i) => ({
    id: `h${i}`,
    type: pick(rand, HAZARD_TYPES),
    distanceM: chance(rand, 0.1) ? null : between(rand, -100, 3000),
    speedLimitKph: chance(rand, 0.5) ? null : pick(rand, [30, 50, 80, 100, 120]),
    delaySeconds: chance(rand, 0.5) ? null : between(rand, 0, 900),
    description: chance(rand, 0.5) ? null : 'Something on the road ahead, quite a long description',
    updatedAt: at,
  }));
}

/** A generator of plausible event streams around a random-walk vehicle speed. */
function eventStream(seed: number): (at: number) => HudEvent {
  const rand = prng(seed);
  let speed = 0;
  return (at) => {
    speed = Math.min(200, Math.max(0, speed + between(rand, -8, 8)));
    const roll = rand();
    if (roll < 0.35) {
      const signals = new Set<SignalId>(['speed', 'rpm']);
      const extra = Math.floor(between(rand, 0, 6));
      for (let i = 0; i < extra; i++) signals.add(pick(rand, SIGNAL_IDS));
      if (chance(rand, 0.2)) signals.delete('speed');
      return {
        type: 'obd/samples',
        at,
        samples: [...signals].map((signal) => ({
          signal,
          value: sampleValue(rand, signal, speed),
        })),
      };
    }
    if (roll < 0.6) return { type: 'tick', at };
    const kind = Math.floor(rand() * 22);
    switch (kind) {
      case 0:
        return {
          type: 'obd/link',
          state: pick(rand, LINK_STATES),
          adapter: chance(rand, 0.5) ? 'ELM327' : undefined,
          message: chance(rand, 0.3) ? 'error text' : undefined,
          at,
        };
      case 1:
        return { type: 'obd/supported', signals: SIGNAL_IDS.filter(() => chance(rand, 0.5)), at };
      case 2:
        return {
          type: 'obd/dtcs',
          milOn: chance(rand, 0.5),
          stored: DTC_POOL.filter(() => chance(rand, 0.2)),
          pending: DTC_POOL.filter(() => chance(rand, 0.2)),
          permanent: DTC_POOL.filter(() => chance(rand, 0.1)),
          at,
        };
      case 3:
        return {
          type: 'obd/vin',
          vin: pick(rand, ['WVWZZZAUZKW123456', ' ', '1hgcm82633a004352']),
          at,
        };
      case 4:
        return { type: 'phone/link', connected: chance(rand, 0.7), deviceName: 'Phone', at };
      case 5:
        return { type: 'nav/update', nav: nav(rand, at), at };
      case 6:
        return { type: 'nav/clear', at };
      case 7:
        return {
          type: 'road/update',
          road: {
            speedLimitKph: chance(rand, 0.2) ? null : pick(rand, [30, 50, 70, 100, 130]),
            unlimited: chance(rand, 0.1),
            source: 'osm',
            roadName: null,
            roadClass: null,
            updatedAt: at,
          },
          at,
        };
      case 8:
        return { type: 'hazards/update', hazards: hazards(rand, at), at };
      case 9:
        return {
          type: 'media/update',
          media: chance(rand, 0.15)
            ? null
            : {
                playing: chance(rand, 0.8),
                title: chance(rand, 0.1) ? null : pick(rand, ['Song A', 'Song B', '']),
                artist: chance(rand, 0.2) ? null : 'Artist',
                album: null,
                app: 'Player',
                trackKey: pick(rand, ['a', 'b', 'c']),
                updatedAt: at,
              },
          at,
        };
      case 10:
        return {
          type: 'call/update',
          call: chance(rand, 0.15)
            ? null
            : {
                id: pick(rand, ['c1', 'c2']),
                state: pick(rand, CALL_STATES),
                callerName: chance(rand, 0.3) ? null : 'Caller',
                number: chance(rand, 0.3) ? null : '+1 555 0100',
                startedAt: at - between(rand, -1000, 60_000),
                updatedAt: at,
              },
          at,
        };
      case 11:
        return {
          type: 'message/received',
          message: {
            id: `m${Math.floor(between(rand, 0, 8))}`,
            sender: 'Someone',
            app: chance(rand, 0.5) ? 'Chat' : null,
            receivedAt: at,
            readingAloud: chance(rand, 0.5),
          },
          at,
        };
      case 12:
        return {
          type: 'location/update',
          lat: between(rand, -95, 95),
          lon: between(rand, -185, 185),
          accuracyM: null,
          at,
        };
      case 13:
        return {
          type: 'sensor/light',
          lux: chance(rand, 0.05) ? -1 : between(rand, 0, 100_000),
          at,
        };
      case 14:
        return { type: 'adas/link', connected: chance(rand, 0.7), at };
      case 15:
        return { type: 'adas/blind-spot', left: chance(rand, 0.3), right: chance(rand, 0.3), at };
      case 16:
        return {
          type: 'adas/collision',
          level: pick(rand, ['none', 'caution', 'warning'] as const),
          ttcSeconds: chance(rand, 0.5) ? null : between(rand, 0, 5),
          at,
        };
      case 17:
      case 18:
        return { type: 'input', action: pick(rand, INPUT_ACTIONS), at };
      case 19:
        return {
          type: 'maintenance/done',
          itemId: pick(rand, MAINTENANCE_IDS),
          odometerKm: chance(rand, 0.5) ? null : between(rand, 0, 60_000),
          at,
        };
      case 20:
        return {
          type: 'odometer/set',
          odometerKm: chance(rand, 0.1) ? -5 : between(rand, 0, 300_000),
          at,
        };
      default:
        return { type: 'config', config: pick(rand, CONFIGS), at };
    }
  };
}

const SEVERITIES: ReadonlySet<AlertSeverity> = new Set(['info', 'caution', 'warning', 'critical']);
const WIDGETS: ReadonlySet<string> = new Set(WIDGET_IDS);
const ZONES: ReadonlySet<string> = new Set(LAYOUT_ZONES);

/** Every number in the frame must be finite (frames are JSON). */
function assertFiniteNumbers(value: unknown, path: string): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`non-finite number at ${path}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertFiniteNumbers(v, `${path}[${i}]`));
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) assertFiniteNumbers(v, `${path}.${k}`);
  } else if (value === undefined) {
    throw new Error(`undefined at ${path}`);
  }
}

function assertValidFrame(frame: HudFrame, state: HudState, config: HudConfig): void {
  assertFiniteNumbers(frame, 'frame');
  expect(frame.at).toBe(state.now);
  expect(DRIVING_CONTEXTS).toContain(frame.context);
  expect(frame.theme.brightness).toBeGreaterThanOrEqual(0.05);
  expect(frame.theme.brightness).toBeLessThanOrEqual(1);

  const ids = frame.widgets.map((w) => w.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const w of frame.widgets) {
    expect(WIDGETS.has(w.id)).toBe(true);
    expect(ZONES.has(w.zone)).toBe(true);
    if (w.id === 'speed') expect(w.value).toBeGreaterThanOrEqual(0);
    if (w.id === 'tachometer') expect(w.fraction).toBeLessThanOrEqual(1);
    if (w.id === 'boost') expect(w.fraction).toBeGreaterThanOrEqual(0);
    if (w.id === 'nav' && w.approach !== null) expect(w.approach).toBeLessThanOrEqual(1);
    if (w.id === 'gear') expect(config.vehicle.transmission).not.toBe('cvt');
  }

  expect(frame.alerts.length).toBeLessThanOrEqual(config.display.maxAlerts);
  const ranks = frame.alerts.map((a) => ALERT_SEVERITY_RANK[a.severity]);
  expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  for (const alert of frame.alerts) {
    expect(SEVERITIES.has(alert.severity)).toBe(true);
    expect(alert.title.length).toBeLessThanOrEqual(24);
    expect(alert.title.length).toBeGreaterThan(0);
    if (alert.severity === 'critical') expect(alert.dismissible).toBe(false);
  }

  if (frame.toast !== null) {
    expect(frame.toast.opacity).toBeGreaterThan(0);
    expect(frame.toast.opacity).toBeLessThanOrEqual(1);
    expect(frame.call === null || frame.call.state === 'ended').toBe(true);
  }
  if (frame.call !== null) expect(frame.call.name.length).toBeGreaterThan(0);
  if (frame.shiftLight !== null) {
    expect(frame.shiftLight.level).toBeGreaterThanOrEqual(0);
    expect(frame.shiftLight.level).toBeLessThanOrEqual(1);
    expect(frame.context).not.toBe('parked');
  }
  expect(['none', 'caution', 'warning']).toContain(frame.collision);

  if (frame.diagnostics !== null) {
    expect(frame.context).toBe('parked');
    expect(frame.diagnostics.pageIndex).toBeGreaterThanOrEqual(0);
    expect(frame.diagnostics.pageIndex).toBeLessThan(frame.diagnostics.pageCount);
  } else if (!frame.blanked) {
    expect(frame.context).not.toBe('parked');
  }
  if (frame.blanked) {
    expect(frame.widgets).toEqual([]);
    expect(frame.toast).toBeNull();
    expect(frame.diagnostics).toBeNull();
    expect(frame.alerts.every((a) => a.severity === 'critical')).toBe(true);
  }
  expect(JSON.parse(JSON.stringify(frame))).toEqual(frame);
}

function assertValidState(state: HudState, prev: HudState): void {
  expect(state.now).toBeGreaterThanOrEqual(prev.now);
  const keys = state.alerts.map((a) => a.key);
  expect(new Set(keys).size).toBe(keys.length);
  expect(state.messages.length).toBeLessThanOrEqual(5);
  expect(Math.abs(state.ui.brightnessOffset)).toBeLessThanOrEqual(0.5);
  expect(state.odometer.integratedKm).toBeGreaterThanOrEqual(prev.odometer.integratedKm);
}

const EFFECT_TYPES: ReadonlySet<HudEffect['type']> = new Set([
  'phone/call-action',
  'trip/completed',
  'maintenance/due',
  'persist',
]);

/** What the streams actually exercised, so the property test cannot pass vacuously. */
const coverage = new Set<string>();

function record(frame: HudFrame, effects: HudEffect[]): void {
  coverage.add(`context:${frame.context}`);
  for (const w of frame.widgets) coverage.add(`widget:${w.id}`);
  for (const a of frame.alerts) coverage.add(`alert:${a.kind}`);
  for (const e of effects) coverage.add(`effect:${e.type}`);
  if (frame.blanked) coverage.add('blanked');
  if (frame.toast !== null) coverage.add(`toast:${frame.toast.kind}`);
  if (frame.call !== null) coverage.add(`call:${frame.call.state}`);
  if (frame.diagnostics !== null) coverage.add(`page:${frame.diagnostics.page}`);
  if (frame.shiftLight !== null) coverage.add('shiftLight');
  if (frame.collision !== 'none') coverage.add('collision');
}

describe('random event streams', () => {
  const SEEDS = Array.from({ length: 12 }, (_, i) => 0x5eed + i * 7919);
  const EVENTS_PER_SEED = 600;

  it.each(SEEDS)('seed %i: reduce never throws or mutates; frames stay valid', (seed) => {
    const rand = prng(seed ^ 0xa5a5);
    const next = eventStream(seed);
    let config = pick(rand, CONFIGS);
    let state = freezeDeep(
      createInitialState(
        config,
        persisted({
          odometerKm: 49_990,
          maintenanceRecords: [{ itemId: 'oil', odometerKm: 42_000, at: T0 - 90 * 86_400_000 }],
        }),
        T0,
      ),
    );
    let at = T0;
    for (let i = 0; i < EVENTS_PER_SEED; i++) {
      // Mostly forward in time, sometimes simultaneous, occasionally a little out of order.
      at += chance(rand, 0.05)
        ? -Math.floor(between(rand, 0, 500))
        : Math.floor(between(rand, 0, 3000));
      if (chance(rand, 0.01)) at += 400_000; // a long silence (trip end, expiry)
      const event = next(at);
      const snapshot = i % 50 === 0 ? JSON.stringify(state) : null;
      const effectiveConfig = event.type === 'config' ? event.config : config;

      let reduced: HudState;
      try {
        reduced = reduce(state, event, config);
      } catch (error) {
        throw new Error(`seed ${seed}, event #${i} (${event.type}) threw: ${String(error)}`);
      }
      if (snapshot !== null) expect(JSON.stringify(state)).toBe(snapshot);

      const effects = deriveEffects(state, reduced, event, effectiveConfig);
      for (const effect of effects) expect(EFFECT_TYPES.has(effect.type)).toBe(true);

      assertValidState(reduced, state);
      const frame = composeFrame(reduced, effectiveConfig);
      assertValidFrame(frame, reduced, effectiveConfig);
      record(frame, effects);
      config = effectiveConfig;
      state = freezeDeep(reduced);
    }
    // Persisted state stays JSON-clean too.
    const saved = extractPersisted(state);
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
  });

  it('exercised the interesting parts of the HUD', () => {
    const required = [
      ...DRIVING_CONTEXTS.map((c) => `context:${c}`),
      ...WIDGET_IDS.map((w) => `widget:${w}`),
      ...[
        'coolant',
        'voltage',
        'check-engine',
        'fuel-low',
        'maintenance-due',
        'tpms',
        'ice-risk',
        'forward-collision',
        'obd-link',
      ].map((k) => `alert:${k}`),
      ...[...EFFECT_TYPES].map((e) => `effect:${e}`),
      ...['ringing', 'dialing', 'active', 'held', 'ended'].map((c) => `call:${c}`),
      ...['overview', 'engine', 'fuel', 'electrical', 'trouble-codes', 'trip', 'maintenance'].map(
        (p) => `page:${p}`,
      ),
      'toast:message',
      'toast:media',
      'blanked',
      'shiftLight',
      'collision',
    ];
    expect([...coverage]).toEqual(expect.arrayContaining(required));
  });
});
