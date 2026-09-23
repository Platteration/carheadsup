/**
 * Auto-ranging shared by the light-sensor drivers. Each chip has a ladder of settings (gain ×
 * integration time) ordered from least to most sensitive; after every reading we pick the
 * setting whose predicted count lands near a comfortable target, jumping several rungs at once
 * so that entering a tunnel or leaving a garage settles within one or two readings.
 */

export interface RangeStep {
  /** Lux represented by one count of the ranging channel at this setting. */
  luxPerCount: number;
  /** Counts at or above this mean the reading clipped. */
  saturation: number;
}

export interface RangePolicy {
  /** Readings below this many counts are too coarse: move to a more sensitive setting. */
  low: number;
  /** Readings above this many counts risk clipping: move to a less sensitive setting. */
  high: number;
  /** Counts aimed for after a change; must lie between `low` × (largest rung ratio) and `high`. */
  target: number;
}

/**
 * The ladder index to use for the next reading, given `count` read at `ladder[current]`.
 * A clipped reading says nothing about the true level, so it jumps to the least sensitive
 * setting; an out-of-band reading jumps straight to the most sensitive setting whose predicted
 * count stays at or below `policy.target`.
 */
export function chooseRange(
  ladder: readonly RangeStep[],
  current: number,
  count: number,
  policy: RangePolicy,
): number {
  const step = ladder[current];
  if (step === undefined || !Number.isFinite(count))
    return Math.min(Math.max(0, current), ladder.length - 1);
  if (count >= step.saturation) return 0;
  if (count >= policy.low && count <= policy.high) return current;
  const lux = Math.max(0, count) * step.luxPerCount;
  let best = 0;
  ladder.forEach((candidate, index) => {
    if (lux / candidate.luxPerCount <= policy.target) best = index;
  });
  return best;
}
