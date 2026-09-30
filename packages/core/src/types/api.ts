import type { CollisionLevel } from './adas.ts';
import type { HudConfig } from './config.ts';
import type { DiagnosticDtc, PairingPageStatus } from './frame.ts';
import type { MaintenanceItemStatus, TripRecord } from './records.ts';
import type { SignalId } from './signals.ts';
import type { ObdLinkStatus } from './vehicle.ts';

/**
 * REST API served by the HUD (`hud-server`) and used by the settings app, the dev console
 * and the phone. JSON in, JSON out. Requests from non-loopback addresses must send
 * `Authorization: Bearer <server.apiToken>` when a token is configured.
 *
 *   GET    /api/info                         → ApiInfo
 *   GET    /api/config                       → HudConfig
 *   PUT    /api/config        HudConfig      → ApiConfigResult   (lenient replace, see below)
 *   PATCH  /api/config        DeepPartial    → ApiConfigResult   (deep merge, validated)
 *   GET    /api/diagnostics                  → ApiDiagnostics
 *   POST   /api/diagnostics/clear-dtcs       → ApiClearDtcsResult (refused unless parked with engine off)
 *   GET    /api/trips?limit=50&before=<ms>   → TripRecord[]   (newest first)
 *   GET    /api/trips.csv                    → text/csv
 *   DELETE /api/trips/:id                    → { ok: true }
 *   GET    /api/maintenance                  → MaintenanceItemStatus[]
 *   POST   /api/maintenance/:itemId/done  { odometerKm?: number } → MaintenanceItemStatus[]
 *   POST   /api/odometer                  { odometerKm: number }  → { ok: true }
 *   POST   /api/input                     { action: InputAction } → { ok: true }
 *   POST   /api/pairing/show                 → ApiPairingShowResult (refused unless parked)
 *   GET    /api/sim                          → SimStatus         (404 when not simulating)
 *   POST   /api/sim                       SimControl → SimStatus (404 when not simulating)
 *
 * PUT /api/config is a lenient replace, not a reset: every field present in the body is
 * validated and applied; fields missing from the body keep their current value; invalid fields
 * also keep their current value and are listed in `errors`. PUT and PATCH answer 200 when
 * `errors` is empty and 422 otherwise — the valid fields have been applied and saved even then.
 * They answer 503 (nothing changed) while the HUD is starting, and when config.json could not
 * be loaded at start-up (unreadable or not JSON): it is never replaced by the defaults.
 *
 * Times in responses are wall-clock epoch ms, as the HUD's system clock has them (the HUD's
 * internal engine time is converted with the latest clock offset).
 */

export interface ApiInfo {
  name: 'carheadsup';
  version: string;
  simulated: boolean;
  uptimeS: number;
  obd: ObdLinkStatus;
  phoneConnected: boolean;
  /** The TLS listener the phone connects to, or null when it is off or failed to start. */
  tls: ApiTlsInfo | null;
}

/** The HUD's TLS listener (`server.tlsPort`) and its certificate. */
export interface ApiTlsInfo {
  /** The port it listens on. */
  port: number;
  /**
   * SHA-256 of the HUD's certificate (DER), 64 lowercase hex digits: what the companion app pins
   * and binds its proofs to. People compare `shortFingerprint(fingerprint)`.
   */
  fingerprint: string;
}

export interface ApiConfigResult {
  /** The resulting stored config. */
  config: HudConfig;
  /**
   * Validation problems ("dotted.path: message"); offending fields were left unchanged. The
   * response status is 422 when this is not empty.
   */
  errors: string[];
}

export interface ApiDiagnostics {
  /**
   * The HUD's wall-clock time when it answered, on the same clock as every `at` here: a
   * sample's age is `now − at`, whatever the client's own clock says (it may be minutes off).
   */
  now: number;
  link: ObdLinkStatus;
  milOn: boolean;
  dtcs: DiagnosticDtc[];
  dtcsCheckedAt: number | null;
  supported: SignalId[] | null;
  /** Latest canonical values and when they were received. */
  signals: Partial<Record<SignalId, { value: number; at: number }>>;
  vin: string | null;
}

