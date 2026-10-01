package dev.carheadsup.protocol.nav

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import java.io.File
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import java.util.stream.Stream

/**
 * Replays the Google Maps notifications in the JSON files of `src/test/resources/nav/` — the companion app's
 * capture format ([NavCaptureCase], exported from Setup → "Capture navigation notifications") —
 * through the parser as the app runs it (languages ordered for the phone's locale, its time zone
 * and driving side) and checks what each case expects. A capture from a real phone becomes a
 * test by checking its `expected` against what Maps showed and adding the file here.
 */
class NavFixtureTest {
    @ParameterizedTest(name = "{0}: {1}")
    @MethodSource("cases")
    fun `parses every captured notification as expected`(file: String, name: String, case: NavCaptureCase) {
        val parser = GoogleMapsNotificationParser(NavLanguages.preferring(Locale.forLanguageTag(case.locale)))
        val clock = Clock.fixed(Instant.ofEpochMilli(case.capturedAtMs), ZoneId.of(case.zone))
        val nav = parser.parse(case.content(), clock, case.drivingSide)
        val expected = case.expected
        if (expected == null) {
            assertNull(nav, "$file: $name")
            return
        }
        assertNotNull(nav, "$file: $name")
        val actual = ExpectedNav.of(nav!!)
        assertEquals(expected.maneuver, actual.maneuver, "maneuver")
        assertEquals(expected.roundaboutExit, actual.roundaboutExit, "roundaboutExit")
        assertClose(expected.distanceM, actual.distanceM, "distanceM")
        assertEquals(expected.street, actual.street, "street")
        assertEquals(expected.currentStreet, actual.currentStreet, "currentStreet")
        assertEquals(expected.then, actual.then, "then")
        assertClose(expected.remainingSeconds, actual.remainingSeconds, "remainingSeconds")
        assertClose(expected.remainingDistanceM, actual.remainingDistanceM, "remainingDistanceM")
        assertEquals(expected.etaEpochMs, actual.etaEpochMs, "etaEpochMs")
    }

    @Test
    fun `there are fixtures in more than one language`() {
        val locales = cases().map { (it.get()[2] as NavCaptureCase).locale.substringBefore('-') }.toList().toSet()
        assertTrue(locales.containsAll(setOf("en", "de")), "$locales")
    }

    private fun assertClose(expected: Double?, actual: Double?, what: String) {
        if (expected == null || actual == null) {
            assertEquals(expected, actual, what)
        } else {
            assertEquals(expected, actual, 1e-6, what)
        }
    }

    companion object {
        @JvmStatic
        fun cases(): Stream<Arguments> {
            val dir = File(requireNotNull(NavFixtureTest::class.java.getResource("/nav")).toURI())
            val files = dir.listFiles { file -> file.name.endsWith(".json") }.orEmpty().sortedBy { it.name }
            return files.flatMap { file ->
                NavCaptureLog.decodeFixture(file.readText()).map { Arguments.of(file.name, it.name, it) }
            }.stream()
        }
    }
}
