package dev.carheadsup.companion.service

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import dev.carheadsup.companion.AppGraph
import dev.carheadsup.companion.BuildConfig
import dev.carheadsup.companion.CompanionApp
import dev.carheadsup.companion.hud.LinkStatus
import dev.carheadsup.companion.location.LocationFeed
import dev.carheadsup.companion.media.MediaMonitor
import dev.carheadsup.companion.road.RoadInfoProvider
import dev.carheadsup.companion.traffic.TrafficProvider
import dev.carheadsup.protocol.link.MonitorPolicy
import dev.carheadsup.protocol.traffic.TomTomTraffic
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Foreground service (types `connectedDevice` + `location`) that keeps the HUD link, media and
 * call monitoring alive, and GPS, road and traffic look-ups while the HUD is connected (plus a
 * two-minute hold, see [MonitorPolicy]) — so it can stay on all day without draining the
 * battery. Started from the app, and at boot or after an app update when the user left it on
 * ([BootReceiver]: then without the location type, which Android does not grant a service
 * started in the background; opening the app adds it). The notification offers "Stop". Sticky,
 * so the system restarts it after killing the process; when Android refuses that, a "HUD link
 * stopped" notification says so (tapping it opens the app, which restarts the service).
 */
class HudConnectionService : Service() {
    private lateinit var graph: AppGraph
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var media: MediaMonitor? = null
    private var locationFeed: LocationFeed? = null
    private var road: RoadInfoProvider? = null
    private var traffic: TrafficProvider? = null
    private var hasLocationType = false
    private val monitorPolicy = MonitorPolicy()

    /** Stops the monitors when the hold after a disconnect ends. */
    private var holdTimer: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        graph = (application as CompanionApp).graph
        if (!enterForeground(withLocation = !startingInBackground)) {
            startingInBackground = false
            graph.notifier.linkStopped()
            stopSelf()
            return
        }
        startingInBackground = false
        graph.notifier.cancelLinkStopped()
        running.value = true
        graph.link.start()
        media = MediaMonitor(this) { graph.hub.publish(it) }
        refreshMonitors()

