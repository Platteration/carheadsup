package dev.carheadsup.protocol.pairing

import dev.carheadsup.protocol.auth.CertFingerprint
import dev.carheadsup.protocol.auth.HudPin
import dev.carheadsup.protocol.auth.PairingCode
import dev.carheadsup.protocol.auth.PhoneAuth
import dev.carheadsup.protocol.link.HudEndpoint
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PairingUriTest {
    private val payload = SHARED_PAIRING_VECTORS.first().payload

    @Test
    fun `parses every shared vector the HUD writes`() {
        for (vector in SHARED_PAIRING_VECTORS) {
            assertEquals(PairingScan.Valid(vector.payload), PairingUri.parse(vector.uri), vector.name)
        }
    }

    @Test
    fun `refuses every shared vector the HUD refuses, for the same reason`() {
        for (vector in SHARED_INVALID_PAIRING_VECTORS) {
            val result = PairingUri.parse(vector.uri)
            val kind =
                when (result) {
                    PairingScan.Foreign -> "foreign"
                    is PairingScan.UnsupportedVersion -> "unsupported-version"
                    is PairingScan.Invalid -> "invalid".also { assertTrue(result.detail.isNotEmpty()) }
                    is PairingScan.Valid -> "valid"
                }
            assertEquals(vector.error, kind, vector.name)
        }
    }

    @Test
    fun `the vectors cover every kind of result`() {
        assertTrue(SHARED_PAIRING_VECTORS.any { it.canonical })
        assertTrue(SHARED_PAIRING_VECTORS.any { !it.canonical })
        assertTrue(SHARED_PAIRING_VECTORS.any { it.payload.hudName == null })
        for (error in listOf("foreign", "unsupported-version", "invalid")) {
            assertTrue(SHARED_INVALID_PAIRING_VECTORS.any { it.error == error }, error)
        }
        assertEquals(PairingUri.MAX_HOSTS, SHARED_PAIRING_VECTORS.maxOf { it.payload.hosts.size })
        assertEquals(PairingUri.MAX_TOKEN_CHARS, SHARED_PAIRING_VECTORS.maxOf { it.payload.pairingToken.length })
    }

    @Test
    fun `a later version asks for an app update rather than failing`() {
        val later = SHARED_PAIRING_VECTORS.first().uri.replace("v=1", "v=12")
        assertEquals(PairingScan.UnsupportedVersion("12"), PairingUri.parse(later))
    }

    @Test
    fun `a plus sign and raw characters stand for themselves`() {
        val uri =
            "carheadsup://pair?v=1&id=${payload.hudId}&fp=${payload.certFingerprint}&k=a+b!~*%21" +
                "&h=10.42.0.1&p=8443&n=My car ü%C3%BC"
        val result = PairingUri.parse(uri)
        assertInstanceOf(PairingScan.Valid::class.java, result)
        assertEquals("a+b!~*!", (result as PairingScan.Valid).payload.pairingToken)
        assertEquals("My car üü", result.payload.hudName)
    }

    @Test
    fun `takes exactly the tokens the manual pairing-code field takes`() {
        val tokens =
            listOf(
                "K7fQ2mZrP4xW9sLt3HvNbC8e",
                "a",
                "!",
                "~",
                (0x21..0x7e).map { it.toChar() }.joinToString(""),
                "x".repeat(256),
                "x".repeat(257),
                "two words",
                " leading",
                "tab\t",
                "line\nbreak",
                "Schlüssel",
                "\u00a0",
                "\u200b",
                "\u0000",
                "\u007f",
                "🚗",
            )
        for (token in tokens) {
            val encodable = PairingUri.problem(payload.copy(pairingToken = token)) == null
            assertEquals(PairingCode.isValid(token), encodable, token)
        }
    }

    @Test
    fun `a raw lone surrogate is refused, with or without escapes next to it, as the HUD refuses it`() {
        // Not a shared vector: JSON parsers disagree about lone surrogates. A scanner never
        // produces one (ZXing decodes bytes to well-formed text), but the parser must not turn
        // it into '?' and accept the result.
        for (token in listOf("abc\uD800", "abc%41\uD800", "\uDC00%41")) {
            val uri =
                "carheadsup://pair?v=1&id=${payload.hudId}&fp=${payload.certFingerprint}&k=$token" +
                    "&h=10.42.0.1&p=8443"
            assertInstanceOf(PairingScan.Invalid::class.java, PairingUri.parse(uri), token)
        }
    }

    @Test
    fun `pins the scanned HUD and certificate for the scanned token`() {
        val pin = payload.pin()
        assertEquals(HudPin.of(payload.hudId, payload.pairingToken, payload.certFingerprint), pin)
        assertTrue(pin.appliesTo(payload.pairingToken))
        assertFalse(pin.appliesTo("another token"))
        assertEquals(payload.certFingerprint, pin.certFingerprint)
        assertTrue(CertFingerprint.isValid(pin.certFingerprint!!))
        assertTrue(PhoneAuth.isValidId(pin.hudId))
    }

    @Test
    fun `offers the hosts in the code's order on the TLS port`() {
        assertEquals(
            listOf(HudEndpoint("10.42.0.1", 8443), HudEndpoint("carheadsup.local", 8443)),
            payload.endpoints(),
        )
    }

    @Test
    fun `never prints the pairing token`() {
        val text = payload.toString()
        assertFalse(payload.pairingToken in text)
        assertTrue(payload.hudId in text)
        assertFalse(payload.pairingToken in PairingScan.Valid(payload).toString())
    }

    @Test
    fun `hosts are IPv4 addresses or DNS names`() {
        for (host in listOf("10.42.0.1", "0.0.0.0", "255.255.255.255", "carheadsup.local", "a", "x-1.y")) {
            assertTrue(PairingUri.isHost(host), host)
        }
        for (host in listOf(
            "",
            "::1",
            "fe80::1%wlan0",
            "[::1]",
            "256.1.1.1",
            "10.42.0.01",
            "10.42.0",
            "1.2.3.4.5",
            "-car.local",
            "car-.local",
            "car..local",
            "car.local.",
            "car_hud",
            "a".repeat(64),
            "car hud",
            "car,hud",
        )) {
            assertFalse(PairingUri.isHost(host), host)
        }
        assertTrue(PairingUri.isHost("${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}"))
        assertFalse(PairingUri.isHost("${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}"))
    }

    @Test
    fun `checks a payload as the HUD's encoder does`() {
        assertNull(PairingUri.problem(payload))
        assertNull(PairingUri.problem(payload.copy(hudName = null)))
        val bad =
            listOf(
                payload.copy(hudId = "short"),
                payload.copy(certFingerprint = "F".repeat(64)),
                payload.copy(pairingToken = ""),
                payload.copy(pairingToken = "x".repeat(257)),
                payload.copy(pairingToken = "a\uD800b"),
                payload.copy(pairingToken = "two words"),
                payload.copy(pairingToken = "Schlüssel"),
                payload.copy(pairingToken = "tab\t"),
                payload.copy(hosts = emptyList()),
                payload.copy(hosts = List(9) { "10.0.0.$it" }),
                payload.copy(hosts = listOf("fe80::1")),
                payload.copy(tlsPort = 0),
                payload.copy(tlsPort = 65536),
                payload.copy(hudName = ""),
                payload.copy(hudName = "line\nbreak"),
                payload.copy(hudName = "\u0085"),
                payload.copy(hudName = "ü".repeat(32)),
            )
        for (candidate in bad) assertTrue(PairingUri.problem(candidate) != null, candidate.toString())
    }
}
