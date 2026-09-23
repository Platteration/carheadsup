/**
 * Automatic gear-ratio learning.
 *
 * Every gear has a fixed overall ratio between engine speed and road speed (rpm per km/h), so
 * steady-state driving produces tight clusters of rpm/speed ratios — one per gear used. The
 * learner keeps a histogram of ln(ratio) built only from samples taken while the ratio is stable
 * (clutch engaged, not shifting), finds its peaks and turns well-separated peaks into gear ratios.
 * Drivers leave 1st gear quickly, so the ratio seen right after pulling away from a standstill
 * is tracked separately and anchors gear numbering until 1st gear's own cluster has formed.
 *
 * Everything here is pure and deterministic, uses bounded memory, and keeps its state as plain
 * JSON-serialisable data (arrays and objects only) because it lives inside `HudState`.
 */

import { median } from './stats.ts';

/** Lowest / highest overall ratio the histogram covers, rpm per km/h (tall top gears … motorcycle 1st). */
export const LEARN_MIN_RATIO = 8;
export const LEARN_MAX_RATIO = 400;

/** Histogram bin width in ln units (≈ 1 % per bin). */
export const LEARN_BIN_WIDTH = 0.01;

const LN_MIN = Math.log(LEARN_MIN_RATIO);
export const LEARN_BIN_COUNT = Math.ceil((Math.log(LEARN_MAX_RATIO) - LN_MIN) / LEARN_BIN_WIDTH);

/**
 * Match tolerance in ln units (≈ ±7 %). Peaks closer than this are one cluster; learned ratios
 * are kept at least this far apart.
 */
export const GEAR_RATIO_TOLERANCE = Math.log(1.07);

/** Samples below this speed break the stability window (low-speed quantisation, clutch slip). */
const WINDOW_MIN_KPH = 10;
/** Only samples at or above this speed are added to the histogram. */
export const LEARN_MIN_KPH = 15;
/** Engine speed must exceed idle by this much (excludes coasting at idle with the clutch in). */
export const LEARN_MIN_RPM_ABOVE_IDLE = 300;
/** The ratio must have been stable for this long before a sample counts. */
export const LEARN_STABLE_MS = 1000;
/** Samples more than 5 % beyond redline are glitches. */
const REDLINE_MARGIN = 1.05;
/** Allowed ln-ratio spread within the stability window, on top of speed quantisation. */
const STABLE_SPREAD = 0.03;
/** A longer gap between samples breaks the stability window. */
const MAX_WINDOW_GAP_MS = 1500;
/** Hard cap on retained window samples (bounded memory at high sample rates). */
const MAX_WINDOW_SAMPLES = 64;
/** At most one histogram sample per this interval, so counts track time rather than poll rate. */
const MIN_ACCEPT_INTERVAL_MS = 100;
/** When the histogram total exceeds this, every bin is halved (bounded, slowly forgetting). */
const HISTOGRAM_CAP = 20_000;
/** Peaks are re-analysed after this many new histogram samples. */
export const LEARN_ANALYSE_EVERY = 20;

/** A peak needs at least this many samples … */
export const MIN_PEAK_SAMPLES = 20;
/** … and at least this share of all samples. */
const MIN_PEAK_SHARE = 0.005;
/** Adjacent peaks whose valley is shallower than this fraction of the smaller peak are one cluster. */
const VALLEY_FRACTION = 0.5;
/** Learning publishes ratios once at least this many distinct gears have been found. */
export const MIN_CLUSTERS_TO_PUBLISH = 3;
/** Published ratios only change when some ratio moves by more than this (ln units ≈ 0.5 %). */
const PUBLISH_EPSILON = 0.005;

/** Smoothing kernel applied before peak detection. */
const KERNEL = [1, 2, 3, 2, 1] as const;
const KERNEL_SUM = 9;
const KERNEL_HALF = 2;
const TOLERANCE_BINS = Math.round(GEAR_RATIO_TOLERANCE / LEARN_BIN_WIDTH);

