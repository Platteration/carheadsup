package dev.carheadsup.companion.speech

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import dev.carheadsup.companion.R
import java.util.Locale

/**
 * Reads incoming messages aloud on the phone — the HUD only ever shows who sent them.
 *
 * Speech runs with transient audio focus that lets music duck underneath
 * (`AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`); focus is released when the queue is empty. Messages
 * arriving before the TTS engine is ready are queued. Call [shutdown] when done.
 */
class MessageReader(context: Context) {
    private val appContext = context.applicationContext
    private val audioManager = appContext.getSystemService(AudioManager::class.java)
    private val attributes =
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
    private val focusRequest =
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener { change ->
                // Another app took focus for good (e.g. a phone call): stop talking over it.
                if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                    stopSpeaking()
                }
            }
            .build()

    private val lock = Any()
    private val pending = ArrayDeque<Pair<String, String>>()
    private var speaking = 0
    private var ready = false
    private var hasFocus = false
    private var tts: TextToSpeech? = null
    private var shutDown = false
    private val mainHandler = Handler(Looper.getMainLooper())

    private val progressListener =
        object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit

            override fun onDone(utteranceId: String?) = utteranceFinished()

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) = utteranceFinished()

            override fun onError(utteranceId: String?, errorCode: Int) = utteranceFinished()

            override fun onStop(utteranceId: String?, interrupted: Boolean) = utteranceFinished()
        }

    init {
        // The engine is created on the main thread (callers may be on worker threads); messages
        // arriving before it is ready are queued.
        mainHandler.post {
            synchronized(lock) {
                if (!shutDown) tts = TextToSpeech(appContext, ::onEngineReady)
            }
        }
    }

    private fun onEngineReady(status: Int) {
        synchronized(lock) {
            val engine = tts
            if (status != TextToSpeech.SUCCESS || engine == null) {
                Log.w(TAG, "Text-to-speech unavailable (status $status)")
                pending.clear()
                return
            }
            engine.setAudioAttributes(attributes)
            engine.setOnUtteranceProgressListener(progressListener)
            val language = engine.setLanguage(Locale.getDefault())
            if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.w(TAG, "TTS has no voice for ${Locale.getDefault()}; using the engine default")
            }
            ready = true
            while (pending.isNotEmpty()) {
                val (id, text) = pending.removeFirst()
                speakLocked(id, text)
            }
        }
    }

    /** Queue "Message from [sender]. [text]" for speaking. */
    fun speak(id: String, sender: String, text: String) {
        val utterance = appContext.getString(R.string.tts_message, sender, text)
        synchronized(lock) {
            if (ready) {
                speakLocked(id, utterance)
            } else if (pending.size < MAX_PENDING) {
                pending.addLast(id to utterance)
            }
        }
    }

    fun stopSpeaking() {
        synchronized(lock) {
            pending.clear()
            tts?.stop()
            speaking = 0
            releaseFocusLocked()
        }
    }

    fun shutdown() {
        synchronized(lock) {
            pending.clear()
            tts?.stop()
            tts?.shutdown()
            tts = null
            shutDown = true
            ready = false
            speaking = 0
            releaseFocusLocked()
        }
    }

    private fun speakLocked(id: String, text: String) {
        val engine = tts ?: return
        if (!hasFocus) {
            hasFocus = audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
            // Without focus (e.g. during a call) the message is not read: never talk over a call.
            if (!hasFocus) return
        }
        val result = engine.speak(text, TextToSpeech.QUEUE_ADD, Bundle(), id)
        if (result == TextToSpeech.SUCCESS) {
            speaking++
        } else if (speaking == 0) {
            releaseFocusLocked()
        }
    }

    private fun releaseFocusLocked() {
        if (hasFocus) {
            audioManager.abandonAudioFocusRequest(focusRequest)
            hasFocus = false
        }
    }

    private fun utteranceFinished() {
        synchronized(lock) {
            speaking = (speaking - 1).coerceAtLeast(0)
            if (speaking == 0) releaseFocusLocked()
        }
    }

    private companion object {
        const val TAG = "MessageReader"
        const val MAX_PENDING = 10
    }
}
