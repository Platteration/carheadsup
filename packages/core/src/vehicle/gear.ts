import type { TransmissionType, VehicleConfig } from '../types/config.ts';
import {
  GEAR_RATIO_TOLERANCE,
  LEARN_ANALYSE_EVERY,
  createGearLearner,
  findGearClusters,
  firstGearHint,
  mergeLearnedRatios,
  normaliseLearnedRatios,
  observeGearSample,
  type GearLearnerState,
} from './gear-learner.ts';

export type { GearLearnerState } from './gear-learner.ts';

export interface GearEstimate {
  /** Gear number (1 = first), 'N' when the rpm/speed ratio matches no gear (clutch in / coasting), null when unknown. */
  gear: number | 'N' | null;
  /** True when inferred from rpm/speed rather than reported by the vehicle (PID 0xA4). */
  inferred: boolean;
  /** 0–1. */
  confidence: number;
}

export interface GearInput {
  at: number;
  speedKph: number | null;
  rpm: number | null;
  throttlePct: number | null;
  /** Gear reported by PID 0xA4, if the vehicle supports it. */
  reportedGear: number | null;
}

/** An inferred gear change waiting for confirmation (debounces shifts). */
export interface PendingGearChange {
  gear: number | 'N';
  /** First sample that produced `gear`. */
  since: number;
  /** Consecutive samples that produced `gear`. */
  count: number;
  /** When the raw inference first stopped agreeing with the displayed estimate. */
  disagreeSince: number;
  /** Samples since then, and how often the raw result changed among them. */
  disagreeCount: number;
  changes: number;
}

/**
 * Gear estimator state. Implementations add private learner fields; `estimate` and
 * `learnedRatios` are the public surface.
 */
export interface GearState {
  estimate: GearEstimate;
  /** Learned overall ratios, rpm per km/h, 1st gear first; null until learned with confidence. */
  learnedRatios: number[] | null;
  /** Inferred change not yet confirmed; the previous estimate is still displayed. */
  pending: PendingGearChange | null;
  /** Recent valid samples [at, km/h, rpm], oldest first, for the decoupling test. */
  recent: Array<[at: number, speedKph: number, rpm: number]>;
  learner: GearLearnerState;
}

/** Below this road speed no gear is inferred (ratio meaningless, clutch slipping, creeping). */
export const GEAR_MIN_SPEED_KPH = 5;

/** Highest gear number accepted from PID 0xA4 (the config schema allows at most 12 ratios). */
const MAX_REPORTED_GEAR = 12;
/** A match window never extends past this fraction of the ln-gap to the neighbouring gear. */
const MAX_GAP_FRACTION = 0.45;
/** Cap on the speed-quantisation widening of the tolerance (ln units). */
const MAX_QUANTISATION = 0.1;
/** Extra upward tolerance for torque-converter slip on automatics, at low and high speed (ln units). */
const AUTO_SLIP_LOW = 0.12;
const AUTO_SLIP_HIGH = 0.03;
const AUTO_SLIP_LOW_KPH = 20;
const AUTO_SLIP_HIGH_KPH = 60;
/**
 * Engine at (or just above) idle while rolling faster than walking-pace traffic creep: the clutch
 * is in or the gearbox is in neutral — even if idle rpm / speed happens to equal some gear's
 * ratio (coasting in neutral would otherwise sweep through 6, 5, 4, 3 … on the way to a stop).
 */
const IDLE_BAND_FACTOR = 1.12;
const CREEP_MAX_KPH = 15;
/**
 * If, within the last 2.5 s, the car was at least 3 km/h and 10 % faster while rpm stayed flat
 * ever since — its ln range under 35 % of the ln speed drop — the engine is decoupled: braking
 * or rolling to a stop with the clutch in. In gear, rpm falls with speed (and after a downshift
 * it jumps first, so it is not flat). The absolute threshold keeps the 1 km/h resolution of the
 * speed PID from faking a speed change.
 */
const DECOUPLE_WINDOW_MS = 2500;
const DECOUPLE_MIN_DROP_KPH = 3;
const DECOUPLE_MIN_DROP_LN = 0.1;
const DECOUPLE_MAX_RPM_FOLLOW = 0.35;
const MAX_RECENT_SAMPLES = 64;
/** Confidence multiplier when inferring from learned (rather than configured) ratios. */
const LEARNED_CONFIDENCE = 0.9;
/** An inferred gear change must hold this many samples and this long before it shows. */
const CONFIRM = {
  default: { samples: 2, ms: 300 },
  automatic: { samples: 3, ms: 600 },
} as const;
/** After disagreeing this long without a confirmed alternative, the old gear is dropped. */
const MAX_HOLD_MS = 1000;

