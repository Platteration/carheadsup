import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hudProofMessage, phoneProofMessage } from '@carheadsup/core';
import type { PhoneProofInput } from '@carheadsup/core';

/**
 * The HMAC half of the phone link's mutual authentication (the messages are defined in core
 * `protocol/phone-auth.ts`): HMAC-SHA256 keyed with the UTF-8 bytes of the pairing token,
 * base64url without padding. An empty token is a valid (if worthless) key.
 */

/** 16 fresh random bytes as 22 base64url characters: a nonce or a new HUD id. */
export function randomAuthId(): string {
  return randomBytes(16).toString('base64url');
}

/** The proof a phone that knows `pairingToken` puts in its `hello`. */
export function phoneProof(pairingToken: string, input: PhoneProofInput): string {
  return mac(pairingToken, phoneProofMessage(input));
}

/** The proof the HUD puts in its `welcome`. */
export function hudProof(pairingToken: string, input: PhoneProofInput): string {
  return mac(pairingToken, hudProofMessage(input));
}

/** Constant-time comparison of two proofs (false when their lengths differ). */
export function proofsEqual(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function mac(key: string, message: string): string {
  return createHmac('sha256', Buffer.from(key, 'utf8')).update(message, 'utf8').digest('base64url');
}
