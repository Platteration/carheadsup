package dev.carheadsup.protocol.link

/**
 * When the phone's driving monitors run — GPS, the speed-limit and camera look-ups and the
 * traffic look-up, all of which only feed the HUD: while the HUD link is connected, and for
 * [holdMs] after it went down (a Wi-Fi drop at a red light, the HUD restarting), so a short drop
 * neither restarts GPS from cold nor forgets the road. Otherwise they are off: a connection
 * service left running all day costs no GPS, no map downloads and no traffic requests while the
 * car is parked. Times are monotonic (`SystemClock.elapsedRealtime`). Not thread-safe.
 */
public class MonitorPolicy(public val holdMs: Long = DEFAULT_HOLD_MS) {
    init {
        require(holdMs >= 0) { "holdMs must not be negative" }
    }

    private var connected = false
    private var lostAtMs: Long? = null

    /** The link is (or is not) connected at [nowMs]; repeated reports change nothing. */
    public fun onLink(connected: Boolean, nowMs: Long) {
        if (connected) {
            this.connected = true
            lostAtMs = null
        } else if (this.connected) {
            this.connected = false
            lostAtMs = nowMs
        }
    }

    /** Whether the monitors should run at [nowMs]. */
    public fun shouldRun(nowMs: Long): Boolean {
        if (connected) return true
        val lost = lostAtMs ?: return false
        return nowMs >= lost && nowMs - lost < holdMs
    }

    /**
     * When the monitors are due to stop unless the link comes back (the end of the hold after a
     * disconnect), or null when nothing is pending.
     */
    public fun stopsAt(): Long? = if (connected) null else lostAtMs?.plus(holdMs)

    public companion object {
        /** Two minutes: longer than a HUD restart or a Wi-Fi hiccup, short enough for the battery. */
        public const val DEFAULT_HOLD_MS: Long = 120_000
    }
}
