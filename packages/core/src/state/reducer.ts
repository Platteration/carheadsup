import { evaluateAlerts } from '../alerts/engine.ts';
import { createBrightnessState } from '../display/brightness.ts';
import { createContextState } from '../display/context.ts';
import { updateShiftFlash } from '../display/shift-light.ts';
import {
  createMaintenanceState,
  dateUndatedServices,
  recordService,
} from '../maintenance/maintenance.ts';
import type { ActiveTrip } from '../trip/trip.ts';
import {
  createTripState,
  reconcileResumedTrip,
  restoreActiveTrip,
  resumeTripState,
  shiftActiveTrip,
} from '../trip/trip.ts';
import type { HudConfig } from '../types/config.ts';
import type { HudEvent } from '../types/events.ts';
import type { PersistedState } from '../types/records.ts';
import type { HudState } from '../types/state.ts';
import { roundTo } from '../units.ts';
import { createFuelState } from '../vehicle/fuel.ts';
import { createGearState } from '../vehicle/gear.ts';
import {
  applyPairingEndpoint,
  followPage,
  showPairingPage,
  trackPairingPage,
} from './dashboard.ts';
import { advanceBrightness, refreshMaintenance } from './derived.ts';
import { applyInput } from './input.ts';
import { freshSignal, wallNow } from './selectors.ts';
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
 * Initial state at engine time `now`: odometer (as an estimate), learned gear ratios with their
 * numbering anchor (if learned on the configured transmission), the long-run fuel average and
 * maintenance records are seeded from `persisted`, as is the trip in progress when it was saved
 * (so powering down at ignition off does not lose it: the first tick after a longer power-down
 * completes it, a short blip continues it, and one saved "in the future" of this start's clock
 * is completed — see `resumeTripState`); the OBD link is 'disconnected' and everything else is
 * empty. Maintenance status and alerts are derived immediately, so the first frame is consistent
 * with the persisted data.
 *
 * `wallOffsetMs` (default 0: engine time starts at the wall clock) converts the saved trip's
 * wall-clock times to engine time. `clockTrusted` (default true) is `ClockState.trusted` at the
 * start: false when the server found the system clock gone back (see `PersistedState.lastWallMs`);
 * a trip resumed then is continued only provisionally (see `resumeTripState`). Trips completed
 * from now on are numbered after `persisted.tripSeq`.
 */
export function createInitialState(
  config: HudConfig,
  persisted: PersistedStateWithTrip,
  now: number,
  options?: { simulated?: boolean; wallOffsetMs?: number; clockTrusted?: boolean },
): HudState {
  const odometerKm = validKm(persisted.odometerKm);
  const offset = options?.wallOffsetMs;
  const wallOffsetMs = offset !== undefined && Number.isFinite(offset) ? offset : 0;
  const trusted = options?.clockTrusted ?? true;
  const lastSeq = persisted.tripSeq ?? 0;
  const saved = restoreActiveTrip(persisted.activeTrip);
  const activeTrip = saved === null ? null : shiftActiveTrip(saved, -wallOffsetMs);
  const state: HudState = {
    now,
    clock: { wallOffsetMs, trusted },
    simulated: options?.simulated ?? false,
    vehicle: {
      link: { state: 'disconnected', adapter: null, protocol: null, message: null, since: now },
      signals: {},
      supported: null,
      milOn: false,
      dtcs: [],
      dtcsCheckedAt: null,
      vin: null,
      tyresReporting: [],
    },
    context: createContextState(now),
    gear: createGearState(
      persisted.learnedGearRatios,
      persisted.gearAnchor,
      config.vehicle.transmission,
    ),
    shiftFlash: false,
    fuel: createFuelState(persisted.avgLPer100km),
    trip:
      activeTrip === null
        ? createTripState(lastSeq)
        : resumeTripState(
            activeTrip,
            { fuelPricePerL: config.vehicle.fuelPricePerL, currency: config.units.currency },
            now,
            wallOffsetMs,
            { lastSeq, clockTrusted: trusted },
          ),
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
    phone: { connected: false, deviceName: null, deviceId: null, appVersion: null, since: now },
    adas: {
      moduleConnected: false,
      blindSpotLeft: false,
      blindSpotRight: false,
      blindSpotUpdatedAt: null,
      collision: 'none',
      ttcSeconds: null,
      collisionUpdatedAt: null,
      collisionWarningAt: null,
    },
    pairing: null,
    env: {
      lux: null,
      luxAt: null,
      location: null,
      brightness: createBrightnessState(config.display.brightness),
    },
    alerts: [],
    ui: {
      blanked: false,
      page: 0,
      dashboardRequested: false,
      pairingShownAt: null,
      brightnessOffset: 0,
      toastDismissedAt: null,
      lastInputAt: null,
    },
  };
  const withStatus: HudState = { ...state, maintenance: refreshMaintenance(state, config) };
  return { ...withStatus, alerts: evaluateAlerts(withStatus, config) };
}

/**
 * The single pure state transition. Never mutates `state`; never reads the clock
 * (time comes from `event.at`); never performs I/O.
 *
 * `event.at` is engine time: epoch ms that advance like a monotonic clock and never step with
 * the system clock (see `ClockState`). Every duration — staleness, grace periods, dwell timers,
 * trip ends, call timers — is measured with it, so a clock stepped by network time neither
 * expires live data nor keeps stale data alive, and never splits a trip. The wall clock arrives
 * as an offset (`clock/sync`) and is used only where the absolute time matters: the clock widget,
 * the sun (night mode), service dates, trip records and the phone's ETA.
 *
 * `state.now` never moves backwards: an event stamped earlier than the previous one is applied
 * at `state.now`. A 'config' event applies (and evaluates alerts against) its own config.
 * Alerts and the shift-light flash latch are re-evaluated after every event, a dashboard the
 * driver opened while stopped closes once the vehicle is no longer stopped, the dashboard
 * stays on the page the driver chose while pages come and go, and its "Pair a phone" page turns
 * back to the overview after `PAIRING_PAGE_TIMEOUT_MS`. Unknown event types (from a newer peer)
 * are ignored.
 */
