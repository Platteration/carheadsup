import { describe, expect, it } from 'vitest';
import {
  PAIRING_URI,
  encodePairingUri,
  hudDisplayName,
  isPairingHost,
  pairingPayloadProblem,
  parsePairingUri,
} from '../../src/protocol/pairing.ts';
import type { PairingPayload } from '../../src/protocol/pairing.ts';
import shared from './pairing-uri-vectors.json' with { type: 'json' };

const utf8Bytes = (text: string) => encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, '.').length;

const PAYLOAD: PairingPayload = {
  hudId: 'AAECAwQFBgcICQoLDA0ODw',
  certFingerprint: 'fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531',
  pairingToken: 'K7fQ2mZrP4xW9sLt3HvNbC8e',
  hosts: ['10.42.0.1', 'carheadsup.local'],
  tlsPort: 8443,
  hudName: 'My car HUD',
};

describe('pairing URI: shared vectors', () => {
  it.each(shared.valid.map((v) => [v.name, v] as const))('parses "%s"', (_name, vector) => {
    expect(parsePairingUri(vector.uri)).toEqual({ ok: true, payload: vector.payload });
  });

  it.each(shared.valid.filter((v) => v.canonical).map((v) => [v.name, v] as const))(
    'encodes "%s" exactly',
    (_name, vector) => {
      expect(encodePairingUri(vector.payload)).toBe(vector.uri);
    },
  );

  it.each(shared.invalid.map((v) => [v.name, v] as const))('refuses "%s"', (_name, vector) => {
    const result = parsePairingUri(vector.uri);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(vector.error);
      expect(result.detail).not.toBe('');
    }
  });

  it('covers every kind of result', () => {
    expect(shared.valid.some((v) => v.canonical)).toBe(true);
    expect(shared.valid.some((v) => !v.canonical)).toBe(true);
    expect(shared.valid.some((v) => v.payload.hudName === null)).toBe(true);
    for (const error of ['foreign', 'unsupported-version', 'invalid']) {
      expect(shared.invalid.some((v) => v.error === error)).toBe(true);
    }
    const hostCounts = shared.valid.map((v) => v.payload.hosts.length);
    expect(Math.max(...hostCounts)).toBe(PAIRING_URI.maxHosts);
    const tokenLengths = shared.valid.map((v) => v.payload.pairingToken.length);
    expect(Math.max(...tokenLengths)).toBe(PAIRING_URI.maxTokenChars);
  });
});

describe('encodePairingUri', () => {
  it('writes the parameters in order, the hosts comma-separated', () => {
    expect(encodePairingUri(PAYLOAD)).toBe(
      'carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw' +
        '&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531' +
        '&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=8443&n=My%20car%20HUD',
    );
  });

  it('round-trips any well-formed token and name', () => {
    const tokens = ['a', ' leading and trailing ', '100%', 'x+y=z&w', 'ü€😀', '\u0000\u007f', '#'];
    for (const pairingToken of tokens) {
      const payload = { ...PAYLOAD, pairingToken, hudName: 'Škoda Octavia HUD' };
      expect(parsePairingUri(encodePairingUri(payload))).toEqual({ ok: true, payload });
    }
  });

  it('escapes everything but the unreserved characters', () => {
    const uri = encodePairingUri({ ...PAYLOAD, pairingToken: "a!b'c(d)e*f~g.h_i-j" });
    expect(uri).toContain('&k=a%21b%27c%28d%29e%2Af~g.h_i-j&');
  });

  it('refuses a payload it cannot encode, naming the problem', () => {
    const bad: Array<[Partial<PairingPayload>, RegExp]> = [
      [{ hudId: 'short' }, /^id /],
      [{ certFingerprint: 'F'.repeat(64) }, /^fp /],
      [{ pairingToken: '' }, /must not be empty/],
      [{ pairingToken: 'x'.repeat(257) }, /at most 256/],
      [{ pairingToken: 'a\ud800b' }, /well-formed/],
      [{ hosts: [] }, /at least one host/],
      [{ hosts: Array.from({ length: 9 }, (_, i) => `10.0.0.${i}`) }, /at most 8/],
      [{ hosts: ['fe80::1'] }, /"fe80::1"/],
      [{ tlsPort: 0 }, /^p /],
      [{ tlsPort: 8443.5 }, /^p /],
      [{ hudName: '' }, /^n /],
      [{ hudName: 'line\nbreak' }, /plain text/],
      [{ hudName: 'ü'.repeat(32) }, /63 bytes/],
    ];
    for (const [change, problem] of bad) {
      const payload = { ...PAYLOAD, ...change };
      expect(pairingPayloadProblem(payload)).toMatch(problem);
      expect(() => encodePairingUri(payload)).toThrow(RangeError);
    }
    expect(pairingPayloadProblem(PAYLOAD)).toBeNull();
    expect(pairingPayloadProblem({ ...PAYLOAD, hudName: null })).toBeNull();
  });
});

