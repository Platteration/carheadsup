import type {
  HudConfig,
  HudEvent,
  HudFrame,
  HudToPhone,
  PhoneToHud,
  SimControl,
  SimStatus,
} from '@carheadsup/core';
import type { Clock, Logger, Timers, VehicleSimulator } from '@carheadsup/obd';

/**
 * Seams between the server core (engine, HTTP/WebSocket, persistence) and the pluggable
 * inputs/outputs (sensors, GPIO, ADAS, simulator, backlight, mDNS). Everything that produces
 * HudEvents is an EventSource; everything driven by composed frames is a FrameSink.
 */

/** Runtime services handed to sources and sinks (injectable for tests). */
export interface RuntimeDeps {
  now: Clock;
  timers: Timers;
  logger: Logger;
}

export interface SourceContext extends RuntimeDeps {
  /** Feed an event into the engine. The engine re-stamps `at` with its own clock. */
  emit(event: HudEvent): void;
}

export interface EventSource {
  readonly name: string;
  start(ctx: SourceContext): Promise<void>;
  stop(): Promise<void>;
  /** Called after the config changes; a source may reconfigure or restart itself. */
  updateConfig?(config: HudConfig): void | Promise<void>;
}

/** An output driven by every composed frame (e.g. the display backlight). */
export interface FrameSink {
  readonly name: string;
  onFrame(frame: HudFrame): void;
  stop(): Promise<void>;
}

/** A long-running side service with no event output (e.g. mDNS advertisement). */
export interface Service {
  readonly name: string;
  stop(): Promise<void>;
}

/**
 * Everything the server needs to run against simulated inputs (`--sim`).
 * The vehicle is handed to `new ObdService(config.obd, { simulator: sim.vehicle })` with
 * `obd.transport = 'simulator'`; `start()` steps it in real time.
 */
export interface Simulation {
  readonly vehicle: VehicleSimulator;
  /** Simulated phone (scenario-synced navigation, media, calls, messages), light sensor, ADAS. */
  readonly sources: EventSource[];
  /**
   * Apply a SimControl from POST /api/sim: vehicle fields go to the VehicleSimulator, `phone`,
   * `adas`, `lux`, `ambientTempC` and `tirePressuresKpa` to the simulated peripherals.
   */
  control(control: SimControl): SimStatus;
  status(): SimStatus;
  /** Messages the HUD sends to "the phone" (e.g. call-action accept) reach the simulated phone. */
  deliverToPhone(message: HudToPhone): void;
  start(): void;
  stop(): Promise<void>;
}

/** Type of the phone-message translator shared by real and simulated phones. */
export type PhoneMessageTranslator = (message: PhoneToHud, now: number) => HudEvent[];
