/**
 * Scripted demo drive for the simulator's 'scenario' mode, plus the speed-tracking "driver"
 * that turns each step's target speed into throttle and brake.
 */
import { clamp } from './model.ts';

export interface ScenarioStep {
  /** Stable name the server keys phone events on ('city', 'highway' …). */
  name: string;
  durationS: number;
  engineRunning: boolean;
  /** Target speed (km/h) at `t` seconds into the step. */
  targetKph: (t: number) => number;
  /** Acceleration used to approach a higher target (m/s²). Default 1.8. */
  accelMps2?: number;
  /** Deceleration used to approach a lower target (m/s²). Default 2.2. */
  decelMps2?: number;
}

/**
 * Seconds the demo stands with the engine off at the end of each loop. The simulated phone
 * opens the diagnostics dashboard with the companion app's remote as the step begins, so it
 * shows for all of it — the HUD's own parked dashboard would need minutes with the engine off
 * (`display.context.engineOffParkedAfterMs`, start-stop protection).
 */
export const DEMO_PARKED_S = 40;

/**
 * The looping demo, about 5 minutes: start-up, a city stretch, a red light, an on-ramp, highway
 * cruising, the exit, arriving (~4.3 min of driving) and {@link DEMO_PARKED_S} standing with the
 * engine off.
 */
export const DEMO_SCENARIO: readonly ScenarioStep[] = Object.freeze([
  { name: 'warm-up', durationS: 20, engineRunning: true, targetKph: () => 0 },
  {
    name: 'city',
    durationS: 55,
    engineRunning: true,
    targetKph: (t: number) => (t < 30 ? 50 : t < 42 ? 35 : 50),
  },
  { name: 'red-light', durationS: 25, engineRunning: true, targetKph: () => 0, decelMps2: 2.5 },
  { name: 'on-ramp', durationS: 20, engineRunning: true, targetKph: () => 100, accelMps2: 3.2 },
  {
    name: 'highway',
    durationS: 90,
    engineRunning: true,
    targetKph: (t: number) => (t < 45 ? 115 : t < 60 ? 105 : 120),
    accelMps2: 1.2,
    decelMps2: 1.0,
  },
  {
    name: 'exit',
    durationS: 20,
    engineRunning: true,
    targetKph: (t: number) => (t < 8 ? 70 : 45),
    decelMps2: 2,
  },
  {
    name: 'arriving',
    durationS: 30,
    engineRunning: true,
    targetKph: (t: number) => (t < 18 ? 30 : 0),
  },
  { name: 'parked', durationS: DEMO_PARKED_S, engineRunning: false, targetKph: () => 0 },
]);

export interface DriverCommand {
  throttle: number;
  brake: number;
}

/**
 * A simple PI speed controller with feed-forward for road load and the planned
 * acceleration. `reset` re-anchors the planned speed at the current speed (new step).
 */
export class SpeedController {
  private plannedMps = 0;
  private integral = 0;

  reset(currentMps: number): void {
    this.plannedMps = currentMps;
    this.integral = 0;
  }

  update(step: ScenarioStep, tS: number, speedMps: number, dtS: number): DriverCommand {
    const target = Math.max(0, step.targetKph(tS)) / 3.6;
    const previous = this.plannedMps;
    if (target > this.plannedMps) {
      this.plannedMps = Math.min(target, this.plannedMps + (step.accelMps2 ?? 1.8) * dtS);
    } else {
      this.plannedMps = Math.max(target, this.plannedMps - (step.decelMps2 ?? 2.2) * dtS);
    }
    if (target === 0 && this.plannedMps === 0 && speedMps < 0.5) {
      this.integral = 0;
      return { throttle: 0, brake: 0.35 }; // hold the car at a standstill
    }
    const plannedAccel = dtS > 0 ? (this.plannedMps - previous) / dtS : 0;
    const plannedKph = this.plannedMps * 3.6;
    const error = this.plannedMps - speedMps;
    this.integral = clamp(this.integral + 0.05 * error * dtS, -0.25, 0.25);
    const roadLoad = 0.02 + 0.0011 * plannedKph + 0.000012 * plannedKph * plannedKph;
    const u = roadLoad + 0.13 * plannedAccel + 0.3 * error + this.integral;
    return {
      throttle: clamp(u, 0, 1),
      brake: u < -0.04 ? clamp(-u, 0, 1) : 0,
    };
  }
}
