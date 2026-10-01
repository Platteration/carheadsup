package dev.carheadsup.companion.ui.screens

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import android.text.format.DateFormat
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.carheadsup.companion.BuildConfig
import dev.carheadsup.companion.R
import dev.carheadsup.companion.data.CompanionSettings
import dev.carheadsup.companion.ui.FileExportBridge
import dev.carheadsup.companion.ui.HudPage
import dev.carheadsup.companion.ui.MainViewModel
import dev.carheadsup.companion.ui.Permissions
import dev.carheadsup.companion.ui.QrPairing
import dev.carheadsup.companion.ui.scan.QrScanner
import dev.carheadsup.companion.ui.theme.StatusColors
import dev.carheadsup.protocol.auth.CertFingerprint
import dev.carheadsup.protocol.auth.HudPin
import dev.carheadsup.protocol.auth.PairingCode
import dev.carheadsup.protocol.link.HudEndpoint
import dev.carheadsup.protocol.nav.NavCaptureLog
import dev.carheadsup.protocol.pairing.PairingScan
import dev.carheadsup.protocol.pairing.PairingUri
import dev.carheadsup.protocol.traffic.TomTomTraffic
import dev.carheadsup.protocol.traffic.TrafficState
import dev.carheadsup.protocol.traffic.TrafficStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** HUD address, pairing, privacy toggles, traffic and the entry to the HUD's own settings app. */
@Composable
fun SetupScreen(viewModel: MainViewModel, onOpenHudSettings: (HudPage) -> Unit) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val discovered by viewModel.discovered.collectAsStateWithLifecycle()
    val trafficStatus by viewModel.trafficStatus.collectAsStateWithLifecycle()
    val serviceRunning by viewModel.serviceRunning.collectAsStateWithLifecycle()

    // Connection fields are edited locally and applied together: each change reconnects.
    var useDiscovery by rememberSaveable(settings.useDiscovery) { mutableStateOf(settings.useDiscovery) }
    var address by rememberSaveable(settings.manualAddress) { mutableStateOf(settings.manualAddress) }
    var pairingToken by rememberSaveable(settings.pairingToken) { mutableStateOf(settings.pairingToken) }
    var apiToken by rememberSaveable(settings.apiToken) { mutableStateOf(settings.apiToken) }
    var trafficKey by rememberSaveable(settings.trafficApiKey) { mutableStateOf(settings.trafficApiKey) }
    val trafficKeyValid = trafficKey.isEmpty() || TomTomTraffic.isPlausibleKey(trafficKey)
    val addressValid = useDiscovery || HudEndpoint.parse(address) != null
    // The HUD's pairing-token rule for a new code; one saved before the rule stays usable as it is
    // (the HUD keeps it too), so it never blocks saving the other connection fields.
    val tokenKept = pairingToken == settings.pairingToken && !PairingCode.isValid(pairingToken)
    val tokenValid = tokenKept || PairingCode.isValid(pairingToken)
    val dirty =
        useDiscovery != settings.useDiscovery || address != settings.manualAddress ||
            pairingToken != settings.pairingToken || apiToken != settings.apiToken

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SectionCard(stringResource(R.string.section_connection)) {
            ScanPairing(viewModel)
            ToggleRow(
                title = stringResource(R.string.setting_discovery),
                description =
                discovered?.let { stringResource(R.string.setting_discovery_found, it.endpoint.display()) }
                    ?: stringResource(R.string.setting_discovery_description),
                checked = useDiscovery,
                onChange = { useDiscovery = it },
            )
            OutlinedTextField(
                value = address,
                onValueChange = { address = it.trim() },
                label = { Text(stringResource(R.string.setting_address)) },
                placeholder = { Text("192.168.4.1:${HudEndpoint.DEFAULT_PORT}") },
                enabled = !useDiscovery,
                isError = !addressValid,
                supportingText = { if (!addressValid) Text(stringResource(R.string.setting_address_invalid)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = pairingToken,
                onValueChange = { pairingToken = it },
                label = { Text(stringResource(R.string.setting_pairing_token)) },
                supportingText = {
                    Text(
                        stringResource(
                            when {
                                !tokenValid -> R.string.setting_pairing_token_invalid
                                tokenKept -> R.string.setting_pairing_token_legacy
                                else -> R.string.setting_pairing_token_description
                            },
                        ),
                    )
                },
                isError = !tokenValid,
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            PairingState(settings.hudPin, settings.pairingToken, onForget = viewModel::forgetPairedHud)
            OutlinedTextField(
                value = apiToken,
                onValueChange = { apiToken = it },
                label = { Text(stringResource(R.string.setting_api_token)) },
                supportingText = { Text(stringResource(R.string.setting_api_token_description)) },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    viewModel.updateSettings {
                        it.copy(
                            useDiscovery = useDiscovery,
                            manualAddress = address,
                            pairingToken = pairingToken,
                            apiToken = apiToken.trim(),
                        )
                    }
                },
                enabled = dirty && addressValid && tokenValid,
            ) { Text(stringResource(R.string.action_save)) }
        }

        SectionCard(stringResource(R.string.section_features)) {
            ToggleRow(
                title = stringResource(R.string.setting_read_aloud),
                description = stringResource(R.string.setting_read_aloud_description),
                checked = settings.readMessagesAloud,
                onChange = { value -> viewModel.updateSettings { it.copy(readMessagesAloud = value) } },
            )
            ToggleRow(
                title = stringResource(R.string.setting_location),
                description = stringResource(R.string.setting_location_description),
                checked = settings.shareLocation,
                onChange = { value -> viewModel.updateSettings { it.copy(shareLocation = value) } },
            )
            ToggleRow(
                title = stringResource(R.string.setting_osm),
                description = stringResource(R.string.setting_osm_description),
                checked = settings.osmLookups,
                onChange = { value -> viewModel.updateSettings { it.copy(osmLookups = value) } },
            )
            ToggleRow(
                title = stringResource(R.string.setting_cameras),
                description = stringResource(R.string.setting_cameras_description),
                checked = settings.cameraWarnings && settings.osmLookups,
                enabled = settings.osmLookups,
                onChange = { value -> viewModel.updateSettings { it.copy(cameraWarnings = value) } },
            )
        }

        SectionCard(stringResource(R.string.section_traffic)) {
            ToggleRow(
                title = stringResource(R.string.setting_traffic),
                description = stringResource(R.string.setting_traffic_description),
                checked = settings.trafficEnabled,
                onChange = { value -> viewModel.updateSettings { it.copy(trafficEnabled = value) } },
            )
            OutlinedTextField(
                value = trafficKey,
                onValueChange = { trafficKey = it.trim() },
                label = { Text(stringResource(R.string.setting_traffic_key)) },
                supportingText = {
                    Text(
                        stringResource(
                            if (trafficKeyValid) {
                                R.string.setting_traffic_key_description
                            } else {
                                R.string.setting_traffic_key_invalid
                            },
                        ),
                    )
                },
                isError = !trafficKeyValid,
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = { viewModel.updateSettings { it.copy(trafficApiKey = trafficKey) } },
                enabled = trafficKey != settings.trafficApiKey && trafficKeyValid,
            ) { Text(stringResource(R.string.action_save)) }
            Text(
                stringResource(R.string.traffic_privacy),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (settings.trafficEnabled) TrafficStatusLine(settings, trafficStatus, serviceRunning)
        }

        SectionCard(stringResource(R.string.section_hud_settings)) {
            Text(
                stringResource(R.string.hud_settings_description),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            val page by viewModel.hudSettings.collectAsStateWithLifecycle()
            FilledTonalButton(onClick = { page?.let(onOpenHudSettings) }, enabled = page != null) {
                Text(stringResource(R.string.action_open_hud_settings))
            }
            if (page == null) Text(stringResource(R.string.hud_address_unknown), color = StatusColors.warning)
        }

        SectionCard(stringResource(R.string.section_debugging)) { NavCapture(viewModel, settings) }

        Text(
            stringResource(R.string.about_version, BuildConfig.VERSION_NAME),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private const val TAG = "SetupScreen"

/**
 * The capture of Google Maps' navigation notifications, for parser test cases: on/off, export
 * (to Downloads, as a test case file) and delete.
 */
@Composable
private fun NavCapture(viewModel: MainViewModel, settings: CompanionSettings) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf<Int?>(null) }
    ToggleRow(
        title = stringResource(R.string.setting_nav_capture),
        description = stringResource(R.string.setting_nav_capture_description, NavCaptureLog.MAX_CASES),
        checked = settings.navCapture,
        onChange = { value -> viewModel.updateSettings { it.copy(navCapture = value) } },
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = {
            val activity = context.findActivity() ?: return@OutlinedButton
            scope.launch {
                val text = viewModel.navCaptureExport()
                message =
                    if (text == null) {
                        R.string.nav_capture_empty
                    } else {
                        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(Date())
                        val name = "carheadsup-nav-$stamp.json"
                        val result =
                            withContext(Dispatchers.IO) {
                                FileExportBridge(activity).saveFile(text, name, "application/json")
                            }
                        if (result == "failed") R.string.nav_capture_failed else null
                    }
            }
        }) { Text(stringResource(R.string.action_export_nav_capture)) }
        TextButton(onClick = {
            viewModel.deleteNavCapture()
            message = R.string.nav_capture_deleted
        }) { Text(stringResource(R.string.action_delete_nav_capture)) }
    }
    message?.let {
        Text(
            stringResource(it),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The activity behind a composition's context, if any. */
private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/**
 * Pairing by the QR code on the HUD: the camera permission is asked for only now, the scanner
 * reads codes until one is a carheadsup pairing code (saying why others are not), and the view
 * model stores it and connects (see [MainViewModel.pairWithQrCode]).
 */
@Composable
private fun ScanPairing(viewModel: MainViewModel) {
    val context = LocalContext.current
    val pairing by viewModel.qrPairing.collectAsStateWithLifecycle()
    var scanning by rememberSaveable { mutableStateOf(false) }
    var problem by rememberSaveable { mutableStateOf<Int?>(null) }
    var cameraError by rememberSaveable { mutableStateOf<String?>(null) }
    var denied by rememberSaveable { mutableStateOf(false) }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val askForCamera =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            denied = !granted
            scanning = granted
        }

    fun cameraAllowed(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    fun startScanning() {
        problem = null
        cameraError = null
        denied = false
        viewModel.resetQrPairing()
        if (cameraAllowed()) scanning = true else askForCamera.launch(Manifest.permission.CAMERA)
    }

    Text(stringResource(R.string.setup_scan_intro), style = MaterialTheme.typography.bodySmall, color = muted)
    // `scanning` survives the process; the permission may not (revoking it in the system
    // settings ends the process, and the restored screen must not open the camera without it).
    if (scanning && cameraAllowed()) {
        QrScanner(
            onText = { text ->
                when (val result = PairingUri.parse(text)) {
                    is PairingScan.Valid -> {
                        scanning = false
                        problem = null
                        viewModel.pairWithQrCode(result.payload)
                    }

                    PairingScan.Foreign -> problem = R.string.scan_foreign

                    is PairingScan.UnsupportedVersion -> problem = R.string.scan_newer_version

                    is PairingScan.Invalid -> {
                        Log.w(TAG, "Unreadable pairing code: ${result.detail}")
                        problem = R.string.scan_invalid
                    }
                }
            },
            onError = { message ->
                scanning = false
                cameraError = message
            },
            modifier = Modifier.fillMaxWidth().aspectRatio(1f).clip(MaterialTheme.shapes.medium),
        )
        Text(
            stringResource(problem ?: R.string.scan_hint),
            style = MaterialTheme.typography.bodySmall,
            color = if (problem == null) muted else StatusColors.warning,
        )
        OutlinedButton(onClick = { scanning = false }) { Text(stringResource(R.string.action_cancel)) }
    } else {
        FilledTonalButton(onClick = ::startScanning) { Text(stringResource(R.string.action_scan_qr)) }
    }
    if (denied) {
        Text(
            stringResource(R.string.scan_camera_denied),
            style = MaterialTheme.typography.bodySmall,
            color = StatusColors.warning,
        )
        TextButton(onClick = { context.startSafely(Permissions.appDetailsIntent(context)) }) {
            Text(stringResource(R.string.action_app_settings))
        }
    }
    cameraError?.let {
        Text(
            stringResource(R.string.scan_camera_failed, it),
            style = MaterialTheme.typography.bodySmall,
            color = StatusColors.error,
        )
    }
    QrPairingOutcome(pairing)
}

/** What became of the last scanned pairing code. */
@Composable
private fun QrPairingOutcome(pairing: QrPairing) {
    val unnamed = stringResource(R.string.scan_unnamed_hud)
    when (pairing) {
        QrPairing.Idle -> Unit

        is QrPairing.Pairing ->
            Text(
                stringResource(R.string.scan_pairing, pairing.hudName ?: unnamed),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

        is QrPairing.Paired -> {
            val name = pairing.hudName ?: unnamed
            val certificate = CertFingerprint.short(pairing.certFingerprint)
            val address = pairing.endpoint.display()
            Text(
                if (pairing.reached) {
                    stringResource(R.string.scan_paired, name, certificate, address)
                } else {
                    stringResource(R.string.scan_paired_unreached, name, certificate, address)
                },
                style = MaterialTheme.typography.bodySmall,
                color = if (pairing.reached) StatusColors.ok else StatusColors.warning,
            )
            if (!pairing.serviceStarted) {
                Text(stringResource(R.string.service_start_refused), color = StatusColors.error)
            }
        }
    }
}

/** What the traffic look-up is doing: last update and incidents ahead, or why it is not working. */
@Composable
private fun TrafficStatusLine(settings: CompanionSettings, status: TrafficStatus, serviceRunning: Boolean) {
    val context = LocalContext.current
    val timeFormat = remember(context) { DateFormat.getTimeFormat(context) }
    val lastUpdate = status.lastUpdateWallMs?.let { timeFormat.format(Date(it)) }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val (text: String, color: Color) =
        when {
            !TomTomTraffic.isPlausibleKey(settings.trafficApiKey) ->
                stringResource(R.string.traffic_status_no_key) to StatusColors.warning

            !serviceRunning -> stringResource(R.string.traffic_status_not_running) to muted

            else -> when (status.state) {
                TrafficState.OFF, TrafficState.NO_KEY -> stringResource(R.string.traffic_status_not_running) to muted

                TrafficState.WAITING_FOR_LOCATION -> stringResource(R.string.traffic_status_waiting_location) to muted

                TrafficState.ACTIVE ->
                    if (lastUpdate == null) {
                        stringResource(R.string.traffic_status_first_update) to muted
                    } else {
                        pluralStringResource(
                            R.plurals.traffic_status_updated,
                            status.incidentsAhead,
                            lastUpdate,
                            status.incidentsAhead,
                        ) to StatusColors.ok
                    }

                TrafficState.PAUSED -> stringResource(R.string.traffic_status_paused) to muted

                TrafficState.ERROR ->
                    stringResource(R.string.traffic_status_error, status.error.orEmpty()) to StatusColors.warning

                TrafficState.BAD_KEY ->
                    stringResource(R.string.traffic_status_bad_key, status.error.orEmpty()) to StatusColors.error

                TrafficState.BUDGET_EXHAUSTED -> stringResource(R.string.traffic_status_budget) to StatusColors.warning
            }
        }
    Text(text, style = MaterialTheme.typography.bodySmall, color = color)
    Text(
        pluralStringResource(
            R.plurals.traffic_requests_today,
            status.requestsToday,
            status.requestsToday,
            status.dailyBudget,
        ),
        style = MaterialTheme.typography.bodySmall,
        color = muted,
    )
}

/** Which HUD (and certificate) the saved pairing code is paired with, if any, and a way to forget it. */
@Composable
private fun PairingState(pin: HudPin?, pairingToken: String, onForget: () -> Unit) {
    val paired = HudPin.active(pin, pairingToken)
    val certificate = paired?.certFingerprint?.let(CertFingerprint::short)
    val text =
        when {
            paired != null && pairingToken.isNotEmpty() ->
                if (certificate == null) {
                    stringResource(R.string.setup_paired, shortHudId(paired.hudId))
                } else {
                    stringResource(R.string.setup_paired_certificate, shortHudId(paired.hudId), certificate)
                }

            paired != null ->
                if (certificate == null) {
                    stringResource(R.string.setup_confirmed_open, shortHudId(paired.hudId))
                } else {
                    stringResource(R.string.setup_confirmed_open_certificate, shortHudId(paired.hudId), certificate)
                }

            pairingToken.isNotEmpty() -> stringResource(R.string.setup_not_paired)

            else -> stringResource(R.string.setup_no_pairing_code)
        }
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = if (pairingToken.isEmpty()) StatusColors.warning else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        if (paired != null) {
            TextButton(onClick = onForget) { Text(stringResource(R.string.action_forget_paired_hud)) }
        }
    }
}

@Composable
private fun ToggleRow(
    title: String,
    description: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
    enabled: Boolean = true,
) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(
                description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}
