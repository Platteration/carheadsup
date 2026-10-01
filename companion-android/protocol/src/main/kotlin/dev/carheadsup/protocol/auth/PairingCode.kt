package dev.carheadsup.protocol.auth

/**
 * The pairing-token rule that the HUD's config, its settings app, the pairing URI
 * ([dev.carheadsup.protocol.pairing.PairingUri]) and this app's manual pairing-code field share
 * (packages/core/src/config/tokens.ts): at most [MAX_CHARS] characters of printable ASCII other
 * than the space ([FIRST_CHAR] to [LAST_CHAR]) — letters, digits and symbols, one word. A QR code,
 * a URI, a phone's keyboard and copy and paste carry them unchanged; every token the HUD or its
 * settings app generates keeps the rule.
 *
 * A token saved before the rule (any text of up to [MAX_CHARS] characters, which both sides took
 * then) keeps working for the link — the HUD keeps such a token as well, and the proofs cover
 * whatever it is ([PhoneAuth.isValidToken]) — but every new one must follow the rule.
 */
public object PairingCode {
    /** Longest pairing token, in characters (the HUD's `MAX_PAIRING_TOKEN_CHARS`). */
    public const val MAX_CHARS: Int = 256

    /** Lowest character a pairing token may have: printable ASCII after the space. */
    public const val FIRST_CHAR: Char = '!'

    /** Highest character a pairing token may have: the last printable ASCII character. */
    public const val LAST_CHAR: Char = '~'

    /**
     * Why [token] cannot be a pairing token, or null when it can, in the HUD's words. Empty is a
     * valid setting (no pairing), though not in a pairing URI.
     */
    public fun problem(token: String): String? {
        if (token.length > MAX_CHARS) return "at most $MAX_CHARS characters"
        if (token.all { it in FIRST_CHAR..LAST_CHAR }) return null
        if (token.any(::isSpace)) return "no spaces: one word of letters, digits and symbols"
        return "only letters, digits and symbols of plain ASCII: no accents, emoji or control characters"
    }

    /** Whether [token] keeps the rule. */
    public fun isValid(token: String): Boolean = problem(token) == null

    /** White space as the HUD's message choice sees it (JavaScript's `\s`). */
    private fun isSpace(c: Char): Boolean =
        c in '\t'..'\r' || c == ' ' || c == '\u00A0' || c == '\u1680' || c in '\u2000'..'\u200A' ||
            c == '\u2028' || c == '\u2029' || c == '\u202F' || c == '\u205F' || c == '\u3000' ||
            c == '\uFEFF'
}
