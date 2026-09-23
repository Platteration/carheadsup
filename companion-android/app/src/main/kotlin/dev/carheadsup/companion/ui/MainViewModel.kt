package dev.carheadsup.companion.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.carheadsup.companion.CompanionApp
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
import dev.carheadsup.protocol.link.HudEndpoint
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Loading state of data fetched from the HUD's REST API. */
sealed interface Remote<out T> {
    data object Idle : Remote<Nothing>

    data object Loading : Remote<Nothing>

    data class Loaded<T>(val value: T) : Remote<T>

    data class Failed(val message: String) : Remote<Nothing>
}

/** UI state and actions of [MainActivity]. */
class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val graph = (application as CompanionApp).graph

    val settings: StateFlow<CompanionSettings> = graph.settings
    val linkStatus: StateFlow<LinkStatus> = graph.link.status
    val serviceRunning: StateFlow<Boolean> = HudConnectionService.isRunning
    val trips: StateFlow<List<TripRecord>> = graph.trips.trips
    val units: StateFlow<DisplayUnits> = graph.units
    val discovered: StateFlow<HudEndpoint?> = graph.discovery.endpoint

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
        if (linkStatus.value is LinkStatus.Connected) {
            graph.hub.publish(
                PhoneMessages.tripsRequest(graph.trips.syncCursor),
            )
        }
        viewModelScope.launch {
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

    /** The HUD's settings page, or null when its address is unknown. */
    fun settingsUrl(): String? = graph.currentEndpoint()?.settingsUrl
}