const UNKNOWN: GearEstimate = { gear: null, inferred: false, confidence: 0 };

export function createGearState(learnedRatios: number[] | null): GearState {
  return {
    estimate: UNKNOWN,
    learnedRatios: normaliseLearnedRatios(learnedRatios),
    pending: null,
    recent: [],
    learner: createGearLearner(),
  };
}

/**
 * Update the estimate from a new sample. Uses `vehicle.gearRatiosRpmPerKph` when configured,
 * otherwise learned ratios; keeps learning from steady-state samples (not idling, not shifting,
 * speed above a floor). CVTs never report a gear. Reported gears (PID 0xA4) win over inference.
 *
 * Inputs are expected to be fresh values (see `freshValue`); null means unknown. An inferred
 * change is shown only once it has held for 2 samples / 300 ms (3 samples / 600 ms on
 * automatics), so shifts do not flicker; changes to "unknown" and reported gears apply at once.
 */
export function updateGear(state: GearState, input: GearInput, vehicle: VehicleConfig): GearState {
  if (vehicle.transmission === 'cvt') {
    return state.estimate === UNKNOWN && state.pending === null && state.recent.length === 0
      ? state
      : { ...state, estimate: UNKNOWN, pending: null, recent: [] };
  }

  let { learner, learnedRatios } = state;
  if (vehicle.gearRatiosRpmPerKph === null) {
    learner = observeGearSample(learner, input, vehicle);
    if (learner.sinceAnalysis >= LEARN_ANALYSE_EVERY && learner.histogram) {
      // Without a torque converter the launch ratio is 1st gear, which anchors gear numbering:
      // the first publication waits for it so 2nd gear is never shown as "1". (A converter
      // slips when pulling away, so automatics publish from the histogram alone.)
      const anchored = vehicle.transmission === 'manual' || vehicle.transmission === 'dct';
      const hint = anchored ? firstGearHint(learner) : null;
      if (!anchored || hint !== null || learnedRatios !== null) {
        learnedRatios = mergeLearnedRatios(
          learnedRatios,
          findGearClusters(learner.histogram, learner.total),
          hint,
        );
      }
      learner = { ...learner, sinceAnalysis: 0 };
    }
  }

  const recent = updateRecent(state.recent, input);
  const reported = reportedGear(input.reportedGear);
  const ratios = vehicle.gearRatiosRpmPerKph ?? learnedRatios;
  const raw: GearEstimate =
    reported !== null
      ? { gear: reported, inferred: false, confidence: 1 }
      : inferGear(input, ratios, vehicle, vehicle.gearRatiosRpmPerKph === null, recent);

  const neutral = neutralEstimate(vehicle.transmission, vehicle.gearRatiosRpmPerKph === null);
  const { estimate, pending } = debounce(state, raw, input.at, vehicle.transmission, neutral);
  return { estimate, learnedRatios, pending, recent, learner };
}

function validSample(input: GearInput): input is GearInput & { speedKph: number; rpm: number } {
  return (
    input.speedKph !== null &&
    input.rpm !== null &&
    Number.isFinite(input.at) &&
    Number.isFinite(input.speedKph) &&
    Number.isFinite(input.rpm)
  );
}

/** Keep the last `DECOUPLE_WINDOW_MS` of valid samples plus the newest one before that. */
function updateRecent(recent: GearState['recent'], input: GearInput): GearState['recent'] {
  if (!validSample(input)) return recent.length === 0 ? recent : [];
  const newest = recent[recent.length - 1];
  if (newest !== undefined && input.at <= newest[0]) return recent;
  const next: GearState['recent'] = [...recent, [input.at, input.speedKph, input.rpm]];
  let drop = 0;
  while (drop < next.length - 1) {
    const following = next[drop + 1];
    if (following === undefined || following[0] > input.at - DECOUPLE_WINDOW_MS) break;
    drop++;
  }
  drop = Math.max(drop, next.length - MAX_RECENT_SAMPLES);
  return drop > 0 ? next.slice(drop) : next;
}

