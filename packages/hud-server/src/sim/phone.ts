/**
 * The simulated companion phone ("sim-phone"). It builds the same PhoneToHud messages a real
 * phone sends and runs them through the shared translator, so `--sim` exercises the real
 * phone path. It follows the demo scenario (VehicleSimulator steps) and the simulated odometer:
 *
 *  - warm-up: back at the start of the route, guidance off.
 *  - city: guidance starts along the scripted route; distances count down from the odometer
 *    about once a second and the next maneuver comes up once one is reached.
 *  - red-light: an incoming call that auto-answers after 6 s (unless the HUD accepts or
 *    declines it first) and ends 20 s after pickup.
 *  - highway: speed limits 120/100, a fixed speed camera in the 100 zone, and a traffic jam
 *    on the A7 beyond the exit (reported from the merge, withdrawn at the exit).
 *  - arriving: a message notification (sender only); guidance ends at the destination.
 *  - parked: the driver presses the companion app's remote "next page" button (an `input`
 *    message), which opens the diagnostics dashboard at once — the HUD would otherwise show it
 *    only after minutes with the engine off (start-stop protection).
 *
 * Speed limits follow the road segment under the car (re-sent every 30 s, like the companion);
 * a new track plays every 45 s. Manual triggers from the dev console work at any time.
 *
 * While a real phone is connected (`--sim` with the companion app) the simulated phone steps
 * aside: it keeps following the scenario but emits nothing — no link changes either — and takes
 * over again with its full state once the real phone has gone.
 */
import type {
  CallState,
  HudEvent,
  HudToPhone,
  PhoneHazards,
  PhoneNav,
  PhoneToHud,
  SimControl,
} from '@carheadsup/core';
import type { Logger } from '@carheadsup/obd/runtime';
import type { VehicleSimulator } from '@carheadsup/obd/sim';
import type { EventSource, PhoneMessageTranslator, SourceContext } from '../sources/types.ts';
import { OnceLogger, TimerSlots, cleanLabel, errorMessage } from '../sensors/util.ts';
import {
  ROUTE_LENGTH_M,
  ROUTE_MANEUVERS,
  SCRIPTED_HAZARDS,
  announceAt,
  dropAt,
  locationAt,
  nextManeuverIndex,
  remainingSeconds,
  roadAt,
  thenManeuver,
} from './route.ts';

export type SimPhoneEvent = NonNullable<SimControl['phone']>;

export const SIM_PHONE_DEVICE = 'Simulated phone';
/**
 * The simulated phone's `deviceId`: never a real phone's (those are 22 base64url characters),
 * so a real phone taking over is always a different phone.
 */
export const SIM_PHONE_DEVICE_ID = 'simulated-phone';
export const SIM_PHONE_APP_VERSION = 'simulator';
export const SIM_NAV_SOURCE = 'simulator';

/** Nav, road, hazard and location bookkeeping period. */
export const NAV_UPDATE_MS = 1000;
/** Location is reported every this many nav updates. */
const LOCATION_EVERY_TICKS = 5;
/** Hazard distances are refreshed this often (the HUD dead-reckons in between). */
export const HAZARD_REFRESH_MS = 10_000;
/**
 * The road is re-sent this often even when it has not changed, like the companion does: the HUD
 * drops a speed limit that has not been refreshed for 75 s (`ROAD_TTL_MS`).
 */
