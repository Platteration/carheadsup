import { z } from 'zod';
import { formatPath, issueMessage } from '../config/issues.ts';
import { isPlainObject } from '../config/json.ts';
import type { AssertTrue, Equals } from '../config/schema.ts';
import type { CollisionLevel } from '../types/adas.ts';
import { INPUT_ACTIONS } from '../types/events.ts';
import { HAZARD_TYPES, LANE_DIRECTIONS, MANEUVER_TYPES } from '../types/nav.ts';
import type { RoadClass } from '../types/nav.ts';
import type { CallState } from '../types/phone.ts';
import type { AdasMessage, PhoneToHud, RendererToServer } from '../types/protocol.ts';
import { AUTH_ID_PATTERN, AUTH_PROOF_PATTERN, PHONE_AUTH } from './phone-auth.ts';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Size limits enforced on incoming messages. Strings over their cap reject the message. */
export const PROTOCOL_LIMITS = {
  /** Whole phone frame, in UTF-16 code units (fits a maximal icon plus a full hazard list). */
  phoneFrameChars: 128 * 1024,
  /** Whole renderer / ADAS frame. */
  smallFrameChars: 1024,
  /** Names and labels: device, app, source, street, sender, caller name … */
  name: 100,
  /** Media title / artist / album (song titles can be long). */
  mediaText: 300,
  /** Opaque identifiers (call, message and hazard ids). */
  id: 256,
  trackKey: 512,
  /**
   * Free text never shown while moving: the nav instruction (the HUD draws its own maneuver
   * arrows and street name) and a hazard description (an 'other' hazard is labelled "Hazard"
   * while moving, see `hazardLabel`).
   */
  text: 300,
  version: 64,
  phoneNumber: 40,
  /** Base64 of a ≤ 32 KiB PNG: 4·⌈32768/3⌉ = 43 692 characters, rounded up to 44 KiB. */
  iconPngBase64: 44 * 1024,
  lanes: 16,
  laneDirections: LANE_DIRECTIONS.length,
  hazards: 50,
} as const;

/**
 * Keys that would carry message content. A 'message' carrying any of them is rejected outright
 * (not merely stripped) so a misbehaving phone app is caught rather than silently tolerated.
 * Compared case-insensitively.
 */
export const FORBIDDEN_MESSAGE_KEYS: readonly string[] = [
  'body',
  'text',
  'content',
  'message',
  'messages',
  'preview',
  'snippet',
  'subject',
  'bigtext',
  'subtext',
  'summarytext',
];

// Runtime lists for contract unions that have no runtime array, checked for exhaustiveness.
const CALL_STATES = ['ringing', 'dialing', 'active', 'held', 'ended'] as const;
const ROAD_CLASSES = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'service',
  'other',
] as const;
const COLLISION_LEVELS = ['none', 'caution', 'warning'] as const;
export type ProtocolEnumsAreExhaustive = [
  AssertTrue<Equals<(typeof CALL_STATES)[number], CallState>>,
  AssertTrue<Equals<(typeof ROAD_CLASSES)[number], RoadClass>>,
  AssertTrue<Equals<(typeof COLLISION_LEVELS)[number], CollisionLevel>>,
];

// ---------------------------------------------------------------------------
// Building blocks

const L = PROTOCOL_LIMITS;

/** C0 control characters and DEL: never valid in display strings (layout breakage, log injection). */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
/** Same, but tab/CR/LF are tolerated in free text. */
const CONTROL_CHARS_EXCEPT_WHITESPACE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const label = (max: number, min = 0) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((s) => !CONTROL_CHARS.test(s), 'must not contain control characters');
const freeText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => !CONTROL_CHARS_EXCEPT_WHITESPACE.test(s), 'must not contain control characters');

/** Nullable field that may also be omitted (normalised to null). */
const orNull = <T extends z.ZodType>(schema: T) => schema.nullable().default(null);
/** Optional, nullable field (kept as-is when present, absent when omitted). */
const maybe = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

/** `hudId`, `deviceId`, nonces: 22 base64url characters. */
const authId = z
  .string()
  .regex(AUTH_ID_PATTERN, `expected ${PHONE_AUTH.idChars} base64url characters`);
/** An HMAC proof: 43 base64url characters. */
const authProof = z
  .string()
  .regex(AUTH_PROOF_PATTERN, `expected ${PHONE_AUTH.proofChars} base64url characters`);

const nonNegative = (max: number) => z.number().min(0).max(max);
const epochMs = z.number().int().min(0).max(8.64e15);
const speedLimitKph = z.number().gt(0).max(500);

