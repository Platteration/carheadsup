import type { SignalId, SignalMeta } from '../types/signals.ts';
import { notImplemented } from '../todo.ts';

/**
 * OBD-II service 01 PID definitions (SAE J1979) and decoders.
 * Decoders take the data bytes AFTER the "41 <pid>" echo and return canonical-unit values.
 */
export interface PidDefinition {
  /** Service/mode, always 0x01 here. */
  mode: 0x01;
  pid: number;
  /** Number of data bytes in the response. */
  bytes: number;
  name: string;
  /** Signals this PID populates (some PIDs carry several). */
  signals: SignalId[];
  /** Returns null when the payload is too short or reports "not available". */
  decode(data: Uint8Array): Partial<Record<SignalId, number>> | null;
}

/** All mode 01 PIDs the HUD understands. */
export const MODE01_PIDS: readonly PidDefinition[] = [];

/** Metadata for every SignalId (labels, units, ranges, normal bands). */
export const SIGNAL_META: Readonly<Record<SignalId, SignalMeta>> = {} as Record<
  SignalId,
  SignalMeta
>;

export function getPid(pid: number): PidDefinition | undefined {
  return notImplemented(`getPid(${pid})`);
}

/** The PID that provides a signal, if any standard PID does. */
export function pidForSignal(signal: SignalId): PidDefinition | undefined {
  return notImplemented(`pidForSignal(${signal})`);
}

/** Decode a mode 01 response payload for `pid`. Unknown PIDs return null. */
export function decodeMode01(
  pid: number,
  data: Uint8Array,
): Partial<Record<SignalId, number>> | null {
  return notImplemented(`decodeMode01(${pid}, ${data.length})`);
}

/**
 * Parse a "supported PIDs" bitmap response (PIDs 0x00, 0x20, 0x40 … 0xE0).
 * Returns the supported PID numbers in [base+1, base+32].
 */
export function parseSupportedPids(basePid: number, data: Uint8Array): number[] {
  return notImplemented(`parseSupportedPids(${basePid}, ${data.length})`);
}

/** Map supported PID numbers to the signals they provide. */
export function signalsForPids(pids: readonly number[]): SignalId[] {
  return notImplemented(`signalsForPids(${pids.length})`);
}

/** Decode service 01 PID 0x01 (monitor status since DTCs cleared). */
export function parseMonitorStatus(data: Uint8Array): { milOn: boolean; dtcCount: number } | null {
  return notImplemented(`parseMonitorStatus(${data.length})`);
}
