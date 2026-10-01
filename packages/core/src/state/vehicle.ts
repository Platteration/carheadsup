import { isValidDtc, normalizeDtc } from '../obd/dtc.ts';
import { isPlausible } from '../obd/plausibility.ts';
import type { HudConfig } from '../types/config.ts';
import type { HudEvent } from '../types/events.ts';
import { SIGNAL_IDS } from '../types/signals.ts';
import type { SignalId, SignalMap } from '../types/signals.ts';
import type { OdometerCalibration } from '../types/records.ts';
import type { HudState, OdometerState } from '../types/state.ts';
import type { DtcEntry, DtcKind, ObdLinkStatus } from '../types/vehicle.ts';
import { advanceContext, advanceFuel, advanceGear, advanceTrip } from './derived.ts';
import { ODOMETER_MAX_GAP_MS, freshSignal, freshSpeedKph } from './selectors.ts';

/** Reducer handlers for OBD-II events. */

type EventOf<T extends HudEvent['type']> = Extract<HudEvent, { type: T }>;

const KNOWN_SIGNALS: ReadonlySet<string> = new Set(SIGNAL_IDS);
const isSignalId = (value: unknown): value is SignalId =>
  typeof value === 'string' && KNOWN_SIGNALS.has(value);

/** Signals that drive the gear estimator; other samples do not count as a new gear sample. */
const DRIVETRAIN_SIGNALS: ReadonlySet<SignalId> = new Set(['speed', 'rpm', 'transmissionGear']);

const TYRE_SIGNALS: ReadonlySet<SignalId> = new Set([
  'tirePressureFL',
  'tirePressureFR',
  'tirePressureRL',
  'tirePressureRR',
]);

/**
 * Store a batch of samples (stamped with the event time; non-finite values and unknown signals
 * are ignored), integrate distance, then advance gear, fuel, context and trip from fresh values.
 * A reading the signal cannot physically have (`isPlausible`: a sensor fault, a garbled answer)
 * removes the signal's value, so it reads as missing rather than as its last good value.
 */
export function applySamples(
  state: HudState,
  samples: EventOf<'obd/samples'>['samples'],
  config: HudConfig,
): HudState {
  const { now } = state;
  let signals: SignalMap | null = null;
  let speed: number | null = null;
  let odometer: number | null = null;
  let drivetrain = false;
  let tyresReporting = state.vehicle.tyresReporting;
  for (const sample of samples) {
    const { signal, value } = sample;
    if (!isSignalId(signal) || typeof value !== 'number' || !Number.isFinite(value)) continue;
    signals ??= { ...state.vehicle.signals };
    if (DRIVETRAIN_SIGNALS.has(signal)) drivetrain = true;
    if (!isPlausible(signal, value)) {
      delete signals[signal];
      continue;
    }
    signals[signal] = { value, at: now };
    if (signal === 'speed') speed = value;
    else if (signal === 'odometer') odometer = value;
    else if (TYRE_SIGNALS.has(signal) && value !== 0 && !tyresReporting.includes(signal)) {
      tyresReporting = [...tyresReporting, signal];
    }
  }
  if (signals === null) return state;

  const lastPid = state.vehicle.signals.odometer;
  const previousPid =
    lastPid !== undefined && freshSignal(state, 'odometer') !== null
      ? { km: lastPid.value, at: lastPid.at }
      : null;
  let next: HudState = { ...state, vehicle: { ...state.vehicle, signals, tyresReporting } };
  next = { ...next, odometer: integrateOdometer(next, speed, odometer, previousPid) };
  if (drivetrain) next = { ...next, gear: advanceGear(next, config) };
  next = { ...next, fuel: advanceFuel(next, config) };
  next = { ...next, context: advanceContext(next, config) };
  return { ...next, trip: advanceTrip(next, config) };
}

/** Largest odometer reading accepted from PID 0xA6; anything beyond is a garbled answer. */
export const ODOMETER_PID_MAX_KM = 10_000_000;
/**
 * A PID 0xA6 reading continues the best-known odometer when it is at most this far below it
 * (odometers never go backwards; this absorbs the PID's 0.1 km resolution and rounding) …
 */