export const ROAD_REFRESH_MS = 30_000;
/** A new track starts this often. */
export const TRACK_CHANGE_MS = 45_000;
export const CALL_AUTO_ANSWER_MS = 6000;
export const CALL_DURATION_MS = 20_000;
/** Delay after entering 'arriving' before the scenario message arrives. */
export const ARRIVING_MESSAGE_DELAY_MS = 5000;
/** Guidance ends this long after the destination is reached. */
export const ARRIVED_END_MS = 3000;
/** Where a manually triggered camera appears, ahead of the car. */
export const MANUAL_CAMERA_AHEAD_M = 700;
/** A manually triggered camera is forgotten after this long if the car never reaches it. */
export const MANUAL_HAZARD_TTL_MS = 120_000;
/** Where a manually triggered jam starts, ahead of the car (within every reveal distance). */
export const MANUAL_JAM_AHEAD_M = 900;
/** A manually triggered jam's delay, seconds. */
export const MANUAL_JAM_DELAY_S = 420;
/** A manually triggered jam is forgotten after this long if the car never reaches it. */
export const MANUAL_JAM_TTL_MS = 300_000;

export interface Track {
  title: string;
  artist: string;
  album: string;
}

/** A small fictional playlist. */
export const SIM_PLAYLIST: readonly Track[] = [
  { title: 'Midnight Motorway', artist: 'The Night Shift', album: 'Neon Miles' },
  { title: 'Harbor Lights', artist: 'Ada Lindqvist', album: 'Coastlines' },
  { title: 'Slow Burn', artist: 'Copper & Pine', album: 'Embers' },
  { title: 'Long Way Round', artist: 'Marlowe Keys', album: 'Detours' },
  { title: 'Static Bloom', artist: 'Velvet Circuit', album: 'Afterglow' },
];
export const SIM_MEDIA_APP = 'Music';

export const SCENARIO_CALLER = { name: 'Sam Taylor', number: '+1 555 0142' } as const;
export const DEFAULT_MANUAL_CALLER = 'Maria Lopez';
export const SCENARIO_MESSAGE_SENDER = 'Robin Park';
export const DEFAULT_MESSAGE_SENDER = 'Alex Chen';
export const SIM_MESSAGE_APP = 'Messages';

/** Longest caller / sender name passed on (the protocol limit). */
const NAME_MAX = 100;

interface ActiveHazard {
  id: string;
  at: number;
  /** Withdrawn once the car reaches this route position (normally `at`). */
  dropAt: number;
  type: PhoneHazards['items'][number]['type'];
  speedLimitKph: number | null;
  delaySeconds: number | null;
  description: string;
  /** Manual hazards expire; scripted ones last until dropped. */
  expiresAt: number | null;
}

interface SimCall {
  id: string;
  state: CallState;
  callerName: string;
  number: string | null;
}

export interface SimPhoneOptions {
  vehicle: VehicleSimulator;
  translate: PhoneMessageTranslator;
  readMessagesAloud: boolean;
  /** For triggers that arrive while the source is stopped. */
  logger: Logger;
}

export class SimPhone implements EventSource {
  readonly name = 'sim-phone';
  private readonly vehicle: VehicleSimulator;
  private readonly translate: PhoneMessageTranslator;
  private readonly logger: Logger;
  private readonly once: OnceLogger;
  private readMessagesAloud: boolean;
  private ctx: SourceContext | null = null;
  private slots: TimerSlots | null = null;
  private unsubscribeStep: (() => void) | null = null;

  private connected = true;
  /** A real phone is connected: emit nothing (see the class comment). */
  private realPhone = false;
  /** Metres along the scripted route. */
  private position = 0;
  private lastOdometerKm: number | null = null;
  private ticks = 0;

  private navActive = false;
  private navIndex = 0;
  private arrived = false;
  private lastRoadKey: string | null = null;
  private roadSentAt = Number.NEGATIVE_INFINITY;

  private readonly hazards = new Map<string, ActiveHazard>();
  private readonly announced = new Set<string>();
  private hazardsSentAt = -Infinity;
  private lastHazardsSentCount = 0;

  private track = 0;
  private playing = true;
  private call: SimCall | null = null;
  private callSeq = 0;
  private messageSeq = 0;
  private cameraSeq = 0;
  private jamSeq = 0;

  constructor(options: SimPhoneOptions) {
    this.vehicle = options.vehicle;
    this.translate = options.translate;
    this.readMessagesAloud = options.readMessagesAloud;
    this.logger = options.logger;
    this.once = new OnceLogger(options.logger);
  }

