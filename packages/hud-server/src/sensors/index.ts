import type { HudConfig } from '@carheadsup/core';
import type { EventSource } from '../sources/types.ts';

/**
 * Hardware input sources enabled by `config.sensors`: ambient light sensor, gesture sensor,
 * GPIO buttons, ADAS UDP feed. Sources whose hardware is absent log once and stay idle rather
 * than failing the HUD.
 */
export function createSensorSources(config: HudConfig): EventSource[] {
  throw new Error(`createSensorSources(${config.version}) is not implemented yet`);
}