/** Below this speed the car counts as standing, which arms the launch tracker. */
const LAUNCH_ARM_BELOW_KPH = 5;
/** Launch tracking (re)starts in [from, startBelow) km/h … */
const LAUNCH_TRACK_FROM_KPH = 10;
const LAUNCH_START_BELOW_KPH = 16;
/**
 * … restarting when the ratio is still settling (clutch slipping, rpm held up) but giving up
 * once rpm falls below this fraction of its launch peak (an up-shift drops rpm by the gear step,
 * 35 % or more between 1st and 2nd) …
 */
const LAUNCH_SHIFT_RPM_FRACTION = 0.85;
/** … and records a ratio once it has been stable this long. */
const LAUNCH_STABLE_MS = 1000;
/** Launch observations kept; their median is the 1st-gear hint. */
const MAX_LAUNCHES = 7;
/** Observations needed before the hint is used. */
const MIN_LAUNCHES = 1;

/**
 * Tracks the ratio right after pulling away from a standstill. On a manual or dual-clutch
 * gearbox that is 1st gear, which the histogram only sees briefly (drivers leave 1st early),
 * so the launch ratio anchors gear numbering until 1st gear's own cluster has formed.
 */
export type LaunchTracker =
  | { phase: 'idle' }
  | { phase: 'armed' }
  | {
      phase: 'tracking';
      since: number;
      lastAt: number;
      lo: number;
      hi: number;
      sum: number;
      count: number;
      minKph: number;
      /** Highest rpm since tracking of this launch began (survives restarts). */
      maxRpm: number;
    };

export interface GearLearnerState {
  /**
   * Recent samples for the stability test, oldest first: [at, ln(rpm/kph), kph]. Holds the last
   * `LEARN_STABLE_MS` of samples plus the newest one before that.
   */
  window: Array<[at: number, lnRatio: number, speedKph: number]>;
  /** Steady-state sample counts per ln-ratio bin; null until the first sample is accepted. */
  histogram: number[] | null;
  /** Sum of `histogram`. */
  total: number;
  /** When the last sample was added to the histogram. */
  lastAcceptedAt: number | null;
  /** Samples added since the last peak analysis. */
  sinceAnalysis: number;
  launch: LaunchTracker;
  /** Recent launch ratios (rpm per km/h), oldest first. */
  launchRatios: number[];
}

export interface LearnSample {
  at: number;
  speedKph: number | null;
  rpm: number | null;
  throttlePct: number | null;
}

export interface LearnLimits {
  idleRpm: number;
  redlineRpm: number;
}

export interface GearCluster {
  /** Overall ratio, rpm per km/h. */
  ratio: number;
  /** Histogram samples attributed to this cluster. */
  samples: number;
}

const IDLE: LaunchTracker = { phase: 'idle' };
const ARMED: LaunchTracker = { phase: 'armed' };

export function createGearLearner(): GearLearnerState {
  return {
    window: [],
    histogram: null,
    total: 0,
    lastAcceptedAt: null,
    sinceAnalysis: 0,
    launch: IDLE,
    launchRatios: [],
  };
}

/** ln-ratio → histogram bin (clamped into range). */
export function ratioBin(lnRatio: number): number {
  const bin = Math.floor((lnRatio - LN_MIN) / LEARN_BIN_WIDTH);
  return Math.min(LEARN_BIN_COUNT - 1, Math.max(0, bin));
}

function binCenter(bin: number): number {
  return LN_MIN + (bin + 0.5) * LEARN_BIN_WIDTH;
}

function withEmptyWindow(state: GearLearnerState): GearLearnerState {
  return state.window.length === 0 ? state : { ...state, window: [] };
}

/**
 * Feed one sample to the learner. Returns the same object when nothing changed. A sample is
 * added to the histogram only in steady state: speed ≥ `LEARN_MIN_KPH`, rpm ≥ idle + 300 and not
 * above redline, throttle open when known, and the ratio stable for `LEARN_STABLE_MS`. Launches
 * from standstill are tracked separately (see `LaunchTracker`).
 */
export function observeGearSample(
  state: GearLearnerState,
  sample: LearnSample,
  limits: LearnLimits,
): GearLearnerState {
  return observeSteadyState(observeLaunch(state, sample), sample, limits);
}

