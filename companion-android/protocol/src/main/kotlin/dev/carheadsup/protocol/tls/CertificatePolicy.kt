package dev.carheadsup.protocol.tls

import dev.carheadsup.protocol.auth.TrustProblem

/** What the phone's TLS layer decides about the certificate a HUD presented. */
public sealed interface CertificateDecision {
    /**
     * Talk to this HUD over this certificate ([fingerprint]). [pinned] is false on a first
     * pairing: the certificate is only trusted on first use, and the handshake's proofs (bound
     * to it) then decide whether it is pinned.
     */
    public data class Trusted(val fingerprint: String, val pinned: Boolean) : CertificateDecision

    /** Refuse the connection: nothing is sent over it. */
    public data class Rejected(val problem: TrustProblem) : CertificateDecision
}

/**
 * Pinning decisions for the HUD's self-signed certificate. The HUD is reached by IP address and
 * has no certificate authority behind it, so names and authorities are not checked: the
 * certificate itself is.
 *
 *  - Paired (a pinned fingerprint): exactly the pinned certificate is accepted; any other is
 *    [TrustProblem.CertificateChanged] — a hard stop until the phone is paired again.
 *  - Not paired yet: trust on first use. If the mDNS advertisement being connected to names a
 *    fingerprint (TXT `fp`), the certificate must match it ([TrustProblem.CertificateMismatch]);
 *    otherwise any certificate is accepted and bound into the handshake's proofs, which a relay
 *    showing its own certificate cannot pass.
 */
public object CertificatePolicy {
    /**
     * The decision for a presented certificate ([presented], its fingerprint), given the pinned
     * one ([pinned], null before the first pairing) and the advertised one ([advertised], null
     * when unknown: manual address or an advertisement without `fp`).
     */
    public fun decide(presented: String, pinned: String?, advertised: String?): CertificateDecision = when {
        pinned != null ->
            if (presented == pinned) {
                CertificateDecision.Trusted(presented, pinned = true)
            } else {
                CertificateDecision.Rejected(TrustProblem.CertificateChanged(pinned, presented))
            }

        advertised != null && advertised != presented ->
            CertificateDecision.Rejected(TrustProblem.CertificateMismatch(advertised, presented))

        else -> CertificateDecision.Trusted(presented, pinned = false)
    }
}
