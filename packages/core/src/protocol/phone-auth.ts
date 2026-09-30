/**
 * Mutual authentication of the phone link (protocol v3) — the part both sides must agree on
 * byte for byte. The HMAC itself is computed by the HUD server (node:crypto) and the companion
 * app (`companion-android/protocol`); this module stays pure.
 *
 *   phone ⇄ HUD   TLS (wss://): the HUD presents its self-signed certificate
 *   HUD → phone   challenge { hudId, nonce: hudNonce }
 *   phone → HUD   hello     { deviceId, nonce: phoneNonce, proof: MAC(phoneProofMessage) }
 *   HUD → phone   welcome   { hudId, proof: MAC(hudProofMessage) }
 *
 * MAC = HMAC-SHA256 keyed with the UTF-8 bytes of `phone.pairingToken` over the UTF-8 bytes of
 * the message, as base64url without padding (43 characters). The token itself never travels.
 * Each side's nonce makes the other side's proof fresh, the two context prefixes keep a proof of
 * one side from being replayed as the other's, and the fixed formats (base64url and lowercase
 * hex, neither containing `|`) keep the joined fields unambiguous.
 *
 * Channel binding: both proofs cover the SHA-256 fingerprint of the TLS certificate the phone
 * was shown. The HUD checks against its own certificate, so a relay that terminates the phone's
 * TLS with a certificate of its own cannot complete (or replay) the handshake with the HUD: the
 * phone's proof names the relay's certificate. On a plain `ws://` session (only when the HUD
 * allows it, `server.allowPlainPhone`) the fingerprint is the empty string: nothing is bound.
 *
 * With an empty pairing token the proofs are still computed (with an empty key) but prove
 * nothing: anyone can make them. The phone then treats the HUD as unauthenticated.
 */

export const PHONE_AUTH = {
  /** Prefix of the message the phone's proof covers. */
  phoneContext: 'carheadsup-phone-v3',
  /** Prefix of the message the HUD's proof covers. */
  hudContext: 'carheadsup-hud-v3',
  /** Length of `hudId`, `deviceId` and nonces: 16 random bytes in base64url. */
  idChars: 22,
  /** Length of a proof: 32 bytes of HMAC-SHA256 in base64url. */
  proofChars: 43,
  /** Length of a certificate fingerprint: 32 bytes of SHA-256 in lowercase hex. */
  fingerprintChars: 64,
  /** Hex digits of the fingerprint's short form (for people to compare): 80 bits. */
  shortFingerprintChars: 20,
} as const;

/** The channel binding of a session without TLS (plain `ws://`): nothing is bound. */
export const NO_CHANNEL_BINDING = '';

/** `hudId`, `deviceId`, `nonce`: 22 base64url characters. */
export const AUTH_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
/** A proof: 43 base64url characters. */
export const AUTH_PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** A certificate fingerprint: SHA-256 of the certificate's DER bytes, 64 lowercase hex digits. */
export const CERT_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/** Whether `value` is a well-formed `hudId`, `deviceId` or nonce. */
export function isAuthId(value: string): boolean {
  return AUTH_ID_PATTERN.test(value);
}

/** Whether `value` is a well-formed certificate fingerprint (64 lowercase hex digits). */
export function isCertFingerprint(value: string): boolean {
  return CERT_FINGERPRINT_PATTERN.test(value);
}

/**
 * A fingerprint as people compare it: the first 20 hex digits (80 bits) in upper case, in groups
 * of four — `3F2A 91C4 7B0E 55D2 0A1B`. The companion app shows the same form. Returns '' for
 * anything that is not a fingerprint.
 */
export function shortFingerprint(fingerprint: string): string {
  if (!isCertFingerprint(fingerprint)) return '';
  const head = fingerprint.slice(0, PHONE_AUTH.shortFingerprintChars).toUpperCase();
  return head.match(/.{4}/g)?.join(' ') ?? head;
}

/** Everything a proof is bound to besides the pairing token. */
export interface PhoneProofInput {
  hudId: string;
  /** The nonce of the HUD's `challenge`. */
  hudNonce: string;
  /** The nonce of the phone's `hello`. */
  phoneNonce: string;
  deviceId: string;
  /**
   * SHA-256 fingerprint (lowercase hex) of the TLS certificate of this connection: as the phone
   * saw it, and as the HUD knows its own. {@link NO_CHANNEL_BINDING} on a plain connection.
   */
  certFingerprint: string;
}

/**
 * What `hello.proof` covers:
 * `carheadsup-phone-v3|hudId|hudNonce|phoneNonce|deviceId|certFingerprint`.
 */
export function phoneProofMessage(input: PhoneProofInput): string {
  return [
    PHONE_AUTH.phoneContext,
    input.hudId,
    input.hudNonce,
    input.phoneNonce,
    input.deviceId,
    input.certFingerprint,
  ].join('|');
}

/**
 * What `welcome.proof` covers:
 * `carheadsup-hud-v3|hudId|phoneNonce|hudNonce|deviceId|certFingerprint`.
 */
export function hudProofMessage(input: PhoneProofInput): string {
  return [
    PHONE_AUTH.hudContext,
    input.hudId,
    input.phoneNonce,
    input.hudNonce,
    input.deviceId,
    input.certFingerprint,
  ].join('|');
}
