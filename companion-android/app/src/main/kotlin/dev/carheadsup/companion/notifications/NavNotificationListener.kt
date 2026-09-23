package dev.carheadsup.companion.notifications

import android.content.ComponentName
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.telephony.TelephonyManager
import android.util.Log
import dev.carheadsup.companion.AppGraph
import dev.carheadsup.companion.CompanionApp
import dev.carheadsup.protocol.PhoneMessages
import dev.carheadsup.protocol.messaging.MessagingNotificationExtractor
import dev.carheadsup.protocol.nav.DrivingSide
import dev.carheadsup.protocol.nav.GoogleMapsNotificationParser
import dev.carheadsup.protocol.nav.NavLanguages
import java.time.Clock
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
 * - the dialer's incoming-call notification → caller name for the call card.
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

    private val endNavigation = Runnable { runOnWorker { publishNavigationEnded() } }

    override fun onCreate() {
        super.onCreate()
        graph = (application as CompanionApp).graph
        worker = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "notification-listener") }
        parser =
            GoogleMapsNotificationParser(
                NavLanguages.preferring(Locale.getDefault()),
                DrivingSide.forCountry(countryCode()),
            )
        iconEncoder = ManeuverIconEncoder(this)
        extractor =
            MessagingNotificationExtractor(
                ignoredPackages = setOf(packageName, GoogleMapsNotificationParser.GOOGLE_MAPS_PACKAGE),
            )
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(endNavigation)
        worker.shutdownNow()
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
        }
    }

    override fun onListenerDisconnected() {
        graph.listenerConnected.value = false
        // Ask the system to bind us again (it unbinds listeners e.g. after the app was updated).
        NotificationListenerService.requestRebind(ComponentName(this, NavNotificationListener::class.java))
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val notification = sbn ?: return
        runOnWorker { handlePosted(notification) }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
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

            else -> {
                NotificationContent.callerName(sbn)?.let { graph.calls.onCallerHint(it) }
                val content = NotificationContent.messaging(this, sbn)
                extractor.extract(content, System.currentTimeMillis())?.let(graph.messageRelay::onIncoming)
            }
        }
    }

    private fun handleMaps(sbn: StatusBarNotification) {
        val nav = parser.parse(NotificationContent.nav(sbn), Clock.systemDefaultZone()) ?: return
        mainHandler.removeCallbacks(endNavigation)
        navActive = true
        navKey = sbn.key
        val icon = iconEncoder.encode(sbn.notification.getLargeIcon())
        graph.hub.publish(nav.copy(iconPng = icon))
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
    }
}