function startTracking(
  at: number,
  lnRatio: number,
  speedKph: number,
  maxRpm: number,
): LaunchTracker {
  return {
    phase: 'tracking',
    since: at,
    lastAt: at,
    lo: lnRatio,
    hi: lnRatio,
    sum: lnRatio,
    count: 1,
    minKph: speedKph,
    maxRpm,
  };
}

function observeLaunch(state: GearLearnerState, sample: LearnSample): GearLearnerState {
  const { at, speedKph, rpm } = sample;
  if (speedKph === null || !Number.isFinite(speedKph) || !Number.isFinite(at)) return state;
  const tracker = state.launch;
  if (speedKph < LAUNCH_ARM_BELOW_KPH) {
    return tracker.phase === 'armed' ? state : { ...state, launch: ARMED };
  }
  if (tracker.phase === 'idle' || rpm === null || !Number.isFinite(rpm) || rpm <= 0) return state;
  const lnRatio = Math.log(rpm / speedKph);

  if (tracker.phase === 'armed') {
    if (speedKph >= LAUNCH_START_BELOW_KPH) return { ...state, launch: IDLE }; // missed the launch
    if (speedKph < LAUNCH_TRACK_FROM_KPH) return state;
    return { ...state, launch: startTracking(at, lnRatio, speedKph, rpm) };
  }

  if (at <= tracker.lastAt) return state;
  if (speedKph < LAUNCH_TRACK_FROM_KPH) return { ...state, launch: ARMED };
  if (at - tracker.lastAt > MAX_WINDOW_GAP_MS) return { ...state, launch: IDLE };
  const lo = Math.min(tracker.lo, lnRatio);
  const hi = Math.max(tracker.hi, lnRatio);
  const minKph = Math.min(tracker.minKph, speedKph);
  const maxRpm = Math.max(tracker.maxRpm, rpm);
  if (hi - lo > STABLE_SPREAD + 1 / minKph) {
    // Clutch still slipping: measure again from here. Already shifted: give up on this launch.
    const shifted = rpm < LAUNCH_SHIFT_RPM_FRACTION * tracker.maxRpm;
    const launch =
      !shifted && speedKph < LAUNCH_START_BELOW_KPH
        ? startTracking(at, lnRatio, speedKph, maxRpm)
        : IDLE;
    return { ...state, launch };
  }
  const sum = tracker.sum + lnRatio;
  const count = tracker.count + 1;
  if (at - tracker.since >= LAUNCH_STABLE_MS) {
    const launchRatios = [...state.launchRatios, Math.exp(sum / count)].slice(-MAX_LAUNCHES);
    return { ...state, launch: IDLE, launchRatios };
  }
  return {
    ...state,
    launch: {
      phase: 'tracking',
      since: tracker.since,
      lastAt: at,
      lo,
      hi,
      sum,
      count,
      minKph,
      maxRpm,
    },
  };
}

/**
 * 1st-gear ratio suggested by recent launches from standstill (median), or null until enough
 * launches were seen. Only meaningful for gearboxes without a torque converter.
 */
export function firstGearHint(state: GearLearnerState): number | null {
  const ratios = state.launchRatios;
  return ratios.length >= MIN_LAUNCHES ? median(ratios) : null;
}

