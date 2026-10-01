package dev.carheadsup.protocol.link

import dev.carheadsup.protocol.PhonePing

/**
 * Application-level heartbeat over the `ping`/`pong` messages.
 *
 * The connection calls [onTick] regularly (e.g. every second); it returns a ping to send every
 * [intervalMs]. Any frame from the HUD counts as a sign of life ([onFrameReceived]); a `pong`
 * additionally yields a round-trip time. When nothing has arrived for [timeoutMs] the link is
 * considered dead ([isTimedOut]) and should be torn down and re-established: a Wi-Fi network
 * that silently vanished never delivers a TCP close.
 */
public class Heartbeat(public val intervalMs: Long = 5_000, public val timeoutMs: Long = 15_000) {
    init {
        require(intervalMs > 0 && timeoutMs > intervalMs) { "timeoutMs must exceed intervalMs" }
    }

    private var nextId = 1L
    private var lastPingAt: Long? = null
    private var lastReceivedAt: Long = 0
    private val outstanding = HashMap<Long, Long>()

    /** Last measured round-trip time, ms. */
    public var lastRttMs: Long? = null
        private set

    /** Start (or restart) monitoring a freshly opened connection at [nowMs]. */
    public fun start(nowMs: Long) {
        lastPingAt = null
        lastReceivedAt = nowMs
        outstanding.clear()
        lastRttMs = null
    }

    /**
     * A ping to send now, or null when the interval has not elapsed. [wallMs] is the phone's
     * clock (epoch ms), sent along as `ping.time` for a HUD without network time.
     */
    public fun onTick(nowMs: Long, wallMs: Long? = null): PhonePing? {
        val last = lastPingAt
        if (last != null && nowMs - last < intervalMs && nowMs >= last) return null
        lastPingAt = nowMs
        val id = nextId++
        outstanding[id] = nowMs
        // Bound memory if pongs never come back.
        if (outstanding.size > 16) outstanding.remove(outstanding.keys.min())
        return PhonePing(id, wallMs)
    }

    public fun onFrameReceived(nowMs: Long) {
        lastReceivedAt = maxOf(lastReceivedAt, nowMs)
    }

    /** Record a `pong`; returns the round-trip time when it answers one of our pings. */
    public fun onPong(id: Long?, nowMs: Long): Long? {
        onFrameReceived(nowMs)
        val sentAt = id?.let { outstanding.remove(it) } ?: return null
        return (nowMs - sentAt).coerceAtLeast(0).also { lastRttMs = it }
    }

    public fun isTimedOut(nowMs: Long): Boolean = nowMs - lastReceivedAt > timeoutMs
}