  /** Whether the simulated phone link is up (as set from the dev console). */
  get isConnected(): boolean {
    return this.connected;
  }

  /** Whether the simulated phone has stepped aside for a real phone. */
  get isSteppedAside(): boolean {
    return this.realPhone;
  }

  /** Position along the scripted route in metres. */
  get routePosition(): number {
    return this.position;
  }

  async start(ctx: SourceContext): Promise<void> {
    if (this.ctx !== null) return;
    this.ctx = ctx;
    this.slots = new TimerSlots(ctx.timers);
    this.lastOdometerKm = this.odometerKm();
    this.unsubscribeStep = this.vehicle.onStep((step) => this.onStep(step));
    if (this.connected && !this.realPhone) {
      this.emitLink(true);
      this.sendFullState();
    }
    this.slots.set('tick', NAV_UPDATE_MS, () => this.tick());
    this.slots.set('track', TRACK_CHANGE_MS, () => this.nextTrack());
  }

  async stop(): Promise<void> {
    this.unsubscribeStep?.();
    this.unsubscribeStep = null;
    this.slots?.clearAll();
    this.slots = null;
    this.ctx = null;
  }

  updateConfig(config: { phone: { readMessagesAloud: boolean } }): void {
    this.readMessagesAloud = config.phone.readMessagesAloud;
  }

  /**
   * A real phone connected (true) or went away (false). The simulated phone steps aside in
   * between, and afterwards reconnects with its full state (unless it was disconnected from the
   * dev console meanwhile).
   */
  setRealPhoneConnected(connected: boolean): void {
    if (connected === this.realPhone) return;
    this.realPhone = connected;
    if (connected) {
      this.logger.info('Simulated phone: a real phone is connected; stepping aside');
      return;
    }
    this.logger.info('Simulated phone: the real phone has gone; taking over again');
    if (this.ctx !== null && this.connected) {
      this.emitLink(true);
      this.sendFullState();
    }
  }

  /** A phone scenario event from the dev console (SimControl.phone). */
  trigger(event: SimPhoneEvent): void {
    if (this.ctx === null) {
      this.logger.debug(`Simulated phone: ignoring "${event.kind}" while stopped`);
      return;
    }
    this.syncPosition();
    switch (event.kind) {
      case 'nav-start':
        this.startNav(false);
        return;
      case 'nav-stop':
        this.endNav();
        return;
      case 'incoming-call':
        this.startCall(cleanLabel(event.name, NAME_MAX, DEFAULT_MANUAL_CALLER), null);
        return;
      case 'end-call':
        this.finishCall();
        return;
      case 'next-track':
        this.nextTrack();
        return;
      case 'message':
        this.sendMessage(cleanLabel(event.sender, NAME_MAX, DEFAULT_MESSAGE_SENDER));
        return;
      case 'speed-camera':
        this.addManualCamera();
        return;
      case 'traffic-jam':
        this.addManualJam();
        return;
      case 'disconnect':
        this.disconnect();
        return;
      case 'connect':
        this.connect();
        return;
      default:
        this.logger.warn(`Simulated phone: unknown event ${JSON.stringify(event)}`);
    }
  }

  /** A message from the HUD to "the phone": call-action accept/decline is honoured. */
  deliver(message: HudToPhone): void {
    if (message.t !== 'call-action' || this.ctx === null || !this.connected) return;
    if (this.realPhone) return; // meant for the real phone
    const call = this.call;
    if (call === null || call.id !== message.callId) return;
    if (message.action === 'accept') this.answerCall();
    else this.finishCall();
  }

  // -------------------------------------------------------------------------------------------
  // Scenario and periodic updates

