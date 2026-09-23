/**
 * Deterministic vehicle simulation behind the ELM327 emulator (`npm run sim`, the dev console
 * and tests). Time only advances through {@link VehicleSimulator.step} with an explicit dt —
 * there are no internal timers or random numbers — so identical inputs give identical output.
 *
 * Model: longitudinal dynamics (engine torque curve through a torque converter or slipping
 * clutch and a six-speed gearbox, aero drag, rolling resistance, brakes, rotating-mass factor,
 * traction limit), automatic shift schedule or a held gear, engine air flow (MAP, MAF, load),
 * fuel consumption with deceleration fuel cut-off, and first-order thermal models for coolant
 * (with a thermostat), oil, intake air, catalyst and tyres.
 */
import { isValidDtc, normalizeDtc } from '@carheadsup/core';
import type { SimControl, SimDriveMode, SimVehicleStatus } from '@carheadsup/core';
import {
  GEAR_COUNT,
  GRAVITY_MPS2,
  VEHICLE_MODEL as M,
  airFractionForThrottle,
  approach,
  clamp,
  frictionTorqueNm,
  overallRatio,
  wotTorqueNm,
} from './model.ts';
import { DEMO_SCENARIO, SpeedController, type ScenarioStep } from './scenario.ts';

export interface TirePressures {
  fl: number;
  fr: number;
  rl: number;
  rr: number;
}

export interface VehicleSimulatorOptions {
  /** Default 'scenario' (the looping demo drive). */
  mode?: SimDriveMode;
  /** Default 18 °C. */
  ambientTempC?: number;
  /** Initial coolant/oil temperature; default = ambient (cold start). */
  engineTempC?: number;
  /** Default 64 %. */
  fuelLevelPct?: number;
  /** Default 48 213.4 km. */
  odometerKm?: number;
  /** Default true. */
  engineRunning?: boolean;
  /** Simulated ambient light, default 20 000 lux (overcast daylight). */
  lux?: number;
  /** Tyre pressures (kPa gauge); null = no TPMS. Default 235/235/230/230. */
  tirePressuresKpa?: TirePressures | null;
  /** Default "1HGCM82633A004352" (a commonly used example VIN). */
  vin?: string;
  /** Replace the demo script. */
  scenario?: readonly ScenarioStep[];
}

/** Every simulated quantity, in canonical units. */
export interface VehicleSnapshot {
  timeS: number;
  mode: SimDriveMode;
  scenarioStep: string | null;
  engineRunning: boolean;
  /** Effective pedal inputs (scripted in scenario mode), 0–1. */
  throttle: number;
  brake: number;
  /** Engaged gear, 0 = neutral. */
  gear: number;
  /** Gear held by the driver, null = automatic shifting. */
  heldGear: number | null;
  /** Overall gearbox ratio of the engaged gear (0 in neutral). */
  gearRatio: number;
  speedKph: number;
  rpm: number;
  coolantTempC: number;
  oilTempC: number;
  intakeAirTempC: number;
  catalystTempC: number;
  ambientTempC: number;
  baroKpa: number;
  mapKpa: number;
  mafGps: number;
  /** Absolute throttle position (PID 0x11), %. */
  throttlePct: number;
  /** Relative throttle position (PID 0x45), %. */
  relativeThrottlePct: number;
  /** Accelerator pedal position D (PID 0x49), %. */
  pedalPct: number;
  engineLoadPct: number;
  absoluteLoadPct: number;
  timingAdvanceDeg: number;
  commandedLambda: number;
  fuelRateLph: number;
  fuelLevelPct: number;
  /** Fuel system status (PID 0x03 byte A): 1 open loop cold, 2 closed loop, 4 open loop (load / fuel cut). */
  fuelSystemStatus: number;
  shortFuelTrimPct: number;
  longFuelTrimPct: number;
  ethanolPct: number;
  batteryVoltage: number;
  controlModuleVoltage: number;
  odometerKm: number;
  runTimeS: number;
  distanceSinceClearKm: number;
  distanceWithMilKm: number;
  milOn: boolean;
  dtcs: { stored: string[]; pending: string[]; permanent: string[] };
  tirePressuresKpa: TirePressures | null;
  lux: number;
}

export type ScenarioStepListener = (step: string, info: { index: number; loop: number }) => void;

