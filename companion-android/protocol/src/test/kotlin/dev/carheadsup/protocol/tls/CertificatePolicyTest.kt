package dev.carheadsup.protocol.tls

import dev.carheadsup.protocol.auth.SHARED_CERTIFICATE_VECTORS
import dev.carheadsup.protocol.auth.TrustProblem
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class CertificatePolicyTest {
    private val hud = SHARED_CERTIFICATE_VECTORS[0].fingerprint
    private val relay = SHARED_CERTIFICATE_VECTORS[1].fingerprint

    @Test
    fun `once paired, exactly the pinned certificate is accepted`() {
        assertEquals(CertificateDecision.Trusted(hud, pinned = true), CertificatePolicy.decide(hud, hud, null))
        assertEquals(
            CertificateDecision.Rejected(TrustProblem.CertificateChanged(pinned = hud, presented = relay)),
            CertificatePolicy.decide(relay, hud, null),
        )
        // The pin wins over the advertisement: an advertisement cannot un-pin a certificate…
        assertEquals(
            CertificateDecision.Rejected(TrustProblem.CertificateChanged(hud, relay)),
            CertificatePolicy.decide(relay, hud, relay),
        )
        // …nor refuse the pinned one.
        assertEquals(CertificateDecision.Trusted(hud, pinned = true), CertificatePolicy.decide(hud, hud, relay))
    }

    @Test
    fun `before pairing, any certificate is trusted on first use unless the advertisement names another`() {
        assertEquals(CertificateDecision.Trusted(relay, pinned = false), CertificatePolicy.decide(relay, null, null))
        assertEquals(CertificateDecision.Trusted(hud, pinned = false), CertificatePolicy.decide(hud, null, hud))
        assertEquals(
            CertificateDecision.Rejected(TrustProblem.CertificateMismatch(advertised = hud, presented = relay)),
            CertificatePolicy.decide(relay, null, hud),
        )
    }
}