  private onStep(step: string): void {
    if (this.ctx === null) return;
    this.syncPosition();
    switch (step) {
      case 'warm-up':
        // The demo loops back to the start of the route.
        if (this.navActive) this.endNav();
        this.resetDrive();
        break;
      case 'city':
        this.resetDrive();
        this.startNav(true);
        break;
      case 'red-light':
        this.startCall(SCENARIO_CALLER.name, SCENARIO_CALLER.number);
        break;
      case 'arriving':
        this.slots?.set('arriving-message', ARRIVING_MESSAGE_DELAY_MS, () =>
          this.sendMessage(SCENARIO_MESSAGE_SENDER),
        );
        break;
      case 'parked':
        if (this.navActive) this.endNav();
        this.send({ t: 'input', action: 'next-page' });
        break;
      default:
        break;
    }
    this.updateRoad(false);
    this.updateHazards();
  }

  private tick(): void {
    if (this.ctx === null) return;
    this.syncPosition();
    this.ticks += 1;
    this.updateRoad(false);
    this.updateNav();
    this.updateHazards();
    if (this.ticks % LOCATION_EVERY_TICKS === 0) this.sendLocation();
    this.slots?.set('tick', NAV_UPDATE_MS, () => this.tick());
  }

  private odometerKm(): number {
    return this.vehicle.snapshot().odometerKm;
  }

  /** Advance the route position by the distance the simulated car covered. */
  private syncPosition(): void {
    const odometer = this.odometerKm();
    const last = this.lastOdometerKm;
    this.lastOdometerKm = odometer;
    if (last === null) return;
    const deltaM = (odometer - last) * 1000;
    if (Number.isFinite(deltaM) && deltaM > 0) this.position += deltaM;
  }

  /** Back to the start of the route (the demo drive loops). */
  private resetDrive(): void {
    this.position = 0;
    this.lastOdometerKm = this.odometerKm();
    this.announced.clear();
    if (this.hazards.size > 0) {
      this.hazards.clear();
      this.sendHazards();
    }
  }

  // -------------------------------------------------------------------------------------------
  // Road, navigation, hazards, location

  /** Send the road when it changed, when forced, and every {@link ROAD_REFRESH_MS} regardless. */
  private updateRoad(force: boolean): void {
    const segment = roadAt(this.position);
    const key = `${segment.name}|${segment.speedLimitKph}|${segment.roadClass}`;
    const now = this.ctx?.now() ?? 0;
    const due = now - this.roadSentAt >= ROAD_REFRESH_MS;
    if (!force && !due && key === this.lastRoadKey) return;
    this.lastRoadKey = key;
    this.roadSentAt = now;
    this.send({
      t: 'road',
      speedLimitKph: segment.speedLimitKph,
      unlimited: false,
      source: 'osm',
      roadName: segment.name,
      roadClass: segment.roadClass,
    });
  }

  private startNav(fromStart: boolean): void {
    if (fromStart || this.position >= ROUTE_LENGTH_M - 10) this.resetDrive();
    this.navActive = true;
    this.arrived = false;
    this.slots?.clear('nav-end');
    this.navIndex = nextManeuverIndex(this.position);
    this.updateRoad(false);
    this.updateNav();
  }

  private endNav(): void {
    this.slots?.clear('nav-end');
    if (!this.navActive) return;
    this.navActive = false;
    this.arrived = false;
    this.send({ t: 'nav', active: false, source: SIM_NAV_SOURCE });
  }

  /** Move past reached maneuvers and send the current guidance. */
  private updateNav(): void {
    if (!this.navActive) return;
    const last = ROUTE_MANEUVERS.length - 1;
    while (this.navIndex < last && this.position >= ROUTE_MANEUVERS[this.navIndex]!.at) {
      this.navIndex += 1;
    }
    if (!this.arrived && this.position >= ROUTE_MANEUVERS[last]!.at) {
      this.navIndex = last;
      this.arrived = true;
      this.slots?.set('nav-end', ARRIVED_END_MS, () => this.endNav());
    }
    this.sendNav();
  }