export const ODOMETER_PID_BEHIND_KM = 1;
/** … and at most this far ahead of it (the known value is extrapolated with integrated distance). */
export const ODOMETER_PID_AHEAD_KM = 2;
/** Fastest plausible travel between two confirming PID readings, km/h. */
const ODOMETER_MAX_KPH = 300;
/** Slack for two consecutive readings to confirm each other (0.1 km resolution). */
const ODOMETER_CONFIRM_SLACK_KM = 0.2;

/**
 * Whether a PID 0xA6 reading can be trusted. ECUs that list the PID but answer 0, garbled
 * multi-ECU answers and bit errors must not overwrite (and get persisted as) the odometer, so a
 * reading is taken at once only when it continues the best-known odometer. One that disagrees —
 * or the first one when nothing is known — is taken only once the previous (still fresh) reading
 * confirms it: two consecutive readings consistent with each other and with the time between
 * them. So a correct PID still replaces a drifted estimate or a mistyped manual setting.
 */
function trustOdometerReading(
  reading: number,
  knownKm: number | null,
  previous: { km: number; at: number } | null,
  now: number,
): boolean {
  if (!(reading > 0) || reading > ODOMETER_PID_MAX_KM) return false;
  if (
    knownKm !== null &&
    reading >= knownKm - ODOMETER_PID_BEHIND_KM &&
    reading <= knownKm + ODOMETER_PID_AHEAD_KM
  ) {
    return true;
  }
  if (previous === null || !(previous.km > 0) || previous.km > ODOMETER_PID_MAX_KM) return false;
  const maxAdvanceKm =
    (Math.max(0, now - previous.at) * ODOMETER_MAX_KPH) / 3_600_000 + ODOMETER_CONFIRM_SLACK_KM;
  const advance = reading - previous.km;
  return advance >= -ODOMETER_CONFIRM_SLACK_KM && advance <= maxAdvanceKm;
}

/**
 * Integrate distance trapezoidally between consecutive speed samples (gaps over 5 s are not
 * bridged). The odometer snaps to trusted PID 0xA6 readings (see `trustOdometerReading`;
 * `previousPid` is the last fresh reading before this batch) and is extrapolated with integrated
 * distance in between — scaled by the learned `calibration.scale` — ; it is 'pid'-sourced while
 * that PID is fresh and trusted, otherwise an estimate from the last known reading (the
 * persisted baseline, a dash reading entered by hand or an older PID value).
 */
export function integrateOdometer(
  state: HudState,
  speedSample: number | null,
  odometerSample: number | null,
  previousPid: { km: number; at: number } | null = null,
): OdometerState {
  const odo = state.odometer;
  const { now } = state;
  let { integratedKm, lastSampleAt, lastSpeedKph, calibration } = odo;
  let deltaKm = 0;
  if (speedSample !== null && speedSample >= 0) {
    if (lastSampleAt !== null && lastSpeedKph !== null) {
      const dt = now - lastSampleAt;
      if (dt > 0 && dt <= ODOMETER_MAX_GAP_MS) {
        deltaKm = (((lastSpeedKph + speedSample) / 2) * dt) / 3_600_000;
        integratedKm += deltaKm;
      }
    }
    lastSampleAt = now;
    lastSpeedKph = speedSample;
  }
  if (deltaKm > 0) {
    calibration = { ...calibration, rawKmSince: calibration.rawKmSince + deltaKm };
  }

  let { km, source } = odo;
  const extrapolated = km === null ? null : km + deltaKm * calibration.scale;
  if (
    odometerSample !== null &&
    trustOdometerReading(odometerSample, extrapolated, previousPid, now)
  ) {
    km = odometerSample;
    source = 'pid';
  } else if (extrapolated !== null) {
    km = extrapolated;
    const pid = freshSignal(state, 'odometer');
    // An untrusted reading leaves an estimate; so does a PID that has gone stale.
    source = odometerSample === null && pid !== null && source === 'pid' ? 'pid' : 'estimated';
  }

  if (
    km === odo.km &&
    source === odo.source &&
    integratedKm === odo.integratedKm &&
    lastSampleAt === odo.lastSampleAt &&
    lastSpeedKph === odo.lastSpeedKph &&
    calibration === odo.calibration
  ) {
    return odo;
  }
  return { ...odo, km, source, integratedKm, lastSampleAt, lastSpeedKph, calibration };
}

/** Phone fixes measure distance only when at least this accurate (metres) … */
export const GPS_BRIDGE_MAX_ACCURACY_M = 30;
/** … at most this far apart … */
export const GPS_BRIDGE_MAX_GAP_MS = 30_000;
/**
 * … and implying a speed within this range: below it the car stands still in the fixes' noise,
 * above it one of them jumped.
 */