function observeSteadyState(
  state: GearLearnerState,
  sample: LearnSample,
  limits: LearnLimits,
): GearLearnerState {
  const { at, speedKph, rpm } = sample;
  if (
    speedKph === null ||
    rpm === null ||
    !Number.isFinite(at) ||
    !Number.isFinite(speedKph) ||
    !Number.isFinite(rpm) ||
    speedKph < WINDOW_MIN_KPH ||
    rpm <= 0
  ) {
    return withEmptyWindow(state);
  }
  const ratio = rpm / speedKph;
  if (ratio < LEARN_MIN_RATIO || ratio > LEARN_MAX_RATIO) return withEmptyWindow(state);
  const lnRatio = Math.log(ratio);

  const newest = state.window[state.window.length - 1];
  if (newest !== undefined && at <= newest[0]) return state; // duplicate or out-of-order sample

  let window: GearLearnerState['window'] =
    newest !== undefined && at - newest[0] > MAX_WINDOW_GAP_MS
      ? [[at, lnRatio, speedKph]]
      : [...state.window, [at, lnRatio, speedKph]];
  // Keep everything inside the stability window plus the newest sample before it.
  let drop = 0;
  while (drop < window.length - 1) {
    const next = window[drop + 1];
    if (next === undefined || next[0] > at - LEARN_STABLE_MS) break;
    drop++;
  }
  drop = Math.max(drop, window.length - MAX_WINDOW_SAMPLES);
  if (drop > 0) window = window.slice(drop);

  const next: GearLearnerState = { ...state, window };
  if (!isSteady(window, at) || !informative(sample.throttlePct, speedKph, rpm, limits)) {
    return next;
  }
  if (next.lastAcceptedAt !== null && at - next.lastAcceptedAt < MIN_ACCEPT_INTERVAL_MS) {
    return next;
  }

  const histogram = next.histogram
    ? next.histogram.slice()
    : new Array<number>(LEARN_BIN_COUNT).fill(0);
  const bin = ratioBin(lnRatio);
  histogram[bin] = (histogram[bin] ?? 0) + 1;
  let total = next.total + 1;
  if (total > HISTOGRAM_CAP) {
    for (let i = 0; i < histogram.length; i++) histogram[i] = (histogram[i] ?? 0) / 2;
    total /= 2;
  }
  return { ...next, histogram, total, lastAcceptedAt: at, sinceAnalysis: next.sinceAnalysis + 1 };
}

/**
 * Whether a steady sample tells us about a gear: fast enough for a precise ratio, clearly above
 * idle (not coasting with the clutch in), not beyond redline (a glitch or the limiter), and not
 * on a closed throttle when the throttle is known.
 */
function informative(
  throttlePct: number | null,
  speedKph: number,
  rpm: number,
  limits: LearnLimits,
): boolean {
  if (speedKph < LEARN_MIN_KPH) return false;
  if (rpm < limits.idleRpm + LEARN_MIN_RPM_ABOVE_IDLE) return false;
  if (rpm > limits.redlineRpm * REDLINE_MARGIN) return false;
  return throttlePct === null || !Number.isFinite(throttlePct) || throttlePct > 0;
}

/** The window spans the stability period and its ln-ratio spread is within noise + quantisation. */
function isSteady(window: GearLearnerState['window'], at: number): boolean {
  const first = window[0];
  if (first === undefined || window.length < 2 || at - first[0] < LEARN_STABLE_MS) return false;
  let lo = Infinity;
  let hi = -Infinity;
  let minSpeed = Infinity;
  for (const [, ln, kph] of window) {
    lo = Math.min(lo, ln);
    hi = Math.max(hi, ln);
    minSpeed = Math.min(minSpeed, kph);
  }
  // Road speed is reported in whole km/h, so each sample's ratio may be off by ±0.5 / speed.
  return hi - lo <= STABLE_SPREAD + 1 / minSpeed;
}

/**
 * Find gear clusters in a ln-ratio histogram: smooth, take local maxima, suppress weaker peaks
 * that are within the tolerance of (or not separated by a clear valley from) a stronger one,
 * then refine each surviving peak to the count-weighted mean of its neighbourhood. Clusters
 * without enough samples are dropped. Sorted by ratio, highest (1st gear) first.
 */
