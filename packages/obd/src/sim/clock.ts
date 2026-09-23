/**
 * Drives a {@link VehicleSimulator} in real time for the server's simulator mode: every
 * `stepMs` it advances the simulation by the wall-clock time that actually elapsed (scaled by
 * `timeScale`), so a stalled event loop does not slow the simulated car down, while a long
 * pause (host suspended) is capped at `maxStepMs` instead of teleporting the car.
 */
import { SYSTEM_TIMERS, type Timers } from '../runtime.ts';
import type { VehicleSimulator } from './vehicle-sim.ts';

export interface SimulationClockOptions {
  /** Tick period. Default 50 ms. */
  stepMs?: number;
  /** Simulated milliseconds per real millisecond. Default 1. */
  timeScale?: number;
  /** Longest real interval credited to one tick. Default 1000 ms. */
  maxStepMs?: number;
  /** Monotonic clock in ms. Default `performance.now()`. */
  now?: () => number;
  timers?: Timers;
}

export class SimulationClock {
  private readonly sim: VehicleSimulator;
  private readonly stepMs: number;
  private readonly timeScale: number;
  private readonly maxStepMs: number;
  private readonly now: () => number;
  private readonly timers: Timers;
  private handle: unknown = null;
  private last = 0;

  constructor(sim: VehicleSimulator, options: SimulationClockOptions = {}) {
    this.sim = sim;
    this.stepMs = Math.max(1, options.stepMs ?? 50);
    this.timeScale = Math.max(0, options.timeScale ?? 1);
    this.maxStepMs = Math.max(this.stepMs, options.maxStepMs ?? 1000);
    this.now = options.now ?? (() => performance.now());
    this.timers = options.timers ?? SYSTEM_TIMERS;
  }

  get running(): boolean {
    return this.handle !== null;
  }

  start(): void {
    if (this.handle !== null) return;
    this.last = this.now();
    this.schedule();
  }

  stop(): void {
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
  }

  private schedule(): void {
    this.handle = this.timers.setTimeout(() => this.tick(), this.stepMs);
  }

  private tick(): void {
    if (this.handle === null) return;
    const now = this.now();
    const elapsed = Math.min(Math.max(0, now - this.last), this.maxStepMs);
    this.last = now;
    this.sim.step(elapsed * this.timeScale);
    if (this.handle !== null) this.schedule();
  }
}
