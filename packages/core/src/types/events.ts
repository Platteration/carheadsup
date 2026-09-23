import type { CollisionLevel } from './adas.ts';
import type { HudConfig } from './config.ts';
import type { Hazard, NavInfo, RoadInfo } from './nav.ts';
import type { CallInfo, MediaInfo, MessageInfo } from './phone.ts';
import type { SignalId } from './signals.ts';
import type { ObdLinkState } from './vehicle.ts';

/** Driver inputs, from GPIO buttons, a gesture sensor, the keyboard, or the phone. */
export type InputAction =
  /** Accept call / acknowledge the top alert. */
  | 'primary'
  /** Decline call / dismiss the top alert or toast. */
  | 'secondary'
  /** Cycle parked-dashboard pages. */
  | 'next-page'
  | 'prev-page'
  /** Blank / unblank the whole HUD. */
  | 'toggle-blank'
  | 'brightness-up'
  | 'brightness-down';

export const INPUT_ACTIONS: readonly InputAction[] = [
  'primary',
  'secondary',
  'next-page',
  'prev-page',
  'toggle-blank',
  'brightness-up',
  'brightness-down',
];

/**
 * Everything that can change HUD state. The server turns every input (OBD, phone,
 * sensors, buttons, clock) into these and feeds them through the pure reducer,
 * which also makes whole drives replayable in tests.
 */
export type HudEvent =
  /** Clock tick — drives time-based behaviour (toast fades, staleness, trip end). */
  | { type: 'tick'; at: number }
  | { type: 'config'; config: HudConfig; at: number }

  // OBD-II
  | {
      type: 'obd/link';
      state: ObdLinkState;
      adapter?: string | null;
      protocol?: string | null;
      message?: string | null;
      at: number;
    }
  | { type: 'obd/samples'; samples: Array<{ signal: SignalId; value: number }>; at: number }
  | { type: 'obd/supported'; signals: SignalId[]; at: number }
  | {
      type: 'obd/dtcs';
      milOn: boolean;
      stored: string[];
      pending: string[];
      permanent: string[];
      at: number;
    }
  | { type: 'obd/vin'; vin: string; at: number }

  // Phone
  | {
      type: 'phone/link';
      connected: boolean;
      deviceName?: string | null;
      appVersion?: string | null;
      at: number;
    }
  | { type: 'nav/update'; nav: NavInfo; at: number }
  | { type: 'nav/clear'; at: number }
  | { type: 'road/update'; road: RoadInfo; at: number }
  /** Replaces the full hazard list. */
  | { type: 'hazards/update'; hazards: Hazard[]; at: number }
  | { type: 'media/update'; media: MediaInfo | null; at: number }
  | { type: 'call/update'; call: CallInfo | null; at: number }
  | { type: 'message/received'; message: MessageInfo; at: number }
  | { type: 'location/update'; lat: number; lon: number; accuracyM: number | null; at: number }

  // Sensors & modules
  | { type: 'sensor/light'; lux: number; at: number }
  | { type: 'adas/link'; connected: boolean; at: number }
  | { type: 'adas/blind-spot'; left: boolean; right: boolean; at: number }
  | { type: 'adas/collision'; level: CollisionLevel; ttcSeconds: number | null; at: number }

  // Driver
  | { type: 'input'; action: InputAction; at: number }

  // Maintenance bookkeeping (from the settings app)
  | { type: 'maintenance/done'; itemId: string; odometerKm: number | null; at: number }
  | { type: 'odometer/set'; odometerKm: number; at: number };

export type HudEventType = HudEvent['type'];
