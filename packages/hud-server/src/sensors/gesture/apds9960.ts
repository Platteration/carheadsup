/**
 * Broadcom/Avago APDS-9960 gesture engine (I2C 0x39): register map, initialisation sequence and
 * the pure logic that turns gesture-FIFO datasets into swipe directions.
 *
 * The gesture engine starts when proximity exceeds GPENTH and fills a 32-dataset FIFO; each
 * dataset is four bytes, one per photodiode (U, D, L, R). A swipe shows up as the balance
 * between opposite photodiodes shifting from one side to the other over the gesture. Direction
 * conventions follow the SparkFun and Adafruit libraries (relative to the board markings):
 * (U−D)/(U+D) falling → up, rising → down; (L−R)/(L+R) rising → right, falling → left.
 */
import type { InputAction } from '@carheadsup/core';

export const APDS9960_ADDRESS = 0x39;
/** ID register values of genuine parts and common clones. */
export const APDS9960_KNOWN_IDS: readonly number[] = [0xab, 0x9c, 0xa8];

export const APDS9960_REGISTERS = {
  ENABLE: 0x80,
  WTIME: 0x83,
  CONFIG1: 0x8d,
  PPULSE: 0x8e,
  CONTROL: 0x8f,
  CONFIG2: 0x90,
  ID: 0x92,
  CONFIG3: 0x9f,
  GPENTH: 0xa0,
  GEXTH: 0xa1,
  GCONF1: 0xa2,
  GCONF2: 0xa3,
  GOFFSET_U: 0xa4,
  GOFFSET_D: 0xa5,
  GPULSE: 0xa6,
  GOFFSET_L: 0xa7,
  GOFFSET_R: 0xa9,
  GCONF3: 0xaa,
  GCONF4: 0xab,
  GFLVL: 0xae,
  GSTATUS: 0xaf,
  GFIFO_U: 0xfc,
} as const;

/** ENABLE bits. */
export const APDS9960_ENABLE = { PON: 0x01, PEN: 0x04, WEN: 0x08, GEN: 0x40 } as const;
/** GSTATUS bits. */
export const APDS9960_GSTATUS = { GVALID: 0x01, GFOV: 0x02 } as const;
/** GCONF4 bits. */
export const APDS9960_GCONF4 = { GMODE: 0x01, GFIFO_CLR: 0x04 } as const;

const R = APDS9960_REGISTERS;

/**
 * Register writes that configure the gesture engine (SparkFun's proven defaults): everything
 * off while configuring; proximity 16 µs × 10 pulses with 300 % LED boost; gesture entry at
 * proximity 40, exit below 30; FIFO threshold 4 datasets; gesture gain ×4, 100 mA LED,
 * 2.8 ms between datasets, 32 µs × 10 pulses; FIFO cleared; then power, wait, proximity and
 * gesture enabled.
 */
export const APDS9960_INIT_SEQUENCE: ReadonlyArray<readonly [register: number, value: number]> = [
  [R.ENABLE, 0x00],
  [R.WTIME, 0xff],
  [R.PPULSE, 0x89],
  [R.CONFIG1, 0x60],
  [R.CONTROL, 0x09],
  [R.CONFIG2, 0x31],
  [R.CONFIG3, 0x00],
  [R.GPENTH, 40],
  [R.GEXTH, 30],
  [R.GCONF1, 0x40],
  [R.GCONF2, 0x41],
  [R.GOFFSET_U, 0],
  [R.GOFFSET_D, 0],
  [R.GOFFSET_L, 0],
  [R.GOFFSET_R, 0],
  [R.GPULSE, 0xc9],
  [R.GCONF3, 0x00],
  [R.GCONF4, APDS9960_GCONF4.GFIFO_CLR],
  [R.ENABLE, APDS9960_ENABLE.PON | APDS9960_ENABLE.WEN | APDS9960_ENABLE.PEN | APDS9960_ENABLE.GEN],
];

/** One gesture-FIFO dataset. */
export interface GestureSample {
  u: number;
  d: number;
  l: number;
  r: number;
}

export type GestureDirection = 'up' | 'down' | 'left' | 'right';

