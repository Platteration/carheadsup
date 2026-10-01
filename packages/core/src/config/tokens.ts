/**
 * Access tokens (`phone.pairingToken`, `server.apiToken`): the pairing-token rule, and how tokens
 * are generated.
 *
 * The pairing-token rule is shared by the HUD's config schema, the settings app, the pairing URI
 * (`protocol/pairing.ts`) and the companion app (`PairingCode` in `companion-android/protocol`,
 * its manual pairing-code field and its pairing-URI parser): every place that takes a pairing
 * token accepts exactly the same ones.
 *
 * Generated tokens — the settings app's *Generate* button and the pairing token the HUD gives a
 * new `config.json` — are made alike: {@link GENERATED_TOKEN_LENGTH} characters drawn uniformly
 * from {@link GENERATED_TOKEN_ALPHABET} with a cryptographic random source (the core itself has
 * none). They keep the rule, as do the hex codes the install guide makes with `openssl rand`.
 */

/** Letters and digits without look-alikes (0/O, 1/l/I): printable ASCII, easy to type. */
export const GENERATED_TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** 24 characters of a 56-character alphabet: about 139 bits. */
export const GENERATED_TOKEN_LENGTH = 24;

/** Longest pairing token, in characters. */
export const MAX_PAIRING_TOKEN_CHARS = 256;

/**
 * The characters of a pairing token: printable ASCII other than the space (`!` to `~`) — letters,
 * digits and symbols, one word. A QR code, a URI, a phone's keyboard and copy and paste all carry
 * them unchanged; spaces get lost, and look-alike or invisible characters cannot be typed back.
 */
const PAIRING_TOKEN_TEXT = /^[\x21-\x7e]*$/;

/**
 * What is wrong with the characters of `token` as a pairing token (see the rule above), or null
 * when they are fine. Its length is checked by {@link pairingTokenProblem}.
 */
export function pairingTokenTextProblem(token: string): string | null {
  if (PAIRING_TOKEN_TEXT.test(token)) return null;
  return /\s/.test(token)
    ? 'no spaces: one word of letters, digits and symbols'
    : 'only letters, digits and symbols of plain ASCII: no accents, emoji or control characters';
}

/**
 * Why `token` cannot be a pairing token, or null when it can: at most
 * {@link MAX_PAIRING_TOKEN_CHARS} characters of printable ASCII without spaces. Empty is a valid
 * `phone.pairingToken` (no pairing), though not in a pairing URI.
 */
export function pairingTokenProblem(token: string): string | null {
  if (token.length > MAX_PAIRING_TOKEN_CHARS) {
    return `at most ${MAX_PAIRING_TOKEN_CHARS} characters`;
  }
  return pairingTokenTextProblem(token);
}

/** Whether `token` keeps the pairing-token rule (see {@link pairingTokenProblem}). */
export function isPairingToken(token: string): boolean {
  return pairingTokenProblem(token) === null;
}

/**
 * Whether `value` is a pairing token that a config stored before the rule may hold: any text of
 * at most {@link MAX_PAIRING_TOKEN_CHARS} UTF-16 code units, which the HUD accepted until then.
 * Phones paired with such a token prove exactly it, so a stored one is kept as it is when the
 * config is loaded (see `parseStoredConfig`) and while changes leave it alone; new tokens follow
 * the rule.
 */
export function isStoredPairingToken(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PAIRING_TOKEN_CHARS;
}
