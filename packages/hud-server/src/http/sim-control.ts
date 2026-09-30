import { isValidDtc, normalizeDtc } from '@carheadsup/core';
import type { SimControl } from '@carheadsup/core';

/**
 * Validation of `POST /api/sim` bodies (dev console → simulator). Only the fields of
 * `SimControl` are kept; unknown fields are dropped; any present field with the wrong type or
 * out of range rejects the whole request with a readable reason.
 */

export type SimControlResult = { ok: true; value: SimControl } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

const PHONE_KINDS = [
  'nav-start',
  'nav-stop',
  'incoming-call',
  'end-call',
  'next-track',
  'message',
  'speed-camera',
  'traffic-jam',
  'disconnect',
  'connect',
] as const;
type PhoneKind = (typeof PHONE_KINDS)[number];
const COLLISION_LEVELS = ['none', 'caution', 'warning'] as const;
const MAX_DTCS = 32;
const MAX_NAME = 100;

class Invalid extends Error {}

function fail(field: string, expected: string): never {
  throw new Invalid(`${field}: expected ${expected}`);
}

function number(value: unknown, field: string, min: number, max: number): number {
  if (!inRange(value, min, max)) fail(field, `a number between ${min} and ${max}`);
  return value;
}

function nullableNumber(value: unknown, field: string, min: number, max: number): number | null {
  return value === null ? null : number(value, field, min, max);
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(field, 'true or false');
  return value;
}

function name(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(field, `a string of at most ${MAX_NAME} characters`);
  }
  return value;
}

function phone(value: unknown): NonNullable<SimControl['phone']> {
  if (!isRecord(value)) fail('phone', 'an object with a "kind"');
  const kind = value['kind'];
  if (typeof kind !== 'string' || !(PHONE_KINDS as readonly string[]).includes(kind)) {
    fail('phone.kind', `one of ${PHONE_KINDS.join(', ')}`);
  }
  switch (kind as PhoneKind) {
    case 'incoming-call':
      return value['name'] === undefined
        ? { kind: 'incoming-call' }
        : { kind: 'incoming-call', name: name(value['name'], 'phone.name') };
    case 'message':
      return value['sender'] === undefined
        ? { kind: 'message' }
        : { kind: 'message', sender: name(value['sender'], 'phone.sender') };
    default:
      return { kind: kind as Exclude<PhoneKind, 'incoming-call' | 'message'> };
  }
}

function adas(value: unknown): NonNullable<SimControl['adas']> {
  if (!isRecord(value)) fail('adas', 'an object');
  const out: NonNullable<SimControl['adas']> = {};
  if (value['blindSpotLeft'] !== undefined) {
    out.blindSpotLeft = boolean(value['blindSpotLeft'], 'adas.blindSpotLeft');
  }
  if (value['blindSpotRight'] !== undefined) {
    out.blindSpotRight = boolean(value['blindSpotRight'], 'adas.blindSpotRight');
  }
  const collision = value['collision'];
  if (collision !== undefined) {
    if (
      typeof collision !== 'string' ||
      !(COLLISION_LEVELS as readonly string[]).includes(collision)
    ) {
      fail('adas.collision', `one of ${COLLISION_LEVELS.join(', ')}`);
    }
    out.collision = collision as (typeof COLLISION_LEVELS)[number];
  }
  return out;
}

function tyres(value: unknown): SimControl['tirePressuresKpa'] {
  if (value === null) return null;
  if (!isRecord(value)) fail('tirePressuresKpa', 'an object {fl, fr, rl, rr} or null');
  return {
    fl: number(value['fl'], 'tirePressuresKpa.fl', 0, 1000),
    fr: number(value['fr'], 'tirePressuresKpa.fr', 0, 1000),
    rl: number(value['rl'], 'tirePressuresKpa.rl', 0, 1000),
    rr: number(value['rr'], 'tirePressuresKpa.rr', 0, 1000),
  };
}

function dtcs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_DTCS) {
    fail('dtcs', `an array of at most ${MAX_DTCS} trouble codes`);
  }
  return value.map((code: unknown, index) => {
    if (typeof code !== 'string' || !isValidDtc(code))
      fail(`dtcs[${index}]`, 'a code like "P0420"');
    return normalizeDtc(code);
  });
}

/** Validate an untrusted `POST /api/sim` body. */
export function parseSimControl(input: unknown): SimControlResult {
  if (!isRecord(input)) return { ok: false, error: 'expected a JSON object' };
  try {
    const out: SimControl = {};
    const v = input;
    if (v['mode'] !== undefined) {
      if (v['mode'] !== 'manual' && v['mode'] !== 'scenario')
        fail('mode', '"manual" or "scenario"');
      out.mode = v['mode'];
    }
    if (v['throttle'] !== undefined) out.throttle = number(v['throttle'], 'throttle', 0, 1);
    if (v['brake'] !== undefined) out.brake = number(v['brake'], 'brake', 0, 1);
    if (v['engineRunning'] !== undefined) {
      out.engineRunning = boolean(v['engineRunning'], 'engineRunning');
    }
    if (v['gear'] !== undefined) {
      const gear = v['gear'];
      if (gear !== null && !(Number.isInteger(gear) && inRange(gear, 0, 10))) {
        fail('gear', 'an integer gear 0–10 or null');
      }
      out.gear = gear;
    }
    if (v['dtcs'] !== undefined) out.dtcs = dtcs(v['dtcs']);
    if (v['coolantOverrideC'] !== undefined) {
      out.coolantOverrideC = nullableNumber(v['coolantOverrideC'], 'coolantOverrideC', -40, 215);
    }
    if (v['voltageOverrideV'] !== undefined) {
      out.voltageOverrideV = nullableNumber(v['voltageOverrideV'], 'voltageOverrideV', 0, 30);
    }
    if (v['fuelLevelOverridePct'] !== undefined) {
      out.fuelLevelOverridePct = nullableNumber(
        v['fuelLevelOverridePct'],
        'fuelLevelOverridePct',
        0,
        100,
      );
    }
    if (v['lux'] !== undefined) out.lux = number(v['lux'], 'lux', 0, 200_000);
    if (v['ambientTempC'] !== undefined) {
      out.ambientTempC = number(v['ambientTempC'], 'ambientTempC', -60, 70);
    }
    if (v['phone'] !== undefined) out.phone = phone(v['phone']);
    if (v['adas'] !== undefined) out.adas = adas(v['adas']);
    if (v['tirePressuresKpa'] !== undefined) out.tirePressuresKpa = tyres(v['tirePressuresKpa']);
    return { ok: true, value: out };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message };
    throw err;
  }
}
