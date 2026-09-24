import type { BrightnessState } from '../display/brightness.ts';
import { updateBrightness } from '../display/brightness.ts';
import { updateContext } from '../display/context.ts';
import { sunElevationDeg } from '../display/sun.ts';
import type { MaintenanceState } from '../maintenance/maintenance.ts';
import { maintenanceStatus } from '../maintenance/maintenance.ts';
import { updateTrip } from '../trip/trip.ts';
import type { HudConfig } from '../types/config.ts';
import type { MaintenanceItemStatus } from '../types/records.ts';
import type { HudState } from '../types/state.ts';
import { updateFuel } from '../vehicle/fuel.ts';
import { updateGear } from '../vehicle/gear.ts';
import {
  LUX_FRESH_MS,
  freshSignal,
  freshSpeedKph,
  isEngineRunning,
  isObdLinkUp,
  wallNow,
} from './selectors.ts';

/**
 * Advancing the derived sub-states (context, gear, fuel, trip, brightness, maintenance) from
 * the raw inputs in `HudState`. Shared by the sample, tick and config handlers.
 */

/** Advance the driving context from the current (fresh-or-null) speed and engine state. */
export function advanceContext(state: HudState, config: HudConfig): HudState['context'] {
  return updateContext(
    state.context,
    {
      at: state.now,
      speedKph: freshSpeedKph(state),
      engineRunning: isEngineRunning(state),
      linkUp: isObdLinkUp(state),
    },
    config.display.context,
  );
}

/** Feed the gear estimator the current fresh drivetrain values (nulls when stale). */
export function advanceGear(state: HudState, config: HudConfig): HudState['gear'] {
  return updateGear(
    state.gear,
    {
      at: state.now,
      speedKph: freshSpeedKph(state),
      rpm: freshSignal(state, 'rpm'),
      throttlePct: freshSignal(state, 'throttle') ?? freshSignal(state, 'relativeThrottle'),
      reportedGear: freshSignal(state, 'transmissionGear'),
    },
    config.vehicle,
  );
}

export function advanceFuel(state: HudState, config: HudConfig): HudState['fuel'] {
  return updateFuel(
    state.fuel,
    {
      at: state.now,
      speedKph: freshSpeedKph(state),
      rpm: freshSignal(state, 'rpm'),
      fuelRateLph: freshSignal(state, 'fuelRate'),
      mafGps: freshSignal(state, 'maf'),
      mapKpa: freshSignal(state, 'map'),
      intakeAirTempC: freshSignal(state, 'intakeAirTemp'),
      commandedLambda: freshSignal(state, 'commandedLambda'),
      fuelLevelPct: freshSignal(state, 'fuelLevel'),
      ethanolPct: freshSignal(state, 'ethanolPercent'),
    },
    config.vehicle,
  );
}

/**
 * Advance the trip. The fuel rate is the one computed from the latest samples, and only while
 * engine data is still arriving (a fresh rpm), so a dead link never keeps burning fuel.
 */
export function advanceTrip(state: HudState, config: HudConfig): HudState['trip'] {
  const rpmFresh = freshSignal(state, 'rpm') !== null;
  return updateTrip(
    state.trip,
    {
      at: state.now,
      speedKph: freshSpeedKph(state),
      engineRunning: isEngineRunning(state),
      fuelRateLph: rpmFresh ? state.fuel.readings.rateLph : null,
      odometerKm: state.odometer.km,
      linkUp: isObdLinkUp(state),
      wallOffsetMs: state.clock.wallOffsetMs,
    },
    config.trip,
    { fuelPricePerL: config.vehicle.fuelPricePerL, currency: config.units.currency },
  );
}

/**
 * Advance auto-brightness / night mode: a light-sensor reading counts while ≤ 5 s old; the sun
 * elevation (at the wall-clock time) comes from the phone's location, else the configured
 * fallback location.
 */
export function advanceBrightness(state: HudState, config: HudConfig): BrightnessState {
  const { env, now } = state;
  const lux =
    env.lux !== null && env.luxAt !== null && now - env.luxAt <= LUX_FRESH_MS ? env.lux : null;
  const location = env.location ?? config.sensors.fallbackLocation;
  const sun =
    location === null ? null : sunElevationDeg(location.lat, location.lon, wallNow(state));
  return updateBrightness(
    env.brightness,
    { at: now, lux, sunElevationDeg: sun },
    config.display.brightness,
  );
}

/**
 * Recompute maintenance status now (keeping the previous array when nothing changed). Service
 * dates are wall-clock times; `checkedAt` is engine time (it paces the rechecks).
 */
export function refreshMaintenance(state: HudState, config: HudConfig): MaintenanceState {
  const prev = state.maintenance;
  const status = maintenanceStatus(
    config.maintenance,
    prev.records,
    state.odometer.km,
    wallNow(state),
  );
  return {
    ...prev,
    status: sameStatus(prev.status, status) ? prev.status : status,
    checkedAt: state.now,
  };
}

function sameStatus(
  a: readonly MaintenanceItemStatus[],
  b: readonly MaintenanceItemStatus[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (
      x.itemId !== y.itemId ||
      x.label !== y.label ||
      x.lastDoneAt !== y.lastDoneAt ||
      x.lastDoneKm !== y.lastDoneKm ||
      x.dueAtKm !== y.dueAtKm ||
      x.dueAtEpochMs !== y.dueAtEpochMs ||
      x.remainingKm !== y.remainingKm ||
      x.remainingDays !== y.remainingDays ||
      x.status !== y.status
    ) {
      return false;
    }
  }
  return true;
}