export function reduce(state: HudState, event: HudEvent, config: HudConfig): HudState {
  const at = Number.isFinite(event.at) ? Math.max(state.now, event.at) : state.now;
  const effectiveConfig = event.type === 'config' ? event.config : config;
  const timed = at === state.now ? state : { ...state, now: at };
  // `config` is still the previous config here; a 'config' event applies its own.
  const applied = apply(timed, event, config);
  // Events that choose the page themselves; after any other, the page follows its kind.
  const paging =
    (event.type === 'input' && (event.action === 'next-page' || event.action === 'prev-page')) ||
    event.type === 'pairing/show';
  const paged = paging ? applied : followPage(state, applied);
  const next = advanceShiftFlash(
    trackPairingPage(closeDashboardUnlessStopped(paged)),
    effectiveConfig,
  );
  const alerts = evaluateAlerts(next, effectiveConfig);
  return alerts === next.alerts ? next : { ...next, alerts };
}

/** A dashboard opened while stopped closes when the vehicle moves (or becomes parked). */
function closeDashboardUnlessStopped(state: HudState): HudState {
  return state.ui.dashboardRequested && state.context.context !== 'stopped'
    ? { ...state, ui: { ...state.ui, dashboardRequested: false } }
    : state;
}

function advanceShiftFlash(state: HudState, config: HudConfig): HudState {
  const flash = updateShiftFlash(state.shiftFlash, freshSignal(state, 'rpm'), config.shiftLight);
  return flash === state.shiftFlash ? state : { ...state, shiftFlash: flash };
}

function apply(state: HudState, event: HudEvent, config: HudConfig): HudState {
  switch (event.type) {
    case 'tick':
      return applyTick(state, config);
    case 'clock/sync':
      return applyClockSync(state, event.wallOffsetMs, event.trusted, config);
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
          collisionWarningAt: event.level === 'warning' ? state.now : state.adas.collisionWarningAt,
        },
      };

    case 'input':
      return applyInput(state, event.action, config);

    case 'pairing/endpoint':
      return applyPairingEndpoint(state, event.endpoint);
    case 'pairing/show':
      return showPairingPage(state);

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
 * The wall clock moved relative to engine time (or this is the first sync), or became trusted:
 * re-derive what depends on the absolute time — maintenance status (service dates) and night
 * mode (the sun). Everything measured in engine time — staleness, timers, the trip in progress —
 * is unaffected, except that a trip resumed after a restart is split again when the sync shows
 * that the break was long after all (`reconcileResumedTrip`: a start-up clock that was behind),
 * or confirmed as one when a trusted sync shows a short one. Once the clock becomes trusted,
 * services recorded while it was not are dated with the real time (`dateUndatedServices`).
 */
function applyClockSync(
  state: HudState,
  wallOffsetMs: number,
  trusted: boolean | undefined,
  config: HudConfig,
): HudState {
  const offset = Number.isFinite(wallOffsetMs) ? wallOffsetMs : state.clock.wallOffsetMs;
  const nextTrusted = trusted ?? state.clock.trusted;
  if (offset === state.clock.wallOffsetMs && nextTrusted === state.clock.trusted) return state;
  const confirmed = nextTrusted && !state.clock.trusted;
  const synced: HudState = {
    ...state,
    clock: { wallOffsetMs: offset, trusted: nextTrusted },
    trip: reconcileResumedTrip(
      state.trip,
      offset,
      config.trip,
      { fuelPricePerL: config.vehicle.fuelPricePerL, currency: config.units.currency },
      nextTrusted,
    ),
    maintenance: confirmed ? dateUndatedServices(state.maintenance, offset) : state.maintenance,
  };
  return {
    ...synced,
    maintenance: refreshMaintenance(synced, config),
    env: { ...synced.env, brightness: advanceBrightness(synced, config) },
  };
}

/**
 * A new config: re-derive what depends on it (maintenance schedule, brightness mode/curve). Gear
 * ratios learned for another kind of transmission are forgotten with their numbering anchor
 * (numbering is anchored differently), which also persists the reset.
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
 * Record a service for a configured item (unknown ids are ignored), dated with the wall-clock
 * time — while that is untrusted, provisionally (see `MaintenanceState.undated`). Without an
 * explicit odometer reading the current best-known odometer is used.
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
    maintenance: recordService(
      state.maintenance,
      itemId,
      km,
      wallNow(state),
      state.clock.trusted ? null : state.now,
    ),
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
 * or null. A fresh, JSON-safe copy with wall-clock times: engine time starts afresh with every
 * start of the server.
 */
export function extractActiveTrip(state: HudState): ActiveTrip | null {
  const trip = state.trip.active === null ? null : restoreActiveTrip(state.trip.active);
  return trip === null ? null : shiftActiveTrip(trip, state.clock.wallOffsetMs);
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
    gearAnchor:
      state.gear.learnedRatios === null || state.gear.anchor === null
        ? null
        : { ...state.gear.anchor },
    avgLPer100km: avg === null || !Number.isFinite(avg) ? null : roundTo(avg, 3),
    maintenanceRecords: state.maintenance.records.map((r) => ({ ...r })),
    activeTrip: extractActiveTrip(state),
    tripSeq: state.trip.lastSeq,
  };
}
