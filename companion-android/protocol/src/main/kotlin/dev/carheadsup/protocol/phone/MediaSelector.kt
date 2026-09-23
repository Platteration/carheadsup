package dev.carheadsup.protocol.phone

import dev.carheadsup.protocol.PhoneMedia
import dev.carheadsup.protocol.PhoneMessages

/** Coarse playback state of a media session (`PlaybackState.STATE_*`). */
public enum class PlaybackStatus { PLAYING, BUFFERING, PAUSED, STOPPED, NONE, ERROR }

/** What the phone knows about one active media session. */
public data class MediaSessionSnapshot(
    val packageName: String,
    val appLabel: String?,
    val status: PlaybackStatus,
    val title: String?,
    val artist: String?,
    val album: String?,
    /** `METADATA_KEY_MEDIA_ID`, when the app provides one. */
    val mediaId: String? = null,
)

/**
 * Chooses which media session the HUD shows and builds the `media` message.
 *
 * Sessions come in the system's priority order (most recently active first). The first one that
 * is playing (or buffering) with a title wins; otherwise the first paused one with a title
 * (reported `playing = false` so the HUD keeps the track but shows no "now playing" toast);
 * otherwise nothing is playing.
 */
public object MediaSelector {
    public fun select(sessions: List<MediaSessionSnapshot>): PhoneMedia {
        val withTitle = sessions.filter { !it.title.isNullOrBlank() }
        val chosen =
            withTitle.firstOrNull { it.status == PlaybackStatus.PLAYING || it.status == PlaybackStatus.BUFFERING }
                ?: withTitle.firstOrNull { it.status == PlaybackStatus.PAUSED }
                ?: return PhoneMessages.mediaStopped()
        return PhoneMedia(
            playing = chosen.status == PlaybackStatus.PLAYING || chosen.status == PlaybackStatus.BUFFERING,
            title = chosen.title?.trim(),
            artist = chosen.artist?.trim()?.ifEmpty { null },
            album = chosen.album?.trim()?.ifEmpty { null },
            app = chosen.appLabel?.trim()?.ifEmpty { null },
            trackKey = trackKey(chosen),
        )
    }

    /** Stable track identity: the app's media id when present, else title/artist/album. */
    public fun trackKey(session: MediaSessionSnapshot): String {
        val mediaId = session.mediaId?.trim()?.ifEmpty { null }
        if (mediaId != null) return "${session.packageName}:$mediaId"
        return listOf(session.title, session.artist, session.album).joinToString(" | ") { it?.trim().orEmpty() }
            .let { "${session.packageName}:$it" }
    }
}
