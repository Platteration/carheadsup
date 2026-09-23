package dev.carheadsup.companion.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.carheadsup.companion.R
import dev.carheadsup.companion.hud.LinkStatus
import dev.carheadsup.companion.ui.MainViewModel
import dev.carheadsup.companion.ui.theme.StatusColors
import dev.carheadsup.protocol.InputAction

/**
 * Big remote-control buttons mirroring the HUD's own inputs (steering-wheel buttons / gestures).
 * Sized for a phone in a holder: no precision needed.
 */
@Composable
fun RemoteScreen(viewModel: MainViewModel) {
    val status by viewModel.linkStatus.collectAsStateWithLifecycle()
    val error by viewModel.remoteError.collectAsStateWithLifecycle()
    val haptics = LocalHapticFeedback.current
    val send: (InputAction) -> Unit = { action ->
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        viewModel.sendInput(action)
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (status !is LinkStatus.Connected) {
            Text(
                stringResource(R.string.remote_not_connected),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        error?.let { Text(stringResource(R.string.remote_failed, it), color = StatusColors.error) }

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            BigButton(stringResource(R.string.remote_primary), primary = true) { send(InputAction.PRIMARY) }
            BigButton(stringResource(R.string.remote_secondary)) { send(InputAction.SECONDARY) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            BigButton(stringResource(R.string.remote_prev_page)) { send(InputAction.PREV_PAGE) }
            BigButton(stringResource(R.string.remote_next_page)) { send(InputAction.NEXT_PAGE) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            BigButton(stringResource(R.string.remote_brightness_down)) { send(InputAction.BRIGHTNESS_DOWN) }
            BigButton(stringResource(R.string.remote_brightness_up)) { send(InputAction.BRIGHTNESS_UP) }
        }
        Row {
            BigButton(stringResource(R.string.remote_blank)) { send(InputAction.TOGGLE_BLANK) }
        }
    }
}

@Composable
private fun RowScope.BigButton(label: String, primary: Boolean = false, onClick: () -> Unit) {
    val modifier = Modifier.weight(1f).height(104.dp)
    val content: @Composable RowScope.() -> Unit = {
        Text(label, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
    }
    if (primary) {
        Button(onClick = onClick, modifier = modifier, content = content)
    } else {
        FilledTonalButton(
            onClick = onClick,
            modifier = modifier,
            colors = ButtonDefaults.filledTonalButtonColors(),
            content = content,
        )
    }
}
