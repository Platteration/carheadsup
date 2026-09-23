import { parsePhoneMessage } from '@carheadsup/core';
import type { PhoneToHud } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { phoneMessageToEvents } from '../src/phone/translate.ts';

const NOW = 1_790_000_000_000;

/** Parse like a real session does, so the tests exercise validated shapes. */
function parse(message: Record<string, unknown>): PhoneToHud {
  const result = parsePhoneMessage(JSON.stringify(message));
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('phoneMessageToEvents', () => {
  it('turns an active nav update into a complete NavInfo', () => {
    const events = phoneMessageToEvents(
      parse({
        t: 'nav',
        active: true,
        source: 'osmand',
        maneuver: { type: 'right' },
        distanceM: 250,
        street: 'Main St',
        lanes: [{ directions: ['straight', 'right'], recommended: true, activeDirection: 'right' }],
        etaEpochMs: NOW + 600_000,
      }),
      NOW,
    );
    expect(events).toEqual([
      {
        type: 'nav/update',
        at: NOW,
        nav: {
          source: 'osmand',
          maneuver: { type: 'right' },
          distanceToManeuverM: 250,
          street: 'Main St',
          currentStreet: null,
          thenManeuver: null,
          lanes: [
            { directions: ['straight', 'right'], recommended: true, activeDirection: 'right' },
          ],
          etaEpochMs: NOW + 600_000,
          remainingDistanceM: null,
          remainingSeconds: null,
          iconPng: null,
          updatedAt: NOW,
        },
      },
    ]);
  });

  it('defaults a missing maneuver to unknown and keeps the phone icon', () => {
    const [event] = phoneMessageToEvents(
      parse({ t: 'nav', active: true, source: 'google-maps', iconPng: 'iVBORw0KGgoAAAA=' }),
      NOW,
    );
    expect(event).toMatchObject({
      type: 'nav/update',
      nav: {
        maneuver: { type: 'unknown' },
        iconPng: 'iVBORw0KGgoAAAA=',
        distanceToManeuverM: null,
      },
    });
  });

  it('maps "then" to thenManeuver', () => {
    const [event] = phoneMessageToEvents(
      parse({ t: 'nav', active: true, source: 'x', then: { type: 'left' } }),
      NOW,
    );
    expect(event).toMatchObject({ nav: { thenManeuver: { type: 'left' } } });
  });

  it('clears navigation when guidance ends', () => {
    expect(phoneMessageToEvents(parse({ t: 'nav', active: false, source: 'x' }), NOW)).toEqual([
      { type: 'nav/clear', at: NOW },
    ]);
  });

  it('translates road info with defaults', () => {
    expect(
      phoneMessageToEvents(parse({ t: 'road', speedLimitKph: 50, source: 'osm' }), NOW),
    ).toEqual([
      {
        type: 'road/update',
        at: NOW,
        road: {
          speedLimitKph: 50,
          unlimited: false,
          source: 'osm',
          roadName: null,
          roadClass: null,
          updatedAt: NOW,
        },
      },
    ]);
    const [unlimited] = phoneMessageToEvents(
      parse({
        t: 'road',
        speedLimitKph: null,
        unlimited: true,
        source: 'nav',
        roadName: 'A9',
        roadClass: 'motorway',
      }),
      NOW,
    );
    expect(unlimited).toMatchObject({
      road: { speedLimitKph: null, unlimited: true, roadName: 'A9', roadClass: 'motorway' },
    });
  });

  it('stamps every hazard with the HUD clock', () => {
    const [event] = phoneMessageToEvents(
      parse({
        t: 'hazards',
        items: [
          { id: 'a', type: 'speed-camera', distanceM: 800, speedLimitKph: 80 },
          { id: 'b', type: 'traffic-jam', delaySeconds: 120, description: 'Stop and go' },
        ],
      }),
      NOW,
    );
    expect(event).toEqual({
      type: 'hazards/update',
      at: NOW,
      hazards: [
        {
          id: 'a',
          type: 'speed-camera',
          distanceM: 800,
          speedLimitKph: 80,
          delaySeconds: null,
          description: null,
          updatedAt: NOW,
        },
        {
          id: 'b',
          type: 'traffic-jam',
          distanceM: null,
          speedLimitKph: null,
          delaySeconds: 120,
          description: 'Stop and go',
          updatedAt: NOW,
        },
      ],
    });
    expect(phoneMessageToEvents(parse({ t: 'hazards', items: [] }), NOW)).toEqual([
      { type: 'hazards/update', at: NOW, hazards: [] },
    ]);
  });

  describe('media', () => {
    it('derives the track key from title, artist and album when the phone gives none', () => {
      const [event] = phoneMessageToEvents(
        parse({ t: 'media', playing: true, title: 'Song', artist: 'Band', album: 'LP' }),
        NOW,
      );
      expect(event).toEqual({
        type: 'media/update',
        at: NOW,
        media: {
          playing: true,
          title: 'Song',
          artist: 'Band',
          album: 'LP',
          app: null,
          trackKey: 'Song|Band|LP',
          updatedAt: NOW,
        },
      });
    });

    it('keeps an explicit track key and falls back for an empty one', () => {
      const [explicit] = phoneMessageToEvents(
        parse({
          t: 'media',
          playing: true,
          title: 'S',
          artist: null,
          trackKey: 'id:42',
          app: 'Spotify',
        }),
        NOW,
      );
      expect(explicit).toMatchObject({ media: { trackKey: 'id:42', app: 'Spotify' } });
      const [empty] = phoneMessageToEvents(
        parse({ t: 'media', playing: true, title: 'S', artist: null, trackKey: '' }),
        NOW,
      );
      expect(empty).toMatchObject({ media: { trackKey: 'S||' } });
    });

    it('reports "no media" when nothing plays and there is no title', () => {
      for (const title of [null, '']) {
        expect(
          phoneMessageToEvents(parse({ t: 'media', playing: false, title, artist: null }), NOW),
        ).toEqual([{ type: 'media/update', at: NOW, media: null }]);
      }
    });

    it('keeps a paused track with a title', () => {
      const [event] = phoneMessageToEvents(
        parse({ t: 'media', playing: false, title: 'Paused', artist: 'A' }),
        NOW,
      );
      expect(event).toMatchObject({
        media: { playing: false, title: 'Paused', trackKey: 'Paused|A|' },
      });
    });
  });

  it('translates calls, stamping both times with the HUD clock', () => {
    expect(
      phoneMessageToEvents(
        parse({ t: 'call', id: 'c1', state: 'ringing', callerName: 'Maria', number: '+1 555' }),
        NOW,
      ),
    ).toEqual([
      {
        type: 'call/update',
        at: NOW,
        call: {
          id: 'c1',
          state: 'ringing',
          callerName: 'Maria',
          number: '+1 555',
          startedAt: NOW,
          updatedAt: NOW,
        },
      },
    ]);
  });

  it('translates messages (sender only)', () => {
    expect(
      phoneMessageToEvents(
        parse({ t: 'message', id: 'm1', sender: 'Alex', app: 'Signal', readingAloud: true }),
        NOW,
      ),
    ).toEqual([
      {
        type: 'message/received',
        at: NOW,
        message: { id: 'm1', sender: 'Alex', app: 'Signal', receivedAt: NOW, readingAloud: true },
      },
    ]);
  });

  it('translates location (dropping speed and bearing) and input', () => {
    expect(
      phoneMessageToEvents(
        parse({ t: 'location', lat: 48.1, lon: 11.5, accuracyM: 5, speedMps: 13, bearingDeg: 90 }),
        NOW,
      ),
    ).toEqual([{ type: 'location/update', lat: 48.1, lon: 11.5, accuracyM: 5, at: NOW }]);
    expect(phoneMessageToEvents(parse({ t: 'input', action: 'primary' }), NOW)).toEqual([
      { type: 'input', action: 'primary', at: NOW },
    ]);
  });

  it('produces no events for session messages', () => {
    for (const message of [
      { t: 'hello', v: 1, device: 'Pixel', app: 'carheadsup', appVersion: '1.0', token: '' },
      { t: 'ping', id: 3 },
      { t: 'trips-request', since: 0 },
    ]) {
      expect(phoneMessageToEvents(parse(message), NOW)).toEqual([]);
    }
  });

  it('ignores message types it does not know (newer peers)', () => {
    const unknown = { t: 'future-thing' } as unknown as PhoneToHud;
    expect(phoneMessageToEvents(unknown, NOW)).toEqual([]);
  });
});
