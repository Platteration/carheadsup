package dev.carheadsup.protocol.messaging

import dev.carheadsup.protocol.PhoneMessage
import java.security.MessageDigest
import java.util.Locale

/** One entry of a `MessagingStyle` notification. */
public data class StyleMessage(
    /** Sender's display name; null when the message was sent by the phone's user. */
    val senderName: String?,
    val text: String?,
    val timestampMs: Long,
)

/**
 * The parts of a posted notification relevant to messages, extracted on the phone from the
 * `StatusBarNotification` and `NotificationCompat.MessagingStyle`.
 */
public data class MessagingNotificationContent(
    /** `StatusBarNotification.key`: identifies the conversation's notification. */
    val key: String,
    val packageName: String,
    /** The app's user-visible name, e.g. "WhatsApp". */
    val appLabel: String?,
    val postTimeMs: Long,
    val category: String?,
    val isGroupSummary: Boolean,
    val isOngoing: Boolean,
    val title: String?,
    val text: String?,
    val conversationTitle: String? = null,
    val isGroupConversation: Boolean = false,
    /** MessagingStyle messages, oldest first; empty when the notification has no MessagingStyle. */
    val messages: List<StyleMessage> = emptyList(),
    /** The user's own display name in the conversation (MessagingStyle user). */
    val selfName: String? = null,
)

/**
 * An incoming message. [spokenText] stays on the phone (it is read aloud there); only the sender
 * reaches the HUD, via [toPhoneMessage].
 */
public class IncomingMessage(
    /** Stable per message: re-posts of the same notification state get the same id. */
    public val id: String,
    public val sender: String,
    public val app: String?,
    public val spokenText: String?,
    public val receivedAtMs: Long,
) {
    /** The HUD message: sender and app only, by construction. */
    public fun toPhoneMessage(readingAloud: Boolean): PhoneMessage =
        PhoneMessage(id = id, sender = sender, app = app, readingAloud = readingAloud)

    // Content never appears in logs.
    override fun toString(): String = "IncomingMessage(id=$id, sender=$sender, app=$app)"

    override fun equals(other: Any?): Boolean =
        other is IncomingMessage && other.id == id && other.sender == sender && other.app == app &&
            other.spokenText == spokenText && other.receivedAtMs == receivedAtMs

    override fun hashCode(): Int = id.hashCode()
}

/**
 * Recognises message notifications and extracts who sent them.
 *
 * - Group summaries ("5 messages from 3 chats"), ongoing notifications ("Checking for new
 *   messages…", active calls), calls and navigation are ignored.
 * - A notification counts as a message when it uses `MessagingStyle`, has category `msg`, or
 *   comes from a known messaging app.
 * - The sender is the author of the latest MessagingStyle message ("Alice @ Family" in group
 *   chats), else the title with counters like " (2 messages)" removed. A latest message written
 *   by the user (a reply shown in the notification) yields nothing.
 * - Notifications whose latest message is older than [maxAgeMs] are ignored, so reconnecting the
 *   listener does not replay old messages.
 */
