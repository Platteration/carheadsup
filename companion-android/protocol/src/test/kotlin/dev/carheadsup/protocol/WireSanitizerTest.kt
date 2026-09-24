package dev.carheadsup.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.Base64

class WireSanitizerTest {
    private val pngHeader = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)

    private fun pngBase64(totalBytes: Int): String = Base64.getEncoder().encodeToString(
        pngHeader + ByteArray(totalBytes - pngHeader.size) {
            7
        },
    )

    @Test
    fun `labels lose control characters and collapse whitespace`() {
        assertEquals("Main St north", WireSanitizer.label("  Main\u0000St\n\tnorth\u007f ", 100))
    }

    @Test
    fun `free text keeps line breaks but drops other control characters`() {
        assertEquals("Turn left\nthen right", WireSanitizer.freeText("Turn left\u0007\nthen right", 300))
    }

    @Test
    fun `truncation adds an ellipsis and never splits a surrogate pair`() {
        assertEquals("abcd…", WireSanitizer.truncate("abcdefgh", 5))
        val emoji = "ab\uD83D\uDE97cd" // "ab\uD83D\uDE97cd"
        val cut = WireSanitizer.truncate(emoji, 4)
        assertEquals("ab…", cut)
        assertTrue(cut.length <= 4)
        assertEquals("", WireSanitizer.truncate("abc", 0))
        assertEquals("abc", WireSanitizer.truncate("abc", 3))
    }

    @Test
    fun `over-long names are truncated to the HUD limit`() {
        val media = WireSanitizer.sanitize(PhoneMedia(true, "x".repeat(400), "y", app = "z".repeat(150))) as PhoneMedia
        assertEquals(WireLimits.MEDIA_TEXT, media.title!!.length)
        assertEquals(WireLimits.NAME, media.app!!.length)
    }

    @Test
    fun `blank optional strings become null`() {
        val media = WireSanitizer.sanitize(PhoneMedia(true, "Song", "  ", album = "\n")) as PhoneMedia
        assertNull(media.artist)
        assertNull(media.album)
    }

    @Test
    fun `nav numbers out of range or not finite become null`() {
        val nav =
            WireSanitizer.sanitize(
                PhoneNav(
                    active = true,
                    source = "google-maps",
                    distanceM = Double.NaN,
                    remainingDistanceM = -5.0,
                    remainingSeconds = Double.POSITIVE_INFINITY,
                    etaEpochMs = -1,
                    maneuver = Maneuver(ManeuverType.ROUNDABOUT_CW, roundaboutExit = 40, roundaboutAngle = -90.0),
                ),
            ) as PhoneNav
        assertNull(nav.distanceM)
        assertNull(nav.remainingDistanceM)
        assertNull(nav.remainingSeconds)
        assertNull(nav.etaEpochMs)
        assertNull(nav.maneuver!!.roundaboutExit)
        assertEquals(270.0, nav.maneuver.roundaboutAngle)
    }

    @Test
    fun `nav without a source cannot be sent`() {
        assertNull(WireSanitizer.sanitize(PhoneNav(active = true, source = " \n")))
    }

    @Test
    fun `lanes are capped and directions de-duplicated`() {
        val lanes =
            List(20) {
                Lane(
                    listOf(LaneDirection.LEFT, LaneDirection.LEFT, LaneDirection.STRAIGHT),
                    recommended =
                    it == 0,
                )
            }
        val nav = WireSanitizer.sanitize(PhoneNav(active = true, source = "s", lanes = lanes)) as PhoneNav
        assertEquals(WireLimits.LANES, nav.lanes!!.size)
        assertEquals(listOf(LaneDirection.LEFT, LaneDirection.STRAIGHT), nav.lanes[0].directions)
    }

    @Test
    fun `icons must be base64 PNGs within budget`() {
        val valid = pngBase64(1_000)
        assertTrue(WireSanitizer.isValidIconPng(valid))
        assertFalse(WireSanitizer.isValidIconPng(Base64.getEncoder().encodeToString(ByteArray(100)))) // not a PNG
        assertFalse(WireSanitizer.isValidIconPng(valid.dropLast(1))) // bad padding
        assertFalse(WireSanitizer.isValidIconPng(pngBase64(WireLimits.ICON_PNG_BYTES + 2_000)))
        assertTrue(WireSanitizer.isValidIconPng(pngBase64(WireLimits.ICON_PNG_BYTES)))
        val nav = WireSanitizer.sanitize(PhoneNav(active = true, source = "s", iconPng = "iVBORw0KGgo!!!!")) as PhoneNav
        assertNull(nav.iconPng)
    }

    @Test
    fun `hazards are validated, de-duplicated and the nearest fifty kept`() {
        val items =
            (0 until 60).map {
                HazardItem("h$it", HazardType.SPEED_CAMERA, distanceM = (60 - it) * 10.0, speedLimitKph = 0.0)
            } +
                HazardItem("h55", HazardType.POLICE, distanceM = 1.0) +
                HazardItem("", HazardType.OTHER) +
                HazardItem("far", HazardType.ACCIDENT, distanceM = 5_000_000.0)
        val hazards = (WireSanitizer.sanitize(PhoneHazards(items)) as PhoneHazards).items
        assertEquals(WireLimits.HAZARDS, hazards.size)
        assertEquals(hazards.size, hazards.map { it.id }.toSet().size)
        assertEquals(HazardType.SPEED_CAMERA, hazards.first { it.id == "h55" }.type) // first occurrence wins
        assertTrue(hazards.all { it.speedLimitKph == null }) // 0 is never a valid limit
        assertEquals("h59", hazards.first().id) // nearest first
        assertTrue(hazards.none { it.id == "far" }) // out-of-range distance → null → sorted last → cut
    }

    @Test
    fun `road limits must be positive, and unlimited roads carry no number`() {
        assertNull((WireSanitizer.sanitize(PhoneRoad(0.0, source = RoadSource.OSM)) as PhoneRoad).speedLimitKph)
        assertNull((WireSanitizer.sanitize(PhoneRoad(600.0, source = RoadSource.OSM)) as PhoneRoad).speedLimitKph)
        assertNull(
            (
                WireSanitizer.sanitize(
                    PhoneRoad(130.0, unlimited = true, source = RoadSource.OSM),
                ) as PhoneRoad
                ).speedLimitKph,
        )
        assertEquals(
            80.0,
            (WireSanitizer.sanitize(PhoneRoad(80.0, source = RoadSource.OSM)) as PhoneRoad).speedLimitKph,
        )
    }

    @Test
    fun `locations off the globe are dropped, optional values clamped`() {
        assertNull(WireSanitizer.sanitize(PhoneLocation(91.0, 0.0, null)))
        assertNull(WireSanitizer.sanitize(PhoneLocation(0.0, Double.NaN, null)))
        val location = WireSanitizer.sanitize(
            PhoneLocation(48.0, 11.0, accuracyM = -1.0, speedMps = 250.0, bearingDeg = -10.0),
        ) as PhoneLocation
        assertNull(location.accuracyM)
        assertNull(location.speedMps)
        assertEquals(350.0, location.bearingDeg)
        assertEquals(0.0, WireSanitizer.normalizeBearing(720.0))
    }

    @Test
    fun `messages need an id and a sender`() {
        assertNull(WireSanitizer.sanitize(PhoneMessage("", "Alice", null, false)))
        assertNull(WireSanitizer.sanitize(PhoneMessage("m1", "\u0000", null, false)))
        assertNotNull(WireSanitizer.sanitize(PhoneMessage("m1", "Alice", null, false)))
    }

    @Test
    fun `calls keep numbers intact or drop them`() {
        val call = WireSanitizer.sanitize(PhoneCall("c1", CallState.RINGING, "  Bob ", "+1 555 0100")) as PhoneCall
        assertEquals("Bob", call.callerName)
        assertEquals("+1 555 0100", call.number)
        assertNull(
            (WireSanitizer.sanitize(PhoneCall("c1", CallState.RINGING, null, "1".repeat(41))) as PhoneCall).number,
        )
        assertNull(WireSanitizer.sanitize(PhoneCall(" ", CallState.RINGING, null, null)))
    }

    @Test
    fun `a hello goes out with its authentication fields intact or not at all`() {
        val id = "8PHy8_T19vf4-fr7_P3-_w"
        val nonce = "ICEiIyQlJicoKSorLC0uLw"
        val proof = "mm0V3w_MTQxN1Eo5QmrfJ3EpsfnnlUZYJPzZ0YPD62s"
        val hello = WireSanitizer.sanitize(PhoneMessages.hello("d".repeat(200), id, "1", nonce, proof)) as PhoneHello
        assertEquals(WireLimits.NAME, hello.device.length)
        val valid = PhoneMessages.hello("d", id, "1", nonce, proof)
        assertEquals(valid, WireSanitizer.sanitize(valid))
        // The proof covers the id and nonce: nothing to repair, the HUD would refuse it.
        assertNull(WireSanitizer.sanitize(PhoneMessages.hello("d", "Pixel", "1", nonce, proof)))
        assertNull(WireSanitizer.sanitize(PhoneMessages.hello("d", id, "1", "$nonce=", proof)))
        assertNull(WireSanitizer.sanitize(PhoneMessages.hello("d", id, "1", nonce, proof.drop(1))))
    }

    @Test
    fun `trips request cursor is clamped`() {
        assertEquals(0L, (WireSanitizer.sanitize(PhoneTripsRequest(-5)) as PhoneTripsRequest).since)
    }

    @Test
    fun `PhoneWire drops a frame-busting icon but keeps the update`() {
        val hugeButValid = pngBase64(WireLimits.ICON_PNG_BYTES)
        val longInstruction = "x".repeat(WireLimits.TEXT)
        val nav =
            PhoneNav(
                active = true,
                source = "google-maps",
                maneuver = Maneuver(ManeuverType.LEFT, instruction = longInstruction),
                iconPng = hugeButValid,
            )
        val encoded = PhoneWire.encode(nav)!!
        assertTrue(encoded.length <= WireLimits.PHONE_FRAME_CHARS)
        assertTrue(encoded.contains(hugeButValid)) // fits: kept
        assertNull(PhoneWire.encode(PhoneLocation(100.0, 0.0, null)))
    }
}
