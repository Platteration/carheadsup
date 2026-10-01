package dev.carheadsup.companion.notifications

import android.content.ComponentName
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.telephony.TelephonyManager
import android.util.Log
import dev.carheadsup.companion.AppGraph
import dev.carheadsup.companion.CompanionApp
import dev.carheadsup.protocol.PhoneMessages
import dev.carheadsup.protocol.messaging.MessagingNotificationExtractor
import dev.carheadsup.protocol.nav.AndroidAuto
import dev.carheadsup.protocol.nav.DrivingSide
import dev.carheadsup.protocol.nav.GoogleMapsNotificationParser
import dev.carheadsup.protocol.nav.NavCaptureLog
import dev.carheadsup.protocol.nav.NavLanguages
import dev.carheadsup.protocol.nav.NavNotificationContent
import java.time.Clock
import java.time.ZoneId
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * Reads other apps' notifications (the user grants "notification access"):
 * - Google Maps' ongoing guidance notification → `nav` (with the maneuver icon as PNG);
 *   guidance ends when the notification has been gone for [NAV_END_DELAY_MS] — Maps briefly
 *   removes and re-posts it during normal guidance;
 * - message notifications → sender to the HUD, content read aloud on the phone ([MessageRelay]);
 * - the dialer's incoming-call notification → caller name for the call card;
 * - Android Auto's ongoing notification → whether it projects ([AppGraph.refreshProjection]).
 *
 * How well Maps' notifications are understood is counted for the Status screen, a notification
 * not understood is logged (its language and the lengths of its texts, never the texts), and
 * with the capture switched on (Setup) Maps' notifications are kept as parser test cases
 * ([dev.carheadsup.companion.data.NavCaptureStore]).
 *
 * Being the enabled listener also authorises [dev.carheadsup.companion.media.MediaMonitor] to read
 * the active media sessions. Work happens on a single worker thread.
 */
class NavNotificationListener : NotificationListenerService() {
    private lateinit var graph: AppGraph
    private lateinit var worker: ExecutorService
    private lateinit var parser: GoogleMapsNotificationParser
    private lateinit var iconEncoder: ManeuverIconEncoder
    private lateinit var extractor: MessagingNotificationExtractor
    private val mainHandler = Handler(Looper.getMainLooper())

    /** Worker-thread state: whether we told the HUD that guidance is active, and by which notification. */
    private var navActive = false
    private var navKey: String? = null

    /** Worker-thread state: the driving side where the phone is, and when it was last looked up. */
    private var cachedDrivingSide = DrivingSide.RIGHT
    private var drivingSideCheckedAt: Long? = null

    /** Worker-thread state: when a notification Maps' parser did not understand was last logged. */
    private var notUnderstoodLoggedAt: Long? = null

    private val endNavigation = Runnable { runOnWorker { publishNavigationEnded() } }

