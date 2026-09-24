import { describe, expect, it } from 'vitest';
import {
  AUTH_ID_PATTERN,
  AUTH_PROOF_PATTERN,
  PHONE_AUTH,
  hudProofMessage,
  isAuthId,
  phoneProofMessage,
} from '../../src/protocol/phone-auth.ts';
import shared from './phone-auth-vectors.json' with { type: 'json' };

describe('phone link authentication: proof messages', () => {
  it.each(shared.vectors.map((v) => [v.name, v] as const))(
    'builds the messages of the shared vector "%s"',
    (_name, vector) => {
      expect(phoneProofMessage(vector)).toBe(vector.phoneMessage);
      expect(hudProofMessage(vector)).toBe(vector.hudMessage);
    },
  );

  it('binds each side to its own context and to both nonces, in opposite order', () => {
    const input = {
      hudId: 'H'.repeat(22),
      hudNonce: 'h'.repeat(22),
      phoneNonce: 'p'.repeat(22),
      deviceId: 'D'.repeat(22),
    };
    expect(phoneProofMessage(input)).toBe(
      `carheadsup-phone-v2|${input.hudId}|${input.hudNonce}|${input.phoneNonce}|${input.deviceId}`,
    );
    expect(hudProofMessage(input)).toBe(
      `carheadsup-hud-v2|${input.hudId}|${input.phoneNonce}|${input.hudNonce}|${input.deviceId}`,
    );
  });

  it('keeps the shared vectors well-formed', () => {
    expect(shared.vectors.length).toBeGreaterThanOrEqual(3);
    for (const v of shared.vectors) {
      for (const id of [v.hudId, v.hudNonce, v.phoneNonce, v.deviceId]) {
        expect(isAuthId(id)).toBe(true);
      }
      expect(v.phoneProof).toMatch(AUTH_PROOF_PATTERN);
      expect(v.hudProof).toMatch(AUTH_PROOF_PATTERN);
    }
    // One vector for an open HUD, one for a key longer than the HMAC block size.
    expect(shared.vectors.some((v) => v.pairingToken === '')).toBe(true);
    const utf8Bytes = (text: string) =>
      encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, '.').length;
    expect(shared.vectors.some((v) => utf8Bytes(v.pairingToken) > 64)).toBe(true);
  });
});

describe('phone link authentication: identifiers', () => {
  it('accepts exactly 22 base64url characters', () => {
    expect(PHONE_AUTH.idChars).toBe(22);
    expect(isAuthId('AAECAwQFBgcICQoLDA0ODw')).toBe(true);
    expect(isAuthId('8PHy8_T19vf4-fr7_P3-_w')).toBe(true);
    for (const bad of [
      '',
      'A'.repeat(21),
      'A'.repeat(23),
      `${'A'.repeat(21)}=`,
      `${'A'.repeat(21)}+`,
      `${'A'.repeat(21)}/`,
      `${'A'.repeat(21)}|`,
      `${'A'.repeat(21)}\n`,
    ]) {
      expect({ bad, ok: isAuthId(bad) }).toEqual({ bad, ok: false });
    }
    expect(AUTH_ID_PATTERN.test(`${'A'.repeat(22)}\n`)).toBe(false);
    expect(AUTH_PROOF_PATTERN.test('A'.repeat(PHONE_AUTH.proofChars))).toBe(true);
    expect(AUTH_PROOF_PATTERN.test('A'.repeat(PHONE_AUTH.proofChars + 1))).toBe(false);
  });
});
