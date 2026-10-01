import type { CollisionLevel } from './adas.ts';
import type { HudConfig } from './config.ts';
import type { InputAction } from './events.ts';
import type { HudFrame } from './frame.ts';
import type { Hazard, Lane, Maneuver, RoadClass } from './nav.ts';
import type { CallState } from './phone.ts';
import type { TripRecord } from './records.ts';

/**
 * Wire protocols. Every message is a JSON object with a `t` (type) discriminator.
 *
 *  Phone  ⇄ HUD : WebSocket over TLS `wss://<hud>:<tlsPort>/ws/phone`   (companion app)
 *  Renderer ⇄ HUD : WebSocket `ws://<hud>:<port>/ws/hud`   (projected display & dev console)
 *
 * Timestamps on the phone link are the phone's epoch ms; the HUD re-stamps on receipt
 * and uses the phone's clock only for absolute values such as ETA — and, while its own system
 * clock is not synchronised to network time, as its wall clock (`hello.time`, `ping.time`).
 *
 * The phone link runs over TLS with the HUD's self-signed certificate, which the phone pins, and
 * starts with a mutual proof of the pairing token (`phone.pairingToken`), which itself never
 * travels: HUD `challenge` → phone `hello` (with the phone's proof) → HUD `welcome` (with the
 * HUD's proof). Both proofs cover the certificate's fingerprint (channel binding). The proof
 * messages are built by `protocol/phone-auth.ts`.
 */
export const PROTOCOL_VERSION = 3;

// ---------------------------------------------------------------------------
// Phone → HUD

/** The phone's answer to `challenge`. The HUD answers with `welcome`, or `error` and a close. */
export interface PhoneHello {
  t: 'hello';
  v: number;
  /** Display name of the phone (logs, the HUD's phone status). Not an identity. */
  device: string;
  /**
   * The phone's identity: a random id made once per app install, 22 base64url characters
   * (16 bytes). A newer session with the same id replaces the older one.
   */
  deviceId: string;
  app: string;
  appVersion: string;
  /** Fresh random nonce of this connection: 22 base64url characters (16 bytes). */
  nonce: string;
  /**
   * base64url (43 characters, no padding) of HMAC-SHA256 keyed with the UTF-8 bytes of the
   * pairing token over `phoneProofMessage(…)`: proves the phone knows the token, for this
   * challenge and the TLS certificate the phone was shown.
   */
  proof: string;
  /**
   * The phone's wall clock (epoch ms) when it sent this hello. A HUD whose system clock is not
   * synchronised to network time sets its wall clock from it (the midpoint between its
   * `challenge` and this hello). Absent from older phones.
   */
  time?: number;
}

export interface PhoneNav {
  t: 'nav';
  /** False ends guidance. */
  active: boolean;
  source: string;
  maneuver?: Maneuver;
  distanceM?: number | null;
  street?: string | null;
  currentStreet?: string | null;
  then?: Maneuver | null;
  lanes?: Lane[] | null;
  etaEpochMs?: number | null;
  remainingDistanceM?: number | null;
  remainingSeconds?: number | null;
  /**
   * Base64 PNG (≤ 32 KiB) of the nav app's maneuver icon, as a mask: white where the arrow is,
   * transparent elsewhere (the renderer fills it with the HUD's accent colour).
   */
  iconPng?: string | null;
}

export interface PhoneRoad {
  t: 'road';
  speedLimitKph: number | null;
  unlimited?: boolean;
  source: 'osm' | 'nav' | 'sign-recognition' | 'manual';
  roadName?: string | null;
  roadClass?: RoadClass | null;
}

export interface PhoneHazards {
  t: 'hazards';
  items: Array<Omit<Hazard, 'updatedAt'>>;
}

export interface PhoneMedia {
  t: 'media';
  /** False with nulls when nothing is playing / session gone. */
  playing: boolean;
  title: string | null;
  artist: string | null;
  album?: string | null;
  app?: string | null;
  trackKey?: string | null;
}

export interface PhoneCall {
  t: 'call';
  id: string;
  state: CallState;
  callerName: string | null;
  number: string | null;
}

/** Sender only — the protocol deliberately has no field for message content. */
export interface PhoneMessage {
  t: 'message';
  id: string;
  sender: string;
  app: string | null;
  readingAloud: boolean;
}

export interface PhoneLocation {
  t: 'location';
  lat: number;
  lon: number;
  accuracyM: number | null;
  speedMps?: number | null;
  bearingDeg?: number | null;
}

/** The phone's own remote control (big buttons in the companion app). */
export interface PhoneInput {
  t: 'input';
  action: InputAction;
}

export interface PhoneTripsRequest {
  t: 'trips-request';
  /**
   * Return trips that ended after this epoch ms. With `sinceSeq`, only trips without a sequence
   * number (recorded by older HUD versions) are selected by it; older HUDs ignore `sinceSeq`.
   */
  since: number;
  /** Return trips whose `TripRecord.seq` is greater than this (oldest first). */
  sinceSeq?: number;
}

export interface Ping {
  t: 'ping';
  id?: number;
  /** The phone's wall clock (epoch ms) when it sent this ping (see `PhoneHello.time`). */
  time?: number;
}

