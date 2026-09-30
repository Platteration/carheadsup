package dev.carheadsup.protocol.pairing

import dev.carheadsup.protocol.auth.CertFingerprint
import dev.carheadsup.protocol.auth.HudPin
import dev.carheadsup.protocol.auth.PhoneAuth
import dev.carheadsup.protocol.link.HudEndpoint
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/**
 * What the HUD's pairing QR code carries (pairing URI version 1): everything the phone needs to
 * pair — the pairing token, the HUD's id and its certificate's fingerprint (pinned at once: the
 * HUD's own display is the trusted channel, so there is no trust on first use), and where to
 * reach it ([hosts], most preferred first, and its TLS port).
 */
public data class PairingPayload(
    val hudId: String,
    /** SHA-256 of the HUD's certificate, 64 lowercase hex digits. */
    val certFingerprint: String,
    /** The HUD's `phone.pairingToken`; never empty. */
    val pairingToken: String,
    val hosts: List<String>,
    val tlsPort: Int,
    /** The HUD's name ("Golf HUD"), or null when the code names none. */
    val hudName: String?,
) {
    /**
     * The pin a scan makes: this HUD and exactly this certificate, for this pairing token. It
     * replaces whatever was pinned before — the scanned fingerprint is authoritative.
     */
    public fun pin(): HudPin = HudPin.of(hudId, pairingToken, certFingerprint)

    /** Where to connect, in the code's order. */
    public fun endpoints(): List<HudEndpoint> = hosts.map { HudEndpoint(it, tlsPort) }

    /** Leaves the pairing token out: payloads end up in logs. */
    override fun toString(): String =
        "PairingPayload(hudId=$hudId, certFingerprint=$certFingerprint, pairingToken=…, hosts=$hosts, " +
            "tlsPort=$tlsPort, hudName=$hudName)"
}

/** What a scanned text is to the pairing flow. */
public sealed interface PairingScan {
    /** A pairing code: pair with [payload]. */
    public data class Valid(val payload: PairingPayload) : PairingScan

    /** Not a carheadsup pairing code at all (another app's QR code, a web address, text). */
    public data object Foreign : PairingScan

    /** A pairing code of a later version ([version]) than this app reads: update the app. */
    public data class UnsupportedVersion(val version: String) : PairingScan

    /** A carheadsup pairing code that is damaged or out of shape; [detail] is for logs. */
    public data class Invalid(val detail: String) : PairingScan
}

/**
 * The pairing URI the HUD shows as a QR code on its parked dashboard ("Pair a phone"), byte for
 * byte as the HUD writes it (packages/core/src/protocol/pairing.ts; shared test vectors keep the
 * two in step):
 *
 *     carheadsup://pair?v=1&id=<hudId>&fp=<cert SHA-256 hex>&k=<pairing token>&h=<host>[,<host>…]&p=<TLS port>&n=<HUD name>
 *
 * Values are percent-encoded UTF-8 (a `+` is a plus sign, not a space). The scheme and host
 * compare ignoring ASCII case; surrounding ASCII white space, a fragment and unknown parameters
 * are ignored; anything else out of shape — a duplicated parameter, a malformed escape, a field
 * out of range — makes the code [PairingScan.Invalid]. `n` is optional.
 */
public object PairingUri {
    public const val SCHEME: String = "carheadsup"
    public const val HOST: String = "pair"
    public const val VERSION: Int = 1

    /** Most hosts in `h`. */
    public const val MAX_HOSTS: Int = 8

    /** Longest host (a DNS name). */
    public const val MAX_HOST_CHARS: Int = 253

    /** Longest pairing token, in UTF-16 code units (the HUD's config limit). */
    public const val MAX_TOKEN_CHARS: Int = PhoneAuth.MAX_TOKEN_CHARS

    /** Longest HUD name, in bytes of UTF-8 (one DNS-SD instance label). */
    public const val MAX_NAME_BYTES: Int = 63

    private const val PREFIX = "$SCHEME://$HOST"
    private val DNS_NAME =
        Regex("^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$")
    private val DIGITS_AND_DOTS = Regex("^[0-9.]+$")
    private val IPV4_BYTE = Regex("^(0|[1-9][0-9]{0,2})$")
    private val VERSION_NUMBER = Regex("^[1-9][0-9]{0,8}$")
    private val PORT = Regex("^[1-9][0-9]{0,4}$")
    private val REQUIRED = listOf("id", "fp", "k", "h", "p")

    /**
     * Whether [host] may appear in `h`: an IPv4 address in canonical dotted decimal or a DNS name
     * (letters, digits and hyphens in labels of at most 63 characters). Digits and dots alone
     * must be an IPv4 address.
     */
    public fun isHost(host: String): Boolean {
        if (host.isEmpty() || host.length > MAX_HOST_CHARS) return false
        if (DIGITS_AND_DOTS.matches(host)) {
            val parts = host.split('.')
            return parts.size == 4 && parts.all { IPV4_BYTE.matches(it) && it.toInt() <= 255 }
        }
        return DNS_NAME.matches(host)
    }

