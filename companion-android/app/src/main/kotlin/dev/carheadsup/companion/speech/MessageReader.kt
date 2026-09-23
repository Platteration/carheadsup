package dev.carheadsup.companion.speech

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import dev.carheadsup.companion.R
import dev.carheadsup.protocol.messaging.FocusChange
import dev.carheadsup.protocol.messaging.FocusResult
import dev.carheadsup.protocol.messaging.SpeechOutput
import dev.carheadsup.protocol.messaging.SpeechQueue
import java.util.Locale

/**
 * Reads incoming messages aloud on the phone — the HUD only ever shows who sent them.
 *
 * Adapts TextToSpeech and audio focus to [SpeechQueue], which decides what is read when: one
 * message at a time under transient focus that lets music duck underneath
 * (`AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`), paused while a navigation prompt or a call needs the
 * audio and resumed afterwards (delayed focus during calls), released when the queue is empty.
 * Messages arriving before the TTS engine is ready are queued. Call [shutdown] when done.
 */
class MessageReader(context: Context) {
    private val appContext = context.applicationContext
    private val audioManager = appContext.getSystemService(AudioManager::class.java)
    private val mainHandler = Handler(Looper.getMainLooper())
    private val attributes =
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
    private val focusRequest =
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attributes)
            // During a call, focus is granted when the call ends instead of being refused.
            .setAcceptsDelayedFocusGain(true)
            // We pause ourselves when asked to duck (the platform cannot duck the TTS engine's
            // speech, which plays from another process).
            .setWillPauseWhenDucked(true)
            .setOnAudioFocusChangeListener(::onFocusChange, mainHandler)
            .build()

    @Volatile
    private var tts: TextToSpeech? = null

    private val output =
        object : SpeechOutput {
            override fun requestFocus(): FocusResult = when (audioManager.requestAudioFocus(focusRequest)) {
                AudioManager.AUDIOFOCUS_REQUEST_GRANTED -> FocusResult.GRANTED
                AudioManager.AUDIOFOCUS_REQUEST_DELAYED -> FocusResult.DELAYED
                else -> FocusResult.FAILED
            }

            override fun releaseFocus() {
                audioManager.abandonAudioFocusRequest(focusRequest)
            }

            override fun speak(text: String, utteranceId: String): Boolean =
                tts?.speak(text, TextToSpeech.QUEUE_ADD, Bundle(), utteranceId) == TextToSpeech.SUCCESS

            override fun stopSpeaking() {
                tts?.stop()
            }
        }

    private val queue = SpeechQueue(output, maxPending = MAX_PENDING)

    private val progressListener =
        object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit

            override fun onDone(utteranceId: String?) = finished(utteranceId)

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) = finished(utteranceId)

            override fun onError(utteranceId: String?, errorCode: Int) = finished(utteranceId)

            override fun onStop(utteranceId: String?, interrupted: Boolean) {
                utteranceId?.let { queue.onUtteranceStopped(it, now()) }
            }
        }

    @Volatile
    private var shutDown = false

    init {
        // The engine is created on the main thread (callers may be on worker threads); messages
        // arriving before it is ready are queued.
        mainHandler.post {
            if (!shutDown) tts = TextToSpeech(appContext, ::onEngineReady)
        }
    }

    private fun onEngineReady(status: Int) {
        val engine = tts
        if (status != TextToSpeech.SUCCESS || engine == null) {
            Log.w(TAG, "Text-to-speech unavailable (status $status)")
            queue.onEngineReady(false, now())
            return
        }
        engine.setAudioAttributes(attributes)
        engine.setOnUtteranceProgressListener(progressListener)
        val language = engine.setLanguage(Locale.getDefault())
        if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
            Log.w(TAG, "TTS has no voice for ${Locale.getDefault()}; using the engine default")
        }
        queue.onEngineReady(true, now())
    }

    /**
     * Queue "Message from [sender]. [text]" for speaking. Returns whether it will be read: false
     * when it was dropped (no speech engine, a full queue, audio focus refused).
     */
    fun speak(id: String, sender: String, text: String): Boolean =
        queue.enqueue(id, appContext.getString(R.string.tts_message, sender, text), now())

    fun stopSpeaking() {
        queue.clear()
    }

    fun shutdown() {
        shutDown = true
        queue.shutdown()
        tts?.shutdown()
        tts = null
    }

    private fun onFocusChange(change: Int) {
        val mapped =
            when (change) {
                AudioManager.AUDIOFOCUS_GAIN -> FocusChange.GAIN
                AudioManager.AUDIOFOCUS_LOSS -> FocusChange.LOSS
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> FocusChange.LOSS_TRANSIENT
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> FocusChange.LOSS_TRANSIENT_CAN_DUCK
                else -> return
            }
        queue.onFocusChange(mapped, now())
    }

    private fun finished(utteranceId: String?) {
        utteranceId?.let { queue.onUtteranceDone(it, now()) }
    }

    private fun now(): Long = SystemClock.elapsedRealtime()

    private companion object {
        const val TAG = "MessageReader"
        const val MAX_PENDING = 10
    }
}
