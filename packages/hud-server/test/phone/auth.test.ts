import { X509Certificate } from 'node:crypto';
import { isAuthId, isCertFingerprint } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import shared from '../../../core/test/protocol/phone-auth-vectors.json' with { type: 'json' };
import { hudProof, phoneProof, proofsEqual, randomAuthId } from '../../src/phone/auth.ts';
import { certificateFingerprint } from '../../src/tls/certificate.ts';

describe('phone link proofs', () => {
  it.each(shared.vectors.map((v) => [v.name, v] as const))(
    'match the shared vector "%s" (also asserted by the companion app)',
    (_name, vector) => {
      expect(phoneProof(vector.pairingToken, vector)).toBe(vector.phoneProof);
      expect(hudProof(vector.pairingToken, vector)).toBe(vector.hudProof);
    },
  );

  it('depend on the token, both nonces, the device and the certificate', () => {
    const [vector] = shared.vectors;
    if (vector === undefined) throw new Error('no vectors');
    const base = phoneProof(vector.pairingToken, vector);
    expect(phoneProof(`${vector.pairingToken}x`, vector)).not.toBe(base);
    expect(phoneProof(vector.pairingToken, { ...vector, hudNonce: vector.phoneNonce })).not.toBe(
      base,
    );
    expect(phoneProof(vector.pairingToken, { ...vector, phoneNonce: vector.hudNonce })).not.toBe(
      base,
    );
    expect(phoneProof(vector.pairingToken, { ...vector, deviceId: vector.hudId })).not.toBe(base);
    expect(
      phoneProof(vector.pairingToken, { ...vector, certFingerprint: '0'.repeat(64) }),
    ).not.toBe(base);
    expect(phoneProof(vector.pairingToken, { ...vector, certFingerprint: '' })).not.toBe(base);
    // A phone's proof is never the HUD's (the contexts differ), even with the nonces swapped.
    const swapped = { ...vector, hudNonce: vector.phoneNonce, phoneNonce: vector.hudNonce };
    expect(hudProof(vector.pairingToken, swapped)).not.toBe(base);
  });

  it('compares proofs exactly', () => {
    const proof = shared.vectors[0]!.phoneProof;
    expect(proofsEqual(proof, proof)).toBe(true);
    expect(proofsEqual(proof, `${proof.slice(0, -1)}A`)).toBe(proof.endsWith('A'));
    expect(proofsEqual(proof, proof.slice(0, -1))).toBe(false);
    expect(proofsEqual(proof, '')).toBe(false);
  });

  it.each(shared.certificates.map((c) => [c.name, c] as const))(
    'fingerprint the shared certificate of %s as the phone does',
    (_name, certificate) => {
      const der = Buffer.from(certificate.der, 'base64');
      expect(certificateFingerprint(der)).toBe(certificate.fingerprint);
      expect(isCertFingerprint(certificate.fingerprint)).toBe(true);
      const parsed = new X509Certificate(der);
      expect(parsed.fingerprint256.replaceAll(':', '').toLowerCase()).toBe(certificate.fingerprint);
      // The vectors bind these certificates.
      expect(shared.vectors.some((v) => v.certFingerprint === certificate.fingerprint)).toBe(true);
    },
  );

  it('makes random 22-character ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => randomAuthId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(isAuthId(id)).toBe(true);
  });
});