    override fun onCreate() {
        super.onCreate()
        graph = (application as CompanionApp).graph
        worker = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "notification-listener") }
        parser = GoogleMapsNotificationParser(NavLanguages.preferring(Locale.getDefault()))
        iconEncoder = ManeuverIconEncoder(this)
        extractor =
            MessagingNotificationExtractor(
                ignoredPackages = setOf(packageName, GoogleMapsNotificationParser.GOOGLE_MAPS_PACKAGE),
            )
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(endNavigation)
        worker.shutdownNow()
        // Nobody would see guidance end any more (the pending end above is cancelled too): do
        // not leave the last arrow on the HUD. A new listener re-reads Maps when it connects.
        if (graph.hub.latestNav()?.active == true) {
            graph.hub.publish(PhoneMessages.navEnded(PhoneMessages.SOURCE_GOOGLE_MAPS))
        }
        super.onDestroy()
    }

    override fun onListenerConnected() {
        graph.listenerConnected.value = true
        // Guidance that was already running (Maps may not re-post for a while when stationary).
        runOnWorker {
            val active =
                try {
                    activeNotifications.orEmpty()
                } catch (e: SecurityException) {
                    emptyArray()
                }
            active.filter { it.packageName == GoogleMapsNotificationParser.GOOGLE_MAPS_PACKAGE }.forEach(::handleMaps)
            updateAndroidAuto(active)
            // Guidance published before the listener was unbound that has ended meanwhile.
            if (!navActive && graph.hub.latestNav()?.active == true) {
                graph.hub.publish(PhoneMessages.navEnded(PhoneMessages.SOURCE_GOOGLE_MAPS))
            }
        }
    }

    override fun onListenerDisconnected() {
        graph.listenerConnected.value = false
        // No more notification events: guidance can no longer be followed, so end it rather than
        // leave a frozen arrow on the HUD (it is picked up again on reconnection).
        mainHandler.removeCallbacks(endNavigation)
        runOnWorker { publishNavigationEnded() }
        // Ask the system to bind us again (it unbinds listeners e.g. after the app was updated).
        NotificationListenerService.requestRebind(ComponentName(this, NavNotificationListener::class.java))
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val notification = sbn ?: return
        runOnWorker { handlePosted(notification) }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        if (sbn?.packageName == AndroidAuto.PACKAGE) {
            runOnWorker { updateAndroidAuto(activeOrEmpty()) }
            return
        }
        if (sbn?.packageName != GoogleMapsNotificationParser.GOOGLE_MAPS_PACKAGE) return
        runOnWorker {
            if (navActive && sbn.key == navKey) {
                mainHandler.removeCallbacks(endNavigation)
                mainHandler.postDelayed(endNavigation, NAV_END_DELAY_MS)
            }
        }
    }

    private fun handlePosted(sbn: StatusBarNotification) {
        when (sbn.packageName) {
            packageName -> return

            GoogleMapsNotificationParser.GOOGLE_MAPS_PACKAGE -> handleMaps(sbn)

            AndroidAuto.PACKAGE -> updateAndroidAuto(activeOrEmpty())

            else -> {
                NotificationContent.callerHint(sbn)?.let(graph.calls::onCallerHint)
                val content = NotificationContent.messaging(this, sbn)
                extractor.extract(content, System.currentTimeMillis())?.let(graph.messageRelay::onIncoming)
            }
        }
    }

    private fun handleMaps(sbn: StatusBarNotification) {
        val content = NotificationContent.nav(sbn)
        val side = drivingSide()
        val nav = parser.parse(content, Clock.systemDefaultZone(), side)
        graph.onNavParsed(content, nav, SystemClock.elapsedRealtime())
        if (graph.settings.value.navCapture) {
            val locale = Locale.getDefault().toLanguageTag()
            val zone = ZoneId.systemDefault().id
            graph.navCapture.record(NavCaptureLog.case(content, locale, zone, sbn.postTime, side, nav))
        }
        if (nav == null) {
            logNotUnderstood(content)
            return
        }
        mainHandler.removeCallbacks(endNavigation)
        navActive = true
        navKey = sbn.key
        val icon = iconEncoder.encode(sbn.notification.getLargeIcon())
        graph.hub.publish(nav.copy(iconPng = icon))
    }

    /**
     * A navigation notification Maps' parser did not understand: log what may explain it — the
     * phone's language and the shape of the notification — but never its text (the streets and
     * destination of the drive). At most once a minute: Maps re-posts every second.
     */
    private fun logNotUnderstood(content: NavNotificationContent) {
        if (content.category != GoogleMapsNotificationParser.CATEGORY_NAVIGATION) return
        val now = SystemClock.elapsedRealtime()
        val last = notUnderstoodLoggedAt
        if (last != null && now - last < NOT_UNDERSTOOD_LOG_MS) return
        notUnderstoodLoggedAt = now
        fun length(text: String?): String = text?.length?.toString() ?: "-"
        Log.i(
            TAG,
            "Maps guidance not understood (language ${Locale.getDefault().toLanguageTag()}; " +
                "title ${length(content.title)}, text ${length(content.text)}, " +
                "subText ${length(content.subText)}, bigText ${length(content.bigText)}, " +
                "chip ${length(content.shortCriticalText)} characters). " +
                "Capture it in Setup to make a test case.",
        )
    }

    /** Whether Android Auto's ongoing notification is among [active]; then re-check projection. */
    private fun updateAndroidAuto(active: Array<StatusBarNotification>) {
        graph.androidAutoNotification = active.any { it.packageName == AndroidAuto.PACKAGE && it.isOngoing }
        graph.refreshProjection()
    }

    private fun activeOrEmpty(): Array<StatusBarNotification> = try {
        activeNotifications.orEmpty()
    } catch (e: SecurityException) {
        emptyArray()
    }

    private fun publishNavigationEnded() {
        if (!navActive) return
        navActive = false
        navKey = null
        graph.hub.publish(PhoneMessages.navEnded(PhoneMessages.SOURCE_GOOGLE_MAPS))
    }

    private fun runOnWorker(block: () -> Unit) {
        try {
            worker.execute {
                try {
                    block()
                } catch (e: RuntimeException) {
                    // One odd notification must never take the listener down.
                    Log.e(TAG, "Failed to process a notification", e)
                }
            }
        } catch (e: RejectedExecutionException) {
            // Shutting down.
        }
    }

    /**
     * The driving side where the phone is now. Looked up again every minute rather than once:
     * the listener lives as long as the process, and a drive can cross into a country that
     * drives on the other side (France → UK).
     */
    private fun drivingSide(): DrivingSide {
        val now = SystemClock.elapsedRealtime()
        val checkedAt = drivingSideCheckedAt
        if (checkedAt == null || now - checkedAt >= DRIVING_SIDE_REFRESH_MS) {
            cachedDrivingSide = DrivingSide.forCountry(countryCode())
            drivingSideCheckedAt = now
        }
        return cachedDrivingSide
    }

    /** Where the phone is (for the driving side): the mobile network's country, else the locale's. */
    private fun countryCode(): String? {
        val telephony = getSystemService(TelephonyManager::class.java)
        val network = telephony?.networkCountryIso?.takeIf { it.length == 2 }
        val sim = telephony?.simCountryIso?.takeIf { it.length == 2 }
        return network ?: sim ?: Locale.getDefault().country.takeIf { it.length == 2 }
    }

    private companion object {
        const val TAG = "NavNotificationListener"
        const val NAV_END_DELAY_MS = 10_000L
        const val DRIVING_SIDE_REFRESH_MS = 60_000L
        const val NOT_UNDERSTOOD_LOG_MS = 60_000L
    }
}