export function findGearClusters(histogram: readonly number[], total: number): GearCluster[] {
  const n = histogram.length;
  const at = (i: number): number => histogram[i] ?? 0;
  const smooth: number[] = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -KERNEL_HALF; k <= KERNEL_HALF; k++)
      sum += (KERNEL[k + KERNEL_HALF] ?? 0) * at(i + k);
    smooth[i] = sum / KERNEL_SUM;
  }
  const s = (i: number): number => smooth[i] ?? 0;

  const candidates: number[] = [];
  for (let i = 0; i < n; i++) {
    const h = s(i);
    if (h > 0 && h >= s(i - 1) && h > s(i + 1)) candidates.push(i);
  }
  candidates.sort((a, b) => s(b) - s(a) || a - b);

  const valley = (a: number, b: number): number => {
    let min = Infinity;
    for (let i = Math.min(a, b) + 1; i < Math.max(a, b); i++) min = Math.min(min, s(i));
    return min;
  };
  const accepted: number[] = [];
  for (const c of candidates) {
    const separate = accepted.every(
      (p) =>
        Math.abs(c - p) >= TOLERANCE_BINS && valley(c, p) <= VALLEY_FRACTION * Math.min(s(c), s(p)),
    );
    if (separate) accepted.push(c);
  }
  accepted.sort((a, b) => a - b);

  // Each peak owns bins within the tolerance, bounded by the valley towards each neighbour.
  const valleyIndex = (a: number, b: number): number => {
    let best = a + 1;
    for (let i = a + 1; i < b; i++) if (s(i) < s(best)) best = i;
    return best;
  };
  const clusters: GearCluster[] = [];
  const minSamples = Math.max(MIN_PEAK_SAMPLES, MIN_PEAK_SHARE * total);
  accepted.forEach((peak, idx) => {
    const prev = accepted[idx - 1];
    const next = accepted[idx + 1];
    const lo = Math.max(
      peak - TOLERANCE_BINS,
      prev === undefined ? 0 : valleyIndex(prev, peak) + 1,
    );
    const hi = Math.min(
      peak + TOLERANCE_BINS,
      next === undefined ? n - 1 : valleyIndex(peak, next) - 1,
    );
    let mass = 0;
    let weighted = 0;
    for (let i = lo; i <= hi; i++) {
      mass += at(i);
      weighted += at(i) * binCenter(i);
    }
    if (mass >= minSamples) clusters.push({ ratio: Math.exp(weighted / mass), samples: mass });
  });
  return clusters.sort((a, b) => b.ratio - a.ratio);
}

/**
 * Normalise a list of ratios: finite and positive only, sorted descending (1st gear first),
 * dropping any within the tolerance of a higher one. Null when nothing usable remains.
 */
export function normaliseLearnedRatios(ratios: readonly number[] | null): number[] | null {
  if (!ratios) return null;
  const sorted = ratios.filter((r) => Number.isFinite(r) && r > 0).sort((a, b) => b - a);
  const out: number[] = [];
  for (const r of sorted) {
    const prev = out[out.length - 1];
    if (prev === undefined || Math.log(prev / r) >= GEAR_RATIO_TOLERANCE) out.push(r);
  }
  return out.length > 0 ? out : null;
}

/**
 * Merge freshly found clusters into the published ratios. Without prior ratios, publishing
 * needs `MIN_CLUSTERS_TO_PUBLISH` clusters. With prior ratios (e.g. persisted from earlier
 * drives), clusters refine the ratios they match and add new gears, while gears not seen in this
 * session are kept — so a short trip in three gears never forgets the other three.
 *
 * `firstGearHint` (see `firstGearHint()`) fills in 1st gear when it lies clearly above every
 * known ratio: without it, 2nd gear would be numbered "1" until 1st gear's cluster formed.
 *
 * Returns the `existing` array itself when nothing moved by more than ≈ 0.5 %, so callers can
 * detect changes by reference and avoid needless persistence.
 */
export function mergeLearnedRatios(
  existing: number[] | null,
  clusters: readonly GearCluster[],
  firstGearHint: number | null = null,
): number[] | null {
  const found = clusters.map((c) => c.ratio).sort((a, b) => b - a);
  const previous = existing ?? [];
  if (previous.length === 0 && found.length < MIN_CLUSTERS_TO_PUBLISH) return existing;

  const top = Math.max(found[0] ?? 0, previous[0] ?? 0);
  const hintIsNewFirstGear =
    firstGearHint !== null &&
    Number.isFinite(firstGearHint) &&
    Math.log(firstGearHint / top) >= GEAR_RATIO_TOLERANCE;
  const fresh = hintIsNewFirstGear ? [firstGearHint, ...found] : found;
  if (fresh.length === 0) return existing;

  const kept = previous.filter((r) =>
    fresh.every((f) => Math.abs(Math.log(r / f)) >= GEAR_RATIO_TOLERANCE),
  );
  const next = (normaliseLearnedRatios([...fresh, ...kept]) ?? []).map(
    (r) => Math.round(r * 100) / 100,
  );
  return existing !== null && sameRatios(existing, next) ? existing : next;
}

function sameRatios(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, i) => {
    const other = b[i];
    return other !== undefined && Math.abs(Math.log(r / other)) <= PUBLISH_EPSILON;
  });
}