    /** What [text] (a scanned QR code) is: a pairing code, or why not. */
    public fun parse(text: String): PairingScan {
        val trimmed = text.trim(::isAsciiSpace)
        val rest = if (trimmed.length >= PREFIX.length) trimmed.substring(PREFIX.length) else ""
        val prefixMatches =
            trimmed.length >= PREFIX.length && PREFIX.indices.all { asciiLower(trimmed[it]) == PREFIX[it] }
        if (!prefixMatches || !(rest.isEmpty() || rest.startsWith('?') || rest.startsWith('#'))) {
            return PairingScan.Foreign
        }
        val query = if (rest.startsWith('?')) rest.substring(1).substringBefore('#') else ""
        val params = LinkedHashMap<String, String>()
        if (query.isNotEmpty()) {
            for ((index, pair) in query.split('&').withIndex()) {
                val eq = pair.indexOf('=')
                // Not the parameter itself: it may be the pairing token.
                if (eq <= 0) return PairingScan.Invalid("parameter ${index + 1} is not name=value")
                val key = pair.substring(0, eq)
                val value = percentDecode(pair.substring(eq + 1)) ?: return PairingScan.Invalid(
                    "$key: malformed percent-encoding",
                )
                if (key in params) return PairingScan.Invalid("$key appears twice")
                params[key] = value
            }
        }

        val version = params["v"] ?: return PairingScan.Invalid("v is missing")
        if (!VERSION_NUMBER.matches(version)) return PairingScan.Invalid("v must be a version number")
        if (version.toLong() > VERSION) return PairingScan.UnsupportedVersion(version)

        REQUIRED.firstOrNull { it !in params }?.let { return PairingScan.Invalid("$it is missing") }
        val port = params.getValue("p")
        if (!PORT.matches(port)) return PairingScan.Invalid("p must be a port number (1–65535)")
        val payload =
            PairingPayload(
                hudId = params.getValue("id"),
                certFingerprint = params.getValue("fp"),
                pairingToken = params.getValue("k"),
                hosts = params.getValue("h").split(','),
                tlsPort = port.toInt(),
                hudName = params["n"],
            )
        return problem(payload)?.let { PairingScan.Invalid(it) } ?: PairingScan.Valid(payload)
    }

    /** The first problem of [payload] (as the HUD's encoder checks it), or null. */
    internal fun problem(payload: PairingPayload): String? {
        if (!PhoneAuth.isValidId(payload.hudId)) return "id must be ${PhoneAuth.ID_CHARS} base64url characters"
        if (!CertFingerprint.isValid(payload.certFingerprint)) {
            return "fp must be ${CertFingerprint.CHARS} lowercase hex digits"
        }
        val token = payload.pairingToken
        if (token.isEmpty()) return "k (the pairing token) must not be empty"
        if (token.length > MAX_TOKEN_CHARS) return "k (the pairing token) must be at most $MAX_TOKEN_CHARS characters"
        if (hasLoneSurrogate(token)) return "k (the pairing token) is not well-formed text"
        val hosts = payload.hosts
        if (hosts.isEmpty()) return "h must name at least one host"
        if (hosts.size > MAX_HOSTS) return "h must name at most $MAX_HOSTS hosts"
        hosts.firstOrNull { !isHost(it) }?.let { return "h: \"$it\" is not an IPv4 address or host name" }
        if (payload.tlsPort !in 1..65535) return "p must be a port number (1–65535)"
        val name = payload.hudName ?: return null
        if (name.isEmpty()) return "n must not be empty"
        if (name.any(::isControl) || hasLoneSurrogate(name)) return "n must be plain text"
        if (name.toByteArray(Charsets.UTF_8).size > MAX_NAME_BYTES) {
            return "n must be at most $MAX_NAME_BYTES bytes of UTF-8"
        }
        return null
    }

    /** Percent-decoding of UTF-8 (`+` stays `+`); null for a malformed escape or bytes that are not UTF-8. */
    private fun percentDecode(text: String): String? {
        if ('%' !in text) return text
        val bytes = ByteArray(text.length * 4)
        var size = 0
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (c == '%') {
                if (i + 2 >= text.length) return null
                val high = hexValue(text[i + 1])
                val low = hexValue(text[i + 2])
                if (high < 0 || low < 0) return null
                bytes[size++] = ((high shl 4) or low).toByte()
                i += 3
            } else {
                // Unescaped characters (a space a scanner kept, a raw 'ü') stand for themselves.
                var end = i + 1
                while (end < text.length && text[end] != '%') end++
                for (b in text.substring(i, end).toByteArray(Charsets.UTF_8)) bytes[size++] = b
                i = end
            }
        }
        return try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes, 0, size))
                .toString()
        } catch (e: CharacterCodingException) {
            null
        }
    }

    private fun hexValue(c: Char): Int = when (c) {
        in '0'..'9' -> c - '0'
        in 'a'..'f' -> c - 'a' + 10
        in 'A'..'F' -> c - 'A' + 10
        else -> -1
    }

    private fun isAsciiSpace(c: Char): Boolean = c == ' ' || c in '\t'..'\r'

    private fun asciiLower(c: Char): Char = if (c in 'A'..'Z') c + ('a' - 'A') else c

    /** C0 controls, DEL and C1 controls (as the HUD refuses them in names). */
    private fun isControl(c: Char): Boolean = c <= '\u001f' || c in '\u007f'..'\u009f'

    private fun hasLoneSurrogate(text: String): Boolean {
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (c.isHighSurrogate()) {
                if (i + 1 >= text.length || !text[i + 1].isLowSurrogate()) return true
                i += 2
            } else {
                if (c.isLowSurrogate()) return true
                i++
            }
        }
        return false
    }
}
