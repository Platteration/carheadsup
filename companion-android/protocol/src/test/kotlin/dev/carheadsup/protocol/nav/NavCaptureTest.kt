package dev.carheadsup.protocol.nav

import dev.carheadsup.protocol.Maneuver
import dev.carheadsup.protocol.ManeuverType
import dev.carheadsup.protocol.PhoneNav
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class NavCaptureTest {
    private val maps = GoogleMapsNotificationParser.GOOGLE_MAPS_PACKAGE
    private val content =
        NavNotificationContent(maps, "300 m", "Turn left onto Elm St", "5 min · 2 km · 10:05 ETA", category = "navigation")
    private val nav =
        PhoneNav(
            active = true,
            source = "google-maps",
            maneuver = Maneuver(ManeuverType.LEFT, instruction = "Turn left onto Elm St"),
            distanceM = 300.0,
            street = "Elm St",
            remainingSeconds = 300.0,
        )

    @Test
    fun `a capture is the notification, where and when, and what the parser made of it`() {
        val case = NavCaptureLog.case(content, "en-US", "America/Los_Angeles", 1_790_182_800_000, DrivingSide.RIGHT, nav)
        assertEquals("captured en-US: left", case.name)
        assertEquals(content, case.content())
        assertEquals(ExpectedNav(ManeuverType.LEFT, distanceM = 300.0, street = "Elm St", remainingSeconds = 300.0), case.expected)
        val missed = NavCaptureLog.case(content, "fr-FR", "Europe/Paris", 1, DrivingSide.RIGHT, null)
        assertEquals("captured fr-FR: not understood", missed.name)
        assertNull(missed.expected)
    }

    @Test
    fun `the log is one case per line and survives a torn last line`() {
        val a = NavCaptureLog.case(content, "en-US", "UTC", 1, DrivingSide.RIGHT, nav)
        val b = NavCaptureLog.case(content.copy(title = "200 m"), "en-US", "UTC", 2, DrivingSide.LEFT, null)
        val line = NavCaptureLog.encodeLine(a)
        assertFalse('\n' in line)
        val text = line + "\n" + NavCaptureLog.encodeLine(b) + "\n" + NavCaptureLog.encodeLine(a).take(20)
        assertEquals(listOf(a, b), NavCaptureLog.decodeLines(text))
    }

    @Test
    fun `the export is the fixture format`() {
        val cases = listOf(NavCaptureLog.case(content, "de-DE", "Europe/Berlin", 5, DrivingSide.RIGHT, nav))
        val exported = NavCaptureLog.export(cases)
        assertEquals(cases, NavCaptureLog.decodeFixture(exported))
        // Every field is written out, so a capture reads (and is corrected) as a whole.
        assertTrue("\"bigText\": null" in exported, exported)
        assertTrue("\"drivingSide\": \"right\"" in exported, exported)
    }

    @Test
    fun `posts that differ only in their numbers have one shape`() {
        val first = CapturedNotification.of(content)
        val countdown = CapturedNotification.of(content.copy(title = "250 m", subText = "4 min · 1.9 km · 10:05 ETA"))
        val nextTurn = CapturedNotification.of(content.copy(text = "Turn right onto Oak Ave"))
        assertEquals(NavCaptureLog.shape(first), NavCaptureLog.shape(countdown))
        assertNotEquals(NavCaptureLog.shape(first), NavCaptureLog.shape(nextTurn))
        assertNotEquals(NavCaptureLog.shape(first), NavCaptureLog.shape(first.copy(bigText = "Then keep right")))
    }

    @Test
    fun `parse statistics tell understood, Maps' own arrow and not understood apart`() {
        var stats = NavParseStats()
        stats = stats.record(content, nav, 1_000)
        stats = stats.record(content, nav.copy(maneuver = Maneuver(ManeuverType.UNKNOWN)), 2_000)
        stats = stats.record(content, null, 3_000)
        // A Maps notification that is not about navigation is no misunderstanding.
        stats = stats.record(content.copy(category = "location_sharing"), null, 4_000)
        assertEquals(NavParseStats(1, 1, 1, lastNotUnderstoodAtMs = 3_000, lastGuidanceAtMs = 2_000), stats)
        assertEquals(3, stats.total)
    }

    @Test
    fun `the Android Auto notice waits for guidance that does not come`() {
        val q = AndroidAuto.QUIET_MS
        assertFalse(AndroidAuto.noticeDue(projectingSinceMs = null, lastGuidanceAtMs = null, nowMs = 10 * q))
        assertFalse(AndroidAuto.noticeDue(1_000, null, 1_000 + q - 1))
        assertTrue(AndroidAuto.noticeDue(1_000, null, 1_000 + q))
        // Guidance from the phone's Maps still arrives: no notice while it keeps coming.
        assertFalse(AndroidAuto.noticeDue(1_000, 50_000, 50_000 + q - 1))
        assertTrue(AndroidAuto.noticeDue(1_000, 50_000, 50_000 + q))
        // Guidance from before the projection began does not count.
        assertTrue(AndroidAuto.noticeDue(100_000, 50_000, 100_000 + q))
    }
}
