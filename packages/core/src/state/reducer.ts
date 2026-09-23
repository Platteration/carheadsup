import { evaluateAlerts } from '../alerts/engine.ts';
import { createBrightnessState } from '../display/brightness.ts';
import { createContextState } from '../display/context.ts';
import { createMaintenanceState, recordService } from '../maintenance/maintenance.ts';
import type { ActiveTrip } from '../trip/trip.ts';
import { createTripState, restoreActiveTrip, resumeTripState } from '../trip/trip.ts';
import type { HudConfig } from '../types/config.ts';
import type { HudEvent } from '../types/events.ts';
import type { PersistedState } from '../types/records.ts';
import type { HudState } from '../types/state.ts';
import { roundTo } from '../units.ts';
import { createFuelState } from '../vehicle/fuel.ts';
import { createGearState } from '../vehicle/gear.ts';
import { followPage } from './dashboard.ts';
import { advanceBrightness, refreshMaintenance } from './derived.ts';
import { applyInput } from './input.ts';
import {
  applyCall,
  applyHazards,
  applyLocation,
  applyMedia,
  applyMessage,
  applyNav,
  applyPhoneLink,
} from './phone.ts';
import { applyTick } from './tick.ts';
import { applyDtcs, applyObdLink, applySamples, applySupported, applyVin } from './vehicle.ts';

export const EMPTY_PERSISTED_STATE: PersistedState = {
  odometerKm: null,
  learnedGearRatios: null,
  avgLPer100km: null,
  maintenanceRecords: [],
};

const validKm = (km: number | null | undefined): number | null =>
  typeof km === 'number' && Number.isFinite(km) && km >= 0 ? km : null;

/**
 * What `createInitialState` accepts: the persisted state, whose `activeTrip` may be anything
 * read back from disk (it is validated here, see `restoreActiveTrip`).
 */
export type PersistedStateWithTrip = Omit<PersistedState, 'activeTrip'> & {
  readonly activeTrip?: unknown;
};

/**
 * Initial state: odometer (as an estimate), learned gear ratios, the long-run fuel average and
 * maintenance records are seeded from `persisted`, as is the trip in progress when it was saved
 * (so powering down at ignition off does not lose it: the first tick after a longer power-down
 * completes it, a short blip continues it); the OBD link is 'disconnected' and everything else
 * is empty. Maintenance status and alerts are
 * derived immediately, so the first frame is consistent with the persisted data.
 */
export function createInitialState(
  config: HudConfig,
  persisted: PersistedStateWithTrip,
  now: number,
  options?: { simulated?: boolean },
): HudState {
  const odometerKm = validKm(persisted.odometerKm);
  const activeTrip = restoreActiveTrip(persisted.activeTrip, now);
  const state: HudState = {
    now,
    simulated: options?.simulated ?? false,
    vehicle: {
      link: { state: 'disconnected', adapter: null, protocol: null, message: null, since: now },
      signals: {},
      supported: null,
      milOn: false,
      dtcs: [],
      dtcsCheckedAt: null,
      vin: null,
    },
    context: createContextState(now),
    gear: createGearState(persisted.learnedGearRatios),
    fuel: createFuelState(persisted.avgLPer100km),
    trip:
      activeTrip === null
        ? createTripState()
        : resumeTripState(activeTrip, {
            fuelPricePerL: config.vehicle.fuelPricePerL,
            currency: config.units.currency,
          }),
    odometer: {
      km: odometerKm,
      source: odometerKm === null ? null : 'estimated',
      integratedKm: 0,
      lastSampleAt: null,
      lastSpeedKph: null,
    },
    maintenance: createMaintenanceState(persisted.maintenanceRecords),
    nav: null,
    road: null,
    hazards: [],
    media: null,
    call: null,
    messages: [],
    phone: { connected: false, deviceName: null, appVersion: null, since: now },
    adas: {
      moduleConnected: false,
      blindSpotLeft: false,
      blindSpotRight: false,
      blindSpotUpdatedAt: null,
      collision: 'none',
      ttcSeconds: null,
      collisionUpdatedAt: null,
    },
    env: {
      lux: null,
      luxAt: null,
      location: null,
      brightness: createBrightnessState(config.display.brightness),
    },
    alerts: [],
    ui: { blanked: false, page: 0, brightnessOffset: 0, toastDismissedAt: null, lastInputAt: null },
  };
  const withStatus: HudState = { ...state, maintenance: refreshMaintenance(state, config) };
  return { ...withStatus, alerts: evaluateAlerts(withStatus, config) };
}

/**
 * The single pure state transition. Never mutates `state`; never reads the clock
 * (time comes from `event.at`); never performs I/O.
 *
 * `event.at` is epoch ms and should advance like a monotonic clock: every duration —
 * staleness, grace periods, trip ends, call timers — is measured with it. A time that stalls
 * (e.g. a wall clock held after stepping backwards) would make data that stopped arriving look
 * live, so the server's engine time keeps counting through backward steps. Forward steps are
 * passed through, because the clock widget, night mode, trip timestamps and day-based
 * maintenance need the real time (a Pi without an RTC jumps forward when NTP syncs): such a
 * step expires time-limited data at once and may end the trip in progress — the safe direction.
 *
 * `state.now` never moves backwards: an event stamped earlier than the previous one is applied
 * at `state.now`. A 'config' event applies (and evaluates alerts against) its own config.
 * Alerts are re-evaluated after every event, and the parked dashboard stays on the page the
 * driver chose while pages come and go. Unknown event types (from a newer peer) are ignored.
 */
