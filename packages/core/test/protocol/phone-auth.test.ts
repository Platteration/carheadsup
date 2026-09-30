import { describe, expect, it } from 'vitest';
import {
  AUTH_ID_PATTERN,
  AUTH_PROOF_PATTERN,
  CERT_FINGERPRINT_PATTERN,
  NO_CHANNEL_BINDING,
  PHONE_AUTH,
  hudProofMessage,
  isAuthId,
  isCertFingerprint,
  phoneProofMessage,
  shortFingerprint,
} from '../../src/protocol/phone-auth.ts';
import { PROTOCOL_VERSION } from '../../src/types/protocol.ts';
import shared from './phone-auth-vectors.json' with { type: 'json' };

describe('phone link authentication: proof messages', () => {
  it.each(shared.vectors.map((v) => [v.name, v] as const))(
    'builds the messages of the shared vector "%s"',
    (_name, vector) => {
      expect(phoneProofMessage(vector)).toBe(vector.phoneMessage);
      expect(hudProofMessage(vector)).toBe(vector.hudMessage);
    },
  );

  it('binds each side to its own context, both nonces in opposite order and the certificate', () => {
    const input = {
      hudId: 'H'.repeat(22),
      hudNonce: 'h'.repeat(22),
      phoneNonce: 'p'.repeat(22),
      deviceId: 'D'.repeat(22),
      certFingerprint: 'f'.repeat(64),
    };
    expect(phoneProofMessage(input)).toBe(
      `carheadsup-phone-v3|${input.hudId}|${input.hudNonce}|${input.phoneNonce}|${input.deviceId}|${input.certFingerprint}`,
    );
    expect(hudProofMessage(input)).toBe(
      `carheadsup-hud-v3|${input.hudId}|${input.phoneNonce}|${input.hudNonce}|${input.deviceId}|${input.certFingerprint}`,
    );
    // Another certificate is another message: a relay's certificate never yields the HUD's proof.
    const relayed = { ...input, certFingerprint: 'e'.repeat(64) };
    expect(phoneProofMessage(relayed)).not.toBe(phoneProofMessage(input));
    expect(hudProofMessage(relayed)).not.toBe(hudProofMessage(input));
  });

  it('binds nothing on a plain connection', () => {
    expect(NO_CHANNEL_BINDING).toBe('');
    const plain = shared.vectors.find((v) => v.certFingerprint === NO_CHANNEL_BINDING);
    expect(plain?.phoneMessage.endsWith('|')).toBe(true);
  });

  it('is protocol version 3', () => {
    expect(PROTOCOL_VERSION).toBe(3);
    expect(PHONE_AUTH.phoneContext.endsWith(`-v${PROTOCOL_VERSION}`)).toBe(true);
    expect(PHONE_AUTH.hudContext.endsWith(`-v${PROTOCOL_VERSION}`)).toBe(true);
  });

  it('keeps the shared vectors well-formed', () => {
    expect(shared.vectors.length).toBeGreaterThanOrEqual(5);
    for (const v of shared.vectors) {
      for (const id of [v.hudId, v.hudNonce, v.phoneNonce, v.deviceId]) {
        expect(isAuthId(id)).toBe(true);
      }
      expect(v.certFingerprint === '' || isCertFingerprint(v.certFingerprint)).toBe(true);
      expect(v.phoneProof).toMatch(AUTH_PROOF_PATTERN);
      expect(v.hudProof).toMatch(AUTH_PROOF_PATTERN);
    }
    // One vector for an open HUD, one for a key longer than the HMAC block size, one for a
    // plain session, and two that differ only in the certificate (a relay).
    expect(shared.vectors.some((v) => v.pairingToken === '')).toBe(true);
    const utf8Bytes = (text: string) =>
      encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, '.').length;
    expect(shared.vectors.some((v) => utf8Bytes(v.pairingToken) > 64)).toBe(true);
    expect(shared.vectors.some((v) => v.certFingerprint === '')).toBe(true);
    const [direct, relayed] = shared.vectors;
    const inputs = (v: typeof direct) => [v?.pairingToken, v?.hudId, v?.hudNonce, v?.phoneNonce];
    expect(inputs(relayed)).toEqual(inputs(direct));
    expect(relayed?.deviceId).toBe(direct?.deviceId);
    expect(relayed?.certFingerprint).not.toBe(direct?.certFingerprint);
    expect(relayed?.phoneProof).not.toBe(direct?.phoneProof);
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

describe('certificate fingerprints', () => {
  it('are 64 lowercase hex digits', () => {
    expect(PHONE_AUTH.fingerprintChars).toBe(64);
    expect(isCertFingerprint('0123456789abcdef'.repeat(4))).toBe(true);
    for (const bad of [
      '',
      'a'.repeat(63),
      'a'.repeat(65),
      'A'.repeat(64),
      `${'a'.repeat(63)}g`,
      `${'a'.repeat(62)}:a`,
      `${'a'.repeat(64)}\n`,
    ]) {
      expect({ bad, ok: isCertFingerprint(bad) }).toEqual({ bad, ok: false });
    }
    expect(CERT_FINGERPRINT_PATTERN.test('f'.repeat(64))).toBe(true);
  });

  it.each(shared.certificates.map((c) => [c.name, c] as const))(
    'shortens the fingerprint of %s as the phone does',
    (_name, certificate) => {
      expect(shortFingerprint(certificate.fingerprint)).toBe(certificate.short);
      expect(certificate.short).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){4}$/);
    },
  );

  it('shortens to the first 80 bits in groups of four', () => {
    expect(shortFingerprint('0123456789abcdef'.repeat(4))).toBe('0123 4567 89AB CDEF 0123');
    expect(shortFingerprint('not a fingerprint')).toBe('');
    expect(shortFingerprint('')).toBe('');
  });
});
