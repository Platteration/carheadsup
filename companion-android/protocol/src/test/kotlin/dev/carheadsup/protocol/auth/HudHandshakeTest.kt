package dev.carheadsup.protocol.auth

import dev.carheadsup.protocol.HudChallenge
import dev.carheadsup.protocol.HudWelcome
import dev.carheadsup.protocol.PROTOCOL_VERSION
import dev.carheadsup.protocol.PhoneHello
import dev.carheadsup.protocol.PhoneWire
import dev.carheadsup.protocol.auth.HudHandshake.ChallengeResult
import dev.carheadsup.protocol.auth.HudHandshake.WelcomeResult
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

private const val PHONE_TIME = 1_790_000_000_000L

class HudHandshakeTest {
    private val deviceId = "8PHy8_T19vf4-fr7_P3-_w"
    private val myHud = "AAECAwQFBgcICQoLDA0ODw"
    private val otherHud = "0F1PEGIqj-Lfw5HU0--o3A"
    private val myCert = SHARED_CERTIFICATE_VECTORS[0].fingerprint
    private val relayCert = SHARED_CERTIFICATE_VECTORS[1].fingerprint

    /**
     * A HUD with [hudId] that knows [token] and serves the certificate [cert]: challenges, and
     * welcomes a hello it can verify — against its own certificate.
     */
    private inner class FakeHud(val hudId: String, val token: String, val cert: String = myCert) {
        val nonce: String = PhoneAuth.newId()
        val challenge = HudChallenge(PROTOCOL_VERSION, hudId, nonce)

        fun accepts(hello: PhoneHello): Boolean = PhoneAuth.proofsEqual(
            PhoneAuth.phoneProof(token, hudId, nonce, hello.nonce, hello.deviceId, cert),
            hello.proof,
        )

        fun welcome(helloNonce: String, hudNonce: String = nonce): HudWelcome = HudWelcome(
            v = PROTOCOL_VERSION,
            hudName = "Golf",
            hudVersion = "1.0",
            readMessagesAloud = true,
            hudId = hudId,
            proof = PhoneAuth.hudProof(token, hudId, hudNonce, helloNonce, deviceId, cert),
        )
    }

    /** The phone's side, over a connection that presented [cert]. */
    private fun handshake(token: String, pin: HudPin? = null, cert: String = myCert) = HudHandshake(
        pairingToken = token,
        deviceId = deviceId,
        device = "Pixel 9",
        appVersion = "1.0",
        pin = pin,
        certFingerprint = cert,
        wallClock = { PHONE_TIME },
    )

    private fun helloFor(handshake: HudHandshake, hud: FakeHud) =
        (handshake.onChallenge(hud.challenge) as ChallengeResult.SendHello).hello

    @Test
    fun `first pairing with a token proves the token, checks the HUD's proof and pins the HUD and its certificate`() {
        val hud = FakeHud(myHud, "s3cret")
        val phone = handshake("s3cret")
        val hello = helloFor(phone, hud)
        // What the HUD checks: a proof over its own nonce, the phone's nonce, the device id and
        // the certificate it serves.
        assertEquals(PhoneAuth.phoneProof("s3cret", myHud, hud.nonce, hello.nonce, deviceId, myCert), hello.proof)
        assertTrue(hud.accepts(hello))
        assertEquals(deviceId, hello.deviceId)
        assertEquals(PROTOCOL_VERSION, hello.v)
        // The phone's clock, for a HUD without network time.
        assertEquals(PHONE_TIME, hello.time)
        assertTrue(PhoneAuth.isValidId(hello.nonce))
        assertFalse(PhoneWire.encodeUnchecked(hello).contains("s3cret"))
        assertFalse(phone.verified)

        val verified = phone.onWelcome(hud.welcome(hello.nonce)) as WelcomeResult.Verified
        assertTrue(phone.verified)
        assertEquals(myHud, verified.hudId)
        assertTrue(verified.authenticated)
        assertEquals(HudPin.of(myHud, "s3cret", myCert), verified.newPin)
    }