describe('isPairingHost', () => {
  it('takes IPv4 literals and DNS names', () => {
    for (const host of [
      '10.42.0.1',
      '0.0.0.0',
      '255.255.255.255',
      'carheadsup.local',
      'a',
      'x-1.y',
    ]) {
      expect(isPairingHost(host)).toBe(true);
    }
    expect(isPairingHost('a'.repeat(63))).toBe(true);
    expect(
      isPairingHost(`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`),
    ).toBe(true);
  });

  it('refuses IPv6, bad addresses and anything that is no name', () => {
    const bad = [
      '',
      '::1',
      'fe80::1%wlan0',
      '[::1]',
      '256.1.1.1',
      '10.42.0.01',
      '10.42.0',
      '1.2.3.4.5',
      '-car.local',
      'car-.local',
      'car..local',
      'car.local.',
      'car_hud',
      'a'.repeat(64),
      'car hud',
      'car,hud',
      `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`,
    ];
    for (const host of bad) expect(isPairingHost(host)).toBe(false);
  });
});

describe('parsePairingUri', () => {
  it('ignores surrounding ASCII white space only', () => {
    const uri = encodePairingUri(PAYLOAD);
    expect(parsePairingUri(`\n ${uri}\t`)).toEqual({ ok: true, payload: PAYLOAD });
    expect(parsePairingUri(` ${uri}`)).toMatchObject({ ok: false, error: 'foreign' });
  });

  it('tells a later version from a damaged code', () => {
    const later = encodePairingUri(PAYLOAD).replace('v=1', 'v=7');
    expect(parsePairingUri(later)).toMatchObject({ ok: false, error: 'unsupported-version' });
    const damaged = encodePairingUri(PAYLOAD).replace('&p=8443', '');
    expect(parsePairingUri(damaged)).toEqual({
      ok: false,
      error: 'invalid',
      detail: 'p is missing',
    });
  });

  it('refuses a raw lone surrogate, with or without escapes next to it (as the companion does)', () => {
    // Not a shared vector: JSON parsers disagree about lone surrogates.
    for (const token of ['abc\ud800', 'abc%41\ud800', '\udc00%41']) {
      const uri = encodePairingUri(PAYLOAD).replace(`k=${PAYLOAD.pairingToken}`, `k=${token}`);
      expect(parsePairingUri(uri)).toMatchObject({ ok: false, error: 'invalid' });
    }
  });
});

describe('hudDisplayName', () => {
  it('names the HUD after the vehicle, as it advertises itself', () => {
    expect(hudDisplayName('My car')).toBe('My car HUD');
    expect(hudDisplayName('  Golf \t\n 7 ')).toBe('Golf 7 HUD');
    expect(hudDisplayName('')).toBe('carheadsup HUD');
    expect(hudDisplayName('\u0000\u0085')).toBe('carheadsup HUD');
  });

  it('fits one DNS label (63 bytes of UTF-8), cutting whole characters', () => {
    const ascii = hudDisplayName('x'.repeat(80));
    expect(ascii).toBe(`${'x'.repeat(59)} HUD`);
    const wide = hudDisplayName('🚗'.repeat(20));
    expect(utf8Bytes(wide)).toBeLessThanOrEqual(63);
    expect(wide.endsWith(' HUD')).toBe(true);
    expect(wide).toBe(`${'🚗'.repeat(14)} HUD`);
    // Any vehicle name gives a name the pairing URI accepts.
    for (const name of [
      'x'.repeat(60),
      'ü'.repeat(60),
      'a\u0000b',
      '🚗'.repeat(60),
      'Golf \ud83d',
    ]) {
      expect(pairingPayloadProblem({ ...PAYLOAD, hudName: hudDisplayName(name) })).toBeNull();
    }
  });

  it('replaces a lone surrogate (a hand-edited config) instead of making a name no URI accepts', () => {
    expect(hudDisplayName('Golf \ud83d')).toBe('Golf \ufffd HUD');
    expect(hudDisplayName('\udc00Golf')).toBe('\ufffdGolf HUD');
    // A surrogate pair is one character and stays as it is.
    expect(hudDisplayName('Golf \ud83d\ude97')).toBe('Golf \ud83d\ude97 HUD');
    // Cutting to one DNS label counts U+FFFD as 3 bytes, as UTF-8 does.
    const cut = hudDisplayName('\ud800'.repeat(40));
    expect(cut).toBe(`${'\ufffd'.repeat(19)} HUD`);
    expect(utf8Bytes(cut)).toBeLessThanOrEqual(63);
  });
});
