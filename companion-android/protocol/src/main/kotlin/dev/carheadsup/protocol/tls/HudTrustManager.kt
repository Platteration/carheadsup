package dev.carheadsup.protocol.tls

import dev.carheadsup.protocol.auth.CertFingerprint
import dev.carheadsup.protocol.auth.TrustProblem
import java.net.Socket
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.SSLSession
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509ExtendedTrustManager

/** The HUD's certificate was refused; [problem] says why (nothing was sent over the connection). */
public class HudCertificateException(public val problem: TrustProblem) :
    CertificateException(
        when (problem) {
            is TrustProblem.CertificateChanged -> "the HUD's certificate changed"
            is TrustProblem.CertificateMismatch -> "the HUD's certificate is not the advertised one"
            else -> "the HUD's certificate was refused"
        },
    )

/**
 * The phone's trust in the HUD's TLS certificate: accepts exactly the leaf certificate
 * [CertificatePolicy] allows — the pinned one ([pinnedFingerprint]) once paired; on a first
 * pairing any one (trust on first use), or the one the mDNS advertisement names
 * ([advertisedFingerprint]). Certificate authorities, names and dates play no part: the HUD is
 * reached by IP address with a self-signed certificate, and the pin is the trust.
 *
 * Use one instance per connection attempt: it records the certificate that connection presented
 * ([presentedFingerprint]), which the handshake binds its proofs to, and why it was refused
 * ([rejection]). [socketFactory] and [hostnameVerifier] belong to it; the hostname verifier
 * replaces the name check with the pin check (it rejects a session whose certificate is not the
 * one accepted here, e.g. a resumed one).
 */
public class HudTrustManager(public val pinnedFingerprint: String?, public val advertisedFingerprint: String? = null) :
    X509ExtendedTrustManager() {
    /** The fingerprint of the certificate the HUD presented last, if a handshake got that far. */
    @Volatile
    public var presentedFingerprint: String? = null
        private set

    /** The fingerprint of the certificate accepted last. */
    @Volatile
    public var acceptedFingerprint: String? = null
        private set

    /** Why the certificate was refused, if it was. */
    @Volatile
    public var rejection: TrustProblem? = null
        private set

    /** TLS client sockets that trust through this instance (its own context and session cache). */
    public val socketFactory: SSLSocketFactory by lazy {
        SSLContext.getInstance("TLS").apply { init(null, arrayOf(this@HudTrustManager), null) }.socketFactory
    }

    /** Checks the pin instead of the host name (see [verify]). */
    public val hostnameVerifier: HostnameVerifier = HostnameVerifier { _, session -> verify(session) }

    /** The decision for a certificate chain the HUD presented (its first entry is the leaf). */
    public fun decide(chain: Array<out X509Certificate>?): CertificateDecision {
        val leaf = chain?.firstOrNull()
            ?: return CertificateDecision.Rejected(TrustProblem.ProtocolViolation("no certificate"))
        return CertificatePolicy.decide(CertFingerprint.of(leaf.encoded), pinnedFingerprint, advertisedFingerprint)
    }

    /**
     * Whether a finished TLS [session] presented the certificate this trust manager accepted —
     * the check that replaces host name verification.
     */
    public fun verify(session: SSLSession?): Boolean {
        val leaf =
            try {
                session?.peerCertificates?.firstOrNull()
            } catch (e: SSLPeerUnverifiedException) {
                null
            } ?: return false
        val fingerprint = CertFingerprint.of(leaf.encoded)
        val decision = CertificatePolicy.decide(fingerprint, pinnedFingerprint, advertisedFingerprint)
        return decision is CertificateDecision.Trusted && fingerprint == acceptedFingerprint
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        check(chain)
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) {
        check(chain)
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) {
        check(chain)
    }

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?): Unit =
        throw CertificateException("the phone accepts no TLS clients")

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?): Unit =
        throw CertificateException("the phone accepts no TLS clients")

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?): Unit =
        throw CertificateException("the phone accepts no TLS clients")

    /** No certificate authority is trusted: only the pinned (or first-use) certificate. */
    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()

    private fun check(chain: Array<out X509Certificate>?) {
        chain?.firstOrNull()?.let { presentedFingerprint = CertFingerprint.of(it.encoded) }
        when (val decision = decide(chain)) {
            is CertificateDecision.Trusted -> {
                rejection = null
                acceptedFingerprint = decision.fingerprint
            }

            is CertificateDecision.Rejected -> {
                rejection = decision.problem
                throw HudCertificateException(decision.problem)
            }
        }
    }
}
