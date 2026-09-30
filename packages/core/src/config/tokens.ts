/**
 * Generated access tokens (`phone.pairingToken`, `server.apiToken`): the settings app's
 * *Generate* button and the pairing token the HUD gives a new `config.json` are made alike —
 * {@link GENERATED_TOKEN_LENGTH} characters drawn uniformly from {@link GENERATED_TOKEN_ALPHABET}
 * with a cryptographic random source (the core itself has none).
 */

/** Letters and digits without look-alikes (0/O, 1/l/I): printable ASCII, easy to type. */
export const GENERATED_TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** 24 characters of a 56-character alphabet: about 139 bits. */
export const GENERATED_TOKEN_LENGTH = 24;