/** Recently much faster with rpm flat ever since: clutch in / neutral. */
function decoupled(recent: GearState['recent'], speedKph: number, rpm: number): boolean {
  if (speedKph <= 0 || rpm <= 0) return false;
  let lo = Math.log(rpm);
  let hi = lo;
  // Walk back in time, widening the rpm band over the span [sample, now].
  for (let i = recent.length - 1; i >= 0; i--) {
    const sample = recent[i];
    if (sample === undefined || sample[2] <= 0) return false;
    const [, oldKph, oldRpm] = sample;
    const ln = Math.log(oldRpm);
    lo = Math.min(lo, ln);
    hi = Math.max(hi, ln);
    if (oldKph - speedKph < DECOUPLE_MIN_DROP_KPH) continue;
    const speedDrop = Math.log(oldKph / speedKph);
    if (speedDrop >= DECOUPLE_MIN_DROP_LN && hi - lo <= DECOUPLE_MAX_RPM_FOLLOW * speedDrop) {
      return true;
    }
  }
  return false;
}

/** PID 0xA4 gear: 0 = neutral, 1…12 = gear; anything else is ignored. */
function reportedGear(value: number | null): number | 'N' | null {
  if (value === null || !Number.isInteger(value) || value < 0 || value > MAX_REPORTED_GEAR) {
    return null;
  }
  return value === 0 ? 'N' : value;
}

export interface GearMatch {
  /** Index into the ratio list (gear number − 1). */
  index: number;
  /** ln(measured / gear ratio). */
  deviation: number;
  /** |deviation| relative to the tolerance on that side, 0–1. */
  score: number;
}

/**
 * Match a measured rpm/speed ratio to a gear. Each gear accepts ±7 % (in ln space), widened by
 * the ±0.5 km/h quantisation of the speed PID and, on automatics, upwards by torque-converter
 * slip — but never beyond 45 % of the ln-gap to its neighbours, so adjacent windows cannot
 * overlap even on close-ratio gearboxes. Ratios need not be sorted; invalid entries never match.
 */
export function matchGearRatio(
  ratio: number,
  speedKph: number,
  ratios: readonly number[],
  transmission: TransmissionType,
): GearMatch | null {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return null;
  const lnRatio = Math.log(ratio);
  const logs = ratios.map((r) => (Number.isFinite(r) && r > 0 ? Math.log(r) : null));
  const quantisation = Math.min(0.5 / Math.max(speedKph, 1), MAX_QUANTISATION);
  const slip = transmission === 'automatic' ? automaticSlip(speedKph) : 0;

  let best: GearMatch | null = null;
  logs.forEach((lnGear, index) => {
    if (lnGear === null) return;
    let gapUp = Infinity;
    let gapDown = Infinity;
    for (const other of logs) {
      if (other === null) continue;
      if (other > lnGear) gapUp = Math.min(gapUp, other - lnGear);
      else if (other < lnGear) gapDown = Math.min(gapDown, lnGear - other);
    }
    const tolUp = Math.min(GEAR_RATIO_TOLERANCE + quantisation + slip, MAX_GAP_FRACTION * gapUp);
    const tolDown = Math.min(GEAR_RATIO_TOLERANCE + quantisation, MAX_GAP_FRACTION * gapDown);
    const deviation = lnRatio - lnGear;
    if (deviation > tolUp || deviation < -tolDown) return;
    const tolerance = deviation >= 0 ? tolUp : tolDown;
    const score = tolerance > 0 ? Math.abs(deviation) / tolerance : 0;
    if (best === null || score < best.score) best = { index, deviation, score };
  });
  return best;
}

function automaticSlip(speedKph: number): number {
  const t = (speedKph - AUTO_SLIP_LOW_KPH) / (AUTO_SLIP_HIGH_KPH - AUTO_SLIP_LOW_KPH);
  const f = Math.min(1, Math.max(0, t));
  return AUTO_SLIP_LOW + (AUTO_SLIP_HIGH - AUTO_SLIP_LOW) * f;
}

/** Transmission-specific confidence multiplier for an inferred gear. */
function transmissionConfidence(transmission: TransmissionType, speedKph: number): number {
  switch (transmission) {
    case 'manual':
      return 1;
    case 'dct':
      return 0.95;
    case 'automatic': {
      // The torque converter slips (and is usually unlocked) at low speed.
      const t = (speedKph - AUTO_SLIP_LOW_KPH) / (AUTO_SLIP_HIGH_KPH - AUTO_SLIP_LOW_KPH);
      return 0.5 + 0.35 * Math.min(1, Math.max(0, t));
    }
    case 'cvt':
      return 0;
  }
}

