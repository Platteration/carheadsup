/**
 * Mutual authentication of the phone link (protocol v2) — the part both sides must agree on
 * byte for byte. The HMAC itself is computed by the HUD server (node:crypto) and the companion
 * app (`companion-android/protocol`); this module stays pure.
 *
 *   HUD → phone   challenge { hudId, nonce: hudNonce }
 *   phone → HUD   hello     { deviceId, nonce: phoneNonce, proof: MAC(phoneProofMessage) }
 *   HUD → phone   welcome   { hudId, proof: MAC(hudProofMessage) }
 *
 * MAC = HMAC-SHA256 keyed with the UTF-8 bytes of `phone.pairingToken` over the UTF-8 bytes of
 * the message, as base64url without padding (43 characters). The token itself never travels.
 * Each side's nonce makes the other side's proof fresh, the two context prefixes keep a proof of
 * one side from being replayed as the other's, and the fixed base64url alphabet (no `|`) keeps
 * the joined fields unambiguous.
 *
 * With an empty pairing token the proofs are still computed (with an empty key) but prove
 * nothing: anyone can make them. The phone then treats the HUD as unauthenticated.
 */

export const PHONE_AUTH = {
  /** Prefix of the message the phone's proof covers. */
  phoneContext: 'carheadsup-phone-v2',
  /** Prefix of the message the HUD's proof covers. */
  hudContext: 'carheadsup-hud-v2',
  /** Length of `hudId`, `deviceId` and nonces: 16 random bytes in base64url. */
  idChars: 22,
  /** Length of a proof: 32 bytes of HMAC-SHA256 in base64url. */
  proofChars: 43,
} as const;

/** `hudId`, `deviceId`, `nonce`: 22 base64url characters. */
export const AUTH_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
/** A proof: 43 base64url characters. */
export const AUTH_PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Whether `value` is a well-formed `hudId`, `deviceId` or nonce. */
export function isAuthId(value: string): boolean {
  return AUTH_ID_PATTERN.test(value);
}

/** Everything a proof is bound to besides the pairing token. */
export interface PhoneProofInput {
  hudId: string;
  /** The nonce of the HUD's `challenge`. */
  hudNonce: string;
  /** The nonce of the phone's `hello`. */
  phoneNonce: string;
  deviceId: string;
}

/** What `hello.proof` covers: `carheadsup-phone-v2|hudId|hudNonce|phoneNonce|deviceId`. */
export function phoneProofMessage(input: PhoneProofInput): string {
  return [
    PHONE_AUTH.phoneContext,
    input.hudId,
    input.hudNonce,
    input.phoneNonce,
    input.deviceId,
  ].join('|');
}

/** What `welcome.proof` covers: `carheadsup-hud-v2|hudId|phoneNonce|hudNonce|deviceId`. */
export function hudProofMessage(input: PhoneProofInput): string {
  return [
    PHONE_AUTH.hudContext,
    input.hudId,
    input.phoneNonce,
    input.hudNonce,
    input.deviceId,
  ].join('|');
}
