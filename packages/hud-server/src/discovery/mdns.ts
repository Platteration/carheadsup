import type { HudConfig } from '@carheadsup/core';
import type { RuntimeDeps, Service } from '../sources/types.ts';

/**
 * Advertise the HUD as `_carheadsup._tcp` (TXT: v=<protocol version>, path=/ws/phone) so the
 * companion app can find it. Returns null when advertising is disabled or unavailable.
 */
export function advertiseHud(config: HudConfig, deps: RuntimeDeps): Service | null {
  throw new Error(`advertiseHud(${config.server.port}, ${typeof deps}) is not implemented yet`);
}
