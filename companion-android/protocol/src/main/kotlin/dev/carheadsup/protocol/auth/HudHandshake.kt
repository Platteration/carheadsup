package dev.carheadsup.protocol.auth

import dev.carheadsup.protocol.HudChallenge
import dev.carheadsup.protocol.HudWelcome
import dev.carheadsup.protocol.PROTOCOL_VERSION
import dev.carheadsup.protocol.PhoneHello
import dev.carheadsup.protocol.PhoneMessages

/**
 * The HUD this phone is paired with: its [hudId] and the fingerprint of its TLS certificate
 * ([certFingerprint]), learned at the first verified connection (or, for a HUD without pairing
 * code, confirmed by the user), valid only together with the pairing token whose
 * [tokenFingerprint] it carries — entering another token starts a new pairing.
 *
 * From then on the phone's TLS layer accepts exactly this certificate (see
 * [dev.carheadsup.protocol.tls.HudTrustManager]). A pin made by an app from before TLS has no
 * [certFingerprint] yet: the certificate of the next verified connection is added to it.
 */
public data class HudPin(val hudId: String, val tokenFingerprint: String, val certFingerprint: String? = null) {
    init {
        require(certFingerprint == null || CertFingerprint.isValid(certFingerprint)) {
            "certFingerprint must be 64 lowercase hex digits"
        }
    }

    /** Whether this pin belongs to [pairingToken]. */
    public fun appliesTo(pairingToken: String): Boolean =
        PhoneAuth.proofsEqual(tokenFingerprint, PhoneAuth.tokenFingerprint(pairingToken))

    public companion object {
        public fun of(hudId: String, pairingToken: String, certFingerprint: String? = null): HudPin =
            HudPin(hudId, PhoneAuth.tokenFingerprint(pairingToken), certFingerprint)

        /** [pin] when it belongs to [pairingToken], else null (not paired with this token). */
        public fun active(pin: HudPin?, pairingToken: String): HudPin? = pin?.takeIf { it.appliesTo(pairingToken) }

        /**
         * Whether discovery may connect to a HUD that advertises the mDNS TXT record
         * `id` = [advertisedId]: any HUD while not paired (pairing needs one); once paired, the
         * paired HUD, or a HUD that does not advertise an id (the static Avahi service file) —
         * its certificate and `challenge` are checked against the pin before anything is sent.
         */
        public fun acceptsAdvertisement(pin: HudPin?, pairingToken: String, advertisedId: String?): Boolean {
            val active = active(pin, pairingToken) ?: return true
            return advertisedId == null || advertisedId == active.hudId
        }
    }
}

/** Why the phone does not talk to the HUD that answered. Nothing was sent to it. */
public sealed interface TrustProblem {
    /** The phone is paired with [pairedHudId], but [answeringHudId] answered. */
    public data class DifferentHud(val pairedHudId: String, val answeringHudId: String) : TrustProblem

    /**
     * The phone has no pairing token and has not confirmed this HUD: without a token nothing
     * proves which HUD this is, so the user must confirm it (see [HudPin.of] with an empty
     * token) — comparing [certFingerprint] with the one the HUD's settings show.
     */
    public data class UnconfirmedOpenHud(val hudId: String, val certFingerprint: String) : TrustProblem

    /** The HUD's `welcome` proof is wrong: it does not know the pairing token. */
    public data object BadProof : TrustProblem

    /** The HUD broke the handshake (malformed challenge, welcome for another HUD …). */
    public data class ProtocolViolation(val detail: String) : TrustProblem

    /**
     * The paired HUD's address presented another TLS certificate ([presented]) than the pinned
     * one ([pinned]): someone is posing as the HUD, or the HUD was reset. A hard stop — the
     * phone does not try again until it is paired anew.
     */
    public data class CertificateChanged(val pinned: String, val presented: String) : TrustProblem

    /**
     * Pairing for the first time, the HUD presented another certificate ([presented]) than the
     * one it advertises over mDNS ([advertised]): something between phone and HUD is terminating
     * the connection.
     */
    public data class CertificateMismatch(val advertised: String, val presented: String) : TrustProblem
}

/**
 * The phone's side of one session's handshake (a new instance per connection), over a TLS
 * connection that presented the certificate with fingerprint [certFingerprint] (already checked
 * against the pin by the TLS layer, see [dev.carheadsup.protocol.tls.HudTrustManager]):
 *
 * 1. [onChallenge]: refuses a HUD other than the paired one (pinned id and certificate, per
 *    pairing token) and, without a pairing token, a HUD the user has not confirmed — in both
 *    cases *before* sending anything, since even the proof lets its receiver test token guesses.
 *    Otherwise returns the `hello` to send, its proof bound to [certFingerprint].
 * 2. [onWelcome]: checks the HUD's proof, which is bound to the same certificate — a relay that
 *    showed the phone its own certificate cannot produce it. Only then is the HUD [verified]:
 *    until then nothing sensitive may be sent to it and nothing it sends (call actions …) may be
 *    acted on. The first verified connection with a token returns the pin to store (hudId and
 *    certificate), as does one that adds the certificate to a pin made before TLS.
 */
