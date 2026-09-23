/**
 * Emulated control units on the simulated car's CAN bus (ISO 15765-4, 11-bit ids):
 *
 *  - Engine ECM, request 7E0 / response 7E8: service 01 (the engine PIDs), 03 / 07 / 0A / 04
 *    (trouble codes) and 09 (VIN, ECU name).
 *  - Transmission TCM, 7E1 / 7E9: service 01 PID A4 (actual gear), empty DTC lists. Having a
 *    second responder exercises multi-ECU handling in the driver.
 *  - TPMS module, 7C6 / 7CE (physical addressing only): manufacturer-style service 22 DIDs
 *    4001–4004 with the four tyre pressures in 0.1 kPa, present only when the simulation has TPMS.
 *
 * Every answer is computed from one {@link VehicleSnapshot}, and each ECU's "supported PIDs"
 * bitmaps are generated from the PIDs it actually answers, so they are always consistent.
 */
import { isSupportedPidsQuery } from '@carheadsup/core';
import type { VehicleSimulator, VehicleSnapshot } from './vehicle-sim.ts';

export interface EmulatedEcu {
  readonly name: string;
  /** Physical request id (e.g. 0x7E0). */
  readonly requestId: number;
  /** Response id (e.g. 0x7E8). */
  readonly responseId: number;
  /** Whether the unit answers functional (0x7DF broadcast) requests. */
  readonly functional: boolean;
  /** Whether the unit is on the bus right now. */
  isPresent(snapshot: VehicleSnapshot): boolean;
  /** The response payload for a request, or null for no response. */
  handle(request: Uint8Array, functional: boolean, snapshot: VehicleSnapshot): Uint8Array | null;
}

type Encoder = (s: VehicleSnapshot) => number[];

