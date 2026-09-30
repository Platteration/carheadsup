package dev.carheadsup.protocol.link

import dev.carheadsup.protocol.auth.CertFingerprint
import dev.carheadsup.protocol.auth.PhoneAuth

/**
 * A HUD found over mDNS (`_carheadsup._tcp`, see hud-server `discovery/mdns.ts`): where to
 * connect ([endpoint]: the resolved address and the TLS port from the TXT record `tls`) and
 * what it says about itself — its id (TXT `id`) and the fingerprint of its certificate (TXT
 * `fp`). Neither is a proof: the certificate pin and the handshake decide. A HUD pairing for the
 * first time must present the advertised certificate, though.
 */
public data class HudAdvertisement(val endpoint: HudEndpoint, val hudId: String?, val certFingerprint: String?) {
    public companion object {
        /** TXT record with the HUD's id. */
        public const val TXT_ID: String = "id"

        /** TXT record with the HUD's TLS port. */
        public const val TXT_TLS_PORT: String = "tls"

        /** TXT record with the SHA-256 fingerprint of the HUD's certificate. */
        public const val TXT_FINGERPRINT: String = "fp"

        /**
         * The advertisement of a service resolved to [host] with the TXT records [txt]. The
         * service's own (SRV) port is the HUD's plain HTTP port, which the phone does not use: it
         * connects to the TLS port the TXT record `tls` names, or [HudEndpoint.DEFAULT_PORT] when
         * there is none (the static Avahi file of an older installation). Malformed `id` or `fp`
         * values count as absent; null when [host] or the TLS port is unusable.
         */
        public fun fromTxt(host: String, txt: Map<String, String?>): HudAdvertisement? {
            if (host.isBlank()) return null
            val rawPort = txt[TXT_TLS_PORT]
            val port = if (rawPort == null) HudEndpoint.DEFAULT_PORT else rawPort.trim().toIntOrNull()
            if (port == null || port !in 1..65535) return null
            return HudAdvertisement(
                endpoint = HudEndpoint(host, port),
                hudId = txt[TXT_ID]?.trim()?.takeIf(PhoneAuth::isValidId),
                certFingerprint = CertFingerprint.parse(txt[TXT_FINGERPRINT]),
            )
        }
    }
}
