package dev.carheadsup.companion.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dev.carheadsup.companion.notifications.NavNotificationListener

/** A group of runtime permissions requested together from one checklist row. */
enum class PermissionGroup(val permissions: List<String>) {
    CALLS(
        listOf(
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.READ_CALL_LOG,
            Manifest.permission.ANSWER_PHONE_CALLS,
        ),
    ),
    CONTACTS(listOf(Manifest.permission.READ_CONTACTS)),
    LOCATION(listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)),
    NOTIFICATIONS(
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            listOf(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            emptyList()
        },
    ),
}

/** What the permission checklist shows. */
data class PermissionState(
    val notificationAccess: Boolean,
    val calls: Boolean,
    val contacts: Boolean,
    val location: Boolean,
    val postNotifications: Boolean,
    val batteryUnrestricted: Boolean,
)

/** Permission checks and the system screens that grant the special ones. */
object Permissions {
    fun state(context: Context): PermissionState = PermissionState(
        notificationAccess = hasNotificationAccess(context),
        calls = granted(context, PermissionGroup.CALLS),
        contacts = granted(context, PermissionGroup.CONTACTS),
        location = granted(context, PermissionGroup.LOCATION),
        postNotifications = granted(context, PermissionGroup.NOTIFICATIONS),
        batteryUnrestricted = context.getSystemService(
            PowerManager::class.java,
        ).isIgnoringBatteryOptimizations(context.packageName),
    )

    /** All permissions of [group] granted (an empty group — not needed on this Android — counts as granted). */
    fun granted(context: Context, group: PermissionGroup): Boolean =
        group.permissions.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

    fun hasNotificationAccess(context: Context): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)

    /** Opens the notification-access screen, directly on our listener where Android supports it. */
    fun notificationAccessIntent(context: Context): Intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
            .putExtra(
                Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                ComponentName(context, NavNotificationListener::class.java).flattenToString(),
            )
    } else {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
    }

    /** Fallback when the detail screen is missing on a device. */
    fun notificationAccessListIntent(): Intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)

    /**
     * Asks to exempt the app from battery optimisation, so the link survives Doze while the phone
     * lies in the car with the screen off.
     */
    @SuppressLint("BatteryLife")
    fun batteryOptimizationIntent(context: Context): Intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))

    /** The app's system settings page (for permissions denied permanently, or "restricted settings"). */
    fun appDetailsIntent(context: Context): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
}