        scope.launch {
            // RTT updates would re-post the notification every ping; only the text matters.
            graph.link.status
                .map { status -> if (status is LinkStatus.Connected) status.copy(rttMs = null) else status }
                .distinctUntilChanged()
                .collect { graph.notifier.updateLink(it) }
        }
        scope.launch {
            // GPS, road and traffic look-ups only feed the HUD: run them while it is connected.
            graph.link.status
                .map { it is LinkStatus.Connected }
                .distinctUntilChanged()
                .collect { connected -> onLinkChanged(connected) }
        }
        scope.launch {
            // Media sessions become readable as soon as notification access is granted.
            graph.listenerConnected.collect { connected -> if (connected) media?.start() }
        }
        scope.launch {
            graph.settings
                .map { listOf(it.shareLocation, it.osmLookups, it.trafficEnabled, it.trafficApiKey) }
                .distinctUntilChanged()
                .collect { refreshMonitors() }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                graph.settingsStore.update { it.copy(serviceEnabled = false) }
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_REFRESH -> {
                // From the app in the foreground: permissions may have been granted since the start
                // (or it started at boot, without the location type) — upgrade the type and monitors.
                if (!hasLocationType && locationGranted()) enterForeground(withLocation = true)
                refreshMonitors()
                graph.link.reconnectNow()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        holdTimer = null
        media?.stop()
        locationFeed?.stop()
        road?.stop()
        traffic?.stop()
        traffic = null
        if (::graph.isInitialized) {
            graph.trafficStatus.value = graph.idleTrafficStatus()
            graph.calls.stop()
            graph.link.stop()
            graph.releaseMessageReader()
        }
        running.value = false
        super.onDestroy()
    }

    /** The HUD link went up or down: start the monitors, or stop them once the hold ends. */
    private fun onLinkChanged(connected: Boolean) {
        val now = SystemClock.elapsedRealtime()
        monitorPolicy.onLink(connected, now)
        holdTimer?.cancel()
        holdTimer = null
        monitorPolicy.stopsAt()?.let { stopsAt ->
            holdTimer =
                scope.launch {
                    delay((stopsAt - now).coerceAtLeast(0))
                    refreshMonitors()
                }
        }
        refreshMonitors()
    }

    /**
     * Starts whatever the granted permissions and settings allow, and — GPS, road and traffic —
     * only while the HUD link is up or within its hold ([MonitorPolicy]); stops the rest.
     * Idempotent.
     */
    private fun refreshMonitors() {
        graph.calls.start()
        media?.start()

        val settings = graph.settings.value
        val linked = monitorPolicy.shouldRun(SystemClock.elapsedRealtime())
        val trafficKey = settings.trafficApiKey.trim()
        val wantTraffic = linked && settings.trafficEnabled && TomTomTraffic.isPlausibleKey(trafficKey)
        val wantRoad = linked && settings.osmLookups
        val wantLocation = linked && (settings.shareLocation || settings.osmLookups || wantTraffic)
        if (wantRoad && road == null) {
            road =
                RoadInfoProvider(
                    scope = graph.scope,
                    client = graph.internetClient,
                    cacheDir = cacheDir,
                    userAgent = "carheadsup-companion/${BuildConfig.VERSION_NAME}",
                    camerasEnabled = { graph.settings.value.cameraWarnings },
                    hazards = graph.hazards,
                    publish = { graph.hub.publish(it) },
                )
        } else if (!wantRoad && road != null) {
            road?.stop()
            road = null
        }
        // A new key starts afresh (a key the service refused stays refused until it changes).
        if (wantTraffic && traffic?.apiKey != trafficKey) {
            traffic?.stop()
            traffic =
                TrafficProvider(
                    scope = graph.scope,
                    client = graph.internetClient,
                    apiKey = trafficKey,
                    budgetStore = graph.trafficBudget,
                    hazards = graph.hazards,
                    onStatus = { graph.trafficStatus.value = it },
                )
        } else if (!wantTraffic && traffic != null) {
            traffic?.stop()
            traffic = null
        }
        if (traffic == null) graph.trafficStatus.value = graph.idleTrafficStatus()
        if (wantLocation && locationFeed == null && hasLocationType) {
            val feed = LocationFeed(this, ::onLocation)
            if (feed.start()) locationFeed = feed
        } else if (!wantLocation) {
            locationFeed?.stop()
            locationFeed = null
        }
    }

    private fun onLocation(location: Location) {
        val settings = graph.settings.value
        if (settings.shareLocation) graph.hub.publish(LocationFeed.toPhoneLocation(location))
        if (settings.osmLookups) road?.onLocation(location)
        traffic?.onLocation(location)
    }

    /**
     * Enters (or updates) the foreground state. The location type is only claimed when asked
     * for ([withLocation]: not when started in the background) and the permission is granted —
     * Android 14 throws otherwise; if claiming it fails anyway (the app was started from the
     * background), the service continues without GPS.
     */
    private fun enterForeground(withLocation: Boolean): Boolean {
        val notification = graph.notifier.linkNotification(graph.link.status.value)
        val claimLocation = withLocation && locationGranted()
        return try {
            ServiceCompat.startForeground(this, Notifier.ID_LINK, notification, foregroundTypes(claimLocation))
            hasLocationType = claimLocation
            true
        } catch (e: SecurityException) {
            if (!claimLocation) return false
            try {
                ServiceCompat.startForeground(this, Notifier.ID_LINK, notification, foregroundTypes(false))
                hasLocationType = false
                true
            } catch (again: RuntimeException) {
                Log.e(TAG, "Cannot enter the foreground", again)
                false
            }
        } catch (e: IllegalStateException) {
            // ForegroundServiceStartNotAllowedException: started from the background (Android 12+).
            Log.w(TAG, "Foreground start not allowed", e)
            false
        }
    }

    private fun foregroundTypes(withLocation: Boolean): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        if (withLocation) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        return types
    }

    private fun locationGranted(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    companion object {
        private const val TAG = "HudConnectionService"
        const val ACTION_STOP = "dev.carheadsup.companion.action.STOP"
        const val ACTION_REFRESH = "dev.carheadsup.companion.action.REFRESH"

        private val running = MutableStateFlow(false)

        /**
         * The next start comes from the background (boot, app update): claim only the
         * `connectedDevice` type. Read once by [onCreate] (one process; the service is a singleton).
         */
        @Volatile
        private var startingInBackground = false

        /** Whether the service is currently running. */
        val isRunning: StateFlow<Boolean> = running.asStateFlow()

        /** Starts the service from the foreground (an activity); false if Android refuses. */
        fun start(context: Context): Boolean = try {
            ContextCompat.startForegroundService(context, Intent(context, HudConnectionService::class.java))
            true
        } catch (e: IllegalStateException) {
            Log.w(TAG, "Cannot start the service", e)
            false
        }

        /**
         * Starts the service from the background — at boot or after an app update, which Android
         * allows — without the location type; false if Android refuses.
         */
        fun startInBackground(context: Context): Boolean {
            if (running.value) return true
            startingInBackground = true
            return try {
                ContextCompat.startForegroundService(context, Intent(context, HudConnectionService::class.java))
                true
            } catch (e: IllegalStateException) {
                startingInBackground = false
                Log.w(TAG, "Cannot start the service in the background", e)
                false
            }
        }

        /** Re-evaluates permissions and monitors of a running service. */
        fun refresh(context: Context) {
            if (!running.value) return
            try {
                context.startService(Intent(context, HudConnectionService::class.java).setAction(ACTION_REFRESH))
            } catch (e: IllegalStateException) {
                Log.w(TAG, "Cannot refresh the service", e)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, HudConnectionService::class.java))
        }
    }
}
