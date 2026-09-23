package dev.carheadsup.companion

import android.app.Application
import android.os.Build
import android.provider.Settings
import android.text.format.DateFormat
import android.util.Log
import dev.carheadsup.companion.calls.CallMonitor
import dev.carheadsup.companion.data.SettingsStore
import dev.carheadsup.companion.data.TripStore
import dev.carheadsup.companion.hud.HudApi
import dev.carheadsup.companion.hud.HudApiException
import dev.carheadsup.companion.hud.HudDiscovery
import dev.carheadsup.companion.hud.HudLink
import dev.carheadsup.companion.hud.LocalNetwork
import dev.carheadsup.companion.hud.PhoneHub
import dev.carheadsup.companion.notifications.MessageRelay
import dev.carheadsup.companion.service.Notifier
import dev.carheadsup.companion.speech.MessageReader
import dev.carheadsup.protocol.HudCallAction
import dev.carheadsup.protocol.HudMaintenanceDue
import dev.carheadsup.protocol.HudToPhone
import dev.carheadsup.protocol.HudTripCompleted
import dev.carheadsup.protocol.HudTrips
import dev.carheadsup.protocol.HudWelcome
import dev.carheadsup.protocol.PhoneMessages
import dev.carheadsup.protocol.api.DisplayUnits
import dev.carheadsup.protocol.api.FuelEconomyUnit
import dev.carheadsup.protocol.api.TripFormatter
import dev.carheadsup.protocol.api.UnitSystem
import dev.carheadsup.protocol.link.HudEndpoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.io.File
import java.time.ZoneId
import java.util.Currency
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * The app's long-lived objects, shared by the activity, the connection service and the
 * notification listener (all in one process). Created once in [CompanionApp].
 */
class AppGraph(private val app: Application) {
    /** Lives as long as the process. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val settingsStore = SettingsStore(app)
    val settings = settingsStore.settings
    val hub = PhoneHub()
    val trips = TripStore(File(app.filesDir, "trips.json"))
    val notifier = Notifier(app)

    /** True while the system has our notification listener bound (notification access granted). */
    val listenerConnected = MutableStateFlow(false)

    val localNetwork = LocalNetwork(app)
    val discovery = HudDiscovery(app)

    /** WebSocket client: no read timeout (the heartbeat detects dead links), transport pings as a backstop. */
    private val socketClient =
        OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(15, TimeUnit.SECONDS)
            .build()

    /** REST client for the HUD (bound to its Wi-Fi per call). */
    private val hudHttpClient =
        socketClient.newBuilder()
            .pingInterval(0, TimeUnit.MILLISECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .callTimeout(20, TimeUnit.SECONDS)
            .build()

    /** Internet client (Overpass): default network, generous timeouts for big tiles. */
    val internetClient: OkHttpClient =
        socketClient.newBuilder()
            .pingInterval(0, TimeUnit.MILLISECONDS)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .callTimeout(90, TimeUnit.SECONDS)
            .build()

    val calls = CallMonitor(app) { call -> hub.publish(call) }

    val link =
        HudLink(
            scope = scope,
            baseClient = socketClient,
            localNetwork = localNetwork,
            discovery = discovery,
            hub = hub,
            settings = settings,
            deviceName = deviceName(),
            appVersion = BuildConfig.VERSION_NAME,
            onConnected = ::onConnected,
            onMessage = ::onHudMessage,
        )

    val api =
        HudApi(client = {
            localNetwork.bind(hudHttpClient)
        }, endpoint = ::currentEndpoint, apiToken = { settings.value.apiToken })

    private val unitsState = MutableStateFlow(defaultUnits(Locale.getDefault()))

    /** The driver's units (from the HUD's config once connected; locale defaults until then). */
    val units: StateFlow<DisplayUnits> = unitsState

    private var reader: MessageReader? = null

    val messageRelay = MessageRelay(hub, link.status, settings, ::messageReader)

    /** The HUD to talk to for REST: the manual address, else the last or discovered one. */
    fun currentEndpoint(): HudEndpoint? = settings.value.manualEndpoint ?: link.lastEndpoint ?: discovery.endpoint.value

    @Synchronized
    fun messageReader(): MessageReader = reader ?: MessageReader(app).also { reader = it }

    @Synchronized
    fun releaseMessageReader() {
        reader?.shutdown()
        reader = null
    }

    fun formatter(): TripFormatter =
        TripFormatter(units.value, Locale.getDefault(), ZoneId.systemDefault(), DateFormat.is24HourFormat(app))

    private suspend fun onConnected(welcome: HudWelcome) {
        Log.i(TAG, "Connected to ${welcome.hudName} ${welcome.hudVersion}")
        // Catch up on trips that ended while we were away, and learn the driver's units.
        hub.publish(PhoneMessages.tripsRequest(trips.syncCursor))
        scope.launch {
            try {
                unitsState.value = api.units()
            } catch (e: HudApiException) {
                Log.i(TAG, "Units unavailable (${e.message}); keeping ${units.value}")
            }
        }
    }

    private suspend fun onHudMessage(message: HudToPhone) {
        when (message) {
            is HudCallAction -> calls.handleAction(message)?.let { failure ->
                Log.w(TAG, "Call ${message.action} not done: $failure")
            }

            is HudTrips -> trips.merge(message.trips)

            is HudTripCompleted -> {
                trips.merge(listOf(message.trip))
                notifier.tripLogged(message.trip, formatter())
            }

            is HudMaintenanceDue -> notifier.maintenanceDue(message, formatter())

            else -> Log.d(TAG, "Unhandled HUD message ${message.javaClass.simpleName}")
        }
    }

    private fun deviceName(): String {
        val name = Settings.Global.getString(app.contentResolver, Settings.Global.DEVICE_NAME)
        return name?.takeIf { it.isNotBlank() } ?: "${Build.MANUFACTURER} ${Build.MODEL}"
    }

    companion object {
        private const val TAG = "AppGraph"

        /** Units the phone's locale suggests, used until the HUD's configuration is known. */
        fun defaultUnits(locale: Locale): DisplayUnits {
            val currency =
                try {
                    Currency.getInstance(locale).currencyCode
                } catch (e: IllegalArgumentException) {
                    "EUR"
                }
            return when (locale.country) {
                "US", "LR", "MM" -> DisplayUnits(UnitSystem.IMPERIAL, FuelEconomyUnit.MPG_US, currency)
                "GB" -> DisplayUnits(UnitSystem.IMPERIAL, FuelEconomyUnit.MPG_UK, currency)
                else -> DisplayUnits(UnitSystem.METRIC, FuelEconomyUnit.L_PER_100KM, currency)
            }
        }
    }
}
