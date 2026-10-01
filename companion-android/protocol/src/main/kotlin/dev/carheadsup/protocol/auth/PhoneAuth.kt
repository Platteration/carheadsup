package dev.carheadsup.protocol.auth

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.Random
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * The phone link's mutual authentication (protocol v3), byte for byte the same as the HUD's
 * (packages/core/src/protocol/phone-auth.ts for the messages, packages/hud-server/src/phone/auth.ts
 * for the HMAC; shared test vectors keep them in step):
 *
 *     phone ⇄ HUD   TLS: the HUD presents its self-signed certificate (see [dev.carheadsup.protocol.tls])
 *     HUD → phone   challenge { hudId, nonce: hudNonce }
 *     phone → HUD   hello     { deviceId, nonce: phoneNonce, proof: MAC(phoneProofMessage) }
 *     HUD → phone   welcome   { hudId, proof: MAC(hudProofMessage) }
 *
 * MAC is HMAC-SHA256 keyed with the UTF-8 bytes of the pairing token, base64url without padding.
 * The token never travels. With an empty token the proofs are computed with an empty key and
 * prove nothing.
 *
 * Both proofs cover the SHA-256 fingerprint of the certificate the phone was shown
 * ([CertFingerprint]): the HUD checks against its own, so a relay that shows the phone another
 * certificate can neither pass the phone's proof on nor produce the HUD's.
 */
public object PhoneAuth {
    public const val PHONE_CONTEXT: String = "carheadsup-phone-v3"
    public const val HUD_CONTEXT: String = "carheadsup-hud-v3"

    /** Length of a HUD id, device id or nonce: 16 random bytes in base64url. */
    public const val ID_CHARS: Int = 22

    /** Length of a proof: 32 bytes of HMAC-SHA256 in base64url. */
    public const val PROOF_CHARS: Int = 43

    /** Longest pairing token the HUD holds (core config `phone.pairingToken`). */
    public const val MAX_TOKEN_CHARS: Int = PairingCode.MAX_CHARS

    private const val HMAC_BLOCK_BYTES = 64
    private const val PIN_CONTEXT = "carheadsup-pin-v2|"
    private val ID = Regex("^[A-Za-z0-9_-]{$ID_CHARS}$")
    private val PROOF = Regex("^[A-Za-z0-9_-]{$PROOF_CHARS}$")
    private val base64url: Base64.Encoder = Base64.getUrlEncoder().withoutPadding()
    private val secureRandom: SecureRandom by lazy { SecureRandom() }

    /** Whether [value] is a well-formed HUD id, device id or nonce. */
    public fun isValidId(value: String): Boolean = ID.matches(value)

    /** Whether [value] is a well-formed proof. */
    public fun isValidProof(value: String): Boolean = PROOF.matches(value)

    /**
     * Whether the link can prove [token]: any text the HUD may hold as its pairing token — also
     * one saved before the pairing-token rule, which the HUD keeps and phones paired with it go on
     * proving. A new token (typed or scanned) must keep the rule: [PairingCode.isValid].
     */
    public fun isValidToken(token: String): Boolean = token.length <= MAX_TOKEN_CHARS

    /** 16 random bytes as 22 base64url characters: a nonce or a device id. */
    public fun newId(random: Random = secureRandom): String {
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        return base64url.encodeToString(bytes)
    }

    /**
     * `carheadsup-phone-v3|hudId|hudNonce|phoneNonce|deviceId|certFingerprint`: what
     * `hello.proof` covers. [certFingerprint] is the certificate this connection presented
     * ([CertFingerprint.of]).
     */
    public fun phoneProofMessage(
        hudId: String,
        hudNonce: String,
        phoneNonce: String,
        deviceId: String,
        certFingerprint: String,
    ): String = listOf(PHONE_CONTEXT, hudId, hudNonce, phoneNonce, deviceId, certFingerprint).joinToString("|")

    /** `carheadsup-hud-v3|hudId|phoneNonce|hudNonce|deviceId|certFingerprint`: what `welcome.proof` covers. */
    public fun hudProofMessage(
        hudId: String,
        hudNonce: String,
        phoneNonce: String,
        deviceId: String,
        certFingerprint: String,
    ): String = listOf(HUD_CONTEXT, hudId, phoneNonce, hudNonce, deviceId, certFingerprint).joinToString("|")

    /** The proof this phone puts in its `hello`. */
    public fun phoneProof(
        token: String,
        hudId: String,
        hudNonce: String,
        phoneNonce: String,
        deviceId: String,
        certFingerprint: String,
    ): String = mac(token, phoneProofMessage(hudId, hudNonce, phoneNonce, deviceId, certFingerprint))

    /** The proof a HUD that knows [token] puts in its `welcome`. */
    public fun hudProof(
        token: String,
        hudId: String,
        hudNonce: String,
        phoneNonce: String,
        deviceId: String,
        certFingerprint: String,
    ): String = mac(token, hudProofMessage(hudId, hudNonce, phoneNonce, deviceId, certFingerprint))

    /** Constant-time comparison (false when the lengths differ). */
    public fun proofsEqual(expected: String, received: String): Boolean =
        MessageDigest.isEqual(expected.toByteArray(Charsets.UTF_8), received.toByteArray(Charsets.UTF_8))

    /**
     * Identifies a pairing token in a [HudPin] without being the token: base64url SHA-256 of
     * `carheadsup-pin-v2|<token>` (stored next to the token, so it reveals nothing more).
     */
    public fun tokenFingerprint(token: String): String = base64url.encodeToString(
        MessageDigest.getInstance("SHA-256").digest((PIN_CONTEXT + token).toByteArray(Charsets.UTF_8)),
    )

    private fun mac(token: String, message: String): String =
        base64url.encodeToString(hmacSha256(token.toByteArray(Charsets.UTF_8), message.toByteArray(Charsets.UTF_8)))

    /** HMAC-SHA256 (RFC 2104), including the empty key the HUD uses without a pairing token. */
    internal fun hmacSha256(key: ByteArray, message: ByteArray): ByteArray {
        // SecretKeySpec refuses an empty key. HMAC pads keys shorter than the 64-byte block with
        // zeros, so the empty key is exactly the key of 64 zero bytes.
        val effectiveKey = if (key.isEmpty()) ByteArray(HMAC_BLOCK_BYTES) else key
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(effectiveKey, "HmacSHA256"))
        return mac.doFinal(message)
    }
}