/** Split raw FIFO bytes (U, D, L, R per dataset) into samples; a trailing partial dataset is dropped. */
export function parseGestureFifo(bytes: ArrayLike<number>): GestureSample[] {
  const samples: GestureSample[] = [];
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    samples.push({
      u: bytes[i] ?? 0,
      d: bytes[i + 1] ?? 0,
      l: bytes[i + 2] ?? 0,
      r: bytes[i + 3] ?? 0,
    });
  }
  return samples;
}

export interface GestureDecodeOptions {
  /** Every photodiode must exceed this for a dataset to count (SparkFun: 10). */
  threshold?: number;
  /** Minimum change of the balance ratio (percent points, −100…100 scale) for a swipe. */
  sensitivity?: number;
  /** Fewer valid datasets than this is noise, not a gesture. */
  minSamples?: number;
}

const ratio = (a: number, b: number): number => (a + b > 0 ? ((a - b) * 100) / (a + b) : 0);

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Decode one complete gesture (all datasets between the engine starting and stopping).
 * Compares the U/D and L/R balance at the start of the gesture (mean of the first quarter of
 * valid datasets) with the end (last quarter); the axis with the larger shift wins if the shift
 * exceeds the sensitivity. Returns null for noise, hovering or near/far movements.
 */
export function decodeGesture(
  samples: readonly GestureSample[],
  options: GestureDecodeOptions = {},
): GestureDirection | null {
  const threshold = options.threshold ?? 10;
  const sensitivity = options.sensitivity ?? 30;
  const minSamples = options.minSamples ?? 4;
  const valid = samples.filter(
    (s) => s.u > threshold && s.d > threshold && s.l > threshold && s.r > threshold,
  );
  if (valid.length < minSamples) return null;
  const edge = Math.max(1, Math.ceil(valid.length / 4));
  const first = valid.slice(0, edge);
  const last = valid.slice(-edge);
  const udDelta = mean(last.map((s) => ratio(s.u, s.d))) - mean(first.map((s) => ratio(s.u, s.d)));
  const lrDelta = mean(last.map((s) => ratio(s.l, s.r))) - mean(first.map((s) => ratio(s.l, s.r)));
  if (Math.max(Math.abs(udDelta), Math.abs(lrDelta)) < sensitivity) return null;
  if (Math.abs(udDelta) > Math.abs(lrDelta)) return udDelta > 0 ? 'down' : 'up';
  return lrDelta > 0 ? 'right' : 'left';
}

/** HUD input for a swipe: right accepts, left dismisses, up/down trim brightness. */
export const GESTURE_ACTIONS: Readonly<Record<GestureDirection, InputAction>> = {
  right: 'primary',
  left: 'secondary',
  up: 'brightness-up',
  down: 'brightness-down',
};

/**
 * Collects FIFO datasets over one gesture and decides when it is complete. A hand that hovers
 * (more than `maxSamples` datasets) is not a swipe: the data is discarded and nothing more is
 * decoded until the engine goes quiet.
 */
export class GestureAccumulator {
  private readonly maxSamples: number;
  private readonly quietMs: number;
  private samples: GestureSample[] = [];
  private lastDataAt = 0;
  private hovering = false;

  constructor(options: { maxSamples?: number; quietMs?: number } = {}) {
    this.maxSamples = options.maxSamples ?? 400;
    this.quietMs = options.quietMs ?? 150;
  }

  /** True while datasets of an unfinished gesture are held (or a hover is being ignored). */
  get active(): boolean {
    return this.samples.length > 0 || this.hovering;
  }

  add(samples: readonly GestureSample[], now: number): void {
    if (samples.length === 0) return;
    this.lastDataAt = now;
    if (this.hovering) return;
    this.samples.push(...samples);
    if (this.samples.length > this.maxSamples) {
      this.samples = [];
      this.hovering = true;
    }
  }

  /**
   * Call when the FIFO is empty. When the engine has left gesture mode (`engineIdle`) or no data
   * arrived for `quietMs`, the gesture is over: returns its direction (or null) and resets.
   * Returns undefined while the gesture is still in progress.
   */
  finish(now: number, engineIdle: boolean): GestureDirection | null | undefined {
    if (!this.active) return undefined;
    if (!engineIdle && now - this.lastDataAt < this.quietMs) return undefined;
    const samples = this.samples;
    const hovered = this.hovering;
    this.samples = [];
    this.hovering = false;
    return hovered ? null : decodeGesture(samples);
  }

  reset(): void {
    this.samples = [];
    this.hovering = false;
  }
}
