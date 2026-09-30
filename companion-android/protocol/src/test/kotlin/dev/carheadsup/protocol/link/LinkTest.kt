package dev.carheadsup.protocol.link

import dev.carheadsup.protocol.CallState
import dev.carheadsup.protocol.InputAction
import dev.carheadsup.protocol.PhoneCall
import dev.carheadsup.protocol.PhoneHazards
import dev.carheadsup.protocol.PhoneLocation
import dev.carheadsup.protocol.PhoneMedia
import dev.carheadsup.protocol.PhoneMessage
import dev.carheadsup.protocol.PhoneMessages
import dev.carheadsup.protocol.PhoneNav
import dev.carheadsup.protocol.PhoneRoad
import dev.carheadsup.protocol.PhoneToHud
import dev.carheadsup.protocol.RoadSource
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import kotlin.random.Random

class LinkTest {
    @Nested
    inner class FixWatchdogTest {
        @Test
        fun `road data is withdrawn once when fixes stop (android-3)`() {
            val watchdog = FixWatchdog(timeoutMs = 5_000)
            // Nothing to withdraw before the first fix.
            assertFalse(watchdog.expired(60_000))
            watchdog.onFix(61_000)
            assertFalse(watchdog.expired(65_999))
            assertTrue(watchdog.expired(66_000))
            assertFalse(watchdog.expired(90_000))
            // Fixes resume, then stop again (a tunnel, location switched off).
            watchdog.onFix(100_000)
            assertFalse(watchdog.expired(104_000))
            assertTrue(watchdog.expired(105_500))
            // A clock that went backwards counts as a gap too.
            watchdog.onFix(200_000)
            assertTrue(watchdog.expired(150_000))
        }

        @Test
        fun `fixes too inaccurate to match a road do not count`() {
            val watchdog = FixWatchdog(maxAccuracyM = 50.0)
            assertTrue(watchdog.isUsable(null))
            assertTrue(watchdog.isUsable(12.0))
            assertTrue(watchdog.isUsable(50.0))
            assertFalse(watchdog.isUsable(180.0))
            assertFalse(watchdog.isUsable(Double.NaN))
        }
    }

    @Nested
    inner class Backoff {
        @Test
        fun `grows exponentially up to the cap without jitter`() {
            val backoff = ReconnectBackoff(initialMs = 1_000, maxMs = 30_000, jitter = 0.0)
            assertEquals(
                listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L),
                List(7) {
                    backoff.nextDelayMs()
                },
            )
            assertEquals(7, backoff.attempts)
        }

        @Test
        fun `reset starts over`() {
            val backoff = ReconnectBackoff(jitter = 0.0)
            repeat(5) { backoff.nextDelayMs() }
            backoff.reset()
            assertEquals(1_000L, backoff.nextDelayMs())
        }

        @Test
        fun `jitter stays within bounds and is deterministic for a seeded random`() {
            val a = ReconnectBackoff(jitter = 0.2, random = Random(42))
            val b = ReconnectBackoff(jitter = 0.2, random = Random(42))
            repeat(20) {
                val base = minOf(30_000.0, 1_000.0 * Math.pow(2.0, it.toDouble()))
                val delay = a.nextDelayMs()
                assertTrue(
                    delay >= (base * 0.8).toLong() - 1 && delay <= (base * 1.2).toLong() + 1,
                    "attempt $it: $delay",
                )
                assertEquals(delay, b.nextDelayMs())
            }
        }

        @Test
        fun `huge attempt counts do not overflow`() {
            val backoff = ReconnectBackoff(jitter = 0.0)
            repeat(10_000) { backoff.nextDelayMs() }
            assertEquals(30_000L, backoff.nextDelayMs())
        }

