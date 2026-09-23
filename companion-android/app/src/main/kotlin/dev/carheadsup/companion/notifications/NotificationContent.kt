package dev.carheadsup.companion.notifications

import android.app.Notification
import android.app.Person
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import dev.carheadsup.protocol.messaging.MessagingNotificationContent
import dev.carheadsup.protocol.messaging.StyleMessage
import dev.carheadsup.protocol.nav.NavNotificationContent
import dev.carheadsup.protocol.phone.CallHintType
import dev.carheadsup.protocol.phone.CallerHint

/** Converts posted notifications into the pure-Kotlin inputs of the :protocol parsers. */
internal object NotificationContent {
    /** Android 16 Live Update status-chip text (`Notification.EXTRA_SHORT_CRITICAL_TEXT`). */
    private const val EXTRA_SHORT_CRITICAL_TEXT = "android.shortCriticalText"

    /** The posting app's ApplicationInfo, added to every notification's extras by the system. */
    private const val EXTRA_APP_INFO = "android.appInfo"

    /** `Notification.EXTRA_CALL_TYPE` and the `Notification.CallStyle.CALL_TYPE_*` values (API 31). */
    private const val EXTRA_CALL_TYPE = "android.callType"
    private const val CALL_TYPE_UNKNOWN = 0
    private const val CALL_TYPE_INCOMING = 1
    private const val CALL_TYPE_ONGOING = 2
    private const val TEL_SCHEME = "tel:"

    fun nav(sbn: StatusBarNotification): NavNotificationContent {
        val notification = sbn.notification
        val extras = notification.extras
        return NavNotificationContent(
            packageName = sbn.packageName,
            title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
            text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
            subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString(),
            bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
            shortCriticalText = extras.getCharSequence(EXTRA_SHORT_CRITICAL_TEXT)?.toString(),
            category = notification.category,
            isOngoing = sbn.isOngoing,
        )
    }

    fun messaging(context: Context, sbn: StatusBarNotification): MessagingNotificationContent {
        val notification = sbn.notification
        val extras = notification.extras
        val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)
        return MessagingNotificationContent(
            key = sbn.key,
            packageName = sbn.packageName,
            appLabel = appLabel(context, sbn),
            postTimeMs = sbn.postTime,
            category = notification.category,
            isGroupSummary = notification.flags and Notification.FLAG_GROUP_SUMMARY != 0,
            isOngoing = sbn.isOngoing,
            title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
            text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
            conversationTitle = style?.conversationTitle?.toString(),
            isGroupConversation = style?.isGroupConversation ?: false,
            messages =
            style?.messages.orEmpty().map { message ->
                StyleMessage(
                    senderName = message.person?.name?.toString(),
                    text = message.text?.toString(),
                    timestampMs = message.timestamp,
                )
            },
            selfName = style?.user?.name?.toString(),
            hasReplyAction = notification.actions?.any { action -> !action.remoteInputs.isNullOrEmpty() } == true,
        )
    }

    /**
     * The caller named by a call notification (Android 12+ CallStyle), with the kind of call it
     * shows and the person's `tel:` number, if any. Any app's call notification qualifies (VoIP
     * apps post them too); [dev.carheadsup.protocol.phone.CallStateTracker] decides whether it
     * describes the tracked phone call.
     */
    fun callerHint(sbn: StatusBarNotification): CallerHint? {
        val notification = sbn.notification
        if (notification.category != Notification.CATEGORY_CALL) return null
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
        val extras = notification.extras
        val person: Person =
            (
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    extras.getParcelable(Notification.EXTRA_CALL_PERSON, Person::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    extras.getParcelable(Notification.EXTRA_CALL_PERSON) as? Person
                }
                ) ?: return null
        val name = person.name?.toString()?.trim()?.ifEmpty { null } ?: return null
        val number =
            person.uri
                ?.takeIf { it.startsWith(TEL_SCHEME, ignoreCase = true) }
                ?.substring(TEL_SCHEME.length)
                ?.let(Uri::decode)
        val type =
            when (extras.getInt(EXTRA_CALL_TYPE, CALL_TYPE_UNKNOWN)) {
                CALL_TYPE_INCOMING -> CallHintType.INCOMING
                CALL_TYPE_ONGOING -> CallHintType.ONGOING
                else -> CallHintType.UNKNOWN
            }
        return CallerHint(name, number, type)
    }

    /** "WhatsApp" for com.whatsapp: from the ApplicationInfo in the extras, else the package manager. */
    fun appLabel(context: Context, sbn: StatusBarNotification): String? {
        val pm = context.packageManager
        val info =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                sbn.notification.extras.getParcelable(EXTRA_APP_INFO, ApplicationInfo::class.java)
            } else {
                @Suppress("DEPRECATION")
                sbn.notification.extras.getParcelable(EXTRA_APP_INFO) as? ApplicationInfo
            }
        info?.let { return pm.getApplicationLabel(it).toString() }
        return appLabel(context, sbn.packageName)
    }

    fun appLabel(context: Context, packageName: String): String? = try {
        val pm = context.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
        null
    }
}
