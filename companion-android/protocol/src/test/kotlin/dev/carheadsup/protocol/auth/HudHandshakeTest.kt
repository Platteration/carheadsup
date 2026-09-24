package dev.carheadsup.protocol.auth

import dev.carheadsup.protocol.HudChallenge
import dev.carheadsup.protocol.HudWelcome
import dev.carheadsup.protocol.PROTOCOL_VERSION
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

class HudHandshakeTest {
    private val deviceId = "8PHy8_T19vf4-fr7_P3-_w"
    private val myHud = "AAECAwQFBgcICQoLDA0ODw"
    private val otherHud = "0F1PEGIqj-Lfw5HU0--o3A"

    /** A HUD with [hudId] that knows [token]: challenges, and welcomes a hello it can verify. */
    private inner class FakeHud(val hudId: String, val token: String) {
        val nonce: String = PhoneAuth.newId()
        val challenge = HudChallenge(PROTOCOL_VERSION, hudId, nonce)

        fun welcome(helloNonce: String, hudNonce: String = nonce): HudWelcome = HudWelcome(
            v = PROTOCOL_VERSION,
            hudName = "Golf",
            hudVersion = "1.0",
            readMessagesAloud = true,
            hudId = hudId,
            proof = PhoneAuth.hudProof(token, hudId, hudNonce, helloNonce, deviceId),
        )
    }

    private fun handshake(token: String, pin: HudPin? = null) =
        HudHandshake(pairingToken = token, deviceId = deviceId, device = "Pixel 9", appVersion = "1.0", pin = pin)

    private fun helloFor(handshake: HudHandshake, hud: FakeHud) =
        (handshake.onChallenge(hud.challenge) as ChallengeResult.SendHello).hello

    @Test
    fun `first pairing with a token proves the token, checks the HUD's proof and pins the HUD`() {
        val hud = FakeHud(myHud, "s3cret")
        val phone = handshake("s3cret")
        val hello = helloFor(phone, hud)
        // What the HUD checks: a proof over its own nonce, the phone's nonce and the device id.
        assertEquals(PhoneAuth.phoneProof("s3cret", myHud, hud.nonce, hello.nonce, deviceId), hello.proof)
        assertEquals(deviceId, hello.deviceId)
        assertTrue(PhoneAuth.isValidId(hello.nonce))
        assertFalse(PhoneWire.encodeUnchecked(hello).contains("s3cret"))
        assertFalse(phone.verified)

        val verified = phone.onWelcome(hud.welcome(hello.nonce)) as WelcomeResult.Verified
        assertTrue(phone.verified)
        assertEquals(myHud, verified.hudId)
        assertTrue(verified.authenticated)
        assertEquals(HudPin.of(myHud, "s3cret"), verified.newPin)
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
        val pin = HudPin.of(myHud, "s3cret")
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
    fun `a new pairing token starts a new pairing`() {
        val oldPin = HudPin.of(myHud, "old code")
        val hud = FakeHud(otherHud, "new code")
        val phone = handshake("new code", oldPin)
        val verified = phone.onWelcome(hud.welcome(helloFor(phone, hud).nonce)) as WelcomeResult.Verified
        assertEquals(HudPin.of(otherHud, "new code"), verified.newPin)
    }

    @Test
    fun `without a pairing token the user confirms the HUD first, and it stays unauthenticated`() {
        val hud = FakeHud(myHud, "")
        assertEquals(
            ChallengeResult.Refuse(TrustProblem.UnconfirmedOpenHud(myHud)),
            handshake("").onChallenge(hud.challenge),
        )
        // A pin made with a token does not count as the user's confirmation.
        assertEquals(
            ChallengeResult.Refuse(TrustProblem.UnconfirmedOpenHud(myHud)),
            handshake("", HudPin.of(myHud, "s3cret")).onChallenge(hud.challenge),
        )
        val confirmed = HudPin.of(myHud, "")
        val phone = handshake("", confirmed)
        val verified = phone.onWelcome(hud.welcome(helloFor(phone, hud).nonce)) as WelcomeResult.Verified
        assertFalse(verified.authenticated)
        assertNull(verified.newPin)
        // Another open HUD is still "a different HUD".
        assertEquals(
            ChallengeResult.Refuse(TrustProblem.DifferentHud(myHud, otherHud)),
            handshake("", confirmed).onChallenge(FakeHud(otherHud, "").challenge),
        )
    }

    @Test
    fun `a HUD that breaks the handshake is refused`() {
        assertEquals(
            ChallengeResult.UnsupportedVersion(1),
            handshake("t").onChallenge(HudChallenge(1, myHud, PhoneAuth.newId())),
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
    fun `the device id must be well-formed`() {
        assertThrows(IllegalArgumentException::class.java) {
            HudHandshake("t", deviceId = "Pixel 9", device = "Pixel 9", appVersion = "1", pin = null)
        }
    }

    @Test
    fun `discovery skips advertised HUDs other than the paired one`() {
        val pin = HudPin.of(myHud, "s3cret")
        assertTrue(HudPin.acceptsAdvertisement(pin, "s3cret", myHud))
        assertFalse(HudPin.acceptsAdvertisement(pin, "s3cret", otherHud))
        // The static Avahi service file has no id: the challenge decides.
        assertTrue(HudPin.acceptsAdvertisement(pin, "s3cret", null))
        // Not paired (or paired with another token): any HUD may be the one to pair with.
        assertTrue(HudPin.acceptsAdvertisement(null, "s3cret", otherHud))
        assertTrue(HudPin.acceptsAdvertisement(pin, "new code", otherHud))
    }
}
