import type { HudConfig } from '../types/config.ts';
import type { HudEffect } from '../types/effects.ts';
import type { HudEvent } from '../types/events.ts';
import type { MaintenanceItemStatus, MaintenanceRecord } from '../types/records.ts';
import type { HudState } from '../types/state.ts';
import type { GearAnchor } from '../vehicle/gear.ts';
import { callControls } from './selectors.ts';

/**
 * Side effects implied by the transition `prev --event--> next`. Pure.
 *  - input 'primary' / 'secondary' while a call is ringing → phone/call-action accept / decline
 *    ('secondary' also hangs up a dialing or active call, matching `CallFrame.canDecline`);
 *    never while the phone is disconnected
 *  - trip.completedCount increased → trip/completed with trip.lastCompleted
 *  - a maintenance item changed into 'due-soon' or 'overdue' → maintenance/due
 *  - odometer crossed a whole km, learned gear ratios or their numbering anchor changed, or a
 *    service was recorded → persist (as does an explicit odometer/set, and a clock/sync that
 *    moved the wall clock while a trip is in progress: its saved times are wall-clock times, and
 *    a trip resumed after a restart may have been split)
 * Effects are listed in that order; at most one of each type.
 */
export function deriveEffects(
  prev: HudState,
  next: HudState,
  event: HudEvent,
  config: HudConfig,
): HudEffect[] {
  const effects: HudEffect[] = [];

  if (event.type === 'input' && prev.call !== null) {
    const { canAccept, canDecline } = callControls(prev.call, prev.phone.connected);
    if (event.action === 'primary' && canAccept) {
      effects.push({ type: 'phone/call-action', callId: prev.call.id, action: 'accept' });
    } else if (event.action === 'secondary' && canDecline) {
      effects.push({ type: 'phone/call-action', callId: prev.call.id, action: 'decline' });
    }
  }

  const trip = next.trip.lastCompleted;
  if (next.trip.completedCount > prev.trip.completedCount && trip !== null) {
    effects.push({ type: 'trip/completed', trip });
  }

  const due = newlyDue(prev.maintenance.status, next.maintenance.status);
  if (due.length > 0) effects.push({ type: 'maintenance/due', items: due });

  if (shouldPersist(prev, next, event)) effects.push({ type: 'persist' });
  return effects;
}

/** Items whose status became 'due-soon' or 'overdue' (including due-soon → overdue). */
function newlyDue(
  prev: readonly MaintenanceItemStatus[],
  next: readonly MaintenanceItemStatus[],
): MaintenanceItemStatus[] {
  if (prev === next) return [];
  const before = new Map(prev.map((item) => [item.itemId, item.status]));
  return next.filter(
    (item) =>
      (item.status === 'due-soon' || item.status === 'overdue') &&
      before.get(item.itemId) !== item.status,
  );
}

function shouldPersist(prev: HudState, next: HudState, event: HudEvent): boolean {
  if (event.type === 'odometer/set' && next.odometer !== prev.odometer) return true;
  if (
    event.type === 'clock/sync' &&
    next.clock.wallOffsetMs !== prev.clock.wallOffsetMs &&
    (next.trip.active !== null || prev.trip.active !== null)
  ) {
    return true;
  }
  if (crossedWholeKm(prev.odometer.km, next.odometer.km)) return true;
  if (!sameNumbers(prev.gear.learnedRatios, next.gear.learnedRatios)) return true;
  if (!sameAnchor(prev.gear.anchor, next.gear.anchor)) return true;
  return !sameRecords(prev.maintenance.records, next.maintenance.records);
}

function sameAnchor(a: GearAnchor | null, b: GearAnchor | null): boolean {
  if (a === b) return true;
  return (
    a !== null &&
    b !== null &&
    a.transmission === b.transmission &&
    a.secondGearRpmPerKph === b.secondGearRpmPerKph
  );
}

/** The odometer became known or moved up past a whole kilometre. */
function crossedWholeKm(prev: number | null, next: number | null): boolean {
  if (next === null || !Number.isFinite(next)) return false;
  if (prev === null || !Number.isFinite(prev)) return true;
  return Math.floor(next) > Math.floor(prev);
}

function sameNumbers(a: readonly number[] | null, b: readonly number[] | null): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function sameRecords(a: readonly MaintenanceRecord[], b: readonly MaintenanceRecord[]): boolean {
  if (a === b) return true;
  return (
    a.length === b.length &&
    a.every((r, i) => {
      const s = b[i];
      return (
        s !== undefined && r.itemId === s.itemId && r.odometerKm === s.odometerKm && r.at === s.at
      );
    })
  );
}
