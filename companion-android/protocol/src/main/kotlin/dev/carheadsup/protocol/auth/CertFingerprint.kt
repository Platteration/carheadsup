package dev.carheadsup.protocol.auth

import java.security.MessageDigest

/**
 * The SHA-256 fingerprint of a TLS certificate, as the HUD computes it for its own certificate
 * (hud-server `tls/certificate.ts`) and as the phone pins it and binds its proofs to it: 64
 * lowercase hex digits over the certificate's DER bytes.
 */
public object CertFingerprint {
    /** Length of a fingerprint: 32 bytes of SHA-256 in hex. */
    public const val CHARS: Int = 64

    /** Hex digits of the short form people compare: 80 bits (core `shortFingerprint`). */
    public const val SHORT_CHARS: Int = 20

    private val PATTERN = Regex("^[0-9a-f]{$CHARS}$")
    private const val HEX = "0123456789abcdef"

    /** The fingerprint of a certificate's DER encoding. */
    public fun of(der: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(der)
        return buildString(CHARS) {
            for (byte in digest) {
                val b = byte.toInt() and 0xff
                append(HEX[b shr 4]).append(HEX[b and 0x0f])
            }
        }
    }

    /** Whether [value] is a well-formed fingerprint (64 lowercase hex digits). */
    public fun isValid(value: String): Boolean = PATTERN.matches(value)

    /**
     * A fingerprint written another way — upper case, with colons or spaces between the bytes,
     * as tools print them (and as the mDNS TXT record `fp` might carry it) — in canonical form,
     * or null when [text] is not one.
     */
    public fun parse(text: String?): String? {
        if (text == null) return null
        val compact = text.trim().replace(":", "").replace(" ", "").lowercase()
        return compact.takeIf(::isValid)
    }

    /**
     * The form people compare: the first 20 hex digits in upper case, in groups of four —
     * `3F2A 91C4 7B0E 55D2 0A1B`, exactly as the HUD's settings app shows it. Empty for anything
     * that is not a fingerprint.
     */
    public fun short(fingerprint: String): String {
        if (!isValid(fingerprint)) return ""
        return fingerprint.take(SHORT_CHARS).uppercase().chunked(4).joinToString(" ")
    }
}
