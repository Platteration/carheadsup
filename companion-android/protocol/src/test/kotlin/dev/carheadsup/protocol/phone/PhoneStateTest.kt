package dev.carheadsup.protocol.phone

import dev.carheadsup.protocol.CallAction
import dev.carheadsup.protocol.CallState
import dev.carheadsup.protocol.PhoneCall
import dev.carheadsup.protocol.PhoneMedia
import dev.carheadsup.protocol.PhoneMessages
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test

class PhoneStateTest {
    @Nested
    inner class Calls {
        private var next = 0

        private fun tracker() = CallStateTracker { "call-${++next}" }

        @Test
        fun `incoming call answered then hung up`() {
            val tracker = tracker()
            assertEquals(
                PhoneCall("call-1", CallState.RINGING, null, null),
                tracker.onTelephonyState(TelephonyState.RINGING),
            )
            // Android repeats RINGING once the number may be read.
            assertEquals(
                PhoneCall("call-1", CallState.RINGING, null, "+4917012345"),
                tracker.onTelephonyState(TelephonyState.RINGING, "+4917012345"),
            )
            assertNull(tracker.onTelephonyState(TelephonyState.RINGING, "+4917012345"))
            assertEquals(
                PhoneCall("call-1", CallState.RINGING, "Mum", "+4917012345"),
                tracker.onCallerIdentified("Mum"),
            )
            assertNull(tracker.onCallerIdentified("Mum"))
            assertEquals(
                PhoneCall("call-1", CallState.ACTIVE, "Mum", "+4917012345"),
                tracker.onTelephonyState(TelephonyState.OFFHOOK),
            )
            assertEquals(
                PhoneCall("call-1", CallState.ENDED, "Mum", "+4917012345"),
                tracker.onTelephonyState(TelephonyState.IDLE),
            )
            assertNull(tracker.currentCall)
            assertNull(tracker.onTelephonyState(TelephonyState.IDLE))
        }

        @Test
        fun `missed call ends from ringing`() {
            val tracker = tracker()
            tracker.onTelephonyState(TelephonyState.RINGING, "123")
            assertEquals(CallState.ENDED, tracker.onTelephonyState(TelephonyState.IDLE)!!.state)
        }

        @Test
        fun `outgoing call is active from dialling`() {
            val tracker = tracker()
            assertEquals(
                PhoneCall("call-1", CallState.ACTIVE, null, null),
                tracker.onTelephonyState(TelephonyState.OFFHOOK),
            )
            assertNull(tracker.onTelephonyState(TelephonyState.OFFHOOK))
        }

        @Test
        fun `a waiting call replaces the active one`() {
            val tracker = tracker()
            tracker.onTelephonyState(TelephonyState.OFFHOOK)
            val waiting = tracker.onTelephonyState(TelephonyState.RINGING, "555")!!
            assertEquals(PhoneCall("call-2", CallState.RINGING, null, "555"), waiting)
            assertEquals(
                PhoneCall("call-2", CallState.ACTIVE, null, "555"),
                tracker.onTelephonyState(TelephonyState.OFFHOOK),
            )
        }

        @Test
        fun `caller identification needs a call and keeps known values`() {
            val tracker = tracker()
            assertNull(tracker.onCallerIdentified("Nobody"))
            tracker.onTelephonyState(TelephonyState.RINGING, "123")
            assertEquals("123", tracker.onCallerIdentified("Ann", "999")!!.number)
            assertNull(tracker.onCallerIdentified("  "))
        }

        @Test
        fun `HUD call actions only apply to the matching call in the right state`() {
            val tracker = tracker()
            assertFalse(tracker.accepts("call-1", CallAction.ACCEPT))
            tracker.onTelephonyState(TelephonyState.RINGING)
            assertTrue(tracker.accepts("call-1", CallAction.ACCEPT))
            assertTrue(tracker.accepts("call-1", CallAction.DECLINE))
            assertFalse(tracker.accepts("call-0", CallAction.DECLINE))
            tracker.onTelephonyState(TelephonyState.OFFHOOK)
            assertFalse(tracker.accepts("call-1", CallAction.ACCEPT))
            assertTrue(tracker.accepts("call-1", CallAction.DECLINE))
            tracker.onTelephonyState(TelephonyState.IDLE)
            assertFalse(tracker.accepts("call-1", CallAction.DECLINE))
        }
    }

    @Nested
    inner class Media {
        private fun session(
            pkg: String,
            status: PlaybackStatus,
            title: String? = "Song",
            artist: String? = "Artist",
            mediaId: String? = null,
        ) = MediaSessionSnapshot(
            pkg,
            pkg.substringAfterLast('.').replaceFirstChar {
                it.uppercase()
            },
            status,
            title,
            artist,
            "Album",
            mediaId,
        )

        @Test
        fun `a playing session wins over a paused one with higher priority`() {
            val media =
                MediaSelector.select(
                    listOf(
                        session("com.podcasts", PlaybackStatus.PAUSED, "Episode 4"),
                        session("com.spotify", PlaybackStatus.PLAYING, "Hey Jude", "The Beatles", "spotify:track:1"),
                    ),
                )
            assertEquals(
                PhoneMedia(true, "Hey Jude", "The Beatles", "Album", "Spotify", "com.spotify:spotify:track:1"),
                media,
            )
        }

        @Test
        fun `buffering counts as playing, paused is reported as not playing with metadata`() {
            assertTrue(MediaSelector.select(listOf(session("a.b", PlaybackStatus.BUFFERING))).playing)
            val paused = MediaSelector.select(listOf(session("a.b", PlaybackStatus.PAUSED)))
            assertFalse(paused.playing)
            assertEquals("Song", paused.title)
        }

        @Test
        fun `nothing playing`() {
            assertEquals(PhoneMessages.mediaStopped(), MediaSelector.select(emptyList()))
            assertEquals(
                PhoneMessages.mediaStopped(),
                MediaSelector.select(listOf(session("a.b", PlaybackStatus.STOPPED))),
            )
            assertEquals(
                PhoneMessages.mediaStopped(),
                MediaSelector.select(listOf(session("a.b", PlaybackStatus.PLAYING, title = " "))),
            )
        }

        @Test
        fun `track keys identify tracks`() {
            val a = session("a.b", PlaybackStatus.PLAYING, "Song", "Artist")
            assertEquals(MediaSelector.trackKey(a), MediaSelector.trackKey(a.copy(status = PlaybackStatus.PAUSED)))
            assertTrue(MediaSelector.trackKey(a) != MediaSelector.trackKey(a.copy(title = "Other")))
            assertEquals("a.b:id-7", MediaSelector.trackKey(a.copy(mediaId = " id-7 ")))
            assertNull(MediaSelector.select(listOf(a.copy(artist = " "))).artist)
        }
    }
}
