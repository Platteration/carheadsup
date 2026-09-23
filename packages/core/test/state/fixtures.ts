import { composeFrame } from '../../src/compose/compose.ts';
import { DEFAULT_CONFIG, mergeConfig } from '../../src/config/config.ts';
import { cloneJson } from '../../src/config/json.ts';
import { deriveEffects } from '../../src/state/effects.ts';
import { EMPTY_PERSISTED_STATE, createInitialState, reduce } from '../../src/state/reducer.ts';
import type { DeepPartial, HudConfig } from '../../src/types/config.ts';
import type { HudEffect } from '../../src/types/effects.ts';
import type { HudEvent, InputAction } from '../../src/types/events.ts';
import type { HudFrame, WidgetFrame, WidgetFrameById } from '../../src/types/frame.ts';
import type { NavInfo, RoadInfo } from '../../src/types/nav.ts';
import type { CallInfo, MediaInfo } from '../../src/types/phone.ts';
import type { PersistedState } from '../../src/types/records.ts';
import type { SignalId } from '../../src/types/signals.ts';
import type { HudState } from '../../src/types/state.ts';
import type { WidgetId } from '../../src/types/config.ts';

/** Shared builders for the state / alerts / compose / scenario tests. */

/** 14 May 2026, 12:00 UTC — daytime almost everywhere that matters for the sun tests. */
export const T0 = Date.UTC(2026, 4, 14, 12, 0, 0);

export function makeConfig(patch?: DeepPartial<HudConfig>): HudConfig {
  if (patch === undefined) return cloneJson(DEFAULT_CONFIG);
  const { config, errors } = mergeConfig(DEFAULT_CONFIG, patch);
  if (errors.length > 0) throw new Error(`invalid test config:\n${errors.join('\n')}`);
  return config;
}

export function persisted(overrides: Partial<PersistedState> = {}): PersistedState {
  return { ...EMPTY_PERSISTED_STATE, maintenanceRecords: [], ...overrides };
}

/**
 * Recursively freeze plain objects and arrays, skipping already-frozen subtrees (states share
 * most of their structure, so this stays cheap).
 */
export function freezeDeep<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

export type SignalValues = Partial<Record<SignalId, number>>;

export function samplesEvent(at: number, values: SignalValues): HudEvent {
  return {
    type: 'obd/samples',
    at,
    samples: Object.entries(values).map(([signal, value]) => ({
      signal: signal as SignalId,
      value: value as number,
    })),
  };
}

export function navInfo(overrides: Partial<NavInfo> = {}): NavInfo {
  return {
    source: 'test',
    maneuver: { type: 'right' },
    distanceToManeuverM: 500,
    street: 'Main Street',
    currentStreet: 'High Street',
    thenManeuver: null,
    lanes: null,
    etaEpochMs: null,
    remainingDistanceM: 5000,
    remainingSeconds: 600,
    iconPng: null,
    updatedAt: T0,
    ...overrides,
  };
}

export function roadInfo(limitKph: number | null, overrides: Partial<RoadInfo> = {}): RoadInfo {
  return {
    speedLimitKph: limitKph,
    unlimited: false,
    source: 'osm',
    roadName: 'Main Street',
    roadClass: 'primary',
    updatedAt: T0,
    ...overrides,
  };
}

export function mediaInfo(overrides: Partial<MediaInfo> = {}): MediaInfo {
  return {
    playing: true,
    title: 'Midnight City',
    artist: 'M83',
    album: null,
    app: 'Spotify',
    trackKey: 'midnight-city',
    updatedAt: T0,
    ...overrides,
  };
}

export function callInfo(overrides: Partial<CallInfo> = {}): CallInfo {
  return {
    id: 'call-1',
    state: 'ringing',
    callerName: 'Maria Lopez',
    number: '+1 415 555 0132',
    startedAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function widget<I extends WidgetId>(frame: HudFrame, id: I): WidgetFrameById<I> | undefined {
  return frame.widgets.find((w): w is WidgetFrameById<I> => w.id === id);
}

export const widgetIds = (frame: HudFrame): WidgetId[] =>
  frame.widgets.map((w: WidgetFrame) => w.id);

/**
 * Drives the reducer like the server does: every input state is deep-frozen (proving `reduce`
 * never mutates), effects are derived for every transition, and frames can be composed at any
 * point.
 */
export class Harness {
  state: HudState;
  config: HudConfig;
  /** Effects of the most recent event. */
  lastEffects: HudEffect[] = [];
  /** Every effect so far, in order. */
  readonly effects: HudEffect[] = [];

  constructor(
    config: HudConfig = makeConfig(),
    persistedState: PersistedState = persisted(),
    now: number = T0,
    options?: { simulated?: boolean },
  ) {
    this.config = config;
    this.state = freezeDeep(createInitialState(config, persistedState, now, options));
  }

  get now(): number {
    return this.state.now;
  }

  send(event: HudEvent): HudState {
    const prev = freezeDeep(this.state);
    const config = event.type === 'config' ? event.config : this.config;
    const next = reduce(prev, event, this.config);
    this.lastEffects = deriveEffects(prev, next, event, config);
    this.effects.push(...this.lastEffects);
    this.config = config;
    this.state = freezeDeep(next);
    return this.state;
  }

  frame(): HudFrame {
    return composeFrame(this.state, this.config);
  }

  tick(at: number): HudState {
    return this.send({ type: 'tick', at });
  }

  samples(at: number, values: SignalValues): HudState {
    return this.send(samplesEvent(at, values));
  }

  input(action: InputAction, at: number = this.now): HudState {
    return this.send({ type: 'input', action, at });
  }

  obdConnected(at: number = this.now): HudState {
    return this.send({
      type: 'obd/link',
      state: 'connected',
      adapter: 'ELM327 v1.5',
      protocol: 'ISO 15765-4 (CAN 11/500)',
      at,
    });
  }

  phoneConnected(at: number = this.now): HudState {
    return this.send({ type: 'phone/link', connected: true, deviceName: 'Pixel', at });
  }

  /**
   * Feed samples (and a tick) every `stepMs` from the current time up to and including
   * `until`. `values` may depend on the time.
   */
  run(
    until: number,
    values: SignalValues | ((at: number) => SignalValues),
    stepMs = 200,
  ): HudState {
    for (let at = this.now + stepMs; at <= until; at += stepMs) {
      this.samples(at, typeof values === 'function' ? values(at) : values);
      this.tick(at);
    }
    return this.state;
  }

  /** Only ticks (no vehicle data) up to and including `until`. */
  idle(until: number, stepMs = 1000): HudState {
    for (let at = this.now + stepMs; at <= until; at += stepMs) this.tick(at);
    return this.state;
  }
}
