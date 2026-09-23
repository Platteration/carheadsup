import type { HudConfig } from '../types/config.ts';
import type { HudEffect } from '../types/effects.ts';
import type { HudEvent } from '../types/events.ts';
import type { HudState } from '../types/state.ts';
import { notImplemented } from '../todo.ts';

/**
 * Side effects implied by the transition `prev --event--> next`. Pure.
 *  - input 'primary' / 'secondary' while a call is ringing → phone/call-action accept / decline
 *  - trip.completedCount increased → trip/completed with trip.lastCompleted
 *  - a maintenance item changed into 'due-soon' or 'overdue' → maintenance/due
 *  - odometer crossed a whole km, learned gear ratios changed, or a service was recorded → persist
 */
export function deriveEffects(
  prev: HudState,
  next: HudState,
  event: HudEvent,
  config: HudConfig,
): HudEffect[] {
  return notImplemented(
    `deriveEffects(${prev.now}, ${next.now}, ${event.type}, ${config.version})`,
  );
}
