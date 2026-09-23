import type { RoadInfo } from '../../src/types/nav.ts';
import type { Harness, SignalValues } from '../state/fixtures.ts';

/**
 * A tiny vehicle model that turns "drive towards this speed" into a consistent OBD sample
 * stream: speed quantised like PID 0x0D, rpm from a manual gearbox (highest gear that keeps
 * the engine above 1500 rpm), plus coolant, voltage, fuel and ambient readings. Every step
 * sends one sample batch and one clock tick, like the server's poll loop.
 */
export const SCENARIO_RATIOS = [120, 70, 48, 36, 29, 24];
export const STEP_MS = 200;
/** The companion app re-sends the current road this often while it has location fixes. */
export const ROAD_REFRESH_MS = 30_000;

export type EngineState = 'off' | 'cranking' | 'running' | 'stopped';

export class DriveScript {
  readonly h: Harness;
  speedKph = 0;
  engine: EngineState = 'off';
  coolantC = 18;
  voltage = 12.6;
  fuelLevelPct = 55;
  ambientC = 2;
  /** The road the phone reports, re-sent every {@link ROAD_REFRESH_MS} like the companion. */
  private road: RoadInfo | null = null;
  private roadSentAt = 0;

  constructor(harness: Harness) {
    this.h = harness;
  }

  /** The phone reports a new road (speed limit) now and keeps refreshing it. */
  setRoad(road: RoadInfo): void {
    this.road = road;
    this.sendRoad();
  }

  private sendRoad(): void {
    if (this.road === null) return;
    this.h.send({ type: 'road/update', road: this.road, at: this.now });
    this.roadSentAt = this.now;
  }

  get now(): number {
    return this.h.now;
  }

  /** Current gear of the model (1-based), or null when crawling / stationary. */
  gear(speed = Math.round(this.speedKph)): number | null {
    if (speed < 5) return null;
    for (let g = SCENARIO_RATIOS.length; g >= 1; g--) {
      const ratio = SCENARIO_RATIOS[g - 1] ?? 0;
      if (ratio * speed >= 1500) return g;
    }
    return 1;
  }

  /**
   * Advance to `until`, moving the speed towards `targetKph` at `accel` km/h per second.
   * `each` runs after every step (for gradual changes and assertions).
   */
  go(until: number, targetKph: number, accel = 4, each?: (at: number) => void): void {
    for (let at = this.now + STEP_MS; at <= until; at += STEP_MS) {
      const dv = (accel * STEP_MS) / 1000;
      this.speedKph =
        this.speedKph < targetKph
          ? Math.min(targetKph, this.speedKph + dv)
          : Math.max(targetKph, this.speedKph - dv);
      this.h.samples(at, this.signals());
      this.h.tick(at);
      if (this.road !== null && at - this.roadSentAt >= ROAD_REFRESH_MS) this.sendRoad();
      each?.(at);
    }
  }

  /** Keep driving at `targetKph` until `done()` holds (checked every step), at most `maxMs`. */
  until(
    done: () => boolean,
    targetKph: number,
    maxMs = 600_000,
    each?: (at: number) => void,
  ): void {
    const deadline = this.now + maxMs;
    while (!done()) {
      if (this.now >= deadline) throw new Error('drive script: condition never met');
      this.go(this.now + STEP_MS, targetKph, 4, each);
    }
  }

  signals(): SignalValues {
    if (this.engine === 'off') return { batteryVoltage: this.voltage };
    const speed = Math.round(this.speedKph);
    const gear = this.gear(speed);
    const ratio = gear === null ? 0 : (SCENARIO_RATIOS[gear - 1] ?? 0);
    const rpm =
      this.engine === 'cranking'
        ? 220
        : this.engine === 'stopped'
          ? 0
          : Math.max(850, ratio * speed);
    return {
      speed,
      rpm,
      coolantTemp: this.coolantC,
      batteryVoltage: this.voltage,
      fuelLevel: this.fuelLevelPct,
      ambientTemp: this.ambientC,
      intakeAirTemp: 25,
      maf: rpm / 150,
    };
  }
}
