import type {
  Hazard,
  HudEvent,
  Maneuver,
  MediaInfo,
  NavInfo,
  PhoneMedia,
  PhoneNav,
  PhoneToHud,
} from '@carheadsup/core';

/**
 * Translate one validated phone message into the HudEvents it implies, stamped with the HUD's
 * clock `now`. Session-level messages (hello, ping, trips-request) produce no events.
 * Shared by real phone sessions and the simulated phone.
 *
 *  - `nav` active → `nav/update` with a complete NavInfo (omitted fields null, a missing
 *    maneuver becomes `{ type: 'unknown' }`, `updatedAt = now`); inactive → `nav/clear`.
 *  - `road` → `road/update` (`unlimited` defaults to false).
 *  - `hazards` → `hazards/update` with every hazard stamped `updatedAt = now`.
 *  - `media` → `media/update`; nothing playing and no title means "no media session" (null).
 *    Without a `trackKey` from the phone the key is derived from title|artist|album.
 *  - `call` → `call/update`, `message` → `message/received` (sender only),
 *    `location` → `location/update`, `input` → `input`.
 *
 * The message is assumed to have passed `parsePhoneMessage`; unknown message types (from a
 * newer peer) yield no events.
 */
export function phoneMessageToEvents(message: PhoneToHud, now: number): HudEvent[] {
  switch (message.t) {
    case 'nav':
      return message.active
        ? [{ type: 'nav/update', nav: navInfo(message, now), at: now }]
        : [{ type: 'nav/clear', at: now }];
    case 'road':
      return [
        {
          type: 'road/update',
          road: {
            speedLimitKph: message.speedLimitKph,
            unlimited: message.unlimited ?? false,
            source: message.source,
            roadName: message.roadName ?? null,
            roadClass: message.roadClass ?? null,
            updatedAt: now,
          },
          at: now,
        },
      ];
    case 'hazards':
      return [
        {
          type: 'hazards/update',
          hazards: message.items.map((item): Hazard => ({ ...item, updatedAt: now })),
          at: now,
        },
      ];
    case 'media':
      return [{ type: 'media/update', media: mediaInfo(message, now), at: now }];
    case 'call':
      return [
        {
          type: 'call/update',
          call: {
            id: message.id,
            state: message.state,
            callerName: message.callerName,
            number: message.number,
            // The reducer re-derives startedAt from the call's phase; `now` is the first-seen time.
            startedAt: now,
            updatedAt: now,
          },
          at: now,
        },
      ];
    case 'message':
      return [
        {
          type: 'message/received',
          message: {
            id: message.id,
            sender: message.sender,
            app: message.app,
            receivedAt: now,
            readingAloud: message.readingAloud,
          },
          at: now,
        },
      ];
    case 'location':
      return [
        {
          type: 'location/update',
          lat: message.lat,
          lon: message.lon,
          accuracyM: message.accuracyM,
          at: now,
        },
      ];
    case 'input':
      return [{ type: 'input', action: message.action, at: now }];
    case 'hello':
    case 'ping':
    case 'trips-request':
      return [];
    default: {
      const unknown: never = message;
      void unknown;
      return [];
    }
  }
}

const UNKNOWN_MANEUVER: Maneuver = { type: 'unknown' };

function navInfo(message: PhoneNav, now: number): NavInfo {
  return {
    source: message.source,
    maneuver: message.maneuver ?? { ...UNKNOWN_MANEUVER },
    distanceToManeuverM: message.distanceM ?? null,
    street: message.street ?? null,
    currentStreet: message.currentStreet ?? null,
    thenManeuver: message.then ?? null,
    lanes: message.lanes ?? null,
    etaEpochMs: message.etaEpochMs ?? null,
    remainingDistanceM: message.remainingDistanceM ?? null,
    remainingSeconds: message.remainingSeconds ?? null,
    iconPng: message.iconPng ?? null,
    updatedAt: now,
  };
}

const present = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== '';

function mediaInfo(message: PhoneMedia, now: number): MediaInfo | null {
  if (!message.playing && !present(message.title)) return null;
  const album = message.album ?? null;
  const trackKey = present(message.trackKey)
    ? message.trackKey
    : `${message.title ?? ''}|${message.artist ?? ''}|${album ?? ''}`;
  return {
    playing: message.playing,
    title: message.title,
    artist: message.artist,
    album,
    app: message.app ?? null,
    trackKey,
    updatedAt: now,
  };
}
