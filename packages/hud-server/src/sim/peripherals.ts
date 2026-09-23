/**
 * Simulated peripherals other than the phone: the ambient light sensor ("sim-env") and an ADAS
 * module ("sim-adas"), both controlled from the dev console through SimControl.
 */
import type { CollisionLevel, SimControl } from '@carheadsup/core';
import type { EventSource, SourceContext } from '../sources/types.ts';

/** Overcast daylight, the VehicleSimulator's default. */
export const DEFAULT_SIM_LUX = 20_000;
/** The simulated light sensor reports this often (a real one runs at ~5 Hz). */
export const SIM_LUX_PERIOD_MS = 500;
/** Active ADAS warnings are repeated this often so they stay fresh (core expires them after 1 s). */
export const SIM_ADAS_REPEAT_MS = 200;

/** Simulated ambient light sensor: emits `sensor/light` periodically and on every change. */
export class SimEnvironment implements EventSource {
  readonly name = 'sim-env';
  private luxValue: number;
  private ctx: SourceContext | null = null;
  private timer: unknown = null;

  constructor(lux = DEFAULT_SIM_LUX) {
    this.luxValue = Number.isFinite(lux) && lux >= 0 ? lux : DEFAULT_SIM_LUX;
  }

  get lux(): number {
    return this.luxValue;
  }

  /** Override the simulated illuminance (ignored unless finite; negative clamps to 0). */
  setLux(lux: number): void {
    if (!Number.isFinite(lux)) return;
    this.luxValue = Math.max(0, lux);
    if (this.ctx !== null) this.report();
  }

  async start(ctx: SourceContext): Promise<void> {
    if (this.ctx !== null) return;
    this.ctx = ctx;
    this.report();
  }

  async stop(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx !== null && this.timer !== null) ctx.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private report(): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    if (this.timer !== null) ctx.timers.clearTimeout(this.timer);
    ctx.emit({ type: 'sensor/light', lux: this.luxValue, at: ctx.now() });
    this.timer = ctx.timers.setTimeout(() => {
      this.timer = null;
      this.report();
    }, SIM_LUX_PERIOD_MS);
  }
}

const COLLISION_LEVELS: readonly CollisionLevel[] = ['none', 'caution', 'warning'];

/** Time to collision reported with each simulated level. */
export const SIM_TTC_SECONDS: Readonly<Record<CollisionLevel, number | null>> = {
  none: null,
  caution: 2.8,
  warning: 1.2,
};

export interface SimAdasState {
  blindSpotLeft: boolean;
  blindSpotRight: boolean;
  collision: CollisionLevel;
}

/**
 * Simulated ADAS module: connected while running; blind-spot and collision warnings set from
 * the dev console are re-sent every 200 ms while active and cleared with one final message.
 */
export class SimAdas implements EventSource {
  readonly name = 'sim-adas';
  private readonly current: SimAdasState = {
    blindSpotLeft: false,
    blindSpotRight: false,
    collision: 'none',
  };
  private ctx: SourceContext | null = null;
  private timer: unknown = null;

  get state(): SimAdasState {
    return { ...this.current };
  }

  async start(ctx: SourceContext): Promise<void> {
    if (this.ctx !== null) return;
    this.ctx = ctx;
    ctx.emit({ type: 'adas/link', connected: true, at: ctx.now() });
    this.repeat();
  }

  async stop(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx !== null && this.timer !== null) ctx.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Apply SimControl.adas; fields left out keep their value, invalid values are ignored. */
  apply(adas: NonNullable<SimControl['adas']>): void {
    let blindSpotChanged = false;
    let collisionChanged = false;
    if (typeof adas.blindSpotLeft === 'boolean') {
      this.current.blindSpotLeft = adas.blindSpotLeft;
      blindSpotChanged = true;
    }
    if (typeof adas.blindSpotRight === 'boolean') {
      this.current.blindSpotRight = adas.blindSpotRight;
      blindSpotChanged = true;
    }
    if (adas.collision !== undefined && COLLISION_LEVELS.includes(adas.collision)) {
      this.current.collision = adas.collision;
      collisionChanged = true;
    }
    const ctx = this.ctx;
    if (ctx === null) return;
    // Report changes (including clears) right away, then keep active warnings fresh.
    if (blindSpotChanged) this.emitBlindSpot(ctx);
    if (collisionChanged) this.emitCollision(ctx);
    if (this.timer !== null) ctx.timers.clearTimeout(this.timer);
    this.timer = null;
    this.schedule(ctx);
  }

  private get blindSpotActive(): boolean {
    return this.current.blindSpotLeft || this.current.blindSpotRight;
  }

  private repeat(): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    if (this.blindSpotActive) this.emitBlindSpot(ctx);
    if (this.current.collision !== 'none') this.emitCollision(ctx);
    this.schedule(ctx);
  }

  private schedule(ctx: SourceContext): void {
    if (!this.blindSpotActive && this.current.collision === 'none') return;
    this.timer = ctx.timers.setTimeout(() => {
      this.timer = null;
      this.repeat();
    }, SIM_ADAS_REPEAT_MS);
  }

  private emitBlindSpot(ctx: SourceContext): void {
    ctx.emit({
      type: 'adas/blind-spot',
      left: this.current.blindSpotLeft,
      right: this.current.blindSpotRight,
      at: ctx.now(),
    });
  }

  private emitCollision(ctx: SourceContext): void {
    const level = this.current.collision;
    ctx.emit({ type: 'adas/collision', level, ttcSeconds: SIM_TTC_SECONDS[level], at: ctx.now() });
  }
}
