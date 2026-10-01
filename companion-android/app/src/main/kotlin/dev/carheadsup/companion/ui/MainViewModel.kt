package dev.carheadsup.companion.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.carheadsup.companion.CompanionApp
import dev.carheadsup.companion.NavStatus
import dev.carheadsup.companion.data.CompanionSettings
import dev.carheadsup.companion.hud.HudApiException
import dev.carheadsup.companion.hud.LinkStatus
import dev.carheadsup.companion.service.HudConnectionService
import dev.carheadsup.protocol.InputAction
import dev.carheadsup.protocol.PhoneMessages
import dev.carheadsup.protocol.api.DisplayUnits
import dev.carheadsup.protocol.api.MaintenanceItemStatus
import dev.carheadsup.protocol.api.TripFormatter
import dev.carheadsup.protocol.api.TripRecord
import dev.carheadsup.protocol.auth.HudPin
import dev.carheadsup.protocol.link.HudAdvertisement
import dev.carheadsup.protocol.link.HudEndpoint
import dev.carheadsup.protocol.pairing.PairingAddress
import dev.carheadsup.protocol.pairing.PairingPayload
import dev.carheadsup.protocol.traffic.TrafficStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.ConcurrentHashMap

/** The HUD's settings page for the WebView: its address and the certificate it must present. */
data class HudPage(val url: String, val certFingerprint: String)

/** Loading state of data fetched from the HUD's REST API. */
sealed interface Remote<out T> {
    data object Idle : Remote<Nothing>

    data object Loading : Remote<Nothing>

    data class Loaded<T>(val value: T) : Remote<T>

    data class Failed(val message: String) : Remote<Nothing>
}

/** Where pairing by the HUD's QR code stands, for the Setup screen. */
sealed interface QrPairing {
    data object Idle : QrPairing

    /** A code was scanned; the phone is looking for the HUD at the code's addresses. */
    data class Pairing(val hudName: String?) : QrPairing

    /**
     * Paired: the token, the HUD's id and certificate are stored and [endpoint] is the HUD's
     * address — [reached] when the phone could open a connection to it just now (else it is not
     * on the car's Wi-Fi yet; the link keeps trying).
     */
    data class Paired(
        val hudName: String?,
        val endpoint: HudEndpoint,
        val certFingerprint: String,
        val reached: Boolean,
        val serviceStarted: Boolean,
    ) : QrPairing
}

