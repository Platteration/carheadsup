import type { HudConfig } from './config.ts';
import type { DiagnosticDtc } from './frame.ts';
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
 *   PUT    /api/config        HudConfig      → ApiConfigResult   (full replace, validated)
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
 *   GET    /api/sim                          → SimStatus         (404 when not simulating)
 *   POST   /api/sim                       SimControl → SimStatus (404 when not simulating)
 */

export interface ApiInfo {
  name: 'carheadsup';
  version: string;
  simulated: boolean;
  uptimeS: number;
  obd: ObdLinkStatus;
  phoneConnected: boolean;
}

export interface ApiConfigResult {
  config: HudConfig;
  /** Validation problems; offending fields were left unchanged. */
  errors: string[];
}

export interface ApiDiagnostics {
  link: ObdLinkStatus;
  milOn: boolean;
  dtcs: DiagnosticDtc[];
  dtcsCheckedAt: number | null;
  supported: SignalId[] | null;
  /** Latest canonical values. */
  signals: Partial<Record<SignalId, { value: number; at: number }>>;
  vin: string | null;
}

export interface ApiClearDtcsResult {
  ok: boolean;
  message: string;
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
}
