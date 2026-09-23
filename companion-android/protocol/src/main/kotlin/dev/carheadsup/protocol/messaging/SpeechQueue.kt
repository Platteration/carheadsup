package dev.carheadsup.protocol.messaging

/** Result of an audio-focus request (`AudioManager.AUDIOFOCUS_REQUEST_*`). */
public enum class FocusResult { GRANTED, DELAYED, FAILED }

/** Audio-focus changes delivered to the focus holder (`AudioManager.AUDIOFOCUS_*`). */
public enum class FocusChange {
    /** Focus granted: after a delayed request or at the end of a transient loss. */
    GAIN,

    /** Another app took focus for good. */
    LOSS,

    /** Another app needs focus for a while (a call, an alarm). */
    LOSS_TRANSIENT,

    /** Another app needs focus for a while and would let us duck (a navigation prompt). */
    LOSS_TRANSIENT_CAN_DUCK,
}

/** The speech engine and audio focus, as [SpeechQueue] drives them. */
public interface SpeechOutput {
    public fun requestFocus(): FocusResult

    public fun releaseFocus()

    /** Starts speaking [text]; false if the engine refused it. Progress is reported per [utteranceId]. */
    public fun speak(text: String, utteranceId: String): Boolean

    public fun stopSpeaking()
}

/**
 * What the phone reads aloud and when, separate from Android's TextToSpeech and AudioManager
 * (the app adapts those to [SpeechOutput] and feeds their callbacks in).
 *
 * - Messages are read one at a time under transient focus, released when the queue is empty.
 * - Speech never talks over other audio that asked for focus: a transient loss — including the
 *   "may duck" kind a navigation prompt asks for, which the platform cannot duck for us (the TTS
 *   engine plays from its own process, and speech is not ducked) — stops the current message;
 *   it is read again from the start when focus comes back. A permanent loss drops everything.
 * - During a phone call focus is only promised for later (delayed focus): messages wait for the
 *   call to end. Messages that waited longer than [maxWaitMs] are not read any more.
 * - [enqueue] says whether the message will be read, so the HUD is not told "reading aloud"
 *   for a message that is dropped.
 *
 * Every utterance attempt gets its own id, so late callbacks for a stopped attempt are ignored.
 * Thread-safe; [SpeechOutput] is called with the queue's lock held.
 */
public class SpeechQueue(
    private val output: SpeechOutput,
    private val maxPending: Int = 10,
    private val maxWaitMs: Long = 3 * 60_000L,
) {
    private class Utterance(val id: String, val text: String, val queuedAtMs: Long)

    private enum class Engine { STARTING, READY, FAILED }

    private enum class Focus { NONE, HELD, PAUSED, DELAYED }

    private val queue = ArrayDeque<Utterance>()
    private var engine = Engine.STARTING
    private var focus = Focus.NONE
    private var focusSinceMs = 0L

    /** Attempt id of the utterance the engine is speaking (the head of [queue]), if any. */
    private var speaking: String? = null
    private var attempts = 0L

    @Synchronized
    public fun onEngineReady(ok: Boolean, nowMs: Long) {
        if (engine == Engine.FAILED) return
        if (!ok) {
            engine = Engine.FAILED
            queue.clear()
            return
        }
        engine = Engine.READY
        pump(nowMs)
    }

    /** Queues [text] under message [id]; true when it will be read (now or once possible). */
    @Synchronized
    public fun enqueue(id: String, text: String, nowMs: Long): Boolean {
        if (engine == Engine.FAILED || queue.size >= maxPending) return false
        val utterance = Utterance(id, text, nowMs)
        queue.addLast(utterance)
        pump(nowMs)
        return queue.any { it === utterance }
    }

    @Synchronized
    public fun onFocusChange(change: FocusChange, nowMs: Long) {
        when (change) {
            FocusChange.GAIN ->
                if (focus == Focus.DELAYED || focus == Focus.PAUSED) {
                    setFocus(Focus.HELD, nowMs)
                    pump(nowMs)
                }

            FocusChange.LOSS_TRANSIENT, FocusChange.LOSS_TRANSIENT_CAN_DUCK ->
                if (focus == Focus.HELD) {
                    setFocus(Focus.PAUSED, nowMs)
                    interrupt()
                }

            FocusChange.LOSS -> clear()
        }
    }

    /** The engine finished (or failed) utterance [utteranceId]. */
    @Synchronized
    public fun onUtteranceDone(utteranceId: String, nowMs: Long) {
        if (utteranceId != speaking) return
        speaking = null
        queue.removeFirstOrNull()
        pump(nowMs)
    }

    /**
     * The engine stopped utterance [utteranceId]. Stops the queue asked for are already accounted
     * for; any other stop (another app flushed the engine) counts as done.
     */
    @Synchronized
    public fun onUtteranceStopped(utteranceId: String, nowMs: Long) {
        onUtteranceDone(utteranceId, nowMs)
    }

    /** Stops speaking, forgets all queued messages and releases focus. */
    @Synchronized
    public fun clear() {
        queue.clear()
        interrupt()
        if (focus != Focus.NONE) {
            focus = Focus.NONE
            output.releaseFocus()
        }
    }

    /** [clear], and nothing is read any more. */
    @Synchronized
    public fun shutdown() {
        clear()
        engine = Engine.FAILED
    }

    private fun interrupt() {
        if (speaking == null) return
        // Forget the attempt before stopping: its callbacks, even synchronous ones, are ignored.
        speaking = null
        output.stopSpeaking()
    }

    private fun setFocus(value: Focus, nowMs: Long) {
        focus = value
        focusSinceMs = nowMs
    }

    private fun pump(nowMs: Long) {
        while (engine == Engine.READY && speaking == null) {
            if ((focus == Focus.DELAYED || focus == Focus.PAUSED) && nowMs - focusSinceMs > maxWaitMs) {
                // Focus was never given back; ask again rather than stay silent for good.
                focus = Focus.NONE
                output.releaseFocus()
            }
            if (focus == Focus.DELAYED || focus == Focus.PAUSED) return
            while (queue.firstOrNull()?.let { nowMs - it.queuedAtMs > maxWaitMs } == true) queue.removeFirst()
            val next = queue.firstOrNull()
            if (next == null) {
                if (focus == Focus.HELD) {
                    focus = Focus.NONE
                    output.releaseFocus()
                }
                return
            }
            if (focus == Focus.NONE) {
                when (output.requestFocus()) {
                    FocusResult.GRANTED -> setFocus(Focus.HELD, nowMs)

                    FocusResult.DELAYED -> {
                        setFocus(Focus.DELAYED, nowMs)
                        return
                    }

                    FocusResult.FAILED -> {
                        // Nothing will say when it could work: never talk over a call.
                        queue.clear()
                        return
                    }
                }
            }
            val attempt = "${next.id}#${++attempts}"
            speaking = attempt
            if (!output.speak(next.text, attempt)) {
                speaking = null
                queue.removeFirst()
            }
        }
    }
}
