package dev.carheadsup.protocol.auth

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PairingCodeTest {
    @Test
    fun `takes what the HUD and its settings app generate, and any one word of ASCII`() {
        for (token in listOf(
            "",
            "K7fQ2mZrP4xW9sLt3HvNbC8e",
            "0123456789abcdef01234567",
            "p@ss/w0rd?&=#%+,;:'!*()~._-[]{}<>|\\^`\"$",
            (0x21..0x7e).map { it.toChar() }.joinToString(""),
            "x".repeat(PairingCode.MAX_CHARS),
        )) {
            assertNull(PairingCode.problem(token), token)
            assertTrue(PairingCode.isValid(token), token)
        }
    }

    @Test
    fun `refuses spaces, characters beyond ASCII, controls and overlong codes, in the HUD's words`() {
        assertEquals("at most 256 characters", PairingCode.problem("x".repeat(257)))
        for (token in listOf("two words", " leading", "trailing ", "tab\t", "line\nbreak", "a b", "a　b")) {
            assertEquals(
                "no spaces: one word of letters, digits and symbols",
                PairingCode.problem(token),
                token,
            )
        }
        for (token in listOf("Schlüssel", "🚗", "a\u0000b", "a\u007fb", "a\u0085b", "a​b", "a\uD800b")) {
            assertEquals(
                "only letters, digits and symbols of plain ASCII: no accents, emoji or control characters",
                PairingCode.problem(token),
                token,
            )
            assertFalse(PairingCode.isValid(token), token)
        }
    }

    @Test
    fun `a token saved before the rule still works for the link`() {
        // The HUD keeps such a token when it loads its config, so phones paired with it connect.
        for (token in listOf("my car key", "Schlüssel-🚗", "x".repeat(PairingCode.MAX_CHARS))) {
            assertTrue(PhoneAuth.isValidToken(token), token)
        }
        assertFalse(PhoneAuth.isValidToken("x".repeat(PairingCode.MAX_CHARS + 1)))
    }
}
