package dev.carheadsup.companion.data

import android.content.Context
import android.content.SharedPreferences
import dev.carheadsup.protocol.auth.HudPin
import dev.carheadsup.protocol.auth.PhoneAuth
import dev.carheadsup.protocol.link.HudEndpoint
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** The companion app's user settings. */
data class CompanionSettings(
    /** Find the HUD via mDNS (`_carheadsup._tcp`); otherwise use [manualAddress]. */
    val useDiscovery: Boolean = true,
    /** "host", "host:port" or "[v6]:port", used when discovery is off. */
    val manualAddress: String = "",
    /**
     * The HUD's `phone.pairingToken`, which phone and HUD prove to each other (it is never sent).
     * Empty for a HUD without one: nothing is proven then, and the user confirms the HUD instead.
     */
    val pairingToken: String = "",
    /** Bearer token for the HUD's REST API (`server.apiToken`), empty when open. */
    val apiToken: String = "",
    /** The driver's consent to reading messages aloud; the HUD must ask for it too. */
    val readMessagesAloud: Boolean = true,
    /** Send the phone's GPS position to the HUD. */
    val shareLocation: Boolean = true,
    /** Look up speed limits (and cameras) on OpenStreetMap (uses mobile data). */
    val osmLookups: Boolean = true,
    /**
     * Warn about speed cameras from OpenStreetMap. Off unless the driver turns it on: using such
     * warnings while driving is illegal in some countries (e.g. Germany, Switzerland).
     */
    val cameraWarnings: Boolean = false,
    /** The user wants the HUD connection service running (restored after app restarts). */
    val serviceEnabled: Boolean = false,
    /**
     * The HUD this phone is paired with: pinned at the first verified connection with a pairing
     * token (or confirmed by the user for a HUD without one). Only applies with that token.
     */
    val hudPin: HudPin? = null,
) {
    /** The manually configured endpoint, or null when discovery is used or the address is invalid. */
    val manualEndpoint: HudEndpoint?
        get() = if (useDiscovery) null else HudEndpoint.parse(manualAddress)

    /** Settings that require the HUD connection to be re-established when they change. */
    val connectionKey: Triple<Boolean, String, String>
        get() = Triple(useDiscovery, manualAddress.trim(), pairingToken)
}

/**
 * Settings persisted in private SharedPreferences and exposed as a [StateFlow]. Tokens are
 * stored in app-private storage (not backed up: `allowBackup` is off).
 */
class SettingsStore(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val state = MutableStateFlow(read())

    val settings: StateFlow<CompanionSettings> = state.asStateFlow()

    /**
     * This install's identity on the phone link (`hello.deviceId`): random, made on first use and
     * kept (not backed up, so a reinstall is a new phone to the HUD).
     */
    val deviceId: String =
        prefs.getString(KEY_DEVICE_ID, null)?.takeIf(PhoneAuth::isValidId)
            ?: PhoneAuth.newId().also { prefs.edit().putString(KEY_DEVICE_ID, it).apply() }

    fun update(transform: (CompanionSettings) -> CompanionSettings) {
        state.update { current ->
            transform(current).also(::write)
        }
    }

    private fun read(): CompanionSettings {
        val defaults = CompanionSettings()
        return CompanionSettings(
            useDiscovery = prefs.getBoolean(KEY_DISCOVERY, defaults.useDiscovery),
            manualAddress = prefs.getString(KEY_ADDRESS, defaults.manualAddress).orEmpty(),
            pairingToken = prefs.getString(KEY_PAIRING, defaults.pairingToken).orEmpty(),
            apiToken = prefs.getString(KEY_API_TOKEN, defaults.apiToken).orEmpty(),
            readMessagesAloud = prefs.getBoolean(KEY_READ_ALOUD, defaults.readMessagesAloud),
            shareLocation = prefs.getBoolean(KEY_LOCATION, defaults.shareLocation),
            osmLookups = prefs.getBoolean(KEY_OSM, defaults.osmLookups),
            cameraWarnings = prefs.getBoolean(KEY_CAMERAS, defaults.cameraWarnings),
            serviceEnabled = prefs.getBoolean(KEY_SERVICE, defaults.serviceEnabled),
            hudPin = readPin(),
        )
    }

    private fun readPin(): HudPin? {
        val hudId = prefs.getString(KEY_PIN_HUD_ID, null)?.takeIf(PhoneAuth::isValidId) ?: return null
        val fingerprint = prefs.getString(KEY_PIN_TOKEN, null)?.takeIf { it.isNotEmpty() } ?: return null
        return HudPin(hudId, fingerprint)
    }

    private fun write(settings: CompanionSettings) {
        prefs.edit()
            .putBoolean(KEY_DISCOVERY, settings.useDiscovery)
            .putString(KEY_ADDRESS, settings.manualAddress)
            .putString(KEY_PAIRING, settings.pairingToken)
            .putString(KEY_API_TOKEN, settings.apiToken)
            .putBoolean(KEY_READ_ALOUD, settings.readMessagesAloud)
            .putBoolean(KEY_LOCATION, settings.shareLocation)
            .putBoolean(KEY_OSM, settings.osmLookups)
            .putBoolean(KEY_CAMERAS, settings.cameraWarnings)
            .putBoolean(KEY_SERVICE, settings.serviceEnabled)
            .putString(KEY_PIN_HUD_ID, settings.hudPin?.hudId)
            .putString(KEY_PIN_TOKEN, settings.hudPin?.tokenFingerprint)
            .apply()
    }

    private companion object {
        const val PREFS = "companion_settings"
        const val KEY_DISCOVERY = "use_discovery"
        const val KEY_ADDRESS = "manual_address"
        const val KEY_PAIRING = "pairing_token"
        const val KEY_API_TOKEN = "api_token"
        const val KEY_READ_ALOUD = "read_messages_aloud"
        const val KEY_LOCATION = "share_location"
        const val KEY_OSM = "osm_lookups"
        const val KEY_CAMERAS = "camera_warnings"
        const val KEY_SERVICE = "service_enabled"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_PIN_HUD_ID = "paired_hud_id"
        const val KEY_PIN_TOKEN = "paired_token_fingerprint"
    }
}