const GPS_BRIDGE_MIN_KPH = 5;
const GPS_BRIDGE_MAX_KPH = 250;
const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance between two points, km (haversine). */
function greatCircleKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Bridge with the phone's location what the speed PID cannot measure — the OBD link down, or not
 * up yet at the start of a drive: the distance between two accurate fixes (see the
 * `GPS_BRIDGE_*` limits) is added to the odometer when no speed sample at all arrived between
 * them, so nothing is counted twice. It enters the calibration as the speed-integrated distance
 * it stands for (÷ scale), so the scale is learnt from the speed PID alone.
 */
export function bridgeOdometerWithGps(
  state: HudState,
  fix: { lat: number; lon: number; accuracyM: number | null },
): HudState {
  const odo = state.odometer;
  const { lat, lon, accuracyM } = fix;
  const usable =
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    accuracyM !== null &&
    Number.isFinite(accuracyM) &&
    accuracyM >= 0 &&
    accuracyM <= GPS_BRIDGE_MAX_ACCURACY_M;
  if (!usable)
    return odo.gpsFix === null ? state : { ...state, odometer: { ...odo, gpsFix: null } };
  const { now } = state;
  const previous = odo.gpsFix;
  let { km, calibration } = odo;
  const speedSince =
    odo.lastSampleAt !== null && previous !== null && odo.lastSampleAt > previous.at;
  if (previous !== null && !speedSince && freshSpeedKph(state) === null) {
    const dt = now - previous.at;
    if (dt > 0 && dt <= GPS_BRIDGE_MAX_GAP_MS) {
      const dKm = greatCircleKm(previous, fix);
      const kph = dKm / (dt / 3_600_000);
      if (kph >= GPS_BRIDGE_MIN_KPH && kph <= GPS_BRIDGE_MAX_KPH) {
        if (km !== null) km += dKm;
        calibration = {
          ...calibration,
          rawKmSince: calibration.rawKmSince + dKm / calibration.scale,
        };
      }
    }
  }
  return { ...state, odometer: { ...odo, km, calibration, gpsFix: { lat, lon, at: now } } };
}

/** The learned distance scale stays within this range … */
export const ODOMETER_SCALE_MIN = 0.9;
export const ODOMETER_SCALE_MAX = 1.1;
/**
 * … is measured only over at least this much speed-integrated distance (dash readings are whole
 * kilometres) …
 */
export const ODOMETER_SCALE_MIN_KM = 200;
/**
 * … from a dash distance / integrated distance ratio within this range (outside it the reading
 * was mistyped, or the OBD link was down for a large part of the way: no measurement) …
 */
const ODOMETER_SCALE_ACCEPT: readonly [number, number] = [0.8, 1.25];
/** … and each measurement moves it this far towards the measured value. */
const ODOMETER_SCALE_WEIGHT = 0.5;

/** No dash reading entered yet, nothing learned. */
export const INITIAL_ODOMETER_CALIBRATION: OdometerCalibration = Object.freeze({
  confirmedKm: null,
  rawKmSince: 0,
  scale: 1,
});

/** A calibration read back from disk, validated (a fresh copy); defaults for anything invalid. */
export function restoreOdometerCalibration(value: unknown): OdometerCalibration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return INITIAL_ODOMETER_CALIBRATION;
  }
  const { confirmedKm, rawKmSince, scale } = value as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  return {
    confirmedKm:
      finite(confirmedKm) && confirmedKm >= 0 && confirmedKm <= ODOMETER_PID_MAX_KM
        ? confirmedKm
        : null,
    rawKmSince: finite(rawKmSince) && rawKmSince >= 0 ? rawKmSince : 0,
    scale: finite(scale) && scale >= ODOMETER_SCALE_MIN && scale <= ODOMETER_SCALE_MAX ? scale : 1,
  };
}

/**
 * The driver entered the dash reading (`odometer/set`, or a service recorded with one): the
 * odometer becomes `km` — an estimate until a PID 0xA6 reading takes over — and the calibration
 * restarts from it. With a previous reading at least `ODOMETER_SCALE_MIN_KM` of integrated
 * distance ago, the two measure the speed PID's error: the scale moves halfway towards the
 * measured ratio (clamped to 0.9–1.1; a ratio beyond 0.8–1.25 is a typo or a long outage and
 * is not used).
 */
