package dev.carheadsup.companion.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import dev.carheadsup.companion.R
import dev.carheadsup.companion.service.HudConnectionService
import dev.carheadsup.companion.ui.screens.RemoteScreen
import dev.carheadsup.companion.ui.screens.SetupScreen
import dev.carheadsup.companion.ui.screens.StatusScreen
import dev.carheadsup.companion.ui.screens.TripsScreen
import dev.carheadsup.companion.ui.theme.CompanionTheme

/** The companion app's single screen with four tabs. */
class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            CompanionTheme {
                CompanionScreen(
                    viewModel = viewModel,
                    onOpenHudSettings = { page ->
                        startActivity(HudSettingsActivity.intent(this, page.url, page.certFingerprint))
                    },
                )
            }
        }
    }

    override fun onStart() {
        super.onStart()
        // Restore the connection the user left running (e.g. after the process was killed).
        if (viewModel.settings.value.serviceEnabled && !HudConnectionService.isRunning.value) viewModel.startService()
    }
}

private enum class Tab(@param:StringRes val label: Int, val glyph: String) {
    STATUS(R.string.tab_status, "◉"),
    REMOTE(R.string.tab_remote, "✥"),
    TRIPS(R.string.tab_trips, "≡"),
    SETUP(R.string.tab_setup, "⚙"),
}

@Composable
private fun CompanionScreen(viewModel: MainViewModel, onOpenHudSettings: (HudPage) -> Unit) {
    var tab by rememberSaveable { mutableStateOf(Tab.STATUS) }
    Scaffold(
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { entry ->
                    NavigationBarItem(
                        selected = tab == entry,
                        onClick = { tab = entry },
                        icon = { Text(entry.glyph) },
                        label = { Text(stringResource(entry.label)) },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (tab) {
                Tab.STATUS -> StatusScreen(viewModel)
                Tab.REMOTE -> RemoteScreen(viewModel)
                Tab.TRIPS -> TripsScreen(viewModel)
                Tab.SETUP -> SetupScreen(viewModel, onOpenHudSettings)
            }
        }
    }
}
