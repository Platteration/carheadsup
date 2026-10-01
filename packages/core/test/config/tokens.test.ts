import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  mergeConfig,
  parseConfig,
  parseStoredConfig,
} from '../../src/config/config.ts';
import { cloneJson } from '../../src/config/json.ts';
import {
  GENERATED_TOKEN_ALPHABET,
  GENERATED_TOKEN_LENGTH,
  MAX_PAIRING_TOKEN_CHARS,
  isPairingToken,
  isStoredPairingToken,
  pairingTokenProblem,
} from '../../src/config/tokens.ts';

const SPACES = 'no spaces: one word of letters, digits and symbols';
const NOT_ASCII =
  'only letters, digits and symbols of plain ASCII: no accents, emoji or control characters';

describe('the pairing-token rule', () => {
  it('takes every generated token, the install guide’s hex codes and any one word of ASCII', () => {
    expect([...GENERATED_TOKEN_ALPHABET].every((c) => isPairingToken(c))).toBe(true);
    expect(isPairingToken(GENERATED_TOKEN_ALPHABET.slice(0, GENERATED_TOKEN_LENGTH))).toBe(true);
    // `openssl rand -hex 12` (docs/install-raspberry-pi.md).
    expect(isPairingToken('0123456789abcdef01234567')).toBe(true);
    const printable = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) =>
      String.fromCharCode(0x21 + i),
    ).join('');
    expect(pairingTokenProblem(printable)).toBeNull();
    expect(pairingTokenProblem('')).toBeNull();
    expect(pairingTokenProblem('x'.repeat(MAX_PAIRING_TOKEN_CHARS))).toBeNull();
  });

  it('refuses spaces, characters beyond ASCII, control characters and overlong codes', () => {
    expect(pairingTokenProblem('x'.repeat(MAX_PAIRING_TOKEN_CHARS + 1))).toBe(
      'at most 256 characters',
    );
    for (const token of ['two words', ' x', 'x ', 'tab\t', 'line\nbreak', 'a b', 'a　b']) {
      expect({ token, problem: pairingTokenProblem(token) }).toEqual({ token, problem: SPACES });
    }
    for (const token of ['Schlüssel', '🚗', 'a\u0000b', 'a\u007fb', 'a\u0085b', 'a​b', 'a\ud800']) {
      expect({ token, problem: pairingTokenProblem(token) }).toEqual({ token, problem: NOT_ASCII });
      expect(isPairingToken(token)).toBe(false);
    }
  });

  it('knows the tokens a config stored before the rule may hold: any text of up to 256', () => {
    for (const token of ['', 'my car key', 'Schlüssel-🚗', 'x'.repeat(256)]) {
      expect(isStoredPairingToken(token)).toBe(true);
    }
    for (const value of ['x'.repeat(257), 42, null, undefined, ['a']]) {
      expect(isStoredPairingToken(value)).toBe(false);
    }
  });
});

describe('phone.pairingToken in the config', () => {
  const LEGACY = 'mein Schlüssel';

  it('is validated by the rule, like every other field', () => {
    const { config, errors } = parseConfig({ phone: { pairingToken: 'two words' } });
    expect(errors).toEqual([`phone.pairingToken: ${SPACES}`]);
    expect(config.phone.pairingToken).toBe(DEFAULT_CONFIG.phone.pairingToken);
    expect(parseConfig({ phone: { pairingToken: 'K7fQ2mZr' } }).errors).toEqual([]);
  });

  it('keeps a stored token from before the rule when the config file is loaded', () => {
    const input = { phone: { pairingToken: LEGACY }, vehicle: { name: 'Golf' } };
    const loaded = parseStoredConfig(input);
    expect(loaded).toMatchObject({ errors: [], keptPairingToken: true });
    expect(loaded.config.phone.pairingToken).toBe(LEGACY);
    expect(loaded.config.vehicle.name).toBe('Golf');
    // Only when loading a stored config: as a new value it is refused.
    expect(parseConfig(input).config.phone.pairingToken).toBe('');
    // Other problems are reported as ever.
    const broken = parseStoredConfig({ phone: { pairingToken: LEGACY }, server: { port: 0 } });
    expect(broken.keptPairingToken).toBe(true);
    expect(broken.errors).toEqual([expect.stringMatching(/^server\.port: /)]);
    expect(parseStoredConfig({ phone: { pairingToken: 'K7fQ2mZr' } }).keptPairingToken).toBe(false);
  });

  it('does not keep what was never a valid token', () => {
    for (const pairingToken of ['x'.repeat(257), 42]) {
      const loaded = parseStoredConfig({ phone: { pairingToken } });
      expect(loaded.keptPairingToken).toBe(false);
      expect(loaded.errors).toEqual([expect.stringMatching(/^phone\.pairingToken: /)]);
      expect(loaded.config.phone.pairingToken).toBe('');
    }
  });

  it('stays while changes leave it alone, and gives way to a valid new token', () => {
    const base = parseStoredConfig({ phone: { pairingToken: LEGACY } }).config;
    const renamed = mergeConfig(base, { vehicle: { name: 'Weekend car' } });
    expect(renamed.errors).toEqual([]);
    expect(renamed.config.phone.pairingToken).toBe(LEGACY);
    // A whole config sent back unchanged (a PUT) keeps it too.
    const replaced = parseConfig(cloneJson(renamed.config), renamed.config);
    expect(replaced.errors).toEqual([]);
    expect(replaced.config.phone.pairingToken).toBe(LEGACY);
    // A new token must keep the rule; a refused one leaves the stored token in place.
    const refused = mergeConfig(base, { phone: { pairingToken: 'another phrase' } });
    expect(refused.errors).toEqual([`phone.pairingToken: ${SPACES}`]);
    expect(refused.config.phone.pairingToken).toBe(LEGACY);
    const other = mergeConfig(base, { phone: { pairingToken: 'other Schlüssel' } });
    expect(other.errors).toEqual([`phone.pairingToken: ${SPACES}`]);
    expect(other.config.phone.pairingToken).toBe(LEGACY);
    const fresh = mergeConfig(base, { phone: { pairingToken: 'K7fQ2mZr' } });
    expect(fresh.errors).toEqual([]);
    expect(fresh.config.phone.pairingToken).toBe('K7fQ2mZr');
    // Once replaced, the old token is just another invalid value.
    const back = mergeConfig(fresh.config, { phone: { pairingToken: LEGACY } });
    expect(back.errors).toEqual([`phone.pairingToken: ${SPACES}`]);
    expect(back.config.phone.pairingToken).toBe('K7fQ2mZr');
    // Removing it (no pairing) is a valid change.
    expect(mergeConfig(base, { phone: { pairingToken: '' } }).config.phone.pairingToken).toBe('');
  });
});
