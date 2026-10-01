import type { SignalId, SignalMap } from './signals.ts';

export type ObdLinkState = 'disconnected' | 'connecting' | 'initializing' | 'connected' | 'error';

export interface ObdLinkStatus {
  state: ObdLinkState;
  /** Adapter identification, e.g. "ELM327 v1.5" or "OBDLink MX+ STN2255". */
  adapter: string | null;
  /** Negotiated OBD protocol description, e.g. "ISO 15765-4 (CAN 11/500)". */
  protocol: string | null;
  /** Human-readable detail for errors / progress. */
  message: string | null;
  /** Epoch ms of the last state change. */
  since: number;
}

export type DtcKind = 'stored' | 'pending' | 'permanent';

export type DtcSystem = 'powertrain' | 'chassis' | 'body' | 'network';

export type DtcSeverity = 'info' | 'caution' | 'warning' | 'critical';

export interface DtcEntry {
  /** Five-character code, e.g. "P0420". */
  code: string;
  kind: DtcKind;
  /** Epoch ms when this code was first reported in the current session. */
  firstSeenAt: number;
}

/** Decoded, human-friendly information about a trouble code. */
export interface DtcInfo {
  code: string;
  system: DtcSystem;
  /** Official-style description, e.g. "Catalyst System Efficiency Below Threshold (Bank 1)". */
  description: string;
  /** Short glanceable label for the HUD (≤ 32 chars), e.g. "Catalytic converter efficiency". */
  short: string;
  severity: DtcSeverity;
  /** True for manufacturer-defined ranges (P1xxx, P30xx–P33xx, B1/B2, C1/C2, U1/U2 …). */
  manufacturerSpecific: boolean;
  /** False when the code was not in the database and the text was synthesised from its range. */
  known: boolean;
}

export interface VehicleState {
  link: ObdLinkStatus;
  /** Latest value per signal. Consumers must treat samples older than the staleness limits as absent. */
  signals: SignalMap;
  /** Signals the vehicle reports as supported, or null until discovery completes. */
  supported: SignalId[] | null;
  milOn: boolean;
  dtcs: DtcEntry[];
  /** Epoch ms of the last successful DTC read, or null if never. */
  dtcsCheckedAt: number | null;
  vin: string | null;
  /**
   * Tyre-pressure signals that have read anything but exactly 0 since start-up. A TPMS receiver
   * reports 0 for a sensor that is missing or asleep (winter wheels without sensors, sensors not
   * yet woken by driving off): a tyre that has only ever read 0 is not a puncture.
   */
  tyresReporting: SignalId[];
}
