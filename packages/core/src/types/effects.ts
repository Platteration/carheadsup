import type { MaintenanceItemStatus, TripRecord } from './records.ts';

/**
 * Side effects requested by a state transition. The pure core decides *what* should happen
 * (`deriveEffects`); the server performs it (send to phone, write to disk).
 */
export type HudEffect =
  /** Driver accepted/declined a ringing call with a gesture or button. */
  | { type: 'phone/call-action'; callId: string; action: 'accept' | 'decline' }
  /** A trip just finished — persist it and push it to the phone. */
  | { type: 'trip/completed'; trip: TripRecord }
  /** One or more maintenance items just became due-soon or overdue. */
  | { type: 'maintenance/due'; items: MaintenanceItemStatus[] }
  /** Persisted state changed meaningfully (odometer step, learned ratios, service record). */
  | { type: 'persist' };