  private navMessage(): PhoneNav | null {
    const ctx = this.ctx;
    const step = ROUTE_MANEUVERS[this.navIndex];
    if (ctx === null || step === undefined) return null;
    const seconds = remainingSeconds(this.position);
    return {
      t: 'nav',
      active: true,
      source: SIM_NAV_SOURCE,
      maneuver: step.maneuver,
      distanceM: Math.round(Math.max(0, step.at - this.position)),
      street: step.street,
      currentStreet: roadAt(this.position).name,
      then: thenManeuver(this.navIndex),
      lanes: step.lanes,
      etaEpochMs: Math.round(ctx.now() + seconds * 1000),
      remainingDistanceM: Math.round(Math.max(0, ROUTE_LENGTH_M - this.position)),
      remainingSeconds: seconds,
      iconPng: null,
    };
  }

  private sendNav(): void {
    const message = this.navMessage();
    if (message !== null) this.send(message);
  }

  private addManualCamera(): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    this.cameraSeq += 1;
    const limit = roadAt(this.position).speedLimitKph;
    const at = this.position + MANUAL_CAMERA_AHEAD_M;
    this.hazards.set(`sim-camera-${this.cameraSeq}`, {
      id: `sim-camera-${this.cameraSeq}`,
      at,
      dropAt: at,
      type: 'speed-camera',
      speedLimitKph: limit,
      delaySeconds: null,
      description: 'Mobile speed camera',
      expiresAt: ctx.now() + MANUAL_HAZARD_TTL_MS,
    });
    this.sendHazards();
  }

  /** A traffic jam ahead, as the companion's traffic look-up reports one. */
  private addManualJam(): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    this.jamSeq += 1;
    const at = this.position + MANUAL_JAM_AHEAD_M;
    this.hazards.set(`sim-jam-${this.jamSeq}`, {
      id: `sim-jam-${this.jamSeq}`,
      at,
      dropAt: at,
      type: 'traffic-jam',
      speedLimitKph: null,
      delaySeconds: MANUAL_JAM_DELAY_S,
      description: 'Stationary traffic',
      expiresAt: ctx.now() + MANUAL_JAM_TTL_MS,
    });
    this.sendHazards();
  }

  private updateHazards(): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const now = ctx.now();
    let changed = false;
    for (const hazard of SCRIPTED_HAZARDS) {
      if (this.announced.has(hazard.id)) continue;
      if (this.position < announceAt(hazard) || this.position >= dropAt(hazard)) continue;
      this.announced.add(hazard.id);
      this.hazards.set(hazard.id, {
        id: hazard.id,
        at: hazard.at,
        dropAt: dropAt(hazard),
        type: hazard.type,
        speedLimitKph: hazard.speedLimitKph,
        delaySeconds: hazard.delaySeconds,
        description: hazard.description,
        expiresAt: null,
      });
      changed = true;
    }
    for (const [id, hazard] of this.hazards) {
      const passed = this.position >= hazard.dropAt;
      const expired = hazard.expiresAt !== null && now >= hazard.expiresAt;
      if (passed || expired) {
        this.hazards.delete(id);
        changed = true;
      }
    }
    const due = this.hazards.size > 0 && now - this.hazardsSentAt >= HAZARD_REFRESH_MS;
    if (changed || due) this.sendHazards();
  }

  /** Send the hazard list; an empty list only when it clears something (or `force`). */
  private sendHazards(force = false): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const items = [...this.hazards.values()].map((h) => ({
      id: h.id,
      type: h.type,
      distanceM: Math.round(Math.max(0, h.at - this.position)),
      speedLimitKph: h.speedLimitKph,
      delaySeconds: h.delaySeconds,
      description: h.description,
    }));
    if (!force && items.length === 0 && this.lastHazardsSentCount === 0) return;
    this.hazardsSentAt = ctx.now();
    this.lastHazardsSentCount = items.length;
    this.send({ t: 'hazards', items });
  }

  private sendLocation(): void {
    const { lat, lon, bearingDeg } = locationAt(this.position);
    const speedMps = Math.min(200, Math.max(0, this.vehicle.snapshot().speedKph / 3.6));
    this.send({
      t: 'location',
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      accuracyM: 5,
      speedMps: Math.round(speedMps * 10) / 10,
      bearingDeg,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Media, calls, messages

  private sendMedia(): void {
    const track = SIM_PLAYLIST[this.track % SIM_PLAYLIST.length]!;
    this.send({
      t: 'media',
      playing: this.playing,
      title: track.title,
      artist: track.artist,
      album: track.album,
      app: SIM_MEDIA_APP,
      trackKey: `sim-track-${this.track % SIM_PLAYLIST.length}`,
    });
  }

  private nextTrack(): void {
    this.track = (this.track + 1) % SIM_PLAYLIST.length;
    this.playing = true;
    this.sendMedia();
    this.slots?.set('track', TRACK_CHANGE_MS, () => this.nextTrack());
  }

  private startCall(callerName: string, number: string | null): void {
    // A second call replaces the first (the simulated phone has no call waiting).
    if (this.call !== null) this.finishCall();
    this.callSeq += 1;
    this.call = { id: `sim-call-${this.callSeq}`, state: 'ringing', callerName, number };
    this.sendCall();
    this.slots?.set('call', CALL_AUTO_ANSWER_MS, () => this.answerCall());
  }

  private answerCall(): void {
    const call = this.call;
    if (call === null || call.state !== 'ringing') return;
    call.state = 'active';
    this.sendCall();
    this.slots?.set('call', CALL_DURATION_MS, () => this.finishCall());
  }

  /** Decline a ringing call or hang up an active one. */
  private finishCall(): void {
    const call = this.call;
    if (call === null) return;
    this.slots?.clear('call');
    call.state = 'ended';
    this.sendCall();
    this.call = null;
  }

  private sendCall(): void {
    const call = this.call;
    if (call === null) return;
    this.send({
      t: 'call',
      id: call.id,
      state: call.state,
      callerName: call.callerName,
      number: call.number,
    });
  }

  private sendMessage(sender: string): void {
    this.messageSeq += 1;
    this.send({
      t: 'message',
      id: `sim-msg-${this.messageSeq}`,
      sender,
      app: SIM_MESSAGE_APP,
      readingAloud: this.readMessagesAloud,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Link

  private disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.emitLink(false);
  }

  /** Reconnect and resend everything, as the companion app does after its hello. */
  private connect(): void {
    if (this.connected) return;
    this.connected = true;
    this.emitLink(true);
    this.sendFullState();
  }

  private sendFullState(): void {
    this.updateRoad(true);
    this.sendMedia();
    if (this.navActive) this.sendNav();
    this.sendHazards(true);
    this.sendCall();
  }

  private emitLink(connected: boolean): void {
    const ctx = this.ctx;
    if (ctx === null || this.realPhone) return;
    ctx.emit({
      type: 'phone/link',
      connected,
      deviceName: SIM_PHONE_DEVICE,
      deviceId: SIM_PHONE_DEVICE_ID,
      appVersion: SIM_PHONE_APP_VERSION,
      at: ctx.now(),
    });
  }

  /**
   * Translate and emit a phone message; dropped while the link is down (like a real phone) and
   * while a real phone is connected.
   */
  private send(message: PhoneToHud): void {
    const ctx = this.ctx;
    if (ctx === null || !this.connected || this.realPhone) return;
    let events: HudEvent[];
    try {
      events = this.translate(message, ctx.now());
    } catch (err) {
      this.once.warn(
        `translate-${message.t}`,
        `Simulated phone: cannot translate "${message.t}": ${errorMessage(err)}`,
      );
      return;
    }
    for (const event of events) ctx.emit(event);
  }
}