    @Test
    fun `a relay with a certificate of its own can neither pass the phone's proof on nor answer it`() {
        // The phone sees the relay's certificate and binds its proof to it…
        val relay = handshake("s3cret", cert = relayCert)
        val hud = FakeHud(myHud, "s3cret", cert = myCert)
        val hello = helloFor(relay, hud)
        // …so the real HUD, which checks against its own certificate, refuses the relayed hello…
        assertFalse(hud.accepts(hello))
        // …and the real HUD's welcome, bound to its own certificate, fails on the phone.
        assertEquals(WelcomeResult.Refuse(TrustProblem.BadProof), relay.onWelcome(hud.welcome(hello.nonce)))
        assertFalse(relay.verified)
    }

    @Test
    fun `a HUD that does not know the token cannot pass (and is not pinned)`() {
        val impostor = FakeHud(otherHud, "guess")
        val phone = handshake("s3cret")
        val hello = helloFor(phone, impostor)
        assertEquals(WelcomeResult.Refuse(TrustProblem.BadProof), phone.onWelcome(impostor.welcome(hello.nonce)))
        assertFalse(phone.verified)
        // Nor can it replay a genuine welcome made for another connection.
        val hud = FakeHud(myHud, "s3cret")
        val second = handshake("s3cret")
        val secondHello = helloFor(second, hud)
        val recorded = hud.welcome(helloNonce = PhoneAuth.newId())
        assertEquals(WelcomeResult.Refuse(TrustProblem.BadProof), second.onWelcome(recorded))
        assertFalse(second.verified)
        assertNotNull(secondHello)
    }

    @Test
    fun `once paired, another HUD is refused before anything is sent`() {
        val pin = HudPin.of(myHud, "s3cret", myCert)
        val phone = handshake("s3cret", pin)
        assertEquals(
            ChallengeResult.Refuse(TrustProblem.DifferentHud(myHud, otherHud)),
            phone.onChallenge(FakeHud(otherHud, "s3cret").challenge),
        )
        // The paired HUD goes through, and nothing new is pinned.
        val hud = FakeHud(myHud, "s3cret")
        val again = handshake("s3cret", pin)
        val verified = again.onWelcome(hud.welcome(helloFor(again, hud).nonce)) as WelcomeResult.Verified
        assertNull(verified.newPin)
    }

    @Test
    fun `once paired, another certificate is refused before anything is sent`() {
        val pin = HudPin.of(myHud, "s3cret", myCert)
        assertEquals(
            ChallengeResult.Refuse(TrustProblem.CertificateChanged(myCert, relayCert)),
            handshake("s3cret", pin, cert = relayCert).onChallenge(FakeHud(myHud, "s3cret", relayCert).challenge),
        )
    }

    @Test
    fun `a pin from before TLS gets the certificate of the next verified connection`() {
        val legacy = HudPin.of(myHud, "s3cret")
        assertNull(legacy.certFingerprint)
        val hud = FakeHud(myHud, "s3cret")
        val phone = handshake("s3cret", legacy)
        val verified = phone.onWelcome(hud.welcome(helloFor(phone, hud).nonce)) as WelcomeResult.Verified
        assertEquals(HudPin.of(myHud, "s3cret", myCert), verified.newPin)
        // Through a relay, the proofs fail: the relay's certificate is never pinned.
        val relayed = handshake("s3cret", legacy, cert = relayCert)
        val relayedHello = helloFor(relayed, hud)
        assertEquals(WelcomeResult.Refuse(TrustProblem.BadProof), relayed.onWelcome(hud.welcome(relayedHello.nonce)))
    }

    @Test
    fun `a new pairing token starts a new pairing`() {
        val oldPin = HudPin.of(myHud, "old code", myCert)
        val hud = FakeHud(otherHud, "new code", relayCert)
        val phone = handshake("new code", oldPin, cert = relayCert)
        val verified = phone.onWelcome(hud.welcome(helloFor(phone, hud).nonce)) as WelcomeResult.Verified
        assertEquals(HudPin.of(otherHud, "new code", relayCert), verified.newPin)
    }

