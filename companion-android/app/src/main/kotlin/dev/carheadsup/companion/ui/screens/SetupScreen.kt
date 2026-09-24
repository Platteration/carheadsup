package dev.carheadsup.companion.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.carheadsup.companion.BuildConfig
import dev.carheadsup.companion.R
import dev.carheadsup.companion.ui.MainViewModel
import dev.carheadsup.companion.ui.theme.StatusColors
import dev.carheadsup.protocol.auth.HudPin
import dev.carheadsup.protocol.auth.PhoneAuth
import dev.carheadsup.protocol.link.HudEndpoint

/** HUD address, pairing, privacy toggles and the entry to the HUD's own settings app. */
@Composable
fun SetupScreen(viewModel: MainViewModel, onOpenHudSettings: (String) -> Unit) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val discovered by viewModel.discovered.collectAsStateWithLifecycle()

    // Connection fields are edited locally and applied together: each change reconnects.
    var useDiscovery by rememberSaveable(settings.useDiscovery) { mutableStateOf(settings.useDiscovery) }
    var address by rememberSaveable(settings.manualAddress) { mutableStateOf(settings.manualAddress) }
    var pairingToken by rememberSaveable(settings.pairingToken) { mutableStateOf(settings.pairingToken) }
    var apiToken by rememberSaveable(settings.apiToken) { mutableStateOf(settings.apiToken) }
    val addressValid = useDiscovery || HudEndpoint.parse(address) != null
    val tokenValid = PhoneAuth.isValidToken(pairingToken) && pairingToken.none { it.isISOControl() }
    val dirty =
        useDiscovery != settings.useDiscovery || address != settings.manualAddress ||
            pairingToken != settings.pairingToken || apiToken != settings.apiToken

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SectionCard(stringResource(R.string.section_connection)) {
            ToggleRow(
                title = stringResource(R.string.setting_discovery),
                description =
                discovered?.let { stringResource(R.string.setting_discovery_found, it.display()) }
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
                supportingText = { Text(stringResource(R.string.setting_pairing_token_description)) },
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

        SectionCard(stringResource(R.string.section_hud_settings)) {
            Text(
                stringResource(R.string.hud_settings_description),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            val url by viewModel.settingsUrl.collectAsStateWithLifecycle()
            FilledTonalButton(onClick = { url?.let(onOpenHudSettings) }, enabled = url != null) {
                Text(stringResource(R.string.action_open_hud_settings))
            }
            if (url == null) Text(stringResource(R.string.hud_address_unknown), color = StatusColors.warning)
        }

        Text(
            stringResource(R.string.about_version, BuildConfig.VERSION_NAME),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Which HUD the saved pairing code is paired with, if any, and a way to forget it. */
@Composable
private fun PairingState(pin: HudPin?, pairingToken: String, onForget: () -> Unit) {
    val paired = HudPin.active(pin, pairingToken)
    val text =
        when {
            paired != null && pairingToken.isNotEmpty() -> stringResource(
                R.string.setup_paired,
                shortHudId(paired.hudId),
            )

            paired != null -> stringResource(R.string.setup_confirmed_open, shortHudId(paired.hudId))

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
