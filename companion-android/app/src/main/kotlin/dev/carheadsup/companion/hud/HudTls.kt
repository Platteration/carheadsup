package dev.carheadsup.companion.hud

import dev.carheadsup.protocol.tls.HudTrustManager
import okhttp3.OkHttpClient

/**
 * [this] client trusting the HUD through [trust] — the pinned certificate (or, on a first
 * pairing, the certificate the connection presents) — instead of certificate authorities, with
 * the host name check replaced by the pin check: the HUD is reached by IP address with a
 * self-signed certificate.
 */
fun OkHttpClient.withHudTrust(trust: HudTrustManager): OkHttpClient = newBuilder()
    .sslSocketFactory(trust.socketFactory, trust)
    .hostnameVerifier(trust.hostnameVerifier)
    .build()

/**
 * Trust in one pinned HUD certificate for REST calls, reused while the pin stays the same so
 * connections to the HUD can be reused.
 */
class PinnedHudTrust {
    @Volatile
    private var current: HudTrustManager? = null

    /** The trust manager that accepts exactly the certificate [fingerprint]. */
    fun forCertificate(fingerprint: String): HudTrustManager = current?.takeIf { it.pinnedFingerprint == fingerprint }
        ?: HudTrustManager(pinnedFingerprint = fingerprint).also { current = it }
}
