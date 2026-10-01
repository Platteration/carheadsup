package dev.carheadsup.companion.ui.screens

import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.carheadsup.companion.NavStatus
import dev.carheadsup.companion.R
import dev.carheadsup.companion.hud.LinkStatus
import dev.carheadsup.companion.ui.MainViewModel
import dev.carheadsup.companion.ui.PermissionGroup
import dev.carheadsup.companion.ui.Permissions
import dev.carheadsup.companion.ui.theme.StatusColors
import dev.carheadsup.protocol.HudErrorCode
import dev.carheadsup.protocol.auth.CertFingerprint
import dev.carheadsup.protocol.auth.TrustProblem
import dev.carheadsup.protocol.nav.AndroidAuto

/** Connection status, service control and the permission checklist. */
@Composable
fun StatusScreen(viewModel: MainViewModel) {
    val context = LocalContext.current
    val status by viewModel.linkStatus.collectAsStateWithLifecycle()
    val running by viewModel.serviceRunning.collectAsStateWithLifecycle()
    val permissions by viewModel.permissions.collectAsStateWithLifecycle()
    val navStatus by viewModel.navStatus.collectAsStateWithLifecycle()
    var startRefused by remember { mutableStateOf(false) }
    var denied by remember { mutableStateOf(emptySet<PermissionGroup>()) }
    var pendingGroup by remember { mutableStateOf<PermissionGroup?>(null) }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.refreshPermissions() }

    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
            val group = pendingGroup
            if (group != null && results.isNotEmpty() && results.values.none { it }) denied = denied + group
            viewModel.refreshPermissions()
        }

    fun request(group: PermissionGroup) {
        pendingGroup = group
        launcher.launch(group.permissions.toTypedArray())
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SectionCard(stringResource(R.string.section_hud)) {
            ConnectionSummary(status, running)
            TrustActions(status, onConfirm = viewModel::confirmOpenHud, onForget = viewModel::forgetPairedHud)
            if (startRefused) Text(stringResource(R.string.service_start_refused), color = StatusColors.error)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (running) {
                    OutlinedButton(onClick = viewModel::stopService) { Text(stringResource(R.string.action_stop)) }
                    if (status !is LinkStatus.Connected) {
                        TextButton(onClick = viewModel::reconnect) { Text(stringResource(R.string.action_retry_now)) }
                    }
                } else {
                    Button(onClick = {
                        startRefused = !viewModel.startService()
                    }) { Text(stringResource(R.string.action_start)) }
                }
            }
        }

        SectionCard(stringResource(R.string.section_navigation)) { NavigationSummary(navStatus) }

        SectionCard(stringResource(R.string.section_permissions)) {
            PermissionRow(
                title = stringResource(R.string.perm_notification_access),
                description = stringResource(R.string.perm_notification_access_description),
                granted = permissions.notificationAccess,
                onGrant = {
                    context.startSafely(
                        Permissions.notificationAccessIntent(context),
                        Permissions.notificationAccessListIntent(),
                    )
                },
            )
            if (!permissions.notificationAccess && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                Text(
                    stringResource(R.string.perm_restricted_settings_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = { context.startSafely(Permissions.appDetailsIntent(context)) }) {
                    Text(stringResource(R.string.action_app_settings))
                }
            }
            HorizontalDivider()
            RuntimePermissionRow(
                PermissionGroup.CALLS,
                R.string.perm_calls,
                R.string.perm_calls_description,
                permissions.calls,
                denied,
                ::request,
            ) { context.startSafely(Permissions.appDetailsIntent(context)) }
            RuntimePermissionRow(
                PermissionGroup.CONTACTS,
                R.string.perm_contacts,
                R.string.perm_contacts_description,
                permissions.contacts,
                denied,
                ::request,
            ) { context.startSafely(Permissions.appDetailsIntent(context)) }
            RuntimePermissionRow(
                PermissionGroup.LOCATION,
                R.string.perm_location,
                R.string.perm_location_description,
                permissions.location,
                denied,
                ::request,
            ) { context.startSafely(Permissions.appDetailsIntent(context)) }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                RuntimePermissionRow(
                    PermissionGroup.NOTIFICATIONS,
                    R.string.perm_notifications,
                    R.string.perm_notifications_description,
                    permissions.postNotifications,
                    denied,
                    ::request,
                ) { context.startSafely(Permissions.appDetailsIntent(context)) }
            }
            HorizontalDivider()
            PermissionRow(
                title = stringResource(R.string.perm_battery),
                description = stringResource(R.string.perm_battery_description),
                granted = permissions.batteryUnrestricted,
                onGrant = {
                    context.startSafely(
                        Permissions.batteryOptimizationIntent(context),
                        Permissions.appDetailsIntent(context),
                    )
                },
            )
        }
    }
}