/** UI state and actions of [MainActivity]. */
class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val graph = (application as CompanionApp).graph

    val settings: StateFlow<CompanionSettings> = graph.settings
    val linkStatus: StateFlow<LinkStatus> = graph.link.status
    val serviceRunning: StateFlow<Boolean> = HudConnectionService.isRunning
    val trips: StateFlow<List<TripRecord>> = graph.trips.trips
    val units: StateFlow<DisplayUnits> = graph.units
    val discovered: StateFlow<HudAdvertisement?> = graph.discovery.advertisement
    val trafficStatus: StateFlow<TrafficStatus> = graph.trafficStatus
    val navStatus: StateFlow<NavStatus> = graph.navStatus

    /** Trip and maintenance formatting in the current units. */
    val formatter: StateFlow<TripFormatter> =
        units.map { graph.formatter() }.stateIn(viewModelScope, SharingStarted.Eagerly, graph.formatter())

    private val maintenanceState = MutableStateFlow<Remote<List<MaintenanceItemStatus>>>(Remote.Idle)
    val maintenance: StateFlow<Remote<List<MaintenanceItemStatus>>> = maintenanceState.asStateFlow()

    private val tripSyncState = MutableStateFlow<Remote<Int>>(Remote.Idle)
    val tripSync: StateFlow<Remote<Int>> = tripSyncState.asStateFlow()

    private val remoteErrorState = MutableStateFlow<String?>(null)

    /** Last failure of a remote-control button, if any. */
    val remoteError: StateFlow<String?> = remoteErrorState.asStateFlow()

    private val permissionState = MutableStateFlow(Permissions.state(application))
    val permissions: StateFlow<PermissionState> = permissionState.asStateFlow()

    fun refreshPermissions() {
        permissionState.value = Permissions.state(getApplication())
        HudConnectionService.refresh(getApplication())
        graph.refreshProjection()
    }

    /** The captured Maps notifications as a test case file, or null when none were captured. */
    suspend fun navCaptureExport(): String? = withContext(Dispatchers.IO) { graph.navCapture.export() }

    /** Delete the captured Maps notifications. */
    fun deleteNavCapture() {
        viewModelScope.launch(Dispatchers.IO) { graph.navCapture.clear() }
    }

    fun updateSettings(transform: (CompanionSettings) -> CompanionSettings) = graph.settingsStore.update(transform)

    /** Starts the connection service; false when Android refused (the app must be in the foreground). */
    fun startService(): Boolean {
        graph.settingsStore.update { it.copy(serviceEnabled = true) }
        return HudConnectionService.start(getApplication())
    }

    fun stopService() {
        graph.settingsStore.update { it.copy(serviceEnabled = false) }
        HudConnectionService.stop(getApplication())
    }

    fun reconnect() = graph.link.reconnectNow()

    /**
     * The user confirms that the HUD without pairing token that answered ([hudId], presenting the
     * certificate [certFingerprint]) is theirs: pin both and connect. Ignored once a pairing token
     * is set (the HUD must then prove itself).
     */
    fun confirmOpenHud(hudId: String, certFingerprint: String) {
        graph.settingsStore.update {
            if (it.pairingToken.isEmpty()) it.copy(hudPin = HudPin.of(hudId, "", certFingerprint)) else it
        }
        graph.link.reconnectNow()
    }

    private val qrPairingState = MutableStateFlow<QrPairing>(QrPairing.Idle)

    /** Pairing by the HUD's QR code: where it stands. */
    val qrPairing: StateFlow<QrPairing> = qrPairingState.asStateFlow()

    /**
     * Pair with the HUD whose QR code was scanned: store its pairing token, pin its id and
     * certificate — the scanned fingerprint replaces any earlier pin, and no certificate is ever
     * trusted on first use this way — and set its address: the first of the code's hosts the
     * phone reaches now (else the first IPv4 one). Then connect: start the connection service,
     * or reconnect a running one (also out of a stop after a changed certificate).
     */
    fun pairWithQrCode(payload: PairingPayload) {
        qrPairingState.value = QrPairing.Pairing(payload.hudName)
        viewModelScope.launch {
            val candidates = payload.endpoints()
            val reached = reachable(candidates)
            val endpoint = PairingAddress.choose(candidates) { it in reached } ?: return@launch
            graph.settingsStore.update {
                it.copy(
                    pairingToken = payload.pairingToken,
                    hudPin = payload.pin(),
                    useDiscovery = false,
                    manualAddress = endpoint.display(),
                )
            }
            val started = HudConnectionService.isRunning.value || startService()
            graph.link.reconnectNow()
            qrPairingState.value =
                QrPairing.Paired(
                    hudName = payload.hudName,
                    endpoint = endpoint,
                    certFingerprint = payload.certFingerprint,
                    reached = endpoint in reached,
                    serviceStarted = started,
                )
        }
    }

    /**
     * Which of [candidates] accept a connection now, all tried at once off the main thread. The
     * wait is bounded by [PROBE_BUDGET_MS]: a name whose lookup hangs (a `.local` name the Wi-Fi's
     * DNS does not answer) counts as unreachable — the lookup cannot be cut short, so it is left
     * to end by itself.
     */
    private suspend fun reachable(candidates: List<HudEndpoint>): Set<HudEndpoint> {
        val reached = ConcurrentHashMap.newKeySet<HudEndpoint>()
        val probes =
            candidates.map { endpoint ->
                viewModelScope.launch(Dispatchers.IO) {
                    if (graph.localNetwork.canConnect(endpoint, PROBE_TIMEOUT_MS)) reached.add(endpoint)
                }
            }
        withTimeoutOrNull(PROBE_BUDGET_MS) { probes.joinAll() }
        return reached.toSet()
    }

    /** Forget the outcome of the last QR pairing (a new scan starts). */
    fun resetQrPairing() {
        qrPairingState.value = QrPairing.Idle
    }

    /**
     * Forget the paired HUD and its certificate (e.g. it was replaced or reset, or its certificate
     * changed): the next HUD that proves the pairing token — or, without one, that the user
     * confirms — becomes the paired one.
     */
    fun forgetPairedHud() {
        graph.settingsStore.update { it.copy(hudPin = null) }
        graph.link.reconnectNow()
    }

    /** A remote-control button: over the WebSocket when connected, else via `POST /api/input`. */
    fun sendInput(action: InputAction) {
        remoteErrorState.value = null
        if (linkStatus.value is LinkStatus.Connected) {
            graph.hub.publish(PhoneMessages.input(action))
            return
        }
        viewModelScope.launch {
            try {
                graph.api.sendInput(action)
            } catch (e: HudApiException) {
                remoteErrorState.value = e.message
            }
        }
    }

    /** Pulls trips from `GET /api/trips` (and asks over the socket when connected). */
    fun syncTrips() {
        tripSyncState.value = Remote.Loading
        val connected = linkStatus.value as? LinkStatus.Connected
        viewModelScope.launch {
            if (connected != null) graph.hub.publish(graph.trips.syncRequest(connected.hudId))
            tripSyncState.value =
                try {
                    val fetched = graph.api.trips()
                    graph.trips.merge(fetched)
                    Remote.Loaded(fetched.size)
                } catch (e: HudApiException) {
                    Remote.Failed(e.message ?: "HUD unreachable")
                }
        }
    }

    fun loadMaintenance() {
        maintenanceState.value = Remote.Loading
        viewModelScope.launch {
            maintenanceState.value =
                try {
                    Remote.Loaded(graph.api.maintenance())
                } catch (e: HudApiException) {
                    Remote.Failed(e.message ?: "HUD unreachable")
                }
        }
    }

    /**
     * The HUD's settings page and the certificate it must present, or null until a HUD has proven
     * itself (it receives the API token). The trusted HUD only changes along with the link status.
     */
    val hudSettings: StateFlow<HudPage?> =
        linkStatus
            .map { currentHudPage() }
            .stateIn(viewModelScope, SharingStarted.Eagerly, currentHudPage())

    private fun currentHudPage(): HudPage? =
        graph.currentHud()?.let { HudPage(it.endpoint.settingsUrl, it.certFingerprint) }

    private companion object {
        /** How long a scanned address may take to accept a connection before the next is preferred. */
        const val PROBE_TIMEOUT_MS = 1_500

        /** How long pairing waits for all the scanned addresses (name lookups included) at most. */
        const val PROBE_BUDGET_MS = 2_500L
    }
}
