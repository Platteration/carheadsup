package dev.carheadsup.companion.traffic

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import dev.carheadsup.protocol.traffic.TrafficBudget

/**
 * Today's count of traffic requests, kept across app restarts so the daily budget holds for the
 * whole day ([TrafficBudget]). App-private preferences, excluded from backups like everything else.
 */
class TrafficBudgetStore(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** The saved count, as a budget to continue from. */
    fun load(): TrafficBudget = TrafficBudget().apply {
        val day = prefs.getLong(KEY_DAY, NO_DAY)
        if (day != NO_DAY) restore(day, prefs.getInt(KEY_USED, 0))
    }

    fun save(budget: TrafficBudget) {
        prefs.edit {
            putLong(KEY_DAY, budget.day)
            putInt(KEY_USED, budget.used)
        }
    }

    /** Requests made on the current (UTC) day. */
    fun usedToday(nowWallMs: Long = System.currentTimeMillis()): Int = load().usedOn(TrafficBudget.dayOf(nowWallMs))

    private companion object {
        const val PREFS = "traffic_budget"
        const val KEY_DAY = "day"
        const val KEY_USED = "used"
        const val NO_DAY = Long.MIN_VALUE
    }
}
