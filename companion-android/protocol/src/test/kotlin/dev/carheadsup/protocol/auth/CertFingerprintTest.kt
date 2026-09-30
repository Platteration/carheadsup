package dev.carheadsup.protocol.auth

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.ByteArrayInputStream
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.Base64

class CertFingerprintTest {
    @Test
    fun `fingerprints certificates made by the HUD exactly as the HUD does`() {
        for (vector in SHARED_CERTIFICATE_VECTORS) {
            val der = Base64.getDecoder().decode(vector.der)
            assertEquals(vector.fingerprint, CertFingerprint.of(der), vector.name)
            assertTrue(CertFingerprint.isValid(vector.fingerprint))
            // The JDK's X.509 parser reads the HUD's certificates (made by its own DER encoder).
            val parsed =
                CertificateFactory.getInstance(
                    "X.509",
                ).generateCertificate(ByteArrayInputStream(der)) as X509Certificate
            assertEquals(vector.fingerprint, CertFingerprint.of(parsed.encoded))
            assertEquals("SHA256withECDSA", parsed.sigAlgName)
            parsed.verify(parsed.publicKey) // self-signed
            assertEquals(-1, parsed.basicConstraints) // not a CA
        }
    }

    @Test
    fun `the short form is the one the HUD's settings show`() {
        for (vector in SHARED_CERTIFICATE_VECTORS) assertEquals(vector.short, CertFingerprint.short(vector.fingerprint))
        assertEquals("0123 4567 89AB CDEF 0123", CertFingerprint.short("0123456789abcdef".repeat(4)))
        assertEquals("", CertFingerprint.short("not a fingerprint"))
        assertEquals(CertFingerprint.SHORT_CHARS, CertFingerprint.short("f".repeat(64)).replace(" ", "").length)
    }

    @Test
    fun `accepts only 64 lowercase hex digits, and reads other spellings`() {
        assertTrue(CertFingerprint.isValid("ab".repeat(32)))
        for (bad in listOf("", "ab".repeat(31), "AB".repeat(32), "g".repeat(64), "ab".repeat(32) + "\n")) {
            assertFalse(CertFingerprint.isValid(bad), bad)
        }
        val fingerprint = SHARED_CERTIFICATE_VECTORS[0].fingerprint
        assertEquals(fingerprint, CertFingerprint.parse(fingerprint))
        assertEquals(fingerprint, CertFingerprint.parse(fingerprint.uppercase()))
        assertEquals(fingerprint, CertFingerprint.parse(fingerprint.chunked(2).joinToString(":")))
        assertEquals(fingerprint, CertFingerprint.parse(" " + fingerprint.chunked(4).joinToString(" ") + " "))
        assertNull(CertFingerprint.parse(null))
        assertNull(CertFingerprint.parse(fingerprint.drop(2)))
        assertNull(CertFingerprint.parse("SHA256:" + fingerprint))
    }
}