        @Test
        fun `a session the HUD replaced does not come straight back (android-8)`() {
            // Welcome reset the backoff; the HUD then closes the session with 4000 "replaced"
            // because a newer session with this device id took over. Reconnecting after ~1 s
            // would take it back.
            val backoff = ReconnectBackoff(jitter = 0.0)
            backoff.reset()
            assertEquals(30_000L, backoff.delayAfterClose(PhoneCloseCode.REPLACED))
            backoff.reset()
            assertEquals(1_000L, backoff.delayAfterClose(1006))
            assertEquals(2_000L, backoff.delayAfterClose(null))
            assertEquals(4_000L, backoff.delayAfterClose(PhoneCloseCode.BUSY))
        }

        @Test
        fun `a refused connection waits the maximum`() {
            assertEquals(30_000L, ReconnectBackoff().refusedDelayMs())
        }

        @Test
        fun `invalid configurations are rejected`() {
            assertThrows(IllegalArgumentException::class.java) { ReconnectBackoff(initialMs = 0) }
            assertThrows(IllegalArgumentException::class.java) { ReconnectBackoff(initialMs = 10, maxMs = 5) }
            assertThrows(IllegalArgumentException::class.java) { ReconnectBackoff(multiplier = 0.5) }
            assertThrows(IllegalArgumentException::class.java) { ReconnectBackoff(jitter = 1.5) }
        }
    }

    @Nested
    inner class RateLimiter {
        private fun nav(distance: Double) = PhoneNav(active = true, source = "google-maps", distanceM = distance)

        @Test
        fun `nav is limited to four per second with the latest update winning`() {
            val limiter = MessageRateLimiter()
            val sent = ArrayList<Pair<Long, PhoneToHud>>()
            // Maps posts an update every 50 ms for one second.
            for (t in 0L..1_000L step 50) {
                if (limiter.offer(nav(1_000.0 - t), t) == MessageRateLimiter.Decision.SendNow) {
                    sent += t to nav(1_000.0 - t)
                }
                limiter.drainDue(t).forEach { sent += t to it }
            }
            limiter.drainDue(1_250).forEach { sent += 1_250L to it }
            val times = sent.map { it.first }
            assertEquals(listOf(0L, 250L, 500L, 750L, 1_000L), times)
            // Each release carries the newest update available at that time.
            assertEquals(nav(750.0), sent[1].second)
            assertEquals(nav(0.0), sent.last().second)
            times.zipWithNext().forEach { (a, b) -> assertTrue(b - a >= 250) }
        }

        @Test
        fun `deferred messages report their release time and nothing is lost`() {
            val limiter = MessageRateLimiter()
            assertEquals(MessageRateLimiter.Decision.SendNow, limiter.offer(nav(3.0), 1_000))
            assertEquals(MessageRateLimiter.Decision.Deferred(1_250), limiter.offer(nav(2.0), 1_100))
            assertEquals(MessageRateLimiter.Decision.Deferred(1_250), limiter.offer(nav(1.0), 1_200))
            assertEquals(1_250L, limiter.nextReleaseAtMs())
            assertEquals(emptyList<PhoneToHud>(), limiter.drainDue(1_249))
            assertEquals(listOf<PhoneToHud>(nav(1.0)), limiter.drainDue(1_250))
            assertNull(limiter.nextReleaseAtMs())
        }

        @Test
        fun `location is limited to 1 Hz independently of nav`() {
            val limiter = MessageRateLimiter()
            val location = PhoneLocation(1.0, 2.0, 5.0)
            assertEquals(MessageRateLimiter.Decision.SendNow, limiter.offer(location, 0))
            assertEquals(MessageRateLimiter.Decision.SendNow, limiter.offer(nav(1.0), 10))
            assertEquals(MessageRateLimiter.Decision.Deferred(1_000), limiter.offer(location, 500))
            assertEquals(MessageRateLimiter.Decision.SendNow, limiter.offer(location, 1_000))
        }

        @Test
        fun `events are never limited`() {
            val limiter = MessageRateLimiter()
            val events: List<PhoneToHud> =
                listOf(
                    PhoneMessage("a", "Alice", null, false),
                    PhoneMessage("b", "Bob", null, false),
                    PhoneMessages.input(InputAction.PRIMARY),
                    PhoneMessages.input(InputAction.PRIMARY),
                    PhoneCall("c", CallState.RINGING, null, null),
                    PhoneMessages.ping(1),
                    PhoneMessages.ping(2),
                )
            events.forEach { assertEquals(MessageRateLimiter.Decision.SendNow, limiter.offer(it, 0)) }
        }

        @Test
        fun `a clock that jumps backwards does not block sending`() {
            val limiter = MessageRateLimiter()
            limiter.offer(nav(1.0), 10_000)
            assertEquals(MessageRateLimiter.Decision.SendNow, limiter.offer(nav(2.0), 5_000))
        }

        @Test
        fun `reset forgets history and parked messages`() {
            val limiter = MessageRateLimiter()
            limiter.offer(nav(1.0), 0)
            limiter.offer(nav(2.0), 10)
            limiter.reset()
            assertEquals(emptyList<PhoneToHud>(), limiter.drainDue(1_000))
            assertEquals(MessageRateLimiter.Decision.SendNow, limiter.offer(nav(3.0), 20))
        }
    }

    @Nested
    inner class HeartbeatTest {
        @Test
        fun `pings every interval with increasing ids`() {
            val heartbeat = Heartbeat(intervalMs = 5_000, timeoutMs = 15_000)
            heartbeat.start(0)
            assertEquals(1L, heartbeat.onTick(0)!!.id)
            assertNull(heartbeat.onTick(4_999))
            assertEquals(2L, heartbeat.onTick(5_000)!!.id)
        }

        @Test
        fun `pong yields the round-trip time`() {
            val heartbeat = Heartbeat()
            heartbeat.start(0)
            val ping = heartbeat.onTick(1_000)!!
            assertEquals(35L, heartbeat.onPong(ping.id, 1_035))
            assertEquals(35L, heartbeat.lastRttMs)
            assertNull(heartbeat.onPong(ping.id, 1_040)) // answered already
            assertNull(heartbeat.onPong(null, 1_050))
            assertNull(heartbeat.onPong(999, 1_060))
        }

        @Test
        fun `silence beyond the timeout means the link is dead`() {
            val heartbeat = Heartbeat(intervalMs = 5_000, timeoutMs = 15_000)
            heartbeat.start(0)
            assertFalse(heartbeat.isTimedOut(15_000))
            assertTrue(heartbeat.isTimedOut(15_001))
            heartbeat.onFrameReceived(14_000)
            assertFalse(heartbeat.isTimedOut(20_000))
            heartbeat.start(40_000)
            assertFalse(heartbeat.isTimedOut(41_000))
        }

        @Test
        fun `unanswered pings do not accumulate without bound`() {
            val heartbeat = Heartbeat(intervalMs = 1, timeoutMs = 2)
            heartbeat.start(0)
            for (t in 0L until 1_000L) heartbeat.onTick(t)
            // The oldest outstanding pings were evicted; the newest can still be matched.
            assertNull(heartbeat.onPong(1, 1_000))
            assertNotNull(heartbeat.onPong(1_000, 1_001))
        }

        @Test
        fun `timeout must exceed interval`() {
            assertThrows(IllegalArgumentException::class.java) { Heartbeat(intervalMs = 5_000, timeoutMs = 5_000) }
        }
    }

    @Nested
    inner class LatestStateTest {
        @Test
        fun `replays the newest state messages in a stable order`() {
            val state = LatestState()
            val media = PhoneMedia(true, "Song", "Artist")
            val road = PhoneRoad(50.0, source = RoadSource.OSM)
            val nav1 = PhoneNav(active = true, source = "google-maps", distanceM = 500.0)
            val nav2 = nav1.copy(distanceM = 250.0)
            val call = PhoneCall("c1", CallState.ACTIVE, "Bob", null)
            listOf(media, nav1, road, nav2, call).forEach { assertTrue(state.record(it)) }
            assertFalse(state.record(PhoneLocation(1.0, 1.0, null)))
            assertFalse(state.record(PhoneMessage("m", "Alice", null, false)))
            assertEquals(listOf(nav2, road, media, call), state.replay())
            assertEquals(nav2, state.latestNav())
        }

        @Test
        fun `ended calls are not replayed, inactive nav and empty hazards are`() {
            val state = LatestState()
            state.record(PhoneCall("c1", CallState.ENDED, null, null))
            state.record(PhoneMessages.navEnded("google-maps"))
            state.record(PhoneHazards(emptyList()))
            assertEquals(listOf(PhoneMessages.navEnded("google-maps"), PhoneHazards(emptyList())), state.replay())
            state.clear()
            assertEquals(emptyList<PhoneToHud>(), state.replay())
        }
    }

    @Nested
    inner class Endpoint {
        @ParameterizedTest
        @CsvSource(
            "192.168.4.1, 192.168.4.1, 8443",
            "192.168.4.1:9443, 192.168.4.1, 9443",
            "  hud.local  , hud.local, 8443",
            "hud.local.:8444, hud.local, 8444",
            "https://10.0.0.5:8443/settings, 10.0.0.5, 8443",
            "wss://carheadsup:8443/ws/phone, carheadsup, 8443",
            "'[fe80::1%wlan0]:8443', fe80::1%wlan0, 8443",
            "'fd00::10', fd00::10, 8443",
        )
        fun `parses manual addresses`(input: String, host: String, port: Int) {
            assertEquals(HudEndpoint(host, port), HudEndpoint.parse(input))
        }

        @ParameterizedTest
        @ValueSource(
            strings = [
                "", "   ", "host:0", "host:70000", "host:abc", "bad host", "[fe80::1", "[::1]x", "-bad.example",
                "http://",
            ],
        )
        fun `rejects invalid addresses`(input: String) {
            assertNull(HudEndpoint.parse(input))
        }

        @Test
        fun `builds TLS URLs on the HUD's TLS port, bracketing IPv6`() {
            val v4 = HudEndpoint("192.168.4.1")
            assertEquals(8443, HudEndpoint.DEFAULT_PORT)
            assertEquals("wss://192.168.4.1:8443/ws/phone", v4.webSocketUrl)
            assertEquals("https://192.168.4.1:8443/settings", v4.settingsUrl)
            assertEquals("https://192.168.4.1:8443/api/trips", v4.apiUrl("/api/trips"))
            assertEquals("https://192.168.4.1:8443/api/info", v4.apiUrl("api/info"))
            assertEquals("wss://[fd00::10]:8443/ws/phone", HudEndpoint("fd00::10").webSocketUrl)
            assertEquals("[fd00::10]:8443", HudEndpoint("fd00::10").display())
            // Nothing goes to the HUD in the clear.
            assertTrue(v4.webSocketUrl.startsWith("wss://") && v4.httpBaseUrl.startsWith("https://"))
        }

        @Test
        fun `hands the API token to the settings page`() {
            val hud = HudEndpoint("192.168.4.1")
            assertEquals("https://192.168.4.1:8443/settings", hud.settingsUrl(""))
            assertEquals("https://192.168.4.1:8443/settings", hud.settingsUrl("   "))
            assertEquals("https://192.168.4.1:8443/settings?token=K7f-Q2_z~9", hud.settingsUrl(" K7f-Q2_z~9 "))
            // Spaces, reserved and non-ASCII characters are percent-encoded (URLSearchParams decodes them).
            assertEquals(
                "https://192.168.4.1:8443/settings?token=a%20b%26c%3D%2B%C3%A4",
                hud.settingsUrl("a b&c=+ä"),
            )
            assertEquals(
                "http://hud.local:8080/settings?page=1&token=t#trips",
                HudEndpoint.withApiToken("http://hud.local:8080/settings?page=1#trips", "t"),
            )
        }

        @ParameterizedTest
        @CsvSource(
            "10.42.0.1:8080, 10.42.0.1:8443",
            "http://hud.local:8080/settings, hud.local:8443",
            "ws://[fd00::10]:8080/ws/phone, [fd00::10]:8443",
            // No port: the default is the TLS port already. Another port: only the user knows.
            "10.42.0.1, 10.42.0.1",
            "10.42.0.1:8090, 10.42.0.1:8090",
            "10.42.0.1:8443, 10.42.0.1:8443",
            "not an address, not an address",
        )
        fun `moves an address saved before the TLS link from the plain port to the TLS port`(
            saved: String,
            upgraded: String,
        ) {
            assertEquals(upgraded, HudEndpoint.upgradeLegacyAddress(saved))
        }

        @Test
        fun `constructor validates`() {
            assertThrows(IllegalArgumentException::class.java) { HudEndpoint(" ") }
            assertThrows(IllegalArgumentException::class.java) { HudEndpoint("h", 0) }
        }
    }

    @Nested
    inner class Advertisement {
        private val fingerprint = "fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531"

        @Test
        fun `connects to the advertised TLS port with the advertised id and certificate`() {
            val txt = mapOf(
                "v" to "3",
                "path" to "/ws/phone",
                "id" to "AAECAwQFBgcICQoLDA0ODw",
                "tls" to "9443",
                "fp" to fingerprint,
            )
            assertEquals(
                HudAdvertisement(HudEndpoint("10.42.0.1", 9443), "AAECAwQFBgcICQoLDA0ODw", fingerprint),
                HudAdvertisement.fromTxt("10.42.0.1", txt),
            )
        }

        @Test
        fun `falls back to the default TLS port and leaves out what is malformed`() {
            // The static Avahi file of an older installation: no tls, id or fp.
            assertEquals(
                HudAdvertisement(HudEndpoint("10.42.0.1", 8443), null, null),
                HudAdvertisement.fromTxt("10.42.0.1", mapOf("v" to "2", "path" to "/ws/phone")),
            )
            assertEquals(
                HudAdvertisement(HudEndpoint("10.42.0.1", 8443), null, null),
                HudAdvertisement.fromTxt("10.42.0.1", mapOf("id" to "short", "fp" to "abc", "tls" to null)),
            )
            // A fingerprint written with colons in upper case is the same fingerprint.
            val colons = fingerprint.uppercase().chunked(2).joinToString(":")
            assertEquals(fingerprint, HudAdvertisement.fromTxt("hud", mapOf("fp" to colons))?.certFingerprint)
        }

        @Test
        fun `skips an unusable address or port`() {
            assertNull(HudAdvertisement.fromTxt("", emptyMap()))
            for (port in listOf("0", "70000", "tls", "")) {
                assertNull(HudAdvertisement.fromTxt("10.42.0.1", mapOf("tls" to port)), port)
            }
        }
    }

    @Nested
    inner class ChangeGateTest {
        @Test
        fun `sends on change and on refresh only`() {
            val gate = ChangeGate<Int>(refreshMs = 30_000)
            assertTrue(gate.shouldSend(1, 0))
            assertFalse(gate.shouldSend(1, 1_000))
            assertTrue(gate.shouldSend(2, 2_000))
            assertFalse(gate.shouldSend(2, 31_999))
            assertTrue(gate.shouldSend(2, 32_000))
            gate.reset()
            assertTrue(gate.shouldSend(2, 32_001))
        }

        @Test
        fun `handles null values and clocks going backwards`() {
            val gate = ChangeGate<String?>(refreshMs = 10_000)
            assertTrue(gate.shouldSend(null, 5_000))
            assertFalse(gate.shouldSend(null, 6_000))
            assertTrue(gate.shouldSend(null, 1_000))
        }
    }
}
