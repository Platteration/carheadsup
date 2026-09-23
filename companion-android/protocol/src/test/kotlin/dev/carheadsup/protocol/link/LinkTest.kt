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
            "192.168.4.1, 192.168.4.1, 8080",
            "192.168.4.1:9000, 192.168.4.1, 9000",
            "  hud.local  , hud.local, 8080",
            "hud.local.:8081, hud.local, 8081",
            "http://10.0.0.5:8080/settings, 10.0.0.5, 8080",
            "ws://carheadsup:8080/ws/phone, carheadsup, 8080",
            "'[fe80::1%wlan0]:8080', fe80::1%wlan0, 8080",
            "'fd00::10', fd00::10, 8080",
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
        fun `builds URLs, bracketing IPv6`() {
            val v4 = HudEndpoint("192.168.4.1")
            assertEquals("ws://192.168.4.1:8080/ws/phone", v4.webSocketUrl)
            assertEquals("http://192.168.4.1:8080/settings", v4.settingsUrl)
            assertEquals("http://192.168.4.1:8080/api/trips", v4.apiUrl("/api/trips"))
            assertEquals("http://192.168.4.1:8080/api/info", v4.apiUrl("api/info"))
            assertEquals("ws://[fd00::10]:8080/ws/phone", HudEndpoint("fd00::10").webSocketUrl)
            assertEquals("[fd00::10]:8080", HudEndpoint("fd00::10").display())
        }

        @Test
        fun `constructor validates`() {
            assertThrows(IllegalArgumentException::class.java) { HudEndpoint(" ") }
            assertThrows(IllegalArgumentException::class.java) { HudEndpoint("h", 0) }
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
