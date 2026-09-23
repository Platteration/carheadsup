package dev.carheadsup.protocol.link

/**
 * Decides when a derived state value is worth sending: whenever it changes, and otherwise again
 * after [refreshMs] so the HUD's copy never expires (hazards, for example, are dropped by the HUD
 * when not refreshed for two minutes). Not thread-safe.
 */
public class ChangeGate<T>(private val refreshMs: Long) {
    private var last: T? = null
    private var hasLast = false
    private var lastSentAt = 0L

    /** True when [value] should be sent at [nowMs]; the send is then recorded. */
    public fun shouldSend(value: T, nowMs: Long): Boolean {
        val due = !hasLast || value != last || nowMs - lastSentAt >= refreshMs || nowMs < lastSentAt
        if (due) {
            last = value
            hasLast = true
            lastSentAt = nowMs
        }
        return due
    }

    /** Forget the last value (e.g. after reconnecting, so the next value is sent at once). */
    public fun reset() {
        last = null
        hasLast = false
    }
}