const DEFAULT_TYRES: TirePressures = { fl: 235, fr: 235, rl: 230, rr: 230 };
const DEFAULT_VIN = '1HGCM82633A004352';
/** Integration step; larger dt values are split into steps of at most this. */
const MAX_SUBSTEP_S = 0.02;
const SHIFT_TIME_S = 0.35;
const MIN_TIME_BETWEEN_SHIFTS_S = 1;
const WHEEL_RADIUS_M = M.tyreCircumferenceM / (2 * Math.PI);
const ATM_KPA = 101.325;
const KELVIN = 273.15;

interface Shift {
  fromRpm: number;
  remainingS: number;
}

function sanitizeCodes(codes: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of codes) {
    const code = normalizeDtc(raw);
    if (isValidDtc(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

const finiteOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback;

export class VehicleSimulator {
  readonly vin: string;
  private readonly scenario: readonly ScenarioStep[];
  private readonly stepListeners = new Set<ScenarioStepListener>();
  private readonly controller = new SpeedController();

  // Driver controls (manual mode) and overrides.
  private mode: SimDriveMode;
  private userThrottle = 0;
  private userBrake = 0;
  private userEngineRunning: boolean;
  /** The engine switch was set while the script drove (it applies once back in 'manual'). */
  private engineSwitchSetWhileScripted = false;
  private heldGear: number | null = null;
  private coolantOverride: number | null = null;
  private voltageOverride: number | null = null;
  private fuelOverride: number | null = null;
  private lux: number;
  private ambientC: number;

  // Scenario progress.
  private stepIndex = 0;
  private stepElapsedS = 0;
  private loop = 0;

  // Physical state.
  private timeS = 0;
  private engineRunning: boolean;
  private throttle = 0;
  private brake = 0;
  private speedMps = 0;
  private rpm: number;
  private gear = 1;
  private shift: Shift | null = null;
  private lastShiftS = -Infinity;
  private coolantC: number;
  private oilC: number;
  private iatC: number;
  private catalystC: number;
  private tyreTempC: number;
  private tyreRef: { pressures: TirePressures; tempC: number } | null;
  private batteryV: number;
  private fuelL: number;
  private odometerKm: number;
  private sinceClearKm = 1523.6;
  private withMilKm = 0;
  private runTimeS = 0;
  private stored: string[] = [];
  private pending: string[] = [];
  private permanent: string[] = [];

  // Derived each step.
  /** Drivetrain locked to the wheels (no converter/clutch slip) during the last step. */
  private locked = false;
  private airFraction = 0;
  private mapKpa: number = M.baroKpa;
  private mafGps = 0;
  private loadPct = 0;
  private absLoadPct = 0;
  private timingDeg = 0;
  private lambda = 1;
  private fuelRateLph = 0;
  private fuelSystemStatus = 0;
  private closedLoop = false;

  constructor(options: VehicleSimulatorOptions = {}) {
    this.scenario =
      options.scenario && options.scenario.length > 0 ? options.scenario : DEMO_SCENARIO;
    this.mode = options.mode ?? 'scenario';
    this.vin = options.vin ?? DEFAULT_VIN;
    this.ambientC = finiteOr(options.ambientTempC, 18);
    this.lux = Math.max(0, finiteOr(options.lux, 20_000));
    const engineC = finiteOr(options.engineTempC, this.ambientC);
    this.coolantC = engineC;
    this.oilC = engineC;
    this.iatC = this.ambientC;
    this.catalystC = engineC;
    this.tyreTempC = this.ambientC;
    const tyres = options.tirePressuresKpa === undefined ? DEFAULT_TYRES : options.tirePressuresKpa;
    this.tyreRef = tyres ? { pressures: { ...tyres }, tempC: this.ambientC } : null;
    this.fuelL = (clamp(finiteOr(options.fuelLevelPct, 64), 0, 100) / 100) * M.tankCapacityL;
    this.odometerKm = Math.max(0, finiteOr(options.odometerKm, 48_213.4));
    const running = options.engineRunning ?? true;
    this.userEngineRunning = running;
    this.engineRunning =
      this.mode === 'scenario' ? (this.currentStep()?.engineRunning ?? running) : running;
    this.rpm = this.engineRunning ? this.idleTargetRpm() : 0;
    this.batteryV = this.engineRunning ? 14.2 : 12.6;
    this.updateDerived(0, false);
  }

  // -------------------------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------------------------

  /**
   * Apply the vehicle-side fields of a SimControl. Phone and ADAS fields are not vehicle
   * state and are ignored here (the server handles them). In 'scenario' mode the script
   * drives throttle, brake and the engine; the values set here apply once back in 'manual'.
   */
  setControls(control: SimControl): void {
    // The mode first, so that a control switching to 'manual' and setting the engine or pedals
    // at once gets exactly those values.
    if (control.mode !== undefined && control.mode !== this.mode) {
      this.mode = control.mode;
      if (control.mode === 'scenario') {
        this.restartScenario();
      } else if (!this.engineSwitchSetWhileScripted) {
        // Nobody touched the switch while scripted: carry on as the script left the engine.
        this.userEngineRunning = this.engineRunning;
      }
      this.engineSwitchSetWhileScripted = false;
    }
    if (control.throttle !== undefined && Number.isFinite(control.throttle)) {
      this.userThrottle = clamp(control.throttle, 0, 1);
    }
    if (control.brake !== undefined && Number.isFinite(control.brake)) {
      this.userBrake = clamp(control.brake, 0, 1);
    }
    if (control.engineRunning !== undefined) {
      this.userEngineRunning = control.engineRunning;
      if (this.mode === 'scenario') this.engineSwitchSetWhileScripted = true;
    }
    if (control.gear !== undefined) {
      this.heldGear =
        control.gear === null || !Number.isFinite(control.gear)
          ? null
          : clamp(Math.round(control.gear), 0, GEAR_COUNT);
    }
    if (control.dtcs !== undefined) this.stored = sanitizeCodes(control.dtcs);
    if (control.coolantOverrideC !== undefined) {
      this.coolantOverride = nullableFinite(control.coolantOverrideC);
    }
    if (control.voltageOverrideV !== undefined) {
      this.voltageOverride = nullableFinite(control.voltageOverrideV);
    }
    if (control.fuelLevelOverridePct !== undefined) {
      const pct = nullableFinite(control.fuelLevelOverridePct);
      this.fuelOverride = pct === null ? null : clamp(pct, 0, 100);
    }
    if (control.lux !== undefined && Number.isFinite(control.lux))
      this.lux = Math.max(0, control.lux);
    if (control.ambientTempC !== undefined && Number.isFinite(control.ambientTempC)) {
      this.ambientC = control.ambientTempC;
    }
    if (control.tirePressuresKpa !== undefined) {
      const tyres = control.tirePressuresKpa;
      this.tyreRef = tyres ? { pressures: { ...tyres }, tempC: this.tyreTempC } : null;
    }
  }

  /** Restart the demo script from its first step (scenario mode only). */
  restartScenario(): void {
    this.stepIndex = 0;
    this.stepElapsedS = 0;
    this.loop = 0;
    this.controller.reset(this.speedMps);
    this.notifyStep();
  }

  /** Replace the injected trouble codes by kind (SimControl.dtcs only sets stored codes). */
  setDtcs(codes: { stored?: string[]; pending?: string[]; permanent?: string[] }): void {
    if (codes.stored) this.stored = sanitizeCodes(codes.stored);
    if (codes.pending) this.pending = sanitizeCodes(codes.pending);
    if (codes.permanent) this.permanent = sanitizeCodes(codes.permanent);
  }

  /**
   * Service 04: clear stored and pending codes (permanent codes stay until the ECU's
   * monitors pass). Refused (false) while the car is moving, like a real ECU.
   */
  clearDtcs(): boolean {
    if (this.speedMps * 3.6 > 1) return false;
    this.stored = [];
    this.pending = [];
    this.sinceClearKm = 0;
    this.withMilKm = 0;
    return true;
  }

  /** Subscribe to scenario step changes; returns an unsubscribe function. */
  onStep(listener: ScenarioStepListener): () => void {
    this.stepListeners.add(listener);
    return () => {
      this.stepListeners.delete(listener);
    };
  }

  // -------------------------------------------------------------------------------------------
  // Output
  // -------------------------------------------------------------------------------------------

  /**
   * Status for the dev console. In manual mode the pedals and engine switch are the commanded
   * values (so a POST of controls reads back immediately); in scenario mode they are the
   * script's current inputs. The overrides and tyre pressures are reported as set.
   */
  status(): SimVehicleStatus {
    const manual = this.mode === 'manual';
    return {
      mode: this.mode,
      throttle: round(manual ? this.userThrottle : this.throttle, 3),
      brake: round(manual ? this.userBrake : this.brake, 3),
      engineRunning: manual ? this.userEngineRunning : this.engineRunning,
      gear: this.gear,
      speedKph: round(this.speedMps * 3.6, 1),
      rpm: Math.round(this.rpm),
      dtcs: [...this.stored],
      lux: this.lux,
      ambientTempC: this.ambientC,
      scenarioStep: this.mode === 'scenario' ? (this.currentStep()?.name ?? null) : null,
      coolantOverrideC: this.coolantOverride,
      voltageOverrideV: this.voltageOverride,
      fuelLevelOverridePct: this.fuelOverride,
      tirePressuresKpa: this.tyreRef === null ? null : { ...this.tyreRef.pressures },
    };
  }

  snapshot(): VehicleSnapshot {
    const battery = this.voltageOverride ?? this.batteryV;
    const fuelPct = this.fuelOverride ?? (this.fuelL / M.tankCapacityL) * 100;
    const t = this.timeS;
    const stft = this.closedLoop
      ? 2.4 * Math.sin((2 * Math.PI * t) / 1.3) + 0.8 * Math.sin((2 * Math.PI * t) / 7.1)
      : 0;
    return {
      timeS: t,
      mode: this.mode,
      scenarioStep: this.mode === 'scenario' ? (this.currentStep()?.name ?? null) : null,
      engineRunning: this.engineRunning,
      throttle: this.throttle,
      brake: this.brake,
      gear: this.gear,
      heldGear: this.heldGear,
      gearRatio: M.gearRatios[this.gear - 1] ?? 0,
      speedKph: this.speedMps * 3.6,
      rpm: this.rpm,
      coolantTempC: this.coolantOverride ?? this.coolantC,
      oilTempC: this.oilC,
      intakeAirTempC: this.iatC,
      catalystTempC: this.catalystC,
      ambientTempC: this.ambientC,
      baroKpa: M.baroKpa,
      mapKpa: this.mapKpa,
      mafGps: this.mafGps,
      throttlePct: 14 + 70 * (this.engineRunning ? Math.max(this.throttle, 0.03) : this.throttle),
      relativeThrottlePct: 100 * this.throttle,
      pedalPct: 14.5 + 66 * this.throttle,
      engineLoadPct: this.loadPct,
      absoluteLoadPct: this.absLoadPct,
      timingAdvanceDeg: this.timingDeg,
      commandedLambda: this.lambda,
      fuelRateLph: this.fuelRateLph,
      fuelLevelPct: fuelPct,
      fuelSystemStatus: this.fuelSystemStatus,
      shortFuelTrimPct: stft,
      longFuelTrimPct: this.engineRunning ? 3.1 : 0,
      ethanolPct: 10,
      batteryVoltage: battery,
      controlModuleVoltage: Math.max(0, battery - 0.2),
      odometerKm: this.odometerKm,
      runTimeS: this.runTimeS,
      distanceSinceClearKm: this.sinceClearKm,
      distanceWithMilKm: this.withMilKm,
      milOn: this.stored.length > 0,
      dtcs: {
        stored: [...this.stored],
        pending: [...this.pending],
        permanent: [...this.permanent],
      },
      tirePressuresKpa: this.tirePressures(),
      lux: this.lux,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------------------------

  /** Advance the simulation by `dtMs` milliseconds of vehicle time. */
  step(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    let remaining = dtMs / 1000;
    while (remaining > 1e-9) {
      const dt = Math.min(remaining, MAX_SUBSTEP_S);
      this.integrate(dt);
      remaining -= dt;
    }
  }

  private integrate(dt: number): void {
    this.timeS += dt;
    const command = this.driverCommand(dt);
    if (command.engineRunning !== this.engineRunning) this.setEngine(command.engineRunning);
    this.throttle = this.engineRunning ? command.throttle : 0;
    this.brake = command.brake;

    const { driveForceN, massFactor, dfco } = this.powertrain(dt);
    this.integrateSpeed(driveForceN, massFactor, dt);
    this.recoupleEngine();
    this.updateDerived(dt, dfco);
    this.updateThermal(dt);
    this.updateTotals(dt);
  }

  private driverCommand(dt: number): { throttle: number; brake: number; engineRunning: boolean } {
    if (this.mode !== 'scenario') {
      return {
        throttle: this.userThrottle,
        brake: this.userBrake,
        engineRunning: this.userEngineRunning,
      };
    }
    this.stepElapsedS += dt;
    let step = this.currentStep();
    if (step && this.stepElapsedS >= step.durationS) {
      this.stepElapsedS -= step.durationS;
      this.stepIndex += 1;
      if (this.stepIndex >= this.scenario.length) {
        this.stepIndex = 0;
        this.loop += 1;
      }
      step = this.currentStep();
      this.controller.reset(this.speedMps);
      this.notifyStep();
    }
    if (!step) return { throttle: 0, brake: 0, engineRunning: this.engineRunning };
    const command = this.controller.update(step, this.stepElapsedS, this.speedMps, dt);
    return { ...command, engineRunning: step.engineRunning };
  }

  private setEngine(running: boolean): void {
    this.engineRunning = running;
    if (running) {
      this.runTimeS = 0;
      // Starter flare before the idle controller settles.
      this.rpm = Math.max(this.rpm, this.idleTargetRpm() + 350);
    }
  }

  /** Idle speed: 750 rpm warm, raised while the coolant is cold. */
  private idleTargetRpm(): number {
    return M.idleRpm + clamp((45 - this.coolantC) * 5, 0, 300);
  }

  /** Engaged gear for this step (automatic shift schedule or the held gear). */
  private selectGear(throttle: number): void {
    if (this.heldGear !== null) {
      if (this.heldGear !== this.gear) this.startShift(this.heldGear);
      return;
    }
    const kph = this.speedMps * 3.6;
    if (this.gear === 0) this.gear = 1;
    if (kph < 3) {
      if (this.gear !== 1) {
        this.gear = 1;
        this.shift = null;
      }
      return;
    }
    if (this.shift || this.timeS - this.lastShiftS < MIN_TIME_BETWEEN_SHIFTS_S) return;
    const rpmNow = this.coupledRpm(this.gear);
    const demand = Math.pow(throttle, 1.5);
    const upshiftRpm = 1900 + 4300 * demand;
    const downshiftRpm = 1000 + 1500 * demand;
    if (this.gear < GEAR_COUNT && rpmNow > upshiftRpm) {
      this.startShift(this.gear + 1);
    } else if (this.gear > 1 && rpmNow < downshiftRpm) {
      this.startShift(this.gear - 1);
    } else if (
      throttle > 0.85 &&
      this.gear > 1 &&
      rpmNow < 3800 &&
      this.coupledRpm(this.gear - 1) < 5600
    ) {
      this.startShift(this.gear - 1); // kick-down
    }
  }

  private startShift(gear: number): void {
    this.shift =
      gear === 0 || this.gear === 0 ? null : { fromRpm: this.rpm, remainingS: SHIFT_TIME_S };
    this.gear = gear;
    this.lastShiftS = this.timeS;
  }

  private coupledRpm(gear: number): number {
    return (this.speedMps / M.tyreCircumferenceM) * 60 * overallRatio(gear);
  }

  private powertrain(dt: number): { driveForceN: number; massFactor: number; dfco: boolean } {
    this.locked = false;
    if (!this.engineRunning) {
      this.rpm = approach(this.rpm, 0, dt, 0.2);
      if (this.rpm < 20) this.rpm = 0;
      this.shift = null;
      return { driveForceN: 0, massFactor: 1.04, dfco: false };
    }

    this.selectGear(this.throttle);
    const idle = this.idleTargetRpm();
    const t = this.throttle;

    if (this.gear === 0) {
      const target = Math.min(idle + t * (M.redlineRpm - idle), M.limiterRpm);
      this.rpm = approach(this.rpm, target, dt, target > this.rpm ? 0.25 : 0.5);
      return { driveForceN: 0, massFactor: 1.04, dfco: false };
    }

    const ratio = overallRatio(this.gear);
    const coupled = this.coupledRpm(this.gear);
    const heldGear = this.heldGear !== null;
    const launchRpm = idle + t * ((heldGear ? M.clutchLaunchRpm : M.converterStallRpm) - idle);
    const locked = coupled >= launchRpm;

    let shiftFactor = 1;
    if (this.shift) {
      this.shift.remainingS -= dt;
      const progress = clamp(1 - this.shift.remainingS / SHIFT_TIME_S, 0, 1);
      this.rpm = this.shift.fromRpm + (Math.max(coupled, idle) - this.shift.fromRpm) * progress;
      shiftFactor = 0.35;
      if (this.shift.remainingS <= 0) this.shift = null;
    } else if (locked) {
      this.rpm = coupled;
    } else {
      this.rpm = approach(this.rpm, launchRpm, dt, 0.2);
    }

    const rpm = this.rpm;
    const dfco = locked && t < 0.02 && rpm > idle + 250;
    const limiter = rpm >= M.limiterRpm;
    // The torque curve is net (brake) torque at full load; indicated torque adds friction back.
    const friction = frictionTorqueNm(rpm);
    const indicated = wotTorqueNm(rpm) + friction;
    const idleAir = indicated > 0 ? Math.min(1, friction / indicated) : 0;
    const air = dfco || limiter ? 0 : Math.max(airFractionForThrottle(t), idleAir);
    const engineTorque = air * indicated - friction;
    const eta = M.drivelineEfficiency;

    let wheelTorque: number;
    if (locked || this.shift) {
      wheelTorque = engineTorque * ratio * (engineTorque > 0 ? eta : 1) * shiftFactor;
    } else if (heldGear) {
      wheelTorque = Math.max(0, engineTorque) * ratio * eta; // slipping clutch
    } else {
      const slip = clamp(1 - coupled / launchRpm, 0, 1);
      const multiplication = 1 + 0.9 * slip; // torque converter
      const creep = t < 0.02 ? 22 * clamp(1 - coupled / idle, 0, 1) : 0;
      wheelTorque = (Math.max(0, engineTorque) * multiplication + creep) * ratio * eta;
    }
    const driveForceN = clamp(wheelTorque / WHEEL_RADIUS_M, -M.tractionLimitN, M.tractionLimitN);
    // Rotating inertia (engine, gearbox, wheels) as an equivalent-mass factor.
    const massFactor = 1.03 + 0.0015 * ratio * ratio;
    this.airFraction = air;
    this.locked = locked;
    return { driveForceN, massFactor, dfco: dfco || limiter };
  }

  private integrateSpeed(driveForceN: number, massFactor: number, dt: number): void {
    const v = this.speedMps;
    const aero = 0.5 * M.airDensityKgM3 * M.dragAreaM2 * v * v;
    const rolling = M.rollingResistance * M.massKg * GRAVITY_MPS2;
    const braking = this.brake * M.massKg * M.maxBrakeDecelMps2;
    let net: number;
    if (v <= 1e-3) {
      // Standing still: rolling resistance and brakes hold the car unless the drive exceeds them.
      net = Math.max(0, driveForceN - rolling - braking);
    } else {
      net = driveForceN - aero - rolling - braking;
    }
    const accel = net / (M.massKg * massFactor);
    this.speedMps = Math.max(0, v + accel * dt);
  }

  /** Keep engine speed exactly tied to the new road speed while the drivetrain is locked. */
  private recoupleEngine(): void {
    if (this.engineRunning && this.locked && this.gear !== 0 && !this.shift) {
      this.rpm = this.coupledRpm(this.gear);
    }
  }

  private updateDerived(dt: number, dfco: boolean): void {
    if (!this.engineRunning) {
      this.mapKpa = M.baroKpa;
      this.mafGps = 0;
      this.loadPct = 0;
      this.absLoadPct = 0;
      this.timingDeg = 0;
      this.lambda = 1;
      this.fuelRateLph = 0;
      this.fuelSystemStatus = 0;
      this.closedLoop = false;
      this.airFraction = 0;
      return;
    }
    const baro = M.baroKpa;
    const air = this.airFraction;
    const map = baro * (0.22 + 0.76 * air);
    this.mapKpa = dt > 0 ? approach(this.mapKpa, map, dt, 0.05) : map;
    const iatK = this.iatC + KELVIN;
    const chargeDensity = (this.mapKpa * 1000) / (287.05 * iatK); // kg/m³
    const sweptM3PerS = ((M.displacementL / 1000) * this.rpm) / 120;
    const mafKgPerS = chargeDensity * M.volumetricEfficiency * sweptM3PerS;
    this.mafGps = mafKgPerS * 1000;
    const ambientDensity = (baro * 1000) / (287.05 * (this.ambientC + KELVIN));
    const maxMaf = ambientDensity * M.volumetricEfficiency * sweptM3PerS * 1000;
    this.loadPct = maxMaf > 0 ? clamp((100 * this.mafGps) / maxMaf, 0, 100) : 0;
    // Absolute load: air mass per intake stroke relative to a full cylinder at STP (1.184 g/L).
    const gramsPerCycle = this.rpm > 0 ? (this.mafGps * 120) / this.rpm : 0;
    this.absLoadPct = clamp((100 * gramsPerCycle) / (1.184 * M.displacementL), 0, 400);
    const loadFrac = this.loadPct / 100;
    this.timingDeg = dfco ? 5 : 8 + 26 * (1 - loadFrac) * Math.min(1, this.rpm / 2500);

    const cold = this.coolantC < 40;
    const wot = this.throttle > 0.85;
    this.closedLoop = !cold && !wot && !dfco;
    this.fuelSystemStatus = cold ? 1 : this.closedLoop ? 2 : 4;
    this.lambda = wot ? 0.87 : cold ? 0.95 : 1;
    this.fuelRateLph = dfco
      ? 0
      : ((this.mafGps / (M.stoichAfr * this.lambda)) * 3600) / M.fuelDensityGPerL;
  }

  private updateThermal(dt: number): void {
    const amb = this.ambientC;
    const kph = this.speedMps * 3.6;
    const running = this.engineRunning;

    // Coolant: combustion heat in, block losses and a thermostat-controlled radiator out.
    const heatIn = running ? 0.06 + 0.02 * this.fuelRateLph : 0;
    const blockLoss = (this.coolantC - amb) * (0.0003 + 0.000004 * kph);
    const thermostat = clamp((this.coolantC - 87) / 8, 0, 1);
    const radiator = thermostat * (this.coolantC - amb) * (0.0035 + 0.00008 * kph);
    const fan = running && this.coolantC > 100 ? 0.004 * (this.coolantC - amb) : 0;
    this.coolantC += (heatIn - blockLoss - radiator - fan) * dt;

    const loadFrac = this.loadPct / 100;
    this.oilC = running
      ? approach(this.oilC, this.coolantC + 12 * loadFrac, dt, 240)
      : approach(this.oilC, amb, dt, 2400);

    const warmth = clamp((this.coolantC - amb) / 70, 0, 1);
    const soak = warmth * 12 * Math.exp(-kph / 30) + 3;
    this.iatC = approach(this.iatC, amb + (running ? soak : soak * 0.5), dt, 60);

    this.catalystC = running
      ? approach(this.catalystC, 380 + 420 * loadFrac + 0.03 * this.rpm, dt, 40)
      : approach(this.catalystC, amb, dt, 900);

    this.tyreTempC = approach(this.tyreTempC, amb + 0.22 * kph, dt, 400);

    const targetV = running ? (this.rpm < 900 ? 14.1 : 14.2) : 12.6;
    this.batteryV = approach(this.batteryV, targetV, dt, running ? 3 : 40);
  }

  private updateTotals(dt: number): void {
    const km = (this.speedMps * dt) / 1000;
    this.odometerKm += km;
    this.sinceClearKm += km;
    if (this.stored.length > 0) this.withMilKm += km;
    if (this.engineRunning) this.runTimeS += dt;
    this.fuelL = Math.max(0, this.fuelL - (this.fuelRateLph * dt) / 3600);
  }

  private tirePressures(): TirePressures | null {
    const ref = this.tyreRef;
    if (!ref) return null;
    const factor = (this.tyreTempC + KELVIN) / (ref.tempC + KELVIN);
    const warm = (p: number): number => (p + ATM_KPA) * factor - ATM_KPA;
    return {
      fl: warm(ref.pressures.fl),
      fr: warm(ref.pressures.fr),
      rl: warm(ref.pressures.rl),
      rr: warm(ref.pressures.rr),
    };
  }

  private currentStep(): ScenarioStep | undefined {
    return this.scenario[this.stepIndex];
  }

  private notifyStep(): void {
    const step = this.currentStep();
    if (!step) return;
    for (const listener of [...this.stepListeners]) {
      listener(step.name, { index: this.stepIndex, loop: this.loop });
    }
  }
}

function nullableFinite(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : value;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