/** PNG signature 89 50 4E 47 0D 0A 1A 0A, base64-encoded. */
const PNG_BASE64_PREFIX = 'iVBORw0KGgo';
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const iconPng = z
  .string()
  .max(L.iconPngBase64)
  .refine(
    (s) => s.length % 4 === 0 && s.startsWith(PNG_BASE64_PREFIX) && BASE64.test(s),
    'expected a base64-encoded PNG',
  );

const maneuverSchema = z.object({
  type: z.enum(MANEUVER_TYPES),
  roundaboutExit: maybe(z.number().int().min(1).max(32)),
  roundaboutAngle: maybe(nonNegative(360)),
  instruction: maybe(freeText(L.text)),
});

const laneDirection = z.enum(LANE_DIRECTIONS);
const laneSchema = z.object({
  directions: z.array(laneDirection).max(L.laneDirections),
  recommended: z.boolean(),
  activeDirection: maybe(laneDirection),
});

const hazardSchema = z.object({
  id: label(L.id, 1),
  type: z.enum(HAZARD_TYPES),
  distanceM: orNull(nonNegative(1_000_000)),
  speedLimitKph: orNull(speedLimitKph),
  delaySeconds: orNull(nonNegative(86_400)),
  description: orNull(freeText(L.text)),
});

// ---------------------------------------------------------------------------
// Phone → HUD

const phoneSchemas = [
  z.object({
    t: z.literal('hello'),
    v: z.number().int().min(0).max(1_000_000),
    device: label(L.name),
    deviceId: authId,
    app: label(L.name),
    appVersion: label(L.version),
    nonce: authId,
    proof: authProof,
  }),
  z.object({
    t: z.literal('nav'),
    active: z.boolean(),
    source: label(L.name, 1),
    maneuver: maneuverSchema.optional(),
    distanceM: maybe(nonNegative(10_000_000)),
    street: maybe(label(L.name)),
    currentStreet: maybe(label(L.name)),
    then: maybe(maneuverSchema),
    lanes: maybe(z.array(laneSchema).max(L.lanes)),
    etaEpochMs: maybe(epochMs),
    remainingDistanceM: maybe(nonNegative(100_000_000)),
    remainingSeconds: maybe(nonNegative(10_000_000)),
    iconPng: maybe(iconPng),
  }),
  z.object({
    t: z.literal('road'),
    speedLimitKph: orNull(speedLimitKph),
    unlimited: z.boolean().optional(),
    source: z.enum(['osm', 'nav', 'sign-recognition', 'manual']),
    roadName: maybe(label(L.name)),
    roadClass: maybe(z.enum(ROAD_CLASSES)),
  }),
  z.object({
    t: z.literal('hazards'),
    items: z
      .array(hazardSchema)
      .max(L.hazards)
      .superRefine((items, ctx) => {
        const seen = new Set<string>();
        items.forEach((item, index) => {
          if (seen.has(item.id)) {
            ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'duplicate hazard id' });
          }
          seen.add(item.id);
        });
      }),
  }),
  z.object({
    t: z.literal('media'),
    playing: z.boolean(),
    title: orNull(label(L.mediaText)),
    artist: orNull(label(L.mediaText)),
    album: maybe(label(L.mediaText)),
    app: maybe(label(L.name)),
    trackKey: maybe(label(L.trackKey)),
  }),
  z.object({
    t: z.literal('call'),
    id: label(L.id, 1),
    state: z.enum(CALL_STATES),
    callerName: orNull(label(L.name)),
    number: orNull(label(L.phoneNumber)),
  }),
  z.object({
    t: z.literal('message'),
    id: label(L.id, 1),
    sender: label(L.name, 1),
    app: orNull(label(L.name)),
    readingAloud: z.boolean(),
  }),
  z.object({
    t: z.literal('location'),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    accuracyM: orNull(nonNegative(100_000)),
    speedMps: maybe(nonNegative(200)),
    bearingDeg: maybe(nonNegative(360)),
  }),
  z.object({ t: z.literal('input'), action: z.enum(INPUT_ACTIONS) }),
  z.object({ t: z.literal('trips-request'), since: epochMs }),
  z.object({ t: z.literal('ping'), id: z.number().optional() }),
] as const;

/** Strict schema for phone → HUD messages (unknown fields are stripped). */
export const phoneToHudSchema = z.discriminatedUnion('t', phoneSchemas);

// ---------------------------------------------------------------------------
// Renderer → Server, ADAS → HUD

/** Strict schema for renderer → server messages. */
export const rendererToServerSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('input'), action: z.enum(INPUT_ACTIONS) }),
]);

