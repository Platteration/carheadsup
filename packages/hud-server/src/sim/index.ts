import type { HudConfig } from '@carheadsup/core';
import type { RuntimeDeps, Simulation } from '../sources/types.ts';

/** Build the simulated vehicle + peripherals used by `--sim` and the dev console. */
export function createSimulation(config: HudConfig, deps: RuntimeDeps): Simulation {
  throw new Error(`createSimulation(${config.version}, ${typeof deps}) is not implemented yet`);
}