export type PhoneToHud =
  | PhoneHello
  | PhoneNav
  | PhoneRoad
  | PhoneHazards
  | PhoneMedia
  | PhoneCall
  | PhoneMessage
  | PhoneLocation
  | PhoneInput
  | PhoneTripsRequest
  | Ping;

// ---------------------------------------------------------------------------
// HUD → Phone

/** Sent by the HUD as soon as a phone connects, before anything else. */
export interface HudChallenge {
  t: 'challenge';
  v: number;
  /**
   * The HUD's identity: 22 base64url characters (16 random bytes) made on first start and kept
   * in the data directory; also advertised as the mDNS TXT record `id`. The phone pins it.
   */
  hudId: string;
  /** Fresh random nonce of this connection: 22 base64url characters (16 bytes). */
  nonce: string;
}

/** Accepted `hello`. The phone trusts the HUD only once `proof` checks out. */
export interface HudWelcome {
  t: 'welcome';
  v: number;
  hudName: string;
  hudVersion: string;
  /** Whether the phone should read messages aloud (from `phone.readMessagesAloud`). */
  readMessagesAloud: boolean;
  /** Same as in `challenge`. */
  hudId: string;
  /**
   * base64url (43 characters) of HMAC-SHA256 keyed with the pairing token over
   * `hudProofMessage(…)`: proves the HUD knows the token, for this hello and its own TLS
   * certificate.
   */
  proof: string;
}

export interface HudError {
  t: 'error';
  code: 'bad-token' | 'bad-message' | 'unsupported-version' | 'internal';
  message: string;
}

export interface HudCallAction {
  t: 'call-action';
  callId: string;
  action: 'accept' | 'decline';
}

/**
 * Answer to `trips-request`: newest first for `since`; with `sinceSeq`, the trips after it in
 * the order they were recorded, so a phone that gets the most per answer asks again from there.
 */
export interface HudTrips {
  t: 'trips';
  trips: TripRecord[];
}

/** Pushed when a trip ends so the phone can log it. */
export interface HudTripCompleted {
  t: 'trip-completed';
  trip: TripRecord;
}

export interface HudMaintenanceDue {
  t: 'maintenance-due';
  items: Array<{
    itemId: string;
    label: string;
    status: 'due-soon' | 'overdue';
    remainingKm: number | null;
    remainingDays: number | null;
  }>;
}

export interface Pong {
  t: 'pong';
  id?: number;
}

export type HudToPhone =
  | HudChallenge
  | HudWelcome
  | HudError
  | HudCallAction
  | HudTrips
  | HudTripCompleted
  | HudMaintenanceDue
  | Pong;

// ---------------------------------------------------------------------------
// Server → Renderer

export interface RendererFrameMessage {
  t: 'frame';
  frame: HudFrame;
}

/** Sent on connect and whenever the projection or `hardwareBrightness` changes. */
export interface RendererDisplayMessage {
  t: 'display';
  projection: HudConfig['display']['projection'];
  /** True when the server runs the simulator (enables the dev console controls). */
  simulated: boolean;
  /**
   * True while the server applies `theme.brightness` to the display hardware (a Linux backlight
   * device): the kiosk must then not dim the content as well, or the result would be about
   * b × b^2.2 instead of b. Previews on other screens keep dimming (they are not lit by that
   * backlight). Absent from older servers: treat as false.
   */
  hardwareBrightness: boolean;
}

export type ServerToRenderer = RendererFrameMessage | RendererDisplayMessage;

// ---------------------------------------------------------------------------
// Renderer → Server

export interface RendererInput {
  t: 'input';
  action: InputAction;
}

/**
 * The kiosk page's heartbeat, sent about once a second from a `requestAnimationFrame` callback:
 * it proves that the page's main thread and the browser's compositor still run (the page's own
 * staleness guards cannot catch a hang of either). The server records it for the HUD's own
 * display only and reports its age at `GET /api/kiosk/health`, where the kiosk launcher looks
 * and restarts the browser when it stops.
 */
export interface RendererAlive {
  t: 'alive';
}

/**
 * An error the page caught (an exception that made the kiosk page start over, or one no code
 * handled), so that it reaches the server's log. Rate-limited by the page and the server.
 */
export interface RendererClientError {
  t: 'client-error';
  /** The error's message (at most {@link CLIENT_ERROR_MESSAGE_CHARS} characters). */
  message: string;
  /** Its stack trace, if any (at most {@link CLIENT_ERROR_STACK_CHARS} characters). */
  stack: string | null;
}

/** Largest renderer → server frame, in UTF-16 code units. */
export const RENDERER_FRAME_CHARS = 4096;
/** Longest `client-error` message and stack trace; the page shortens longer ones. */
export const CLIENT_ERROR_MESSAGE_CHARS = 500;
export const CLIENT_ERROR_STACK_CHARS = 2500;

export type RendererToServer = RendererInput | RendererAlive | RendererClientError;

// ---------------------------------------------------------------------------
// ADAS module → HUD (newline-delimited JSON over UDP, see `sensors.adasUdpPort`)

export type AdasMessage =
  | { t: 'blind-spot'; left: boolean; right: boolean }
  | { t: 'collision'; level: CollisionLevel; ttcSeconds?: number | null }
  | { t: 'heartbeat' };
