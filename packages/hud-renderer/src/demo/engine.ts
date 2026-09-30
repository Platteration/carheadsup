import { DEFAULT_CONFIG, EMPTY_PERSISTED_STATE, mergeConfig } from '@carheadsup/core';
import type {
  DeepPartial,
  HudConfig,
  HudFrame,
  HudState,
  HudToPhone,
  InputAction,
  SimControl,
  SimStatus,
} from '@carheadsup/core';
import { HudEngine } from '@carheadsup/hud-server/engine';
import type { FrameListener } from '@carheadsup/hud-server/engine';
import { createSimulation } from '@carheadsup/hud-server/sim';
import type { Simulation, SourceContext } from '@carheadsup/hud-server/sim';
import { SILENT_LOGGER, SYSTEM_CLOCK, SYSTEM_TIMERS } from '@carheadsup/obd/runtime';
import type { Clock, Logger, Timers } from '@carheadsup/obd/runtime';
import { DEMO_SCENARIO } from '@carheadsup/obd/sim';
import { SimulatedObd } from './obd-feed.ts';

/**
 * What the demo changes from the defaults: the simulated car has TPMS, and its OBD data comes
 * from the simulator (as with `--sim`).
 */
export const DEMO_CONFIG_PATCH: DeepPartial<HudConfig> = {
  obd: { transport: 'simulator' },
  vehicle: { hasTpms: true },
};

export interface DemoEngineOptions {
  /** Merged over the demo defaults (e.g. remembered units or layout). */
  config?: DeepPartial<HudConfig>;
  /** Wall clock, epoch ms. Default `Date.now`. */
  now?: Clock;
  /** Monotonic ms the engine time follows. Default `performance.now()`. */
  monotonic?: Clock;
  timers?: Timers;
  logger?: Logger;
}

/** Where the scripted drive is. */
export interface ScriptProgress {
  /** Scenario step name ('warm-up', 'city' …). */
  step: string;
  /** 0-based position in the script. */
  index: number;
  count: number;
  /** Seconds into the step (simulated time). */
  elapsedS: number;
  durationS: number;
}

export interface DemoStatus extends SimStatus {
  /** Null while driving manually. */
  script: ScriptProgress | null;
}

/**
 * The whole HUD running in the browser, no server: the server's own engine ({@link HudEngine}:
 * the core reducer, effects and composer, a tick every 100 ms, frames at `server.frameRate`)
 * and its simulation (the VehicleSimulator on the demo scenario, the scenario-synced phone, a
 * light sensor and an ADAS module), stepped in real time. The car's OBD data reaches the engine
 * through {@link SimulatedObd}, which stands in for the adapter and poller. Messages the HUD
 * sends to the phone (accepting or declining a call) go to the simulated phone.
 */
export class DemoEngine {
  readonly simulation: Simulation;
  private readonly engine: HudEngine;
  private readonly obd: SimulatedObd;
  private readonly ctx: SourceContext;
  private readonly logger: Logger;
  private readonly unsubscribeStep: () => void;
  private stepStart = { index: 0, timeS: 0 };
  private state: 'idle' | 'running' | 'stopped' = 'idle';

  constructor(options: DemoEngineOptions = {}) {
    const now = options.now ?? SYSTEM_CLOCK;
    const timers = options.timers ?? SYSTEM_TIMERS;
    this.logger = options.logger ?? SILENT_LOGGER;
    const config = demoConfig(options.config);
    const deps = { now, timers, logger: this.logger };
    this.simulation = createSimulation(config, deps);
    const simulation = this.simulation;
    this.engine = new HudEngine({
      config,
      persisted: EMPTY_PERSISTED_STATE,
      simulated: true,
      now,
      ...(options.monotonic !== undefined ? { monotonic: options.monotonic } : {}),
      timers,
      logger: this.logger,
      outputs: {
        sendToPhone: (message: HudToPhone) => simulation.deliverToPhone(message),
        // Nothing is kept between visits: trips and the odometer live only as long as the page.
        saveTrip: async () => undefined,
        savePersisted: async () => undefined,
      },
    });
    const dispatch = this.engine.dispatch.bind(this.engine);
    this.ctx = { ...deps, emit: dispatch };
    this.obd = new SimulatedObd({ vehicle: simulation.vehicle, emit: dispatch, now, timers });
    this.unsubscribeStep = simulation.vehicle.onStep((_step, { index }) => {
      this.stepStart = { index, timeS: simulation.vehicle.snapshot().timeS };
    });
  }

  /**
   * Start the OBD feed, the simulation clock and the simulated peripherals, then the engine: its
   * first frame (published at once) already has the car and the phone connected.
   */
  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.obd.start();
    this.simulation.start();
    for (const source of this.simulation.sources) {
      source.start(this.ctx).catch((err: unknown) => {
        this.logger.error(`${source.name}: failed to start: ${String(err)}`);
      });
    }
    this.engine.start();
  }

  /** Stop everything (the engine cannot be restarted). */
  stop(): void {
    if (this.state === 'stopped') return;
    const wasRunning = this.state === 'running';
    this.state = 'stopped';
    this.unsubscribeStep();
    if (!wasRunning) return;
    for (const source of this.simulation.sources) void source.stop();
    void this.simulation.stop();
    this.obd.stop();
    void this.engine.stop();
  }

  /** Subscribe to composed frames; returns the unsubscribe function. */
  onFrame(listener: FrameListener): () => void {
    return this.engine.onFrame(listener);
  }

  /** The latest frame. */
  get frame(): HudFrame {
    return this.engine.frame;
  }

  get hudState(): HudState {
    return this.engine.state;
  }

  get config(): HudConfig {
    return this.engine.config;
  }

  /** A driver input, as from the steering-wheel buttons. */
  input(action: InputAction): void {
    this.engine.dispatch({ type: 'input', action, at: this.engine.now() });
  }

  /** Drive the simulation: pedals, engine, faults, light, phone and ADAS events. */
  control(control: SimControl): DemoStatus {
    this.simulation.control(control);
    return this.status();
  }

  /** Start the scripted drive again from the beginning (also from manual driving). */
  restartDrive(): DemoStatus {
    if (this.simulation.status().mode === 'scenario') this.simulation.vehicle.restartScenario();
    else this.simulation.control({ mode: 'scenario' });
    return this.status();
  }

  /**
   * Change the HUD's config (units, layout, shift light …) the way the settings app does: merged
   * and validated with `mergeConfig`, then applied with a `config` event. Returns the fields that
   * were rejected (left unchanged).
   */
  configure(patch: DeepPartial<HudConfig>): string[] {
    const { config, errors } = mergeConfig(this.engine.config, patch);
    this.engine.setConfig(config);
    return errors;
  }

  status(): DemoStatus {
    const status = this.simulation.status();
    return { ...status, script: status.mode === 'scenario' ? this.progress() : null };
  }

  private progress(): ScriptProgress | null {
    const { index, timeS } = this.stepStart;
    const step = DEMO_SCENARIO[index];
    if (step === undefined) return null;
    const elapsedS = Math.max(0, this.simulation.vehicle.snapshot().timeS - timeS);
    return {
      step: step.name,
      index,
      count: DEMO_SCENARIO.length,
      elapsedS: Math.min(elapsedS, step.durationS),
      durationS: step.durationS,
    };
  }
}

/** The demo's config: the defaults, the demo's changes and then `patch`, validated. */
export function demoConfig(patch: DeepPartial<HudConfig> = {}): HudConfig {
  const base = mergeConfig(DEFAULT_CONFIG, DEMO_CONFIG_PATCH).config;
  return mergeConfig(base, patch).config;
}
