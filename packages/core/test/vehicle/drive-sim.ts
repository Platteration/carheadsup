/**
 * Deterministic synthetic drives for gear tests: a car with a clutch (or torque converter),
 * sampled at a fixed rate, with rpm noise and whole-km/h speed quantisation like PID 0x0D.
 */

export interface DriveSample {
  at: number;
  /** Reported speed, whole km/h. */
  speedKph: number;
  rpm: number;
  throttlePct: number;
  /** Ground truth: gear engaged (clutch up), 'N' while the clutch is in, null when stopped. */
  truth: number | 'N' | null;
}

/** Small deterministic PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DriveOptions {
  ratios: readonly number[];
  idleRpm?: number;
  stepMs?: number;
  /** Relative rpm noise (uniform ± this fraction). */
  rpmNoise?: number;
  seed?: number;
  startAt?: number;
  /**
   * Torque-converter slip as a fraction of turbine speed at a given road speed (automatics);
   * engine rpm = gear rpm × (1 + slip). Default: none (clutch).
   */
  converterSlip?: (kph: number) => number;
}

/** Builds a drive step by step; every step appends samples at `stepMs` intervals. */
export class Drive {
  readonly samples: DriveSample[] = [];
  private t: number;
  private kph = 0;
  private rpm: number;
  private readonly ratios: readonly number[];
  private readonly idle: number;
  private readonly step: number;
  private readonly noise: number;
  private readonly rand: () => number;
  private readonly slip: (kph: number) => number;

  constructor(options: DriveOptions) {
    this.ratios = options.ratios;
    this.idle = options.idleRpm ?? 800;
    this.step = options.stepMs ?? 100;
    this.noise = options.rpmNoise ?? 0.006;
    this.rand = prng(options.seed ?? 1);
    this.slip = options.converterSlip ?? (() => 0);
    this.t = options.startAt ?? 1_700_000_000_000;
    this.rpm = this.idle;
  }

  get now(): number {
    return this.t;
  }

  get speed(): number {
    return this.kph;
  }

  private ratio(gear: number): number {
    const r = this.ratios[gear - 1];
    if (r === undefined) throw new Error(`no gear ${gear}`);
    return r;
  }

  private emit(truth: number | 'N' | null, throttlePct: number): void {
    const jitter = 1 + (this.rand() * 2 - 1) * this.noise;
    this.samples.push({
      at: this.t,
      speedKph: Math.round(this.kph),
      rpm: Math.max(0, Math.round(this.rpm * jitter)),
      throttlePct,
      truth,
    });
    this.t += this.step;
  }

  /** Move off from standstill in 1st: clutch slips (rpm held) until the gear speed catches up. */
  launch(toKph: number, kphPerS = 6): this {
    const r1 = this.ratio(1);
    const biteRpm = this.idle + 700;
    while (this.kph < toKph) {
      this.kph = Math.min(toKph, this.kph + (kphPerS * this.step) / 1000);
      const locked = r1 * this.kph;
      const slipping = locked < biteRpm;
      this.rpm = slipping ? biteRpm : locked;
      this.emit(slipping ? (this.kph >= 5 ? 'N' : null) : 1, 30);
    }
    return this;
  }

  /** Accelerate (or decelerate, with a negative rate) in gear. */
  inGear(gear: number, toKph: number, kphPerS: number): this {
    const r = this.ratio(gear);
    const dir = Math.sign(toKph - this.kph);
    while (dir !== 0 && (toKph - this.kph) * dir > 0) {
      const next = this.kph + (dir * Math.abs(kphPerS) * this.step) / 1000;
      this.kph = dir > 0 ? Math.min(toKph, next) : Math.max(toKph, next);
      this.rpm = r * this.kph * (1 + this.slip(this.kph));
      this.emit(this.kph >= 5 ? gear : null, dir > 0 ? 35 : 15);
    }
    return this;
  }

  /** Hold a speed in gear, with a gentle ±1 km/h undulation. */
  cruise(gear: number, seconds: number): this {
    const r = this.ratio(gear);
    const base = this.kph;
    const n = Math.round((seconds * 1000) / this.step);
    for (let i = 0; i < n; i++) {
      this.kph = base + Math.sin(i / 25);
      this.rpm = r * this.kph * (1 + this.slip(this.kph));
      this.emit(gear, 20);
    }
    this.kph = base;
    return this;
  }

  /** Clutch in for `ms`: rpm falls towards idle, the car loses a little speed. */
  clutchIn(ms: number, kphPerS = -1.5): this {
    const n = Math.round(ms / this.step);
    for (let i = 0; i < n; i++) {
      this.kph = Math.max(0, this.kph + (kphPerS * this.step) / 1000);
      this.rpm = this.idle + (this.rpm - this.idle) * Math.exp(-this.step / 250);
      this.emit(this.kph >= 5 ? 'N' : null, 0);
    }
    return this;
  }

  /** A manual up/down shift: clutch in ~0.4 s, then engage `gear`. */
  shift(gear: number, clutchMs = 400): this {
    this.clutchIn(clutchMs, -1);
    this.rpm = this.ratio(gear) * this.kph;
    return this;
  }

  /**
   * Brake to a stop: slow down in gear until the engine nears idle, then clutch in and brake to
   * a standstill.
   */
  stop(gear: number, kphPerS = -6): this {
    this.inGear(gear, (this.idle + 250) / this.ratio(gear), kphPerS);
    while (this.kph > 0) this.clutchIn(this.step, kphPerS);
    this.idleFor(2);
    return this;
  }

  /** Roll in neutral (engine idling) while the speed drifts to `toKph`. */
  coast(toKph: number, kphPerS: number): this {
    const dir = Math.sign(toKph - this.kph);
    while (dir !== 0 && (toKph - this.kph) * dir > 0)
      this.clutchIn(this.step, dir * Math.abs(kphPerS));
    return this;
  }

  idleFor(seconds: number): this {
    const n = Math.round((seconds * 1000) / this.step);
    this.kph = 0;
    this.rpm = this.idle;
    for (let i = 0; i < n; i++) this.emit(null, 0);
    return this;
  }
}

/** A typical 6-speed manual hatchback, rpm per km/h. */
export const SIX_SPEED = [118, 68, 46, 35, 28, 23] as const;

/** City driving: several launches through 1st–3rd (sometimes 4th) and stops. */
export function cityDrive(drive: Drive, laps: number): Drive {
  for (let i = 0; i < laps; i++) {
    drive
      .launch(22 + (i % 3) * 2)
      .shift(2)
      .inGear(2, 40 + (i % 2) * 5, 5)
      .shift(3)
      .inGear(3, 52, 3)
      .cruise(3, 12);
    if (i % 2 === 0) drive.shift(4).inGear(4, 60, 2).cruise(4, 10).shift(3).cruise(3, 3).stop(3);
    else drive.stop(3);
  }
  return drive;
}

/** Out of town onto the motorway through all six gears, cruise, and back down. */
export function highwayDrive(drive: Drive): Drive {
  return drive
    .launch(24)
    .shift(2)
    .inGear(2, 45, 5)
    .shift(3)
    .inGear(3, 65, 4)
    .shift(4)
    .inGear(4, 85, 3)
    .cruise(4, 8)
    .shift(5)
    .inGear(5, 100, 2)
    .cruise(5, 15)
    .shift(6)
    .inGear(6, 118, 1.5)
    .cruise(6, 60)
    .shift(5)
    .inGear(5, 80, -3)
    .cruise(5, 10)
    .shift(4)
    .inGear(4, 60, -3)
    .shift(3)
    .stop(3);
}
