package dev.carheadsup.companion.service

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dev.carheadsup.companion.R
import dev.carheadsup.companion.hud.LinkStatus
import dev.carheadsup.companion.ui.MainActivity
import dev.carheadsup.protocol.HudMaintenanceDue
import dev.carheadsup.protocol.MaintenanceDueStatus
import dev.carheadsup.protocol.api.MaintenanceItemStatus
import dev.carheadsup.protocol.api.TripFormatter
import dev.carheadsup.protocol.api.TripRecord

/** Notification channels and the app's notifications. */
class Notifier(private val context: Context) {
    private val manager = NotificationManagerCompat.from(context)

    fun createChannels() {
        val system = context.getSystemService(NotificationManager::class.java)
        system.createNotificationChannels(
            listOf(
                NotificationChannel(
                    CHANNEL_LINK,
                    context.getString(R.string.channel_link),
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = context.getString(R.string.channel_link_description)
                    setShowBadge(false)
                },
                NotificationChannel(
                    CHANNEL_TRIPS,
                    context.getString(R.string.channel_trips),
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = context.getString(R.string.channel_trips_description)
                },
                NotificationChannel(
                    CHANNEL_MAINTENANCE,
                    context.getString(R.string.channel_maintenance),
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply { description = context.getString(R.string.channel_maintenance_description) },
            ),
        )
    }

    /** The foreground-service notification, describing the link. */
    fun linkNotification(status: LinkStatus): Notification {
        val text =
            when (status) {
                LinkStatus.Stopped -> context.getString(R.string.status_stopped)

                LinkStatus.Searching -> context.getString(R.string.status_searching)

                is LinkStatus.Connecting -> context.getString(R.string.status_connecting, status.endpoint.display())

                is LinkStatus.Connected -> context.getString(
                    R.string.status_connected,
                    status.hudName.ifBlank {
                        status.endpoint.display()
                    },
                )

                is LinkStatus.Waiting -> context.getString(R.string.status_waiting, status.reason)

                is LinkStatus.Refused -> context.getString(R.string.status_refused, status.message)
            }
        val stop =
            PendingIntent.getService(
                context,
                REQUEST_STOP,
                Intent(context, HudConnectionService::class.java).setAction(HudConnectionService.ACTION_STOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        return NotificationCompat.Builder(context, CHANNEL_LINK)
            .setSmallIcon(R.drawable.ic_stat_hud)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(text)
            .setContentIntent(openApp())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(0, context.getString(R.string.action_stop), stop)
            .build()
    }

    fun updateLink(status: LinkStatus) = notify(ID_LINK, linkNotification(status))

    fun tripLogged(trip: TripRecord, formatter: TripFormatter) {
        val notification =
            NotificationCompat.Builder(context, CHANNEL_TRIPS)
                .setSmallIcon(R.drawable.ic_stat_hud)
                .setContentTitle(context.getString(R.string.trip_logged))
                .setContentText(formatter.summary(trip))
                .setContentIntent(openApp())
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .build()
        notify(ID_TRIP, notification)
    }

    fun maintenanceDue(message: HudMaintenanceDue, formatter: TripFormatter) {
        for (item in message.items) {
            val status =
                context.getString(
                    if (item.status == MaintenanceDueStatus.OVERDUE) {
                        R.string.maintenance_overdue
                    } else {
                        R.string.maintenance_due_soon
                    },
                )
            val remaining =
                formatter.maintenanceRemaining(
                    MaintenanceItemStatus(
                        itemId = item.itemId,
                        label = item.label,
                        remainingKm = item.remainingKm,
                        remainingDays = item.remainingDays,
                    ),
                )
            val notification =
                NotificationCompat.Builder(context, CHANNEL_MAINTENANCE)
                    .setSmallIcon(R.drawable.ic_stat_hud)
                    .setContentTitle("${item.label} · $status")
                    .setContentText(remaining)
                    .setContentIntent(openApp())
                    .setAutoCancel(true)
                    .setOnlyAlertOnce(true)
                    .setCategory(NotificationCompat.CATEGORY_REMINDER)
                    .build()
            // One notification per item, updated in place rather than stacked.
            notify(ID_MAINTENANCE_BASE + (item.itemId.hashCode() and 0xFFFF), notification)
        }
    }

    @SuppressLint("MissingPermission")
    private fun notify(id: Int, notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        manager.notify(id, notification)
    }

    private fun openApp(): PendingIntent = PendingIntent.getActivity(
        context,
        REQUEST_OPEN,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    companion object {
        const val CHANNEL_LINK = "hud_link"
        const val CHANNEL_TRIPS = "trips"
        const val CHANNEL_MAINTENANCE = "maintenance"
        const val ID_LINK = 1
        const val ID_TRIP = 2
        const val ID_MAINTENANCE_BASE = 0x10000
        private const val REQUEST_OPEN = 1
        private const val REQUEST_STOP = 2
    }
}
