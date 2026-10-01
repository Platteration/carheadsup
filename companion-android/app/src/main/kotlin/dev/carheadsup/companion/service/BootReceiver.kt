package dev.carheadsup.companion.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dev.carheadsup.companion.CompanionApp

/**
 * Restarts the HUD connection service after the phone starts and after an app update, when the
 * user left it on — so the HUD gets navigation, calls and messages on the next drive without
 * opening the app first. Android allows a foreground service to start from these broadcasts;
 * the service then runs with the `connectedDevice` type only (GPS needs the app opened once, see
 * [HudConnectionService]). With the link idle it costs next to nothing: GPS and the look-ups run
 * only while the HUD is connected.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in STARTING_ACTIONS) return
        val graph = (context.applicationContext as CompanionApp).graph
        if (!graph.settings.value.serviceEnabled) return
        if (!HudConnectionService.startInBackground(context)) graph.notifier.linkStopped()
    }

    private companion object {
        val STARTING_ACTIONS = setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)
    }
}
