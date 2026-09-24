package dev.carheadsup.protocol.auth

import dev.carheadsup.protocol.HudChallenge
import dev.carheadsup.protocol.HudWelcome
import dev.carheadsup.protocol.PROTOCOL_VERSION
import dev.carheadsup.protocol.PhoneHello
import dev.carheadsup.protocol.PhoneMessages

/**
 * The HUD this phone is paired with: its [hudId], learned at the first verified connection (or,
 * for a HUD without pairing code, confirmed by the user), valid only together with the pairing
 * token whose [tokenFingerprint] it carries — entering another token starts a new pairing.
 */
public data class HudPin(val hudId: String, val tokenFingerprint: String) {
    /** Whether this pin belongs to [pairingToken]. */
    public fun appliesTo(pairingToken: String): Boolean =
        PhoneAuth.proofsEqual(tokenFingerprint, PhoneAuth.tokenFingerprint(pairingToken))

    public companion object {
        public fun of(hudId: String, pairingToken: String): HudPin =
            HudPin(hudId, PhoneAuth.tokenFingerprint(pairingToken))

        /** [pin] when it belongs to [pairingToken], else null (not paired with this token). */
        public fun active(pin: HudPin?, pairingToken: String): HudPin? = pin?.takeIf { it.appliesTo(pairingToken) }

        /**
         * Whether discovery may connect to a HUD that advertises the mDNS TXT record
         * `id` = [advertisedId]: any HUD while not paired (pairing needs one); once paired, the
         * paired HUD, or a HUD that does not advertise an id (the static Avahi service file) —
         * its `challenge` is checked against the pin before anything is sent.
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
     * proves which HUD this is, so the user must confirm it (see [HudPin.of] with an empty token).
     */
    public data class UnconfirmedOpenHud(val hudId: String) : TrustProblem

    /** The HUD's `welcome` proof is wrong: it does not know the pairing token. */
    public data object BadProof : TrustProblem

    /** The HUD broke the handshake (malformed challenge, welcome for another HUD …). */
    public data class ProtocolViolation(val detail: String) : TrustProblem
}

/**
 * The phone's side of one session's handshake (a new instance per connection):
 *
 * 1. [onChallenge]: refuses a HUD other than the paired one (pinned id, per pairing token) and,
 *    without a pairing token, a HUD the user has not confirmed — in both cases *before* sending
 *    anything, since even the proof lets its receiver test token guesses. Otherwise returns the
 *    `hello` to send.
 * 2. [onWelcome]: checks the HUD's proof. Only then is the HUD [verified]: until then nothing
 *    sensitive may be sent to it and nothing it sends (call actions …) may be acted on. The first
 *    verified connection with a token returns the pin to store.
 */
public class HudHandshake(
    private val pairingToken: String,
    private val deviceId: String,
    private val device: String,
    private val appVersion: String,
    pin: HudPin?,
    private val newNonce: () -> String = { PhoneAuth.newId() },
) {
    private val pin: HudPin? = HudPin.active(pin, pairingToken)
    private var challenge: HudChallenge? = null
    private var hello: PhoneHello? = null

    init {
        require(PhoneAuth.isValidId(deviceId)) { "deviceId must be 22 base64url characters" }
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
         * first verified connection with this token.
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
        if (paired == null && pairingToken.isEmpty()) {
            return ChallengeResult.Refuse(TrustProblem.UnconfirmedOpenHud(challenge.hudId))
        }
        val nonce = newNonce()
        val proof = PhoneAuth.phoneProof(pairingToken, challenge.hudId, challenge.nonce, nonce, deviceId)
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
        val expected = PhoneAuth.hudProof(pairingToken, challenge.hudId, challenge.nonce, hello.nonce, deviceId)
        if (!PhoneAuth.proofsEqual(expected, welcome.proof)) return WelcomeResult.Refuse(TrustProblem.BadProof)
        verified = true
        return WelcomeResult.Verified(
            hudId = challenge.hudId,
            authenticated = pairingToken.isNotEmpty(),
            newPin = if (pin == null) HudPin.of(challenge.hudId, pairingToken) else null,
        )
    }
}