export interface ApiClearDtcsResult {
  ok: boolean;
  message: string;
}

/**
 * `POST /api/pairing/show`: the parked dashboard turned to its "Pair a phone" page (200), or why
 * not (409: the car is not parked — the page never shows while driving or stopped).
 */
export interface ApiPairingShowResult {
  ok: boolean;
  message: string;
  /** What the page shows (see `PairingPageStatus`); null when refused. */
  status: PairingPageStatus | null;
}

export interface ApiError {
  error: string;
}

export type ApiTripsResponse = TripRecord[];
export type ApiMaintenanceResponse = MaintenanceItemStatus[];

// ---------------------------------------------------------------------------
// Simulator control (dev console)

export type SimDriveMode = 'manual' | 'scenario';

export interface SimControl {
  /** 'scenario' runs the scripted demo drive; 'manual' obeys throttle/brake below. */
  mode?: SimDriveMode;
  /** 0–1 */
  throttle?: number;
  /** 0–1 */
  brake?: number;
  engineRunning?: boolean;
  /** Manual transmissions: gear to hold (0 = neutral); null = automatic shifting. */
  gear?: number | null;
  /** Replace the injected trouble codes. */
  dtcs?: string[];
  /** Force the coolant temperature (°C), null to release. */
  coolantOverrideC?: number | null;
  /** Force the battery voltage, null to release. */
  voltageOverrideV?: number | null;
  /** Force the fuel level (%), null to release. */
  fuelLevelOverridePct?: number | null;
  /** Simulated ambient light in lux. */
  lux?: number;
  /** Simulated outside temperature (°C). */
  ambientTempC?: number;
  /** Fire a phone scenario event. */
  phone?:
    | { kind: 'nav-start' }
    | { kind: 'nav-stop' }
    | { kind: 'incoming-call'; name?: string }
    | { kind: 'end-call' }
    | { kind: 'next-track' }
    | { kind: 'message'; sender?: string }
    | { kind: 'speed-camera' }
    | { kind: 'traffic-jam' }
    | { kind: 'disconnect' }
    | { kind: 'connect' };
  adas?: {
    blindSpotLeft?: boolean;
    blindSpotRight?: boolean;
    collision?: 'none' | 'caution' | 'warning';
  };
  /** Simulated tyre pressures (kPa gauge), null to disable TPMS. */
  tirePressuresKpa?: { fl: number; fr: number; rl: number; rr: number } | null;
}

/**
 * The simulator's state, including everything the dev console controls, so that the console
 * shows the server's state after a reload (or when another console changed it) rather than
 * toggles remembered locally.
 */
export interface SimStatus {
  mode: SimDriveMode;
  throttle: number;
  brake: number;
  engineRunning: boolean;
  gear: number | null;
  speedKph: number;
  rpm: number;
  dtcs: string[];
  lux: number;
  ambientTempC: number;
  scenarioStep: string | null;
  /** Forced coolant temperature (°C), or null when the simulated value is used. */
  coolantOverrideC: number | null;
  /** Forced battery voltage, or null. */
  voltageOverrideV: number | null;
  /** Forced fuel level (%), or null. */
  fuelLevelOverridePct: number | null;
  /**
   * Tyre pressures as last set (kPa gauge, cold; the reported ones rise as the tyres warm up),
   * or null while the simulated car reports no TPMS.
   */
  tirePressuresKpa: { fl: number; fr: number; rl: number; rr: number } | null;
  /** The simulated ADAS module's warnings. */
  adas: { blindSpotLeft: boolean; blindSpotRight: boolean; collision: CollisionLevel };
  /** The simulated phone. */
  phone: {
    /** Its link as set with SimControl.phone connect / disconnect. */
    connected: boolean;
    /** A real phone is connected, so the simulated one is silent until it goes. */
    steppedAside: boolean;
  };
}

/** The part of {@link SimStatus} the vehicle simulator itself knows (not the peripherals). */
export type SimVehicleStatus = Omit<SimStatus, 'adas' | 'phone'>;