/** Confidence of an inferred neutral ('N'): clear on a manual (clutch in), doubtful on an automatic. */
const NEUTRAL_CONFIDENCE: Record<TransmissionType, number> = {
  manual: 0.7,
  dct: 0.6,
  automatic: 0.4,
  cvt: 0,
};

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Raw (undebounced) inference from rpm / speed. */
function inferGear(
  input: GearInput,
  ratios: readonly number[] | null,
  vehicle: VehicleConfig,
  learned: boolean,
  recent: GearState['recent'],
): GearEstimate {
  const { transmission } = vehicle;
  const { speedKph, rpm } = input;
  if (
    ratios === null ||
    ratios.length === 0 ||
    speedKph === null ||
    rpm === null ||
    !Number.isFinite(speedKph) ||
    !Number.isFinite(rpm) ||
    speedKph < GEAR_MIN_SPEED_KPH ||
    rpm <= 0
  ) {
    return UNKNOWN;
  }
  const idling = rpm <= vehicle.idleRpm * IDLE_BAND_FACTOR && speedKph > CREEP_MAX_KPH;
  const match =
    idling || decoupled(recent, speedKph, rpm)
      ? null
      : matchGearRatio(rpm / speedKph, speedKph, ratios, transmission);
  if (match === null) return neutralEstimate(transmission, learned);
  const sourceFactor = learned ? LEARNED_CONFIDENCE : 1;
  const closeness = 1 - 0.5 * match.score * match.score;
  return {
    gear: match.index + 1,
    inferred: true,
    confidence: round2(closeness * transmissionConfidence(transmission, speedKph) * sourceFactor),
  };
}

function neutralEstimate(transmission: TransmissionType, learned: boolean): GearEstimate {
  const sourceFactor = learned ? LEARNED_CONFIDENCE : 1;
  return {
    gear: 'N',
    inferred: true,
    confidence: round2(NEUTRAL_CONFIDENCE[transmission] * sourceFactor),
  };
}

/**
 * Hold the displayed gear until a different inferred result has been stable long enough.
 * Unknown (null) and vehicle-reported gears apply immediately: stale data must never linger.
 *
 * With a clutch, a result that keeps changing (rpm falling through other gears' ratios after
 * the clutch goes in) is itself evidence of decoupling, so it shows 'N' once the disagreement has
 * lasted the confirmation time. Otherwise — and always on automatics, where it is converter
 * slip — a display that keeps disagreeing with the data drops to unknown rather than freezing.
 */
function debounce(
  state: GearState,
  raw: GearEstimate,
  at: number,
  transmission: TransmissionType,
  neutral: GearEstimate,
): { estimate: GearEstimate; pending: PendingGearChange | null } {
  const current = state.estimate;
  if (raw.gear === null || !raw.inferred || raw.gear === current.gear) {
    return { estimate: raw, pending: null };
  }
  const previous = state.pending;
  const pending: PendingGearChange =
    previous === null
      ? { gear: raw.gear, since: at, count: 1, disagreeSince: at, disagreeCount: 1, changes: 0 }
      : previous.gear === raw.gear
        ? { ...previous, count: previous.count + 1, disagreeCount: previous.disagreeCount + 1 }
        : {
            ...previous,
            gear: raw.gear,
            since: at,
            count: 1,
            disagreeCount: previous.disagreeCount + 1,
            changes: previous.changes + 1,
          };
  const need = transmission === 'automatic' ? CONFIRM.automatic : CONFIRM.default;
  if (pending.count >= need.samples && at - pending.since >= need.ms) {
    return { estimate: raw, pending: null };
  }
  const disagreeMs = at - pending.disagreeSince;
  const sweeping =
    transmission !== 'automatic' &&
    pending.changes >= 2 &&
    pending.disagreeCount >= need.samples &&
    disagreeMs >= need.ms;
  if (sweeping && current.gear !== 'N') return { estimate: neutral, pending };
  if (current.gear !== null && current.gear !== 'N' && disagreeMs >= MAX_HOLD_MS) {
    return { estimate: UNKNOWN, pending };
  }
  return { estimate: current, pending };
}