    @Test
    fun `without a pairing token the user confirms the HUD and its certificate first, and it stays unauthenticated`() {
        val hud = FakeHud(myHud, "")
        assertEquals(
            ChallengeResult.Refuse(TrustProblem.UnconfirmedOpenHud(myHud, myCert)),
            handshake("").onChallenge(hud.challenge),
        )
        // A pin made with a token does not count as the user's confirmation…
        assertEquals(
            ChallengeResult.Refuse(TrustProblem.UnconfirmedOpenHud(myHud, myCert)),
            handshake("", HudPin.of(myHud, "s3cret", myCert)).onChallenge(hud.challenge),
        )
        // …nor does a confirmation from before TLS, which covered no certificate.
        assertEquals(
            ChallengeResult.Refuse(TrustProblem.UnconfirmedOpenHud(myHud, myCert)),
            handshake("", HudPin.of(myHud, "")).onChallenge(hud.challenge),
        )
        val confirmed = HudPin.of(myHud, "", myCert)
        val phone = handshake("", confirmed)
        val verified = phone.onWelcome(hud.welcome(helloFor(phone, hud).nonce)) as WelcomeResult.Verified
        assertFalse(verified.authenticated)
        assertNull(verified.newPin)
        // Another open HUD is still "a different HUD", and another certificate a changed one.
        assertEquals(
            ChallengeResult.Refuse(TrustProblem.DifferentHud(myHud, otherHud)),
            handshake("", confirmed).onChallenge(FakeHud(otherHud, "").challenge),
        )
        assertEquals(
            ChallengeResult.Refuse(TrustProblem.CertificateChanged(myCert, relayCert)),
            handshake("", confirmed, cert = relayCert).onChallenge(hud.challenge),
        )
    }

    @Test
    fun `a HUD that breaks the handshake is refused`() {
        assertEquals(
            ChallengeResult.UnsupportedVersion(1),
            handshake("t").onChallenge(HudChallenge(1, myHud, PhoneAuth.newId())),
        )
        // A HUD of the previous protocol (no channel binding) is refused as well.
        assertEquals(
            ChallengeResult.UnsupportedVersion(2),
            handshake("t").onChallenge(HudChallenge(2, myHud, PhoneAuth.newId())),
        )
        for (bad in listOf(HudChallenge(PROTOCOL_VERSION, "", ""), HudChallenge(PROTOCOL_VERSION, "$myHud|x", myHud))) {
            assertInstanceOf(ChallengeResult.Refuse::class.java, handshake("t").onChallenge(bad))
        }
        val hud = FakeHud(myHud, "t")
        assertEquals(
            WelcomeResult.Refuse(TrustProblem.ProtocolViolation("welcome before hello")),
            handshake("t").onWelcome(hud.welcome(PhoneAuth.newId())),
        )
        val phone = handshake("t")
        val hello = helloFor(phone, hud)
        assertInstanceOf(ChallengeResult.Refuse::class.java, phone.onChallenge(hud.challenge))
        val forOtherHud = hud.welcome(hello.nonce).copy(hudId = otherHud)
        assertEquals(
            WelcomeResult.Refuse(TrustProblem.ProtocolViolation("the welcome names another HUD")),
            phone.onWelcome(forOtherHud),
        )
        assertInstanceOf(WelcomeResult.Verified::class.java, phone.onWelcome(hud.welcome(hello.nonce)))
        assertInstanceOf(WelcomeResult.Refuse::class.java, phone.onWelcome(hud.welcome(hello.nonce)))
    }

    @Test
    fun `the device id and the certificate fingerprint must be well-formed`() {
        assertThrows(IllegalArgumentException::class.java) {
            HudHandshake(
                "t",
                deviceId = "Pixel 9",
                device = "Pixel 9",
                appVersion = "1",
                pin = null,
                certFingerprint = myCert,
            )
        }
        for (bad in listOf("", "A".repeat(64), myCert.dropLast(1))) {
            assertThrows(IllegalArgumentException::class.java) {
                HudHandshake("t", deviceId, device = "Pixel 9", appVersion = "1", pin = null, certFingerprint = bad)
            }
        }
        assertThrows(IllegalArgumentException::class.java) { HudPin(myHud, "x", certFingerprint = "abc") }
    }

    @Test
    fun `discovery skips advertised HUDs other than the paired one`() {
        val pin = HudPin.of(myHud, "s3cret", myCert)
        assertTrue(HudPin.acceptsAdvertisement(pin, "s3cret", myHud))
        assertFalse(HudPin.acceptsAdvertisement(pin, "s3cret", otherHud))
        // The static Avahi service file has no id: the certificate and the challenge decide.
        assertTrue(HudPin.acceptsAdvertisement(pin, "s3cret", null))
        // Not paired (or paired with another token): any HUD may be the one to pair with.
        assertTrue(HudPin.acceptsAdvertisement(null, "s3cret", otherHud))
        assertTrue(HudPin.acceptsAdvertisement(pin, "new code", otherHud))
    }
}
