package dev.carheadsup.protocol.link

/**
 * Notices when position fixes stop (a tunnel, an underground car park, location switched off, a
 * GPS that never started), so that data derived from the position — the speed limit, cameras
 * ahead — is withdrawn instead of staying on the HUD as if it were current. Not thread-safe.
 */
public class FixWatchdog(
    private val timeoutMs: Long = 5_000,
    /** Fixes less accurate than this cannot place the car on a road and do not count. */
    private val maxAccuracyM: Double = 50.0,
) {
    private var lastFixMs: Long? = null
    private var withdrawn = false

    /** Whether a fix with this accuracy (metres, null when unknown) is good enough to use. */
    public fun isUsable(accuracyM: Double?): Boolean = accuracyM == null || accuracyM <= maxAccuracyM

    /** A usable fix arrived at [nowMs] (monotonic clock). */
    public fun onFix(nowMs: Long) {
        lastFixMs = nowMs
        withdrawn = false
    }

    /**
     * True, once per gap, when no usable fix has arrived for [timeoutMs] at [nowMs]: the caller
     * then withdraws what it derived from the last one.
     */
    public fun expired(nowMs: Long): Boolean {
        val last = lastFixMs ?: return false
        if (withdrawn) return false
        if (nowMs - last < timeoutMs && nowMs >= last) return false
        withdrawn = true
        return true
    }
}