@Composable
private fun ConnectionSummary(status: LinkStatus, serviceRunning: Boolean) {
    val now = rememberElapsedRealtime()
    val (text, color) =
        when (status) {
            LinkStatus.Stopped ->
                stringResource(if (serviceRunning) R.string.status_starting else R.string.status_stopped) to
                    MaterialTheme.colorScheme.onSurfaceVariant

            LinkStatus.Searching -> stringResource(R.string.status_searching) to StatusColors.warning

            is LinkStatus.Connecting -> stringResource(R.string.status_connecting, status.endpoint.display()) to
                StatusColors.warning

            is LinkStatus.Connected -> {
                val name = status.hudName.ifBlank { status.endpoint.display() }
                if (status.authenticated) {
                    stringResource(R.string.status_connected, name) to StatusColors.ok
                } else {
                    stringResource(R.string.status_connected_unverified, name) to StatusColors.warning
                }
            }

            is LinkStatus.Waiting -> {
                val seconds = ((status.retryAtElapsedMs - now) / 1000).coerceAtLeast(0)
                stringResource(R.string.status_waiting_countdown, status.reason, seconds) to StatusColors.warning
            }

            is LinkStatus.Refused -> {
                val reason =
                    if (status.code == HudErrorCode.BAD_TOKEN) {
                        stringResource(R.string.status_bad_token)
                    } else {
                        status.message
                    }
                stringResource(R.string.status_refused, reason) to StatusColors.error
            }

            is LinkStatus.Untrusted -> {
                val at = status.endpoint.display()
                when (val problem = status.problem) {
                    is TrustProblem.DifferentHud ->
                        stringResource(
                            R.string.status_untrusted_different_hud,
                            at,
                            shortHudId(problem.answeringHudId),
                            shortHudId(problem.pairedHudId),
                        ) to StatusColors.error

                    is TrustProblem.UnconfirmedOpenHud ->
                        stringResource(
                            R.string.status_untrusted_open_hud,
                            at,
                            shortHudId(problem.hudId),
                            CertFingerprint.short(problem.certFingerprint),
                        ) to StatusColors.warning

                    TrustProblem.BadProof -> stringResource(R.string.status_untrusted_bad_proof, at) to
                        StatusColors.error

                    is TrustProblem.ProtocolViolation ->
                        stringResource(R.string.status_untrusted_protocol, at, problem.detail) to StatusColors.error

                    is TrustProblem.CertificateChanged ->
                        stringResource(
                            R.string.status_certificate_changed,
                            at,
                            CertFingerprint.short(problem.presented),
                            CertFingerprint.short(problem.pinned),
                        ) to StatusColors.error

                    is TrustProblem.CertificateMismatch ->
                        stringResource(
                            R.string.status_certificate_mismatch,
                            at,
                            CertFingerprint.short(problem.presented),
                            CertFingerprint.short(problem.advertised),
                        ) to StatusColors.error
                }
            }
        }
    Text(text, style = MaterialTheme.typography.bodyLarge, color = color)
    if (status is LinkStatus.Connected) {
        val details =
            buildList {
                add(status.endpoint.display())
                if (status.hudVersion.isNotBlank()) add("v${status.hudVersion}")
                status.rttMs?.let { add(stringResource(R.string.status_rtt, it)) }
                add(stringResource(R.string.status_certificate, CertFingerprint.short(status.certFingerprint)))
            }.joinToString(" · ")
        Text(details, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            stringResource(
                if (status.readMessagesAloud) R.string.status_read_aloud_on else R.string.status_read_aloud_off,
            ),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * How well Google Maps' guidance is understood, and — while Android Auto projects without the
 * phone's Maps guiding — why the HUD shows no arrows.
 */
@Composable
private fun NavigationSummary(status: NavStatus) {
    val now = rememberElapsedRealtime()
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val stats = status.stats
    if (AndroidAuto.noticeDue(status.projectingSinceMs, stats.lastGuidanceAtMs, now)) {
        Text(stringResource(R.string.nav_android_auto), color = StatusColors.warning)
    }
    if (stats.total == 0) {
        Text(stringResource(R.string.nav_none_yet), style = MaterialTheme.typography.bodySmall, color = muted)
        return
    }
    Text(
        stringResource(R.string.nav_stats, stats.understood, stats.unknownManeuver, stats.notUnderstood),
        color = if (stats.notUnderstood > 0) StatusColors.warning else MaterialTheme.colorScheme.onSurface,
    )
    if (stats.notUnderstood > 0) {
        Text(
            stringResource(R.string.nav_not_understood_hint),
            style = MaterialTheme.typography.bodySmall,
            color = muted,
        )
    }
}

/** What the user can do about a HUD the app does not trust. */
@Composable
private fun TrustActions(status: LinkStatus, onConfirm: (String, String) -> Unit, onForget: () -> Unit) {
    val problem = (status as? LinkStatus.Untrusted)?.problem ?: return
    when (problem) {
        is TrustProblem.UnconfirmedOpenHud ->
            Button(onClick = { onConfirm(problem.hudId, problem.certFingerprint) }) {
                Text(stringResource(R.string.action_confirm_open_hud))
            }

        is TrustProblem.DifferentHud, is TrustProblem.CertificateChanged -> {
            Text(
                stringResource(R.string.status_forget_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(onClick = onForget) { Text(stringResource(R.string.action_forget_paired_hud)) }
        }

        TrustProblem.BadProof, is TrustProblem.ProtocolViolation, is TrustProblem.CertificateMismatch -> Unit
    }
}

@Composable
private fun RuntimePermissionRow(
    group: PermissionGroup,
    title: Int,
    description: Int,
    granted: Boolean,
    denied: Set<PermissionGroup>,
    onRequest: (PermissionGroup) -> Unit,
    onOpenSettings: () -> Unit,
) {
    PermissionRow(
        title = stringResource(title),
        description = stringResource(description),
        granted = granted,
        onGrant = { if (group in denied) onOpenSettings() else onRequest(group) },
        grantLabel = if (group in denied) stringResource(R.string.action_app_settings) else null,
    )
}

@Composable
private fun PermissionRow(
    title: String,
    description: String,
    granted: Boolean,
    onGrant: () -> Unit,
    grantLabel: String? = null,
) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            if (granted) "✓" else "✗",
            color = if (granted) StatusColors.ok else StatusColors.error,
            style = MaterialTheme.typography.titleLarge,
        )
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(
                description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (!granted) {
            FilledTonalButton(onClick = onGrant) { Text(grantLabel ?: stringResource(R.string.action_grant)) }
        } else {
            Text(
                stringResource(R.string.granted),
                color = Color.Unspecified,
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}
