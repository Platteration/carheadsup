import { isValidDtc, normalizeDtc } from '../obd/dtc.ts';
import type { HudConfig } from '../types/config.ts';
import type { HudEvent } from '../types/events.ts';
import { SIGNAL_IDS } from '../types/signals.ts';
import type { SignalId, SignalMap } from '../types/signals.ts';
import type { HudState, OdometerState } from '../types/state.ts';
import type { DtcEntry, DtcKind, ObdLinkStatus } from '../types/vehicle.ts';
import { advanceContext, advanceFuel, advanceGear, advanceTrip } from './derived.ts';
import { ODOMETER_MAX_GAP_MS, freshSignal } from './selectors.ts';

/** Reducer handlers for OBD-II events. */

type EventOf<T extends HudEvent['type']> = Extract<HudEvent, { type: T }>;

const KNOWN_SIGNALS: ReadonlySet<string> = new Set(SIGNAL_IDS);
const isSignalId = (value: unknown): value is SignalId =>
  typeof value === 'string' && KNOWN_SIGNALS.has(value);

/** Signals that drive the gear estimator; other samples do not count as a new gear sample. */
const DRIVETRAIN_SIGNALS: ReadonlySet<SignalId> = new Set(['speed', 'rpm', 'transmissionGear']);

/**
 * Store a batch of samples (stamped with the event time; non-finite values and unknown signals
 * are ignored), integrate distance, then advance gear, fuel, context and trip from fresh values.
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
  for (const sample of samples) {
    const { signal, value } = sample;
    if (!isSignalId(signal) || typeof value !== 'number' || !Number.isFinite(value)) continue;
    signals ??= { ...state.vehicle.signals };
    signals[signal] = { value, at: now };
    if (signal === 'speed') speed = value;
    else if (signal === 'odometer') odometer = value;
    if (DRIVETRAIN_SIGNALS.has(signal)) drivetrain = true;
  }
  if (signals === null) return state;

  const lastPid = state.vehicle.signals.odometer;
  const previousPid =
    lastPid !== undefined && freshSignal(state, 'odometer') !== null
      ? { km: lastPid.value, at: lastPid.at }
      : null;
  let next: HudState = { ...state, vehicle: { ...state.vehicle, signals } };
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
 * distance in between; it is 'pid'-sourced while that PID is fresh and trusted, otherwise an
 * estimate from the last known reading (the persisted baseline, a manual setting or an older
 * PID value).
 */
export function integrateOdometer(
  state: HudState,
  speedSample: number | null,
  odometerSample: number | null,
  previousPid: { km: number; at: number } | null = null,
): OdometerState {
  const odo = state.odometer;
  const { now } = state;
  let { integratedKm, lastSampleAt, lastSpeedKph } = odo;
  if (speedSample !== null && speedSample >= 0) {
    if (lastSampleAt !== null && lastSpeedKph !== null) {
      const dt = now - lastSampleAt;
      if (dt > 0 && dt <= ODOMETER_MAX_GAP_MS) {
        integratedKm += (((lastSpeedKph + speedSample) / 2) * dt) / 3_600_000;
      }
    }
    lastSampleAt = now;
    lastSpeedKph = speedSample;
  }

  let { km, source } = odo;
  const extrapolated = km === null ? null : km + (integratedKm - odo.integratedKm);
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
    lastSpeedKph === odo.lastSpeedKph
  ) {
    return odo;
  }
  return { km, source, integratedKm, lastSampleAt, lastSpeedKph };
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