const clampRound = (value: number, max: number): number =>
  Math.min(max, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
const u8 = (value: number): number[] => [clampRound(value, 0xff)];
const u16 = (value: number): number[] => {
  const n = clampRound(value, 0xffff);
  return [n >> 8, n & 0xff];
};
const u32 = (value: number): number[] => {
  const n = clampRound(value, 0xfffffffe);
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
};
const pct = (value: number): number[] => u8((value * 255) / 100);
const temp = (celsius: number): number[] => u8(celsius + 40);
const trim = (percent: number): number[] => u8((percent * 128) / 100 + 128);

/** Service 01 PIDs answered by the engine ECU, encoded per SAE J1979. */
const ENGINE_PIDS: ReadonlyMap<number, Encoder> = new Map<number, Encoder>([
  [0x01, (s) => [(s.milOn ? 0x80 : 0) | Math.min(0x7f, s.dtcs.stored.length), 0x07, 0x65, 0x00]],
  [0x03, (s) => [s.fuelSystemStatus, 0x00]],
  [0x04, (s) => pct(s.engineLoadPct)],
  [0x05, (s) => temp(s.coolantTempC)],
  [0x06, (s) => trim(s.shortFuelTrimPct)],
  [0x07, (s) => trim(s.longFuelTrimPct)],
  [0x0b, (s) => u8(s.mapKpa)],
  [0x0c, (s) => u16(s.rpm * 4)],
  [0x0d, (s) => u8(s.speedKph)],
  [0x0e, (s) => u8((s.timingAdvanceDeg + 64) * 2)],
  [0x0f, (s) => temp(s.intakeAirTempC)],
  [0x10, (s) => u16(s.mafGps * 100)],
  [0x11, (s) => pct(s.throttlePct)],
  [0x1c, () => [0x06]], // EOBD
  [0x1f, (s) => u16(s.runTimeS)],
  [0x21, (s) => u16(s.distanceWithMilKm)],
  [0x2f, (s) => pct(s.fuelLevelPct)],
  [0x31, (s) => u16(s.distanceSinceClearKm)],
  [0x33, (s) => u8(s.baroKpa)],
  [0x3c, (s) => u16((s.catalystTempC + 40) * 10)],
  [0x42, (s) => u16(s.controlModuleVoltage * 1000)],
  [0x43, (s) => u16((s.absoluteLoadPct * 255) / 100)],
  [0x44, (s) => u16(s.commandedLambda * 32768)],
  [0x45, (s) => pct(s.relativeThrottlePct)],
  [0x46, (s) => temp(s.ambientTempC)],
  [0x49, (s) => pct(s.pedalPct)],
  [0x51, () => [0x01]], // fuel type: gasoline
  [0x52, (s) => pct(s.ethanolPct)],
  [0x5c, (s) => temp(s.oilTempC)],
  [0x5e, (s) => u16(s.fuelRateLph * 20)],
  [0xa6, (s) => u32(s.odometerKm * 10)],
]);

const TRANSMISSION_PIDS: ReadonlyMap<number, Encoder> = new Map<number, Encoder>([
  [
    0xa4,
    (s) => {
      // A: bit 0 actual gear supported, bit 1 ratio supported; B high nibble: gear; C–D: ratio ×1000.
      const gear = s.engineRunning || s.speedKph > 0 ? s.gear : 0;
      return [0x03, (gear & 0x0f) << 4, ...u16(s.gearRatio * 1000)];
    },
  ],
]);

/** Encode "P0420" as the two bytes used by services 03 / 07 / 0A. */
export function encodeDtc(code: string): [number, number] {
  const letter = 'PCBU'.indexOf(code.charAt(0));
  const first = parseInt(code.charAt(1), 16);
  const rest = parseInt(code.slice(2, 5), 16);
  if (letter < 0 || !(first >= 0 && first <= 3) || !Number.isFinite(rest)) {
    throw new RangeError(`Invalid trouble code ${JSON.stringify(code)}`);
  }
  return [(letter << 6) | (first << 4) | (rest >> 8), rest & 0xff];
}

/**
 * A "PIDs supported" bitmap for `base` from the set of answered PIDs. Bitmap PIDs further up
 * the chain are implied by any supported PID above them (the continuation bit).
 */
export function supportedBitmap(base: number, pids: Iterable<number>): number[] {
  const bytes = [0, 0, 0, 0];
  const all = withBitmapChain(pids);
  for (const pid of all) {
    const offset = pid - base - 1;
    if (offset < 0 || offset >= 32) continue;
    const index = offset >> 3;
    bytes[index] = (bytes[index] ?? 0) | (0x80 >> (offset & 7));
  }
  return bytes;
}

/** The PID set plus every bitmap PID needed to reach it (0x20, 0x40 … below the highest PID). */
export function withBitmapChain(pids: Iterable<number>): Set<number> {
  const all = new Set(pids);
  const highest = Math.max(0, ...all);
  for (let base = 0x20; base < highest; base += 0x20) all.add(base);
  return all;
}

const nrc = (service: number, code: number): Uint8Array => Uint8Array.of(0x7f, service, code);

/** Service 01 with up to six PIDs; unsupported PIDs are silently omitted, as ECUs do. */
function answerMode01(
  request: Uint8Array,
  pids: ReadonlyMap<number, Encoder>,
  functional: boolean,
  snapshot: VehicleSnapshot,
): Uint8Array | null {
  const requested = [...request.slice(1)];
  if (requested.length === 0 || requested.length > 6) return functional ? null : nrc(0x01, 0x13);
  const chain = withBitmapChain(pids.keys());
  const out = [0x41];
  for (const pid of requested) {
    if (isSupportedPidsQuery(pid)) {
      if (pid === 0x00 || chain.has(pid)) out.push(pid, ...supportedBitmap(pid, pids.keys()));
      continue;
    }
    const encode = pids.get(pid);
    if (encode) out.push(pid, ...encode(snapshot));
  }
  if (out.length > 1) return Uint8Array.from(out);
  return functional ? null : nrc(0x01, 0x12);
}

function answerDtcs(service: number, codes: readonly string[]): Uint8Array {
  const out = [service + 0x40, codes.length];
  for (const code of codes) out.push(...encodeDtc(code));
  return Uint8Array.from(out);
}

const ascii = (text: string, length: number): number[] => {
  const bytes = [...text].slice(0, length).map((ch) => ch.charCodeAt(0) & 0x7f);
  while (bytes.length < length) bytes.push(0);
  return bytes;
};

export function createEngineEcu(sim: VehicleSimulator): EmulatedEcu {
  return {
    name: 'ECM',
    requestId: 0x7e0,
    responseId: 0x7e8,
    functional: true,
    isPresent: () => true,
    handle(request, functional, snapshot) {
      const service = request[0];
      switch (service) {
        case 0x01:
          return answerMode01(request, ENGINE_PIDS, functional, snapshot);
        case 0x03:
          return answerDtcs(0x03, snapshot.dtcs.stored);
        case 0x07:
          return answerDtcs(0x07, snapshot.dtcs.pending);
        case 0x0a:
          return answerDtcs(0x0a, snapshot.dtcs.permanent);
        case 0x04:
          return sim.clearDtcs() ? Uint8Array.of(0x44) : nrc(0x04, 0x22);
        case 0x09: {
          const pid = request[1];
          if (pid === 0x00) return Uint8Array.of(0x49, 0x00, 0x40, 0x40, 0x00, 0x00);
          if (pid === 0x02) return Uint8Array.from([0x49, 0x02, 0x01, ...ascii(sim.vin, 17)]);
          if (pid === 0x0a) {
            return Uint8Array.from([0x49, 0x0a, 0x01, ...ascii('ECM-EngineControl', 20)]);
          }
          return functional ? null : nrc(0x09, 0x12);
        }
        default:
          return functional || service === undefined ? null : nrc(service, 0x11);
      }
    },
  };
}

export function createTransmissionEcu(): EmulatedEcu {
  return {
    name: 'TCM',
    requestId: 0x7e1,
    responseId: 0x7e9,
    functional: true,
    isPresent: () => true,
    handle(request, functional, snapshot) {
      const service = request[0];
      switch (service) {
        case 0x01:
          return answerMode01(request, TRANSMISSION_PIDS, functional, snapshot);
        case 0x03:
        case 0x07:
        case 0x0a:
          return answerDtcs(service, []);
        case 0x04:
          return Uint8Array.of(0x44);
        default:
          return functional || service === undefined ? null : nrc(service, 0x11);
      }
    },
  };
}

/** Service 22 data identifiers of the simulated TPMS module (pressure in 0.1 kPa). */
export const SIM_TPMS_DIDS = Object.freeze({ fl: 0x4001, fr: 0x4002, rl: 0x4003, rr: 0x4004 });

export const SIM_TPMS_REQUEST_ID = 0x7c6;

export function createTpmsEcu(): EmulatedEcu {
  return {
    name: 'TPMS',
    requestId: SIM_TPMS_REQUEST_ID,
    responseId: SIM_TPMS_REQUEST_ID + 8,
    functional: false,
    isPresent: (snapshot) => snapshot.tirePressuresKpa !== null,
    handle(request, functional, snapshot) {
      const service = request[0];
      if (functional || service === undefined) return null;
      if (service !== 0x22) return nrc(service, 0x11);
      const did = ((request[1] ?? 0) << 8) | (request[2] ?? 0);
      const pressures = snapshot.tirePressuresKpa;
      if (request.length !== 3 || !pressures) return nrc(0x22, 0x13);
      const wheel = (Object.keys(SIM_TPMS_DIDS) as Array<keyof typeof SIM_TPMS_DIDS>).find(
        (key) => SIM_TPMS_DIDS[key] === did,
      );
      if (!wheel) return nrc(0x22, 0x31);
      return Uint8Array.from([
        0x62,
        request[1] ?? 0,
        request[2] ?? 0,
        ...u16(pressures[wheel] * 10),
      ]);
    },
  };
}
