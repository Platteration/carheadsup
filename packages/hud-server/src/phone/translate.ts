import type { HudEvent, PhoneToHud } from '@carheadsup/core';

/**
 * Translate one validated phone message into the HudEvents it implies, stamped with the HUD's
 * clock `now`. Session-level messages (hello, ping, trips-request) produce no events.
 * Shared by real phone sessions and the simulated phone.
 */
export function phoneMessageToEvents(message: PhoneToHud, now: number): HudEvent[] {
  throw new Error(`phoneMessageToEvents(${message.t}, ${now}) is not implemented yet`);
}