public class MessagingNotificationExtractor(
    private val ignoredPackages: Set<String> = emptySet(),
    private val maxAgeMs: Long = 2 * 60_000L,
    private val messagingPackages: Set<String> = KNOWN_MESSAGING_APPS,
) {
    public fun extract(content: MessagingNotificationContent, nowMs: Long): IncomingMessage? {
        if (content.packageName in ignoredPackages) return null
        if (content.isGroupSummary || content.isOngoing) return null
        if (content.category in NON_MESSAGE_CATEGORIES) return null
        val hasStyle = content.messages.isNotEmpty()
        if (!hasStyle && content.category != CATEGORY_MESSAGE && content.packageName !in messagingPackages) return null

        val latest = content.messages.maxByOrNull { it.timestampMs }
        val receivedAt = latest?.timestampMs?.takeIf { it > 0 } ?: content.postTimeMs
        if (nowMs - receivedAt > maxAgeMs) return null

        val sender: String
        val spoken: String?
        if (latest != null) {
            val author = latest.senderName?.trim()?.ifEmpty { null } ?: return null
            if (content.selfName != null && author == content.selfName.trim()) return null
            val conversation = content.conversationTitle?.trim()?.ifEmpty { null }
            sender =
                if (content.isGroupConversation && conversation != null && conversation != author) {
                    "$author @ $conversation"
                } else {
                    author
                }
            spoken = latest.text
        } else {
            val title = content.title?.let(::stripCounters)?.trim()?.ifEmpty { null } ?: return null
            if (isSummary(title) || (content.text != null && isSummary(content.text))) return null
            if (content.appLabel != null && title.equals(content.appLabel.trim(), ignoreCase = true)) return null
            sender = title
            spoken = content.text
        }
        if (isSummary(sender)) return null

        val id =
            "msg-" +
                digest(
                    content.packageName,
                    content.key,
                    (latest?.timestampMs ?: 0L).toString(),
                    sender,
                    spoken.orEmpty(),
                )
        return IncomingMessage(
            id = id,
            sender = sender,
            app = content.appLabel?.trim()?.ifEmpty { null },
            spokenText = spoken?.trim()?.ifEmpty { null }?.take(MAX_SPOKEN_CHARS),
            receivedAtMs = receivedAt,
        )
    }

    public companion object {
        public const val CATEGORY_MESSAGE: String = "msg"
        private const val MAX_SPOKEN_CHARS = 500

        private val NON_MESSAGE_CATEGORIES =
            setOf(
                "call", "navigation", "transport", "service", "progress", "sys", "alarm", "email", "stopwatch",
                "location_sharing",
            )

        /** Package names of common messaging apps (used when an app sets no category or style). */
        public val KNOWN_MESSAGING_APPS: Set<String> =
            setOf(
                "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger", "org.telegram.messenger.web",
                "org.thunderdog.challegram", "org.thoughtcrime.securesms", "com.google.android.apps.messaging",
                "com.samsung.android.messaging", "com.android.mms", "com.facebook.orca", "com.facebook.mlite",
                "com.discord", "com.Slack", "com.microsoft.teams", "com.viber.voip", "jp.naver.line.android",
                "com.tencent.mm", "com.skype.raider", "im.vector.app", "ch.threema.app",
                "com.google.android.apps.dynamite", "com.kakao.talk", "com.textra", "chat.simplex.app",
            )

        /** Summaries such as "3 new messages" or "5 Nachrichten aus 2 Chats" (English, German). */
        private val SUMMARY =
            listOf(
                Regex("^\\d+\\s+(new\\s+)?messages?(\\s+from\\s+\\d+\\s+(chats?|conversations?))?$"),
                Regex("^\\d+\\s+(neue\\s+)?nachrichten?(\\s+(aus|in|von)\\s+\\d+\\s+(chats?|unterhaltungen))?$"),
                Regex("^\\d+\\s+unread\\s+messages?$"),
                Regex("^\\d+\\s+ungelesene\\s+nachrichten?$"),
            )

        /** " (2 messages)", " (3 new messages)", " (2 Nachrichten)" suffixes on titles. */
        private val COUNTER_SUFFIX =
            Regex("\\s*\\(\\d+\\s+(new\\s+|neue\\s+)?(messages?|nachrichten?)\\)$", RegexOption.IGNORE_CASE)

        internal fun isSummary(text: String): Boolean {
            val lower = text.trim().lowercase(Locale.ROOT)
            return SUMMARY.any { it.matches(lower) }
        }

        internal fun stripCounters(title: String): String = title.replace(COUNTER_SUFFIX, "")

        private fun digest(vararg parts: String): String {
            val sha = MessageDigest.getInstance("SHA-256")
            for (part in parts) {
                sha.update(part.toByteArray(Charsets.UTF_8))
                sha.update(0)
            }
            return sha.digest().take(10).joinToString("") { String.format(Locale.ROOT, "%02x", it) }
        }
    }
}

/**
 * Remembers recently announced message ids so a notification that is re-posted (edited, re-alerted,
 * or replayed when the listener reconnects) is neither announced nor read aloud twice.
 */
public class RecentMessageIds(private val capacity: Int = 256, private val ttlMs: Long = 30 * 60_000L) {
    private val seen = LinkedHashMap<String, Long>()

    /** True the first time [id] is seen within the TTL; records it. */
    @Synchronized
    public fun firstSeen(id: String, nowMs: Long): Boolean {
        seen.entries.removeAll { nowMs - it.value > ttlMs || nowMs < it.value - ttlMs }
        if (seen.containsKey(id)) return false
        seen[id] = nowMs
        while (seen.size > capacity) seen.remove(seen.keys.first())
        return true
    }
}