export function reduce(state: HudState, event: HudEvent, config: HudConfig): HudState {
  const at = Number.isFinite(event.at) ? Math.max(state.now, event.at) : state.now;
  const effectiveConfig = event.type === 'config' ? event.config : config;
  const timed = at === state.now ? state : { ...state, now: at };
  // `config` is still the previous config here; a 'config' event applies its own.
  const applied = apply(timed, event, config);
  const paging =
    event.type === 'input' && (event.action === 'next-page' || event.action === 'prev-page');
  const next = paging ? applied : followPage(state, applied);
  const alerts = evaluateAlerts(next, effectiveConfig);
  return alerts === next.alerts ? next : { ...next, alerts };
}

function apply(state: HudState, event: HudEvent, config: HudConfig): HudState {
  switch (event.type) {
    case 'tick':
      return applyTick(state, config);
    case 'config':
      return applyConfig(state, event.config, config);

    case 'obd/link':
      return applyObdLink(state, event);
    case 'obd/samples':
      return applySamples(state, event.samples, config);
    case 'obd/supported':
      return applySupported(state, event.signals);
    case 'obd/dtcs':
      return applyDtcs(state, event);
    case 'obd/vin':
      return applyVin(state, event.vin);

    case 'phone/link':
      return applyPhoneLink(state, event);
    case 'nav/update':
      return applyNav(state, event);
    case 'nav/clear':
      return state.nav === null ? state : { ...state, nav: null };
    case 'road/update':
      // Re-stamped with the receipt time: its expiry is measured against the HUD clock.
      return { ...state, road: { ...event.road, updatedAt: state.now } };
    case 'hazards/update':
      return applyHazards(state, event);
    case 'media/update':
      return applyMedia(state, event.media);
    case 'call/update':
      return applyCall(state, event.call);
    case 'message/received':
      return applyMessage(state, event.message);
    case 'location/update':
      return applyLocation(state, event);

    case 'sensor/light':
      return Number.isFinite(event.lux) && event.lux >= 0
        ? { ...state, env: { ...state.env, lux: event.lux, luxAt: state.now } }
        : state;
    case 'adas/link':
      return { ...state, adas: { ...state.adas, moduleConnected: event.connected } };
    case 'adas/blind-spot':
      // Data from the module proves it is connected.
      return {
        ...state,
        adas: {
          ...state.adas,
          moduleConnected: true,
          blindSpotLeft: event.left,
          blindSpotRight: event.right,
          blindSpotUpdatedAt: state.now,
        },
      };
    case 'adas/collision':
      return {
        ...state,
        adas: {
          ...state.adas,
          moduleConnected: true,
          collision: event.level,
          ttcSeconds: event.ttcSeconds,
          collisionUpdatedAt: state.now,
        },
      };

    case 'input':
      return applyInput(state, event.action, config);

    case 'maintenance/done':
      return applyMaintenanceDone(state, event.itemId, event.odometerKm, config);
    case 'odometer/set':
      return applyOdometerSet(state, event.odometerKm, config);

    default: {
      const unhandled: never = event;
      void unhandled;
      return state;
    }
  }
}

/**
 * A new config: re-derive what depends on it (maintenance schedule, brightness mode/curve). Gear
 * ratios learned for another kind of transmission are forgotten (their numbering was anchored
 * differently), which also persists the reset.
 */
function applyConfig(state: HudState, config: HudConfig, previous: HudConfig): HudState {
  const transmissionChanged = config.vehicle.transmission !== previous.vehicle.transmission;
  return {
    ...state,
    gear: transmissionChanged ? createGearState(null) : state.gear,
    maintenance: refreshMaintenance(state, config),
    env: { ...state.env, brightness: advanceBrightness(state, config) },
  };
}

/**
 * Record a service for a configured item (unknown ids are ignored). Without an explicit
 * odometer reading the current best-known odometer is used.
 */
function applyMaintenanceDone(
  state: HudState,
  itemId: string,
  odometerKm: number | null,
  config: HudConfig,
): HudState {
  if (!config.maintenance.items.some((item) => item.id === itemId)) return state;
  const current = state.odometer.km;
  const km = validKm(odometerKm) ?? (current === null ? null : roundTo(current, 1));
  const recorded: HudState = {
    ...state,
    maintenance: recordService(state.maintenance, itemId, km, state.now),
  };
  return { ...recorded, maintenance: refreshMaintenance(recorded, config) };
}

/** The driver set the odometer by hand; a fresh PID reading still takes precedence later. */
function applyOdometerSet(state: HudState, odometerKm: number, config: HudConfig): HudState {
  const km = validKm(odometerKm);
  if (km === null) return state;
  const updated: HudState = { ...state, odometer: { ...state.odometer, km, source: 'estimated' } };
  return { ...updated, maintenance: refreshMaintenance(updated, config) };
}

/**
 * The trip in progress (as `extractPersisted` includes it, for `createInitialState` to resume),
 * or null. A fresh, JSON-safe copy.
 */
export function extractActiveTrip(state: HudState): ActiveTrip | null {
  const trip = state.trip.active;
  return trip === null ? null : restoreActiveTrip(trip, Number.POSITIVE_INFINITY);
}

/**
 * What the server should write to disk, including the trip in progress. Returns fresh objects
 * sharing nothing with `state`.
 */
export function extractPersisted(state: HudState): PersistedState {
  const km = state.odometer.km;
  const avg = state.fuel.readings.averageLPer100km;
  return {
    odometerKm: km === null || !Number.isFinite(km) ? null : roundTo(km, 3),
    learnedGearRatios: state.gear.learnedRatios === null ? null : [...state.gear.learnedRatios],
    avgLPer100km: avg === null || !Number.isFinite(avg) ? null : roundTo(avg, 3),
    maintenanceRecords: state.maintenance.records.map((r) => ({ ...r })),
    activeTrip: extractActiveTrip(state),
  };
}
