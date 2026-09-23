package dev.carheadsup.companion.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** HUD amber on black: readable at night in the car and consistent with the projected display. */
private val HudColors =
    darkColorScheme(
        primary = Color(0xFFFFB300),
        onPrimary = Color(0xFF1B1300),
        primaryContainer = Color(0xFF3D2E00),
        onPrimaryContainer = Color(0xFFFFE08A),
        secondary = Color(0xFF7FD1FF),
        onSecondary = Color(0xFF002233),
        background = Color.Black,
        onBackground = Color(0xFFECECEC),
        surface = Color(0xFF0E0E0E),
        onSurface = Color(0xFFECECEC),
        surfaceVariant = Color(0xFF1C1C1C),
        onSurfaceVariant = Color(0xFFBDBDBD),
        surfaceContainer = Color(0xFF141414),
        surfaceContainerHigh = Color(0xFF1C1C1C),
        error = Color(0xFFFF6E6E),
        onError = Color(0xFF330000),
    )

/** The companion app's Material 3 theme (always dark). */
@Composable
fun CompanionTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = HudColors, content = content)
}

/** Status colours used by the checklist and connection card. */
object StatusColors {
    val ok = Color(0xFF6BD968)
    val warning = Color(0xFFFFB300)
    val error = Color(0xFFFF6E6E)
}
