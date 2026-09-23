package dev.carheadsup.protocol.api

import dev.carheadsup.protocol.HudMaintenanceDue
import dev.carheadsup.protocol.MaintenanceDueItem
import dev.carheadsup.protocol.MaintenanceDueStatus

/**
 * Decides which `maintenance-due` items are worth an alert. The HUD pushes the full list after
 * every `welcome`, so without this a Wi-Fi blip mid-drive would sound the reminder again. An
 * item alerts when its status is new (due soon → overdue) or its last alert is [quietMs] old.
 * Thread-safe.
 */
public class MaintenanceAlertGate(private val quietMs: Long = 20 * 3_600_000L) {
    private val alertedAt = HashMap<Pair<String, MaintenanceDueStatus>, Long>()

    /** The items of [message] to alert about at [nowMs] (wall clock); they are recorded as alerted. */
    @Synchronized
    public fun toAlert(message: HudMaintenanceDue, nowMs: Long): List<MaintenanceDueItem> {
        alertedAt.entries.removeAll { nowMs - it.value >= quietMs || nowMs < it.value }
        return message.items.filter { item ->
            val key = item.itemId to item.status
            if (key in alertedAt) {
                false
            } else {
                alertedAt[key] = nowMs
                true
            }
        }
    }
}
