package dev.carheadsup.companion.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import dev.carheadsup.protocol.auth.CertFingerprint
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
    /**
     * Traffic incidents ahead from TomTom. Off unless the driver turns it on: it sends the car's
     * whereabouts to TomTom and needs the driver's own API key ([trafficApiKey]).
     */
    val trafficEnabled: Boolean = false,
    /** The driver's TomTom API key (a secret like the tokens: app-private, never backed up). */
    val trafficApiKey: String = "",
    /** The user wants the HUD connection service running (restored after app restarts). */
    val serviceEnabled: Boolean = false,
    /**
     * Keep Google Maps' navigation notifications for a parser test case file (a debugging aid:
     * they hold the streets and destination of the drive, so it is off unless switched on).
     */
    val navCapture: Boolean = false,
    /**
     * The HUD this phone is paired with — its id and TLS certificate: pinned at the first
     * verified connection with a pairing token (or confirmed by the user for a HUD without one).
     * Only applies with that token.
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
 * Settings persisted in private SharedPreferences and exposed as a [StateFlow]. Tokens and the
 * TomTom API key are stored in app-private storage (not backed up: `allowBackup` is off and the
 * backup rules exclude everything).
 */
class SettingsStore(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    init {
        upgradeFromPlainLink()
    }

    private val state = MutableStateFlow(read())

    val settings: StateFlow<CompanionSettings> = state.asStateFlow()

    /**
     * This install's identity on the phone link (`hello.deviceId`): random, made on first use and
     * kept (not backed up, so a reinstall is a new phone to the HUD).
     */
    val deviceId: String =
        prefs.getString(KEY_DEVICE_ID, null)?.takeIf(PhoneAuth::isValidId)
            ?: PhoneAuth.newId().also { id -> prefs.edit { putString(KEY_DEVICE_ID, id) } }

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
            trafficEnabled = prefs.getBoolean(KEY_TRAFFIC, defaults.trafficEnabled),
            trafficApiKey = prefs.getString(KEY_TRAFFIC_KEY, defaults.trafficApiKey).orEmpty(),
            serviceEnabled = prefs.getBoolean(KEY_SERVICE, defaults.serviceEnabled),
            navCapture = prefs.getBoolean(KEY_NAV_CAPTURE, defaults.navCapture),
            hudPin = readPin(),
        )
    }

    /**
     * Settings saved by an app from before the TLS link (no [KEY_LINK_VERSION] yet): a manual
     * address on the HUD's default plain port now names its TLS port
     * ([HudEndpoint.upgradeLegacyAddress]). Runs once.
     */
    private fun upgradeFromPlainLink() {
        if (prefs.getInt(KEY_LINK_VERSION, 0) >= LINK_VERSION_TLS) return
        val address = prefs.getString(KEY_ADDRESS, null)
        val upgraded = address?.let(HudEndpoint::upgradeLegacyAddress)
        prefs.edit {
            if (upgraded != null && upgraded != address) putString(KEY_ADDRESS, upgraded)
            putInt(KEY_LINK_VERSION, LINK_VERSION_TLS)
        }
    }

    private fun readPin(): HudPin? {
        val hudId = prefs.getString(KEY_PIN_HUD_ID, null)?.takeIf(PhoneAuth::isValidId) ?: return null
        val fingerprint = prefs.getString(KEY_PIN_TOKEN, null)?.takeIf { it.isNotEmpty() } ?: return null
        // Pins made before TLS have no certificate: the next verified connection adds it.
        val certificate = prefs.getString(KEY_PIN_CERTIFICATE, null)?.takeIf(CertFingerprint::isValid)
        return HudPin(hudId, fingerprint, certificate)
    }

    private fun write(settings: CompanionSettings) {
        prefs.edit {
            putBoolean(KEY_DISCOVERY, settings.useDiscovery)
            putString(KEY_ADDRESS, settings.manualAddress)
            putString(KEY_PAIRING, settings.pairingToken)
            putString(KEY_API_TOKEN, settings.apiToken)
            putBoolean(KEY_READ_ALOUD, settings.readMessagesAloud)
            putBoolean(KEY_LOCATION, settings.shareLocation)
            putBoolean(KEY_OSM, settings.osmLookups)
            putBoolean(KEY_CAMERAS, settings.cameraWarnings)
            putBoolean(KEY_TRAFFIC, settings.trafficEnabled)
            putString(KEY_TRAFFIC_KEY, settings.trafficApiKey)
            putBoolean(KEY_SERVICE, settings.serviceEnabled)
            putBoolean(KEY_NAV_CAPTURE, settings.navCapture)
            putString(KEY_PIN_HUD_ID, settings.hudPin?.hudId)
            putString(KEY_PIN_TOKEN, settings.hudPin?.tokenFingerprint)
            putString(KEY_PIN_CERTIFICATE, settings.hudPin?.certFingerprint)
        }
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
        const val KEY_TRAFFIC = "traffic_enabled"
        const val KEY_TRAFFIC_KEY = "tomtom_api_key"
        const val KEY_SERVICE = "service_enabled"
        const val KEY_NAV_CAPTURE = "nav_capture"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_PIN_HUD_ID = "paired_hud_id"
        const val KEY_PIN_TOKEN = "paired_token_fingerprint"
        const val KEY_PIN_CERTIFICATE = "paired_certificate_fingerprint"

        /** The phone-link generation the saved settings are for (absent: before TLS). */
        const val KEY_LINK_VERSION = "link_version"
        const val LINK_VERSION_TLS = 3
    }
}
