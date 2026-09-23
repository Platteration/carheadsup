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
 *  Phone  ⇄ HUD : WebSocket `ws://<hud>:<port>/ws/phone`   (companion app)
 *  Renderer ⇄ HUD : WebSocket `ws://<hud>:<port>/ws/hud`   (projected display & dev console)
 *
 * Timestamps on the phone link are the phone's epoch ms; the HUD re-stamps on receipt
 * and uses the phone's clock only for absolute values such as ETA.
 */
export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Phone → HUD

export interface PhoneHello {
  t: 'hello';
  v: number;
  device: string;
  app: string;
  appVersion: string;
  /** Must equal `phone.pairingToken` when one is configured. */
  token: string;
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
  /** Base64 PNG (≤ 32 KiB) of the nav app's maneuver icon. */
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
  /** Return trips that ended after this epoch ms. */
  since: number;
}

export interface Ping {
  t: 'ping';
  id?: number;
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

export interface HudWelcome {
  t: 'welcome';
  v: number;
  hudName: string;
  hudVersion: string;
  /** Whether the phone should read messages aloud (from `phone.readMessagesAloud`). */
  readMessagesAloud: boolean;
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
  HudWelcome | HudError | HudCallAction | HudTrips | HudTripCompleted | HudMaintenanceDue | Pong;

// ---------------------------------------------------------------------------
// Server → Renderer

export interface RendererFrameMessage {
  t: 'frame';
  frame: HudFrame;
}

/** Sent on connect and whenever the display config changes. */
export interface RendererDisplayMessage {
  t: 'display';
  projection: HudConfig['display']['projection'];
  /** True when the server runs the simulator (enables the dev console controls). */
  simulated: boolean;
}

export type ServerToRenderer = RendererFrameMessage | RendererDisplayMessage;

// ---------------------------------------------------------------------------
// Renderer → Server

export interface RendererInput {
  t: 'input';
  action: InputAction;
}

export type RendererToServer = RendererInput;

// ---------------------------------------------------------------------------
// ADAS module → HUD (newline-delimited JSON over UDP, see `sensors.adasUdpPort`)

export type AdasMessage =
  | { t: 'blind-spot'; left: boolean; right: boolean }
  | { t: 'collision'; level: CollisionLevel; ttcSeconds?: number | null }
  | { t: 'heartbeat' };
