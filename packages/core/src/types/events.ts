import type { CollisionLevel } from './adas.ts';
import type { HudConfig } from './config.ts';
import type { Hazard, NavInfo, RoadInfo } from './nav.ts';
import type { CallInfo, MediaInfo, MessageInfo } from './phone.ts';
import type { SignalId } from './signals.ts';
import type { PairingEndpoint } from './state.ts';
import type { ObdLinkState } from './vehicle.ts';

/** Driver inputs, from GPIO buttons, a gesture sensor, the keyboard, or the phone. */
export type InputAction =
  /** Accept call / acknowledge the top alert. */
  | 'primary'
  /** Decline call / dismiss the top alert or toast. */
  | 'secondary'
  /**
   * Cycle the dashboard's pages. While stopped (not yet parked) the first press opens the
   * dashboard instead (see `UiState.dashboardRequested`).
   */
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
  /**
   * Where the wall clock stands relative to engine time: wall-clock epoch ms − `at`. The server
   * sends it on start and whenever the difference drifts (e.g. network time stepped the system
   * clock) or the clock becomes trusted; `trusted` absent leaves `ClockState.trusted` as it is.
   * See `ClockState`.
   */
  | { type: 'clock/sync'; wallOffsetMs: number; trusted?: boolean; at: number }
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
      /**
       * False when only the MIL state could be read (the trouble-code read failed, e.g. a
       * clone that cannot receive a long answer): the code lists are not known and the
       * previous ones are kept. Absent: a complete read.
       */
      complete?: boolean;
      at: number;
    }
  | { type: 'obd/vin'; vin: string; at: number }

  // Phone
  | {
      type: 'phone/link';
      connected: boolean;
      deviceName?: string | null;
      /**
       * The phone's identity (`hello.deviceId`), which tells two phones with the same name
       * apart. Absent: unchanged (or, without one on either side, the name identifies the phone).
       */
      deviceId?: string | null;
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

  // Pairing a phone (from the server and the settings app)
  /**
   * Where phones reach this HUD — its id, certificate and addresses — for the pairing page's QR
   * code; null while the phone link (TLS) is not running. Sent by the server on start and
   * whenever it changes (e.g. the Wi-Fi came up with another address).
   */
  | { type: 'pairing/endpoint'; endpoint: PairingEndpoint | null; at: number }
  /**
   * Turn the parked dashboard to its "Pair a phone" page (the settings app's button), unblanking
   * the HUD. Ignored unless parked.
   */
  | { type: 'pairing/show'; at: number }

  // Maintenance bookkeeping (from the settings app)
  | { type: 'maintenance/done'; itemId: string; odometerKm: number | null; at: number }
  | { type: 'odometer/set'; odometerKm: number; at: number };

export type HudEventType = HudEvent['type'];