/** Strict schema for ADAS module messages. */
export const adasMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('blind-spot'), left: z.boolean(), right: z.boolean() }),
  z.object({
    t: z.literal('collision'),
    level: z.enum(COLLISION_LEVELS),
    ttcSeconds: maybe(nonNegative(600)),
  }),
  z.object({ t: z.literal('heartbeat') }),
]);

/** Fail to compile if a schema drifts from its contract type. */
export type ProtocolSchemasMatchContract = [
  AssertTrue<Equals<z.output<typeof phoneToHudSchema>, PhoneToHud>>,
  AssertTrue<Equals<z.output<typeof rendererToServerSchema>, RendererToServer>>,
  AssertTrue<Equals<z.output<typeof adasMessageSchema>, AdasMessage>>,
];

// ---------------------------------------------------------------------------
// Parsing

const MAX_REPORTED_ISSUES = 3;

function typesOf(schema: { options: readonly { shape: { t: { value: string } } }[] }) {
  return new Set(schema.options.map((o) => o.shape.t.value));
}
const PHONE_TYPES = typesOf(phoneToHudSchema);
const RENDERER_TYPES = typesOf(rendererToServerSchema);
const ADAS_TYPES = typesOf(adasMessageSchema);

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Pre-parse check on the raw object (before unknown keys are stripped). */
type RawCheck = (t: string, data: Record<string, unknown>) => string | null;

const rejectMessageContent: RawCheck = (t, data) => {
  if (t !== 'message') return null;
  const offending = Object.keys(data).find((key) =>
    FORBIDDEN_MESSAGE_KEYS.includes(key.toLowerCase()),
  );
  return offending === undefined
    ? null
    : `message: content field ${JSON.stringify(offending.slice(0, 40))} is not allowed (sender only)`;
};

function parseFrame<T>(
  raw: string,
  maxChars: number,
  schema: z.ZodType<T>,
  knownTypes: ReadonlySet<string>,
  rawCheck: RawCheck | null,
): ParseResult<T> {
  try {
    if (typeof raw !== 'string') return fail('expected a text frame');
    if (raw.length > maxChars)
      return fail(`message too large (${raw.length} > ${maxChars} characters)`);
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return fail('invalid JSON');
    }
    if (!isPlainObject(data)) return fail('expected a JSON object');
    const t = data['t'];
    if (typeof t !== 'string') return fail('missing message type "t"');
    if (!knownTypes.has(t)) return fail(`unknown message type ${JSON.stringify(t.slice(0, 40))}`);
    const rejected = rawCheck?.(t, data) ?? null;
    if (rejected !== null) return fail(rejected);

    const result = schema.safeParse(data, { error: issueMessage });
    if (result.success) return { ok: true, value: result.data };
    const issues = result.error.issues.slice(0, MAX_REPORTED_ISSUES);
    return fail(issues.map((i) => `${formatPath([t, ...i.path])}: ${i.message}`).join('; '));
  } catch {
    // Validation must never take the connection handler down.
    return fail('invalid message');
  }
}

/**
 * Strictly validate a raw WebSocket text frame from the phone. Unknown fields are stripped,
 * strings are length-capped (names 100 chars, iconPng 44 KiB base64), numbers must be finite.
 * A message with any content-like field ("body", "text", "content") on `message` is rejected.
 *
 * Also: unknown `t` values, out-of-range numbers, unknown enum values (maneuvers, lanes, hazard
 * types, input actions …), more than 16 lanes or 50 hazards, duplicate hazard ids, control
 * characters in display strings, non-PNG icons and a `hello` whose `deviceId`, `nonce` or
 * `proof` is not base64url of the right length (22, 22, 43 characters) are rejected. Omitted
 * nullable fields are normalised to null. Never throws; errors read like
 * "nav.distanceM: expected number >= 0".
 */
export function parsePhoneMessage(raw: string): ParseResult<PhoneToHud> {
  return parseFrame(raw, L.phoneFrameChars, phoneToHudSchema, PHONE_TYPES, rejectMessageContent);
}

/** Strictly validate a frame from the renderer / dev console (see `parsePhoneMessage`). */
export function parseRendererMessage(raw: string): ParseResult<RendererToServer> {
  return parseFrame(raw, L.smallFrameChars, rendererToServerSchema, RENDERER_TYPES, null);
}

/** Strictly validate one newline-delimited JSON datagram from the ADAS module. */
export function parseAdasMessage(raw: string): ParseResult<AdasMessage> {
  return parseFrame(raw, L.smallFrameChars, adasMessageSchema, ADAS_TYPES, null);
}
