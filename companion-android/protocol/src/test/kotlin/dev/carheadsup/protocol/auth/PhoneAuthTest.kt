package dev.carheadsup.protocol.auth

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.Random

class PhoneAuthTest {
    private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    @Test
    fun `HMAC-SHA256 matches RFC 4231, including keys longer than the block`() {
        assertEquals(
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
            hex(PhoneAuth.hmacSha256(ByteArray(20) { 0x0b }, "Hi There".toByteArray())),
        )
        assertEquals(
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
            hex(PhoneAuth.hmacSha256("Jefe".toByteArray(), "what do ya want for nothing?".toByteArray())),
        )
        assertEquals(
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
            hex(
                PhoneAuth.hmacSha256(
                    ByteArray(131) { 0xaa.toByte() },
                    "Test Using Larger Than Block-Size Key - Hash Key First".toByteArray(),
                ),
            ),
        )
    }

    @Test
    fun `HMAC-SHA256 takes the empty key (a HUD without pairing token)`() {
        assertEquals(
            "b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad",
            hex(PhoneAuth.hmacSha256(ByteArray(0), ByteArray(0))),
        )
        assertEquals(
            "fb011e6154a19b9a4c767373c305275a5a69e8b68b0b4c9200c383dced19a416",
            hex(PhoneAuth.hmacSha256(ByteArray(0), "The quick brown fox jumps over the lazy dog".toByteArray())),
        )
    }

    @Test
    fun `proofs match the vectors the HUD asserts`() {
        for (v in SHARED_AUTH_VECTORS) {
            val phoneMessage =
                PhoneAuth.phoneProofMessage(v.hudId, v.hudNonce, v.phoneNonce, v.deviceId, v.certFingerprint)
            assertEquals(v.phoneMessage, phoneMessage, v.name)
            assertEquals(
                v.hudMessage,
                PhoneAuth.hudProofMessage(v.hudId, v.hudNonce, v.phoneNonce, v.deviceId, v.certFingerprint),
                v.name,
            )
            assertEquals(
                v.phoneProof,
                PhoneAuth.phoneProof(v.pairingToken, v.hudId, v.hudNonce, v.phoneNonce, v.deviceId, v.certFingerprint),
                v.name,
            )
            assertEquals(
                v.hudProof,
                PhoneAuth.hudProof(v.pairingToken, v.hudId, v.hudNonce, v.phoneNonce, v.deviceId, v.certFingerprint),
                v.name,
            )
        }
    }

    @Test
    fun `proofs are bound to the certificate the phone was shown`() {
        val direct = SHARED_AUTH_VECTORS[0]
        val relayed = SHARED_AUTH_VECTORS[1]
        // The same session, the same token: only the certificate differs, and so do both proofs.
        assertEquals(direct.hudNonce, relayed.hudNonce)
        assertEquals(direct.pairingToken, relayed.pairingToken)
        assertEquals(direct.phoneNonce, relayed.phoneNonce)
        assertNotEquals(direct.certFingerprint, relayed.certFingerprint)
        assertNotEquals(direct.phoneProof, relayed.phoneProof)
        assertNotEquals(direct.hudProof, relayed.hudProof)
        assertTrue(PhoneAuth.PHONE_CONTEXT.endsWith("-v3"))
        assertTrue(PhoneAuth.HUD_CONTEXT.endsWith("-v3"))
    }

    @Test
    fun `ids are 22 base64url characters of fresh randomness`() {
        val ids = (1..50).map { PhoneAuth.newId() }.toSet()
        assertEquals(50, ids.size)
        assertTrue(ids.all(PhoneAuth::isValidId))
        assertEquals(PhoneAuth.newId(Random(7)), PhoneAuth.newId(Random(7)))
        val almost = "A".repeat(21)
        for (bad in listOf("", almost, "A".repeat(23), "$almost=", "$almost+", "$almost|")) {
            assertFalse(PhoneAuth.isValidId(bad), bad)
        }
        assertTrue(PhoneAuth.isValidProof("A".repeat(43)))
        assertFalse(PhoneAuth.isValidProof("A".repeat(42) + "/"))
    }

    @Test
    fun `proofs are compared exactly`() {
        val proof = SHARED_AUTH_VECTORS[0].phoneProof
        assertTrue(PhoneAuth.proofsEqual(proof, proof))
        assertFalse(PhoneAuth.proofsEqual(proof, proof.dropLast(1)))
        assertFalse(PhoneAuth.proofsEqual(proof, proof.dropLast(1) + if (proof.last() == 'A') "B" else "A"))
    }

    @Test
    fun `a token fingerprint tells tokens apart without containing them`() {
        val fingerprint = PhoneAuth.tokenFingerprint("K7fQ2mZr")
        assertEquals(fingerprint, PhoneAuth.tokenFingerprint("K7fQ2mZr"))
        assertNotEquals(fingerprint, PhoneAuth.tokenFingerprint("K7fQ2mZs"))
        assertNotEquals(PhoneAuth.tokenFingerprint(""), fingerprint)
        assertFalse(fingerprint.contains("K7fQ2mZr"))
    }
}
