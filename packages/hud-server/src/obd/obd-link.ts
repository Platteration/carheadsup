import { isEngineRunning } from '@carheadsup/core';
import type { HudConfig, HudEvent, HudState, ObdConfig, ObdLinkStatus } from '@carheadsup/core';
import { ObdService } from '@carheadsup/obd';
import type { ClearDtcsOutcome, ObdServiceDeps, VehicleSimulator } from '@carheadsup/obd';
import type { RuntimeDeps } from '../sources/types.ts';

/** The parts of ObdService the server uses (tests inject fakes). */
export interface ObdServiceLike {
  start(): void;
  stop(): Promise<void>;
  onEvent(cb: (event: HudEvent) => void): () => void;
  clearDtcs(): Promise<ClearDtcsOutcome>;
  updateConfig(config: ObdConfig): void;
  /** Read trouble codes at the next polling cycle (optional: test doubles may omit it). */
  requestDtcRead?(): void;
  readonly status: ObdLinkStatus;
}

export type ObdServiceFactory = (config: ObdConfig, deps: ObdServiceDeps) => ObdServiceLike;

export const createObdService: ObdServiceFactory = (config, deps) => new ObdService(config, deps);

/**
 * Why clearing trouble codes must be refused right now, or null when it is allowed: only while
 * the driving context is 'parked' and the engine is not running (a car being driven must never
 * have its emission monitors reset; many ECUs also refuse service 04 with the engine on).
 */
export function clearDtcsRefusal(state: HudState): string | null {
  if (state.context.context !== 'parked') {
    return 'Trouble codes can only be cleared while parked.';
  }
  if (isEngineRunning(state)) {
    return 'Switch the engine off (ignition on) before clearing trouble codes.';
  }
  return null;
}

export interface ObdLinkOptions {
  /** Effective config (with runtime overrides such as `--sim`). */
  config: HudConfig;
  /** The simulation's vehicle in `--sim` mode (the simulation steps it). */
  simulator: VehicleSimulator | null;
  deps: RuntimeDeps;
  /** Where the service's events go (the engine). */
  onEvent: (event: HudEvent) => void;
  factory?: ObdServiceFactory;
}

/**
 * The OBD service as the server uses it: built with the runtime seams, its events forwarded to
 * the engine, reconfigured in place on config changes, and cleared-codes requests serialised.
 */
export class ObdLink {
  readonly service: ObdServiceLike;
  private readonly unsubscribe: () => void;
  private clearing: Promise<ClearDtcsOutcome> | null = null;

  constructor(options: ObdLinkOptions) {
    const { deps } = options;
    const serviceDeps: ObdServiceDeps = {
      now: deps.now,
      setTimeout: (callback, ms) => deps.timers.setTimeout(callback, ms),
      clearTimeout: (handle) => deps.timers.clearTimeout(handle),
      logger: deps.logger,
      ...(options.simulator ? { simulator: options.simulator } : {}),
    };
    this.service = (options.factory ?? createObdService)(options.config.obd, serviceDeps);
    this.unsubscribe = this.service.onEvent(options.onEvent);
  }

  get status(): ObdLinkStatus {
    return this.service.status;
  }

  start(): void {
    this.service.start();
  }

  async stop(): Promise<void> {
    try {
      await this.service.stop();
    } finally {
      this.unsubscribe();
    }
  }

  updateConfig(config: HudConfig): void {
    this.service.updateConfig(config.obd);
  }

  /**
   * Read trouble codes promptly rather than at the next `obd.dtcIntervalMs` tick, e.g. after the
   * simulator's injected codes changed, so the HUD shows them within a polling cycle.
   */
  requestDtcRead(): void {
    this.service.requestDtcRead?.();
  }

  /** Clear trouble codes (the caller has checked {@link clearDtcsRefusal}). One at a time. */
  clearDtcs(): Promise<ClearDtcsOutcome> {
    if (this.clearing) {
      return Promise.resolve({
        ok: false,
        message: 'Clearing trouble codes is already in progress.',
      });
    }
    const run = this.service.clearDtcs().finally(() => {
      this.clearing = null;
    });
    this.clearing = run;
    return run;
  }
}
