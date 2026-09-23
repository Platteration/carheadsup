import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_MESSAGE_KEYS,
  PROTOCOL_LIMITS,
  parseAdasMessage,
  parsePhoneMessage,
  parseRendererMessage,
} from '../../src/protocol/validate.ts';
import type { ParseResult } from '../../src/protocol/validate.ts';
import { INPUT_ACTIONS } from '../../src/types/events.ts';
import { HAZARD_TYPES, LANE_DIRECTIONS, MANEUVER_TYPES } from '../../src/types/nav.ts';

const json = (value: unknown): string => JSON.stringify(value);

function ok<T>(result: ParseResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result.value;
}

function err<T>(result: ParseResult<T>): string {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`);
  return result.error;
}

/** Smallest valid PNG header in base64 (signature + IHDR start). */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const hello = {
  t: 'hello',
  v: 1,
  device: 'Pixel 9',
  app: 'carheadsup',
  appVersion: '1.0.0',
  token: 'secret',
};
const nav = {
  t: 'nav',
  active: true,
  source: 'google-maps',
  maneuver: {
    type: 'right',
    roundaboutExit: null,
    roundaboutAngle: null,
    instruction: 'Turn right onto Main St',
  },
  distanceM: 250,
  street: 'Main St',
  currentStreet: 'High St',
  then: { type: 'keep-left' },
  lanes: [
    { directions: ['left'], recommended: false },
    { directions: ['straight', 'right'], recommended: true, activeDirection: 'right' },
  ],
  etaEpochMs: 1_760_000_000_000,
  remainingDistanceM: 12_000,
  remainingSeconds: 900,
  iconPng: PNG,
};
const road = {
  t: 'road',
  speedLimitKph: 50,
  unlimited: false,
  source: 'osm',
  roadName: 'Main St',
  roadClass: 'primary',
};
const hazard = {
  id: 'h1',
  type: 'speed-camera',
  distanceM: 800,
  speedLimitKph: 50,
  delaySeconds: null,
  description: 'Fixed camera',
};
const media = {
  t: 'media',
  playing: true,
  title: 'Song',
  artist: 'Band',
  album: 'LP',
  app: 'Spotify',
  trackKey: 'k1',
};
const call = {
  t: 'call',
  id: 'c1',
  state: 'ringing',
  callerName: 'Alice',
  number: '+44 20 7946 0000',
};
const message = { t: 'message', id: 'm1', sender: 'Bob', app: 'WhatsApp', readingAloud: true };
const location = {
  t: 'location',
  lat: 51.5,
  lon: -0.12,
  accuracyM: 5,
  speedMps: 13.9,
  bearingDeg: 270,
};

describe('parsePhoneMessage — framing', () => {
  it.each([
    ['not JSON', '{nope', 'invalid JSON'],
    ['empty', '', 'invalid JSON'],
    ['an array', '[1,2]', 'expected a JSON object'],
    ['a string', '"hello"', 'expected a JSON object'],
    ['null', 'null', 'expected a JSON object'],
    ['a number', '42', 'expected a JSON object'],
    ['missing t', '{"v":1}', 'missing message type "t"'],
    ['non-string t', '{"t":5}', 'missing message type "t"'],
    ['unknown t', '{"t":"welcome"}', 'unknown message type "welcome"'],
  ])('rejects %s', (_label, raw, error) => {
    expect(err(parsePhoneMessage(raw))).toBe(error);
  });

  it('truncates an absurd unknown type in the error', () => {
    const error = err(parsePhoneMessage(json({ t: 'x'.repeat(5000) })));
    expect(error.length).toBeLessThan(80);
  });

  it('rejects oversized frames before parsing them', () => {
    const raw = json({ ...media, title: 'x'.repeat(PROTOCOL_LIMITS.phoneFrameChars) });
    expect(err(parsePhoneMessage(raw))).toMatch(/^message too large \(\d+ > 131072 characters\)$/);
  });

  it('rejects non-finite numbers (JSON overflow to Infinity)', () => {
    expect(err(parsePhoneMessage('{"t":"nav","active":true,"source":"g","distanceM":1e999}'))).toBe(
      'nav.distanceM: expected number, got Infinity',
    );
  });

  it('never throws, whatever it is fed', () => {
    const garbage = [
      '['.repeat(100_000),
      '{"t":"nav","active":true,"source":"g","lanes":' +
        '['.repeat(50_000) +
        ']'.repeat(50_000) +
        '}',
      '{"__proto__":{"t":"ping"}}',
      '{"t":"ping","constructor":{"prototype":{"polluted":true}}}',
      '\u0000',
      undefined as unknown as string,
      42 as unknown as string,
    ];
    for (const raw of garbage) {
      expect(() => parsePhoneMessage(raw)).not.toThrow();
      expect(parsePhoneMessage(raw).ok).toBe(raw === garbage[3]);
    }
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('reports at most three issues, each with a path', () => {
    const error = err(
      parsePhoneMessage(
        json({ t: 'location', lat: 91, lon: 181, accuracyM: -1, speedMps: -1, bearingDeg: 400 }),
      ),
    );
    expect(error.split('; ')).toEqual([
      'location.lat: expected number <= 90',
      'location.lon: expected number <= 180',
      'location.accuracyM: expected number >= 0',
    ]);
  });
});

describe('parsePhoneMessage — hello', () => {
  it('accepts a valid hello and strips unknown fields', () => {
    expect(ok(parsePhoneMessage(json({ ...hello, extra: 'x' })))).toEqual(hello);
  });

  it.each([
    [{ token: undefined }, 'hello.token: required'],
    [{ v: 1.5 }, 'hello.v: expected integer, got 1.5'],
    [{ v: '1' }, 'hello.v: expected number, got string'],
    [{ device: 'd'.repeat(101) }, 'hello.device: expected at most 100 characters'],
    [{ token: 't'.repeat(257) }, 'hello.token: expected at most 256 characters'],
  ])('rejects %j', (override, error) => {
    expect(err(parsePhoneMessage(json({ ...hello, ...override })))).toBe(error);
  });
});

describe('parsePhoneMessage — nav', () => {
  it('accepts a full guidance update', () => {
    expect(ok(parsePhoneMessage(json(nav)))).toEqual(nav);
  });

  it('accepts guidance ending with only the required fields', () => {
    expect(ok(parsePhoneMessage(json({ t: 'nav', active: false, source: 'osmand' })))).toEqual({
      t: 'nav',
      active: false,
      source: 'osmand',
    });
  });

  it('strips unknown fields at every level', () => {
    const value = ok(
      parsePhoneMessage(
        json({
          ...nav,
          secret: 1,
          maneuver: { type: 'left', bogus: true },
          lanes: [{ directions: ['left'], recommended: true, colour: 'red' }],
        }),
      ),
    );
    expect(value).not.toHaveProperty('secret');
    expect(value).toMatchObject({ maneuver: { type: 'left' } });
    expect(value.t === 'nav' && value.maneuver).not.toHaveProperty('bogus');
    expect(value.t === 'nav' && value.lanes?.[0]).toEqual({
      directions: ['left'],
      recommended: true,
    });
  });

  it('accepts every maneuver type and lane direction', () => {
    for (const type of MANEUVER_TYPES) {
      expect(parsePhoneMessage(json({ ...nav, maneuver: { type } })).ok, type).toBe(true);
    }
    const lanes = LANE_DIRECTIONS.map((d) => ({ directions: [d], recommended: false }));
    expect(parsePhoneMessage(json({ ...nav, lanes: lanes.slice(0, 16) })).ok).toBe(true);
    expect(
      parsePhoneMessage(
        json({ ...nav, lanes: [{ directions: [...LANE_DIRECTIONS], recommended: true }] }),
      ).ok,
    ).toBe(true);
  });

  it('caps lanes at 16', () => {
    const lane = { directions: ['straight'], recommended: true };
    expect(parsePhoneMessage(json({ ...nav, lanes: Array(16).fill(lane) })).ok).toBe(true);
    expect(err(parsePhoneMessage(json({ ...nav, lanes: Array(17).fill(lane) })))).toBe(
      'nav.lanes: expected at most 16 items',
    );
  });

  it.each<[Record<string, unknown>, string | RegExp]>([
    [{ maneuver: { type: 'teleport' } }, /^nav\.maneuver\.type: expected one of "depart", /],
    [
      { maneuver: { type: 'right', roundaboutExit: 0 } },
      'nav.maneuver.roundaboutExit: expected number >= 1',
    ],
    [
      { maneuver: { type: 'right', roundaboutAngle: 361 } },
      'nav.maneuver.roundaboutAngle: expected number <= 360',
    ],
    [{ then: { type: 'moonwalk' } }, /^nav\.then\.type: expected one of/],
    [
      { lanes: [{ directions: ['diagonal'], recommended: true }] },
      /^nav\.lanes\[0\]\.directions\[0\]: expected one of "straight"/,
    ],
    [
      { lanes: [{ directions: ['left'], recommended: 'yes' }] },
      'nav.lanes[0].recommended: expected boolean, got string',
    ],
    [
      { lanes: [{ directions: ['left'], recommended: true, activeDirection: 'up' }] },
      /^nav\.lanes\[0\]\.activeDirection: expected one of/,
    ],
    [{ distanceM: -1 }, 'nav.distanceM: expected number >= 0'],
    [{ distanceM: '250' }, 'nav.distanceM: expected number, got string'],
    [{ etaEpochMs: 1.5 }, 'nav.etaEpochMs: expected integer, got 1.5'],
    [{ street: 's'.repeat(101) }, 'nav.street: expected at most 100 characters'],
    [{ street: 'Main\nSt' }, 'nav.street: must not contain control characters'],
    [{ source: '' }, 'nav.source: must not be empty'],
    [{ active: 'true' }, 'nav.active: expected boolean, got string'],
    [
      { iconPng: 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==' },
      'nav.iconPng: expected a base64-encoded PNG',
    ],
    [{ iconPng: 'iVBORw0KGgo!!!!' }, 'nav.iconPng: expected a base64-encoded PNG'],
    [{ iconPng: 'data:image/png;base64,' + PNG }, 'nav.iconPng: expected a base64-encoded PNG'],
  ])('rejects %j', (override, error) => {
    const message = err(parsePhoneMessage(json({ ...nav, ...override })));
    if (typeof error === 'string') expect(message).toBe(error);
    else expect(message).toMatch(error);
  });

  it('accepts a maximal icon and rejects a larger one', () => {
    const body = 'A'.repeat(PROTOCOL_LIMITS.iconPngBase64 - 12);
    const max = `iVBORw0KGgo${body}=`;
    expect(max.length).toBe(PROTOCOL_LIMITS.iconPngBase64);
    expect(parsePhoneMessage(json({ ...nav, iconPng: max })).ok).toBe(true);
    const tooLarge = `iVBORw0KGgo${'A'.repeat(PROTOCOL_LIMITS.iconPngBase64 - 7)}`;
    expect(tooLarge.length % 4).toBe(0);
    expect(err(parsePhoneMessage(json({ ...nav, iconPng: tooLarge })))).toBe(
      'nav.iconPng: expected at most 45056 characters',
    );
  });

  it('accepts names of exactly 100 characters and non-Latin text', () => {
    expect(parsePhoneMessage(json({ ...nav, street: 's'.repeat(100) })).ok).toBe(true);
    expect(parsePhoneMessage(json({ ...nav, street: 'Königstraße · 銀座通り · شارع' })).ok).toBe(
      true,
    );
  });

  it('tolerates newlines in the (never shown while moving) instruction text', () => {
    expect(
      parsePhoneMessage(
        json({ ...nav, maneuver: { type: 'left', instruction: 'Turn left\nthen right' } }),
      ).ok,
    ).toBe(true);
    expect(
      err(
        parsePhoneMessage(
          json({ ...nav, maneuver: { type: 'left', instruction: 'bad\u0007bell' } }),
        ),
      ),
    ).toBe('nav.maneuver.instruction: must not contain control characters');
  });
});

describe('parsePhoneMessage — road', () => {
  it('accepts a posted limit and an unlimited road', () => {
    expect(ok(parsePhoneMessage(json(road)))).toEqual(road);
    expect(
      ok(
        parsePhoneMessage(json({ t: 'road', speedLimitKph: null, unlimited: true, source: 'nav' })),
      ),
    ).toEqual({
      t: 'road',
      speedLimitKph: null,
      unlimited: true,
      source: 'nav',
    });
  });

  it('normalises an omitted limit to null', () => {
    expect(ok(parsePhoneMessage(json({ t: 'road', source: 'osm' })))).toEqual({
      t: 'road',
      source: 'osm',
      speedLimitKph: null,
    });
  });

  it.each<[Record<string, unknown>, string | RegExp]>([
    [{ speedLimitKph: 0 }, 'road.speedLimitKph: expected number > 0'],
    [{ speedLimitKph: 600 }, 'road.speedLimitKph: expected number <= 500'],
    [
      { source: 'simulator' },
      'road.source: expected one of "osm", "nav", "sign-recognition", "manual"',
    ],
    [{ roadClass: 'dirt' }, /^road\.roadClass: expected one of "motorway"/],
  ])('rejects %j', (override, error) => {
    const message = err(parsePhoneMessage(json({ ...road, ...override })));
    if (typeof error === 'string') expect(message).toBe(error);
    else expect(message).toMatch(error);
  });
});

describe('parsePhoneMessage — hazards', () => {
  it('accepts every hazard type and normalises omitted nullable fields', () => {
    const items = HAZARD_TYPES.map((type, i) => ({ id: `h${i}`, type }));
    const value = ok(parsePhoneMessage(json({ t: 'hazards', items })));
    expect(value.t === 'hazards' && value.items[0]).toEqual({
      id: 'h0',
      type: HAZARD_TYPES[0],
      distanceM: null,
      speedLimitKph: null,
      delaySeconds: null,
      description: null,
    });
  });

  it('accepts an empty list (all hazards cleared)', () => {
    expect(ok(parsePhoneMessage(json({ t: 'hazards', items: [] })))).toEqual({
      t: 'hazards',
      items: [],
    });
  });

  it('caps the list at 50 items', () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ ...hazard, id: `h${i}` }));
    expect(parsePhoneMessage(json({ t: 'hazards', items: items(50) })).ok).toBe(true);
    expect(err(parsePhoneMessage(json({ t: 'hazards', items: items(51) })))).toBe(
      'hazards.items: expected at most 50 items',
    );
  });

  it.each<[Record<string, unknown>, string | RegExp]>([
    [{ type: 'alien' }, /^hazards\.items\[0\]\.type: expected one of "speed-camera"/],
    [{ distanceM: -5 }, 'hazards.items[0].distanceM: expected number >= 0'],
    [{ id: '' }, 'hazards.items[0].id: must not be empty'],
    [
      { description: 'd'.repeat(301) },
      'hazards.items[0].description: expected at most 300 characters',
    ],
  ])('rejects an item with %j', (override, error) => {
    const message = err(
      parsePhoneMessage(json({ t: 'hazards', items: [{ ...hazard, ...override }] })),
    );
    if (typeof error === 'string') expect(message).toBe(error);
    else expect(message).toMatch(error);
  });

  it('rejects duplicate hazard ids', () => {
    expect(err(parsePhoneMessage(json({ t: 'hazards', items: [hazard, hazard] })))).toBe(
      'hazards.items[1].id: duplicate hazard id',
    );
  });

  it('rejects a missing item list', () => {
    expect(err(parsePhoneMessage(json({ t: 'hazards' })))).toBe('hazards.items: required');
  });
});

describe('parsePhoneMessage — media', () => {
  it('accepts now-playing and nothing-playing updates', () => {
    expect(ok(parsePhoneMessage(json(media)))).toEqual(media);
    expect(
      ok(parsePhoneMessage(json({ t: 'media', playing: false, title: null, artist: null }))),
    ).toEqual({
      t: 'media',
      playing: false,
      title: null,
      artist: null,
    });
  });

  it('allows long song titles up to 300 characters only', () => {
    expect(parsePhoneMessage(json({ ...media, title: 't'.repeat(300) })).ok).toBe(true);
    expect(err(parsePhoneMessage(json({ ...media, title: 't'.repeat(301) })))).toBe(
      'media.title: expected at most 300 characters',
    );
  });

  it('rejects a non-boolean playing flag', () => {
    expect(err(parsePhoneMessage(json({ ...media, playing: 1 })))).toBe(
      'media.playing: expected boolean, got number',
    );
  });
});

describe('parsePhoneMessage — call', () => {
  it('accepts every call state', () => {
    for (const state of ['ringing', 'dialing', 'active', 'held', 'ended']) {
      expect(ok(parsePhoneMessage(json({ ...call, state })))).toEqual({ ...call, state });
    }
  });

  it('accepts an unknown caller', () => {
    expect(ok(parsePhoneMessage(json({ t: 'call', id: 'c2', state: 'ringing' })))).toEqual({
      t: 'call',
      id: 'c2',
      state: 'ringing',
      callerName: null,
      number: null,
    });
  });

  it.each<[Record<string, unknown>, string]>([
    [
      { state: 'on-hold' },
      'call.state: expected one of "ringing", "dialing", "active", "held", "ended"',
    ],
    [{ callerName: 'Eve\u0000' }, 'call.callerName: must not contain control characters'],
    [{ number: '1'.repeat(41) }, 'call.number: expected at most 40 characters'],
    [{ id: '' }, 'call.id: must not be empty'],
  ])('rejects %j', (override, error) => {
    expect(err(parsePhoneMessage(json({ ...call, ...override })))).toBe(error);
  });
});

describe('parsePhoneMessage — message (sender only)', () => {
  it('accepts a sender-only notification and strips innocuous extras', () => {
    expect(ok(parsePhoneMessage(json({ ...message, receivedAt: 123 })))).toEqual(message);
    expect(
      ok(parsePhoneMessage(json({ t: 'message', id: 'm2', sender: 'Mum', readingAloud: false }))),
    ).toEqual({
      t: 'message',
      id: 'm2',
      sender: 'Mum',
      app: null,
      readingAloud: false,
    });
  });

  it.each(FORBIDDEN_MESSAGE_KEYS)('rejects content smuggled in "%s"', (key) => {
    expect(err(parsePhoneMessage(json({ ...message, [key]: 'Are you coming?' })))).toBe(
      `message: content field ${JSON.stringify(key)} is not allowed (sender only)`,
    );
  });

  it.each(['Body', 'TEXT', 'Content', 'bigText'])(
    'matches content keys case-insensitively (%s)',
    (key) => {
      expect(parsePhoneMessage(json({ ...message, [key]: 'hi' })).ok).toBe(false);
    },
  );

  it('rejects content keys even when empty or null', () => {
    expect(parsePhoneMessage(json({ ...message, body: '' })).ok).toBe(false);
    expect(parsePhoneMessage(json({ ...message, text: null })).ok).toBe(false);
  });

  it('allows content-like keys on other message types (they are simply stripped)', () => {
    expect(ok(parsePhoneMessage(json({ ...media, text: 'lyrics' })))).toEqual(media);
  });

  it.each<[Record<string, unknown>, string]>([
    [{ sender: '' }, 'message.sender: must not be empty'],
    [{ sender: 's'.repeat(101) }, 'message.sender: expected at most 100 characters'],
    [{ sender: 'Bob\nsays hi' }, 'message.sender: must not contain control characters'],
    [{ readingAloud: undefined }, 'message.readingAloud: required'],
  ])('rejects %j', (override, error) => {
    expect(err(parsePhoneMessage(json({ ...message, ...override })))).toBe(error);
  });
});

describe('parsePhoneMessage — location, input, trips-request, ping', () => {
  it('accepts a location fix', () => {
    expect(ok(parsePhoneMessage(json(location)))).toEqual(location);
    expect(
      ok(parsePhoneMessage(json({ t: 'location', lat: -90, lon: 180, accuracyM: null }))),
    ).toEqual({
      t: 'location',
      lat: -90,
      lon: 180,
      accuracyM: null,
    });
  });

  it.each<[Record<string, unknown>, string]>([
    [{ lat: 90.1 }, 'location.lat: expected number <= 90'],
    [{ lon: -180.1 }, 'location.lon: expected number >= -180'],
    [{ lat: null }, 'location.lat: expected number, got null'],
    [{ bearingDeg: -1 }, 'location.bearingDeg: expected number >= 0'],
  ])('rejects a location with %j', (override, error) => {
    expect(err(parsePhoneMessage(json({ ...location, ...override })))).toBe(error);
  });

  it('accepts every input action and rejects others', () => {
    for (const action of INPUT_ACTIONS) {
      expect(ok(parsePhoneMessage(json({ t: 'input', action })))).toEqual({ t: 'input', action });
    }
    expect(err(parsePhoneMessage(json({ t: 'input', action: 'self-destruct' })))).toMatch(
      /^input\.action: expected one of "primary", "secondary"/,
    );
  });

  it('validates trips-request', () => {
    expect(ok(parsePhoneMessage(json({ t: 'trips-request', since: 0 })))).toEqual({
      t: 'trips-request',
      since: 0,
    });
    expect(err(parsePhoneMessage(json({ t: 'trips-request', since: -1 })))).toBe(
      'trips-request.since: expected number >= 0',
    );
    expect(err(parsePhoneMessage(json({ t: 'trips-request' })))).toBe(
      'trips-request.since: required',
    );
  });

  it('validates ping', () => {
    expect(ok(parsePhoneMessage(json({ t: 'ping' })))).toEqual({ t: 'ping' });
    expect(ok(parsePhoneMessage(json({ t: 'ping', id: 7 })))).toEqual({ t: 'ping', id: 7 });
    expect(err(parsePhoneMessage(json({ t: 'ping', id: 'x' })))).toBe(
      'ping.id: expected number, got string',
    );
  });
});

describe('parseRendererMessage', () => {
  it('accepts driver input and strips extras', () => {
    expect(ok(parseRendererMessage(json({ t: 'input', action: 'toggle-blank', x: 1 })))).toEqual({
      t: 'input',
      action: 'toggle-blank',
    });
  });

  it.each([
    [json({ t: 'frame', frame: {} }), 'unknown message type "frame"'],
    [json({ t: 'input', action: 'launch' }), /^input\.action: expected one of/],
    [json({ t: 'input' }), 'input.action: required'],
    ['nope', 'invalid JSON'],
    [json({ t: 'input', action: 'primary', pad: 'x'.repeat(2000) }), /^message too large/],
  ])('rejects %s', (raw, error) => {
    const message = err(parseRendererMessage(raw));
    if (typeof error === 'string') expect(message).toBe(error);
    else expect(message).toMatch(error);
  });
});

describe('parseAdasMessage', () => {
  it('accepts every message type', () => {
    expect(ok(parseAdasMessage(json({ t: 'blind-spot', left: true, right: false })))).toEqual({
      t: 'blind-spot',
      left: true,
      right: false,
    });
    expect(
      ok(parseAdasMessage(json({ t: 'collision', level: 'warning', ttcSeconds: 1.2 }))),
    ).toEqual({
      t: 'collision',
      level: 'warning',
      ttcSeconds: 1.2,
    });
    expect(ok(parseAdasMessage(json({ t: 'collision', level: 'none' })))).toEqual({
      t: 'collision',
      level: 'none',
    });
    expect(ok(parseAdasMessage(json({ t: 'heartbeat', uptime: 5 })))).toEqual({ t: 'heartbeat' });
  });

  it.each([
    [json({ t: 'blind-spot', left: true }), 'blind-spot.right: required'],
    [
      json({ t: 'blind-spot', left: 1, right: false }),
      'blind-spot.left: expected boolean, got number',
    ],
    [
      json({ t: 'blind-spot', left: 'yes', right: 0 }),
      'blind-spot.left: expected boolean, got string; blind-spot.right: expected boolean, got number',
    ],
    [
      json({ t: 'collision', level: 'panic' }),
      'collision.level: expected one of "none", "caution", "warning"',
    ],
    [
      json({ t: 'collision', level: 'caution', ttcSeconds: -0.5 }),
      'collision.ttcSeconds: expected number >= 0',
    ],
    [
      '{"t":"collision","level":"caution","ttcSeconds":1e400}',
      'collision.ttcSeconds: expected number, got Infinity',
    ],
    [json({ t: 'lane-departure' }), 'unknown message type "lane-departure"'],
    ['{"t":"heartbeat"', 'invalid JSON'],
    [json({ t: 'heartbeat', pad: 'x'.repeat(2000) }), /^message too large/],
  ])('rejects %s', (raw, error) => {
    const message = err(parseAdasMessage(raw));
    if (typeof error === 'string') expect(message).toBe(error);
    else expect(message).toMatch(error);
  });
});