public class HudHandshake(
    private val pairingToken: String,
    private val deviceId: String,
    private val device: String,
    private val appVersion: String,
    pin: HudPin?,
    private val certFingerprint: String,
    private val newNonce: () -> String = { PhoneAuth.newId() },
) {
    private val pin: HudPin? = HudPin.active(pin, pairingToken)
    private var challenge: HudChallenge? = null
    private var hello: PhoneHello? = null

    init {
        require(PhoneAuth.isValidId(deviceId)) { "deviceId must be 22 base64url characters" }
        require(CertFingerprint.isValid(certFingerprint)) { "certFingerprint must be 64 lowercase hex digits" }
    }

    /** True once the HUD's `welcome` checked out. */
    public var verified: Boolean = false
        private set

    public sealed interface ChallengeResult {
        public data class SendHello(val hello: PhoneHello) : ChallengeResult

        public data class Refuse(val problem: TrustProblem) : ChallengeResult

        /** The HUD speaks another protocol version. */
        public data class UnsupportedVersion(val hudVersion: Int) : ChallengeResult
    }

    public sealed interface WelcomeResult {
        /**
         * The HUD is the one to talk to. [authenticated] is false for a HUD without pairing token
         * (confirmed by the user, but not proven); [newPin] is the pin to store, if this was the
         * first verified connection with this token (or the first over TLS).
         */
        public data class Verified(val hudId: String, val authenticated: Boolean, val newPin: HudPin?) : WelcomeResult

        public data class Refuse(val problem: TrustProblem) : WelcomeResult
    }

    public fun onChallenge(challenge: HudChallenge): ChallengeResult {
        if (this.challenge != null) return ChallengeResult.Refuse(TrustProblem.ProtocolViolation("a second challenge"))
        if (challenge.v != PROTOCOL_VERSION) return ChallengeResult.UnsupportedVersion(challenge.v)
        if (!PhoneAuth.isValidId(challenge.hudId) || !PhoneAuth.isValidId(challenge.nonce)) {
            return ChallengeResult.Refuse(TrustProblem.ProtocolViolation("malformed challenge"))
        }
        this.challenge = challenge
        val paired = pin
        if (paired != null && paired.hudId != challenge.hudId) {
            return ChallengeResult.Refuse(TrustProblem.DifferentHud(paired.hudId, challenge.hudId))
        }
        val pinnedCert = paired?.certFingerprint
        if (pinnedCert != null && pinnedCert != certFingerprint) {
            // The TLS layer refuses this already; never bind a proof to an unpinned certificate.
            return ChallengeResult.Refuse(TrustProblem.CertificateChanged(pinnedCert, certFingerprint))
        }
        // Without a token nothing proves the HUD: the user confirms it, certificate included (a
        // confirmation from before TLS covered no certificate).
        if (pairingToken.isEmpty() && (paired == null || pinnedCert == null)) {
            return ChallengeResult.Refuse(TrustProblem.UnconfirmedOpenHud(challenge.hudId, certFingerprint))
        }
        val nonce = newNonce()
        val proof = PhoneAuth.phoneProof(
            pairingToken,
            challenge.hudId,
            challenge.nonce,
            nonce,
            deviceId,
            certFingerprint,
        )
        val hello = PhoneMessages.hello(device, deviceId, appVersion, nonce, proof)
        this.hello = hello
        return ChallengeResult.SendHello(hello)
    }

    public fun onWelcome(welcome: HudWelcome): WelcomeResult {
        val challenge = challenge
        val hello = hello
        if (challenge == null || hello == null) {
            return WelcomeResult.Refuse(TrustProblem.ProtocolViolation("welcome before hello"))
        }
        if (verified) return WelcomeResult.Refuse(TrustProblem.ProtocolViolation("a second welcome"))
        if (welcome.hudId != challenge.hudId) {
            return WelcomeResult.Refuse(TrustProblem.ProtocolViolation("the welcome names another HUD"))
        }
        val expected =
            PhoneAuth.hudProof(pairingToken, challenge.hudId, challenge.nonce, hello.nonce, deviceId, certFingerprint)
        if (!PhoneAuth.proofsEqual(expected, welcome.proof)) return WelcomeResult.Refuse(TrustProblem.BadProof)
        verified = true
        val paired = pin
        return WelcomeResult.Verified(
            hudId = challenge.hudId,
            authenticated = pairingToken.isNotEmpty(),
            newPin =
            when {
                paired == null -> HudPin.of(challenge.hudId, pairingToken, certFingerprint)
                paired.certFingerprint == null -> paired.copy(certFingerprint = certFingerprint)
                else -> null
            },
        )
    }
}
