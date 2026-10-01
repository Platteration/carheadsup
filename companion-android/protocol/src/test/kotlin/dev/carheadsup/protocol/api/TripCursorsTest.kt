package dev.carheadsup.protocol.api

import dev.carheadsup.protocol.PhoneTripsRequest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test

class TripCursorsTest {
    private val hudA = "AAECAwQFBgcICQoLDA0ODw"
    private val hudB = "EBESExQVFhcYGRobHB0eHw"

    private fun trip(id: String, endedAt: Long, seq: Long? = null) = TripRecord(
        id = id, seq = seq, startedAt = endedAt - 600_000, endedAt = endedAt, distanceKm = 5.0, durationS = 600.0,
        movingS = 500.0, idleS = 100.0, maxSpeedKph = 80.0, avgMovingSpeedKph = 36.0, currency = "EUR",
    )

    @Test
    fun `asks each HUD for what it numbered after the last trip received from it`() {
        val log = listOf(trip("old", 5_000), trip("n1", 1_000, seq = 1))
        var cursors = TripCursors()
        // Nothing numbered received yet: everything numbered, and older trips by end time.
        assertEquals(PhoneTripsRequest(since = 5_000, sinceSeq = 0), cursors.request(hudA, log))
        cursors = cursors.received(hudA, listOf(trip("n1", 1_000, seq = 1), trip("n3", 900, seq = 3)))
        assertEquals(PhoneTripsRequest(since = 5_000, sinceSeq = 3), cursors.request(hudA, log))
        // Another HUD counts on its own.
        assertEquals(0L, cursors.cursor(hudB))
        cursors = cursors.received(hudB, listOf(trip("b1", 2_000, seq = 1)), pushed = true)
        assertEquals(1L, cursors.cursor(hudB))
        assertEquals(3L, cursors.cursor(hudA))
    }

    @Test
    fun `never moves back for an answer, and starts over when a HUD's newest trip is numbered lower`() {
        val cursors = TripCursors(mapOf(hudA to 40L))
        assertSame(cursors, cursors.received(hudA, listOf(trip("x", 1, seq = 12))))
        assertSame(cursors, cursors.received(hudA, listOf(trip("legacy", 1))))
        assertSame(cursors, cursors.received(hudA, emptyList()))
        // The HUD's data was reset: its newest trip is number 2.
        assertEquals(0L, cursors.received(hudA, listOf(trip("y", 1, seq = 2)), pushed = true).cursor(hudA))
        assertEquals(41L, cursors.received(hudA, listOf(trip("z", 1, seq = 41)), pushed = true).cursor(hudA))
    }

    @Test
    fun `remembers a bounded number of HUDs, forgetting the one heard from longest ago`() {
        var cursors = TripCursors()
        for (i in 0 until TripCursors.MAX_HUDS + 2) {
            cursors = cursors.received("hud$i", listOf(trip("t", 1, seq = i + 1L)))
        }
        assertEquals(TripCursors.MAX_HUDS, cursors.seqByHud.size)
        assertEquals(0L, cursors.cursor("hud0"))
        assertEquals(TripCursors.MAX_HUDS + 2L, cursors.cursor("hud${TripCursors.MAX_HUDS + 1}"))
    }

    @Test
    fun `round-trips through its file format and survives a broken file`() {
        val cursors = TripCursors(mapOf(hudA to 7L, hudB to 2L))
        assertEquals(cursors, TripCursors.decode(cursors.encode()))
        assertEquals(TripCursors(), TripCursors.decode("not json"))
        assertEquals(TripCursors(), TripCursors.decode("[1,2]"))
        assertEquals(TripCursors(mapOf(hudA to 7L)), TripCursors.decode("""{"$hudA":7,"$hudB":-1}"""))
    }
}
