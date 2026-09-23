package dev.carheadsup.protocol.messaging

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SpeechQueueTest {
    /** Records what the queue asks of TTS and audio focus. */
    private class FakeOutput : SpeechOutput {
        var focusResult = FocusResult.GRANTED
        var speakAccepted = true
        val log = mutableListOf<String>()
        var lastUtteranceId: String? = null

        override fun requestFocus(): FocusResult {
            log += "focus"
            return focusResult
        }

        override fun releaseFocus() {
            log += "release"
        }

        override fun speak(text: String, utteranceId: String): Boolean {
            log += "speak $text"
            lastUtteranceId = utteranceId
            return speakAccepted
        }

        override fun stopSpeaking() {
            log += "stop"
        }

        val spoken: List<String> get() = log.filter { it.startsWith("speak ") }.map { it.removePrefix("speak ") }
    }

    private val output = FakeOutput()
    private val queue = SpeechQueue(output, maxPending = 3, maxWaitMs = 180_000)

    private fun finishCurrent(nowMs: Long) = queue.onUtteranceDone(output.lastUtteranceId!!, nowMs)

    @Test
    fun `messages are read one after another, focus is released at the end`() {
        queue.onEngineReady(true, 0)
        assertTrue(queue.enqueue("m1", "Alice", 0))
        assertTrue(queue.enqueue("m2", "Bob", 10))
        assertEquals(listOf("focus", "speak Alice"), output.log)
        finishCurrent(1_000)
        assertEquals(listOf("Alice", "Bob"), output.spoken)
        finishCurrent(2_000)
        assertEquals("release", output.log.last())
        assertEquals(1, output.log.count { it == "focus" })
    }

    @Test
    fun `a navigation prompt pauses reading, which resumes after it (android-12)`() {
        queue.onEngineReady(true, 0)
        queue.enqueue("m1", "Alice", 0)
        val interrupted = output.lastUtteranceId!!
        // Google Maps asks for transient, may-duck focus for "In 300 m, turn left".
        queue.onFocusChange(FocusChange.LOSS_TRANSIENT_CAN_DUCK, 1_000)
        assertEquals("stop", output.log.last())
        queue.onUtteranceStopped(interrupted, 1_001)
        queue.enqueue("m2", "Bob", 2_000)
        assertEquals(listOf("Alice"), output.spoken)
        // The prompt is over: the interrupted message is read again from the start, then the next.
        queue.onFocusChange(FocusChange.GAIN, 4_000)
        assertEquals(listOf("Alice", "Alice"), output.spoken)
        finishCurrent(6_000)
        assertEquals(listOf("Alice", "Alice", "Bob"), output.spoken)
        finishCurrent(7_000)
        assertEquals("release", output.log.last())
    }

    @Test
    fun `a transient loss pauses the same way`() {
        queue.onEngineReady(true, 0)
        queue.enqueue("m1", "Alice", 0)
        queue.onFocusChange(FocusChange.LOSS_TRANSIENT, 500)
        assertEquals("stop", output.log.last())
        queue.onFocusChange(FocusChange.GAIN, 3_000)
        assertEquals(listOf("Alice", "Alice"), output.spoken)
    }

    @Test
    fun `callbacks for an utterance that was stopped do not skip the one that replaced it`() {
        queue.onEngineReady(true, 0)
        queue.enqueue("m1", "Alice", 0)
        val first = output.lastUtteranceId!!
        queue.onFocusChange(FocusChange.LOSS_TRANSIENT_CAN_DUCK, 1_000)
        queue.onFocusChange(FocusChange.GAIN, 2_000)
        // The engine reports the first attempt late.
        queue.onUtteranceStopped(first, 2_001)
        queue.onUtteranceDone(first, 2_002)
        queue.enqueue("m2", "Bob", 2_500)
        assertEquals(listOf("Alice", "Alice"), output.spoken)
        finishCurrent(4_000)
        assertEquals(listOf("Alice", "Alice", "Bob"), output.spoken)
    }

    @Test
    fun `during a call a message waits for the call to end (android-16)`() {
        queue.onEngineReady(true, 0)
        output.focusResult = FocusResult.DELAYED
        assertTrue(queue.enqueue("m1", "Alice", 0), "queued: it will be read")
        assertTrue(output.spoken.isEmpty())
        // Focus is granted once the call is over.
        queue.onFocusChange(FocusChange.GAIN, 60_000)
        assertEquals(listOf("Alice"), output.spoken)
    }

    @Test
    fun `messages that waited too long are not read any more`() {
        queue.onEngineReady(true, 0)
        output.focusResult = FocusResult.DELAYED
        queue.enqueue("m1", "Alice", 0)
        queue.onFocusChange(FocusChange.GAIN, 10 * 60_000)
        assertTrue(output.spoken.isEmpty())
        assertEquals("release", output.log.last())
    }

    @Test
    fun `refused focus drops the message and reports it (android-16)`() {
        queue.onEngineReady(true, 0)
        output.focusResult = FocusResult.FAILED
        assertFalse(queue.enqueue("m1", "Alice", 0))
        output.focusResult = FocusResult.GRANTED
        assertTrue(queue.enqueue("m2", "Bob", 1_000))
        assertEquals(listOf("Bob"), output.spoken)
    }

    @Test
    fun `an engine that refuses the text drops only that message`() {
        queue.onEngineReady(true, 0)
        output.speakAccepted = false
        assertFalse(queue.enqueue("m1", "Alice", 0))
        assertEquals("release", output.log.last())
        output.speakAccepted = true
        assertTrue(queue.enqueue("m2", "Bob", 1_000))
    }

    @Test
    fun `messages wait for the engine, and a failed engine reads nothing (android-16)`() {
        assertTrue(queue.enqueue("m1", "Alice", 0))
        assertTrue(output.log.isEmpty())
        queue.onEngineReady(true, 100)
        assertEquals(listOf("Alice"), output.spoken)

        val other = FakeOutput()
        val broken = SpeechQueue(other)
        broken.enqueue("m1", "Alice", 0)
        broken.onEngineReady(false, 100)
        assertFalse(broken.enqueue("m2", "Bob", 200))
        assertTrue(other.log.isEmpty())
    }

    @Test
    fun `losing focus for good stops and forgets everything`() {
        queue.onEngineReady(true, 0)
        queue.enqueue("m1", "Alice", 0)
        queue.enqueue("m2", "Bob", 0)
        queue.onFocusChange(FocusChange.LOSS, 1_000)
        assertEquals(listOf("stop", "release"), output.log.takeLast(2))
        queue.onFocusChange(FocusChange.GAIN, 2_000)
        assertEquals(listOf("Alice"), output.spoken)
    }

    @Test
    fun `the queue is bounded and clear stops`() {
        queue.onEngineReady(true, 0)
        assertTrue(queue.enqueue("m1", "A", 0))
        assertTrue(queue.enqueue("m2", "B", 0))
        assertTrue(queue.enqueue("m3", "C", 0))
        assertFalse(queue.enqueue("m4", "D", 0))
        queue.clear()
        assertEquals(listOf("stop", "release"), output.log.takeLast(2))
        finishCurrent(1_000)
        assertEquals(listOf("A"), output.spoken)
    }

    @Test
    fun `a focus that is never given back does not block reading for good`() {
        queue.onEngineReady(true, 0)
        output.focusResult = FocusResult.DELAYED
        queue.enqueue("m1", "Alice", 0)
        output.focusResult = FocusResult.GRANTED
        // No GAIN ever came; a later message tries again once the first one has expired.
        assertTrue(queue.enqueue("m2", "Bob", 200_000))
        assertEquals(listOf("Bob"), output.spoken)
    }
}