export function confirmOdometer(odo: OdometerState, km: number): OdometerState {
  const { calibration } = odo;
  let { scale } = calibration;
  if (calibration.confirmedKm !== null && calibration.rawKmSince >= ODOMETER_SCALE_MIN_KM) {
    const measured = (km - calibration.confirmedKm) / calibration.rawKmSince;
    if (measured >= ODOMETER_SCALE_ACCEPT[0] && measured <= ODOMETER_SCALE_ACCEPT[1]) {
      const target = Math.min(ODOMETER_SCALE_MAX, Math.max(ODOMETER_SCALE_MIN, measured));
      scale = Math.round((scale + ODOMETER_SCALE_WEIGHT * (target - scale)) * 10_000) / 10_000;
    }
  }
  return {
    ...odo,
    km,
    source: 'estimated',
    calibration: { confirmedKm: km, rawKmSince: 0, scale },
  };
}

/** Adapter link state; `since` moves only when the state changes. */
export function applyObdLink(state: HudState, event: EventOf<'obd/link'>): HudState {
  const prev = state.vehicle.link;
  const changed = prev.state !== event.state;
  const link: ObdLinkStatus = {
    state: event.state,
    adapter: event.adapter !== undefined ? event.adapter : prev.adapter,
    protocol: event.protocol !== undefined ? event.protocol : prev.protocol,
    message: event.message !== undefined ? event.message : changed ? null : prev.message,
    since: changed ? state.now : prev.since,
  };
  return { ...state, vehicle: { ...state.vehicle, link } };
}

export function applySupported(state: HudState, signals: readonly SignalId[]): HudState {
  const supported = [...new Set(signals.filter(isSignalId))];
  return { ...state, vehicle: { ...state.vehicle, supported } };
}

const DTC_KINDS: readonly DtcKind[] = ['stored', 'permanent', 'pending'];

/**
 * Replace the trouble-code list with the latest read (so empty lists clear it). A code that
 * was already present — in any list — keeps its `firstSeenAt`. Codes are normalised, invalid
 * ones dropped, and each (code, kind) pair appears once. An incomplete read (`complete:
 * false`: only the MIL state was readable) updates the MIL and keeps the codes, and the time
 * they were last checked, as they were.
 */
export function applyDtcs(state: HudState, event: EventOf<'obd/dtcs'>): HudState {
  const { now } = state;
  if (event.complete === false) {
    const milOn = event.milOn === true;
    return milOn === state.vehicle.milOn
      ? state
      : { ...state, vehicle: { ...state.vehicle, milOn } };
  }
  const firstSeen = new Map<string, number>();
  for (const entry of state.vehicle.dtcs) {
    const seen = firstSeen.get(entry.code);
    if (seen === undefined || entry.firstSeenAt < seen)
      firstSeen.set(entry.code, entry.firstSeenAt);
  }
  const lists: Record<DtcKind, readonly string[]> = {
    stored: event.stored,
    permanent: event.permanent,
    pending: event.pending,
  };
  const dtcs: DtcEntry[] = [];
  const added = new Set<string>();
  for (const kind of DTC_KINDS) {
    for (const raw of lists[kind]) {
      if (typeof raw !== 'string') continue;
      const code = normalizeDtc(raw);
      const id = `${kind}:${code}`;
      if (!isValidDtc(code) || added.has(id)) continue;
      added.add(id);
      dtcs.push({ code, kind, firstSeenAt: firstSeen.get(code) ?? now });
    }
  }
  return {
    ...state,
    vehicle: {
      ...state.vehicle,
      milOn: event.milOn,
      dtcs: sameDtcs(state.vehicle.dtcs, dtcs) ? state.vehicle.dtcs : dtcs,
      dtcsCheckedAt: now,
    },
  };
}

function sameDtcs(a: readonly DtcEntry[], b: readonly DtcEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return (
        y !== undefined && x.code === y.code && x.kind === y.kind && x.firstSeenAt === y.firstSeenAt
      );
    })
  );
}

export function applyVin(state: HudState, vin: string): HudState {
  const trimmed = typeof vin === 'string' ? vin.trim().toUpperCase() : '';
  return { ...state, vehicle: { ...state.vehicle, vin: trimmed === '' ? null : trimmed } };
}
