package dev.carheadsup.companion.media

import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.util.Log
import dev.carheadsup.companion.notifications.NavNotificationListener
import dev.carheadsup.companion.notifications.NotificationContent
import dev.carheadsup.protocol.PhoneMedia
import dev.carheadsup.protocol.phone.MediaSelector
import dev.carheadsup.protocol.phone.MediaSessionSnapshot
import dev.carheadsup.protocol.phone.PlaybackStatus

/**
 * Follows the phone's active media sessions (Spotify, YouTube Music, podcasts, radio …) and
 * publishes `media` on track and play/pause changes.
 *
 * `MediaSessionManager.getActiveSessions` is only allowed for the enabled notification listener,
 * so this needs notification access; [start] returns false without it.
 */
class MediaMonitor(context: Context, private val publish: (PhoneMedia) -> Unit) {
    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(MediaSessionManager::class.java)
    private val listenerComponent = ComponentName(appContext, NavNotificationListener::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private val labels = HashMap<String, String?>()
    private var controllers: List<MediaController> = emptyList()
    private var last: PhoneMedia? = null
    private var running = false

    private val controllerCallback =
        object : MediaController.Callback() {
            override fun onMetadataChanged(metadata: MediaMetadata?) = refresh()

            override fun onPlaybackStateChanged(state: PlaybackState?) = refresh()

            override fun onSessionDestroyed() = rebind(currentSessions())
        }

    private val sessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { sessions ->
        rebind(sessions.orEmpty())
    }

    /** Starts watching; must be called on the main thread. False without notification access. */
    fun start(): Boolean {
        if (running) return true
        return try {
            manager.addOnActiveSessionsChangedListener(sessionsListener, listenerComponent, handler)
            running = true
            rebind(currentSessions())
            true
        } catch (e: SecurityException) {
            Log.i(TAG, "No notification access: media info unavailable")
            false
        }
    }

    fun stop() {
        if (!running) return
        running = false
        manager.removeOnActiveSessionsChangedListener(sessionsListener)
        controllers.forEach { it.unregisterCallback(controllerCallback) }
        controllers = emptyList()
        last = null
    }

    private fun currentSessions(): List<MediaController> = try {
        manager.getActiveSessions(listenerComponent)
    } catch (e: SecurityException) {
        emptyList()
    }

    private fun rebind(sessions: List<MediaController>) {
        if (!running) return
        controllers.forEach { it.unregisterCallback(controllerCallback) }
        controllers = sessions
        controllers.forEach { it.registerCallback(controllerCallback, handler) }
        refresh()
    }

    private fun refresh() {
        if (!running) return
        val media = MediaSelector.select(controllers.map(::snapshot))
        if (media != last) {
            last = media
            publish(media)
        }
    }

    private fun snapshot(controller: MediaController): MediaSessionSnapshot {
        val metadata = controller.metadata
        val packageName = controller.packageName
        return MediaSessionSnapshot(
            packageName = packageName,
            appLabel = labels.getOrPut(packageName) { NotificationContent.appLabel(appContext, packageName) },
            status = status(controller.playbackState?.state),
            title =
            metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)
                ?: metadata?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE),
            artist =
            metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST)
                ?: metadata?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST),
            album = metadata?.getString(MediaMetadata.METADATA_KEY_ALBUM),
            mediaId = metadata?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID),
        )
    }

    private fun status(state: Int?): PlaybackStatus = when (state) {
        PlaybackState.STATE_PLAYING,
        PlaybackState.STATE_FAST_FORWARDING,
        PlaybackState.STATE_REWINDING,
        -> PlaybackStatus.PLAYING

        PlaybackState.STATE_BUFFERING, PlaybackState.STATE_CONNECTING,
        PlaybackState.STATE_SKIPPING_TO_NEXT, PlaybackState.STATE_SKIPPING_TO_PREVIOUS,
        PlaybackState.STATE_SKIPPING_TO_QUEUE_ITEM,
        -> PlaybackStatus.BUFFERING

        PlaybackState.STATE_PAUSED -> PlaybackStatus.PAUSED

        PlaybackState.STATE_STOPPED -> PlaybackStatus.STOPPED

        PlaybackState.STATE_ERROR -> PlaybackStatus.ERROR

        else -> PlaybackStatus.NONE
    }

    private companion object {
        const val TAG = "MediaMonitor"
    }
}
