package dev.carheadsup.protocol.link

import dev.carheadsup.protocol.PhoneToHud
import dev.carheadsup.protocol.wireType

/**
 * Per-message-type rate limiter with "latest wins" coalescing.
 *
 * State messages (nav, location, media …) only matter in their latest version, so a message
 * that arrives before its type's minimum interval has elapsed is not dropped but parked; a newer
 * one replaces it, and it is released by [drainDue] once the interval has passed. The final
 * state therefore always reaches the HUD, at most [minIntervalMs] late, and never faster than
 * the configured rate (defaults: nav ≤ 4 Hz, location 1 Hz, media/road/hazards ≤ 2 Hz).
 *
 * Types without an interval (hello, message, input, call, ping …) always pass immediately.
 * Not thread-safe: confine to one thread (the connection's sender loop).
 */
public class MessageRateLimiter(private val minIntervalMs: Map<String, Long> = DEFAULT_INTERVALS_MS) {
    public sealed interface Decision {
        /** Send now. */
        public data object SendNow : Decision

        /** Parked; will be released by [drainDue] at [releaseAtMs] unless superseded. */
        public data class Deferred(val releaseAtMs: Long) : Decision
    }

    private val lastSentAt = HashMap<String, Long>()
    private val pending = LinkedHashMap<String, PhoneToHud>()

    /**
     * Offer [message] at [nowMs]. On [Decision.SendNow] the caller must send it (the send time is
     * recorded); on [Decision.Deferred] the message is parked.
     */
    public fun offer(message: PhoneToHud, nowMs: Long): Decision {
        val type = message.wireType
        val interval = minIntervalMs[type] ?: return Decision.SendNow
        val last = lastSentAt[type]
        if (last == null || nowMs - last >= interval || nowMs < last) {
            pending.remove(type)
            lastSentAt[type] = nowMs
            return Decision.SendNow
        }
        pending[type] = message
        return Decision.Deferred(last + interval)
    }

    /** Parked messages whose interval has elapsed at [nowMs] (their send time is recorded). */
    public fun drainDue(nowMs: Long): List<PhoneToHud> {
        if (pending.isEmpty()) return emptyList()
        val due = ArrayList<PhoneToHud>()
        val iterator = pending.entries.iterator()
        while (iterator.hasNext()) {
            val (type, message) = iterator.next()
            val interval = minIntervalMs[type] ?: 0L
            val last = lastSentAt[type]
            if (last == null || nowMs - last >= interval || nowMs < last) {
                due += message
                lastSentAt[type] = nowMs
                iterator.remove()
            }
        }
        return due
    }

    /** When the earliest parked message becomes due, or null when nothing is parked. */
    public fun nextReleaseAtMs(): Long? =
        pending.keys.minOfOrNull { type -> (lastSentAt[type] ?: 0L) + (minIntervalMs[type] ?: 0L) }

    /** Forget all history, e.g. on a new connection (the first message of each type goes out at once). */
    public fun reset() {
        lastSentAt.clear()
        pending.clear()
    }

    public companion object {
        public val DEFAULT_INTERVALS_MS: Map<String, Long> =
            mapOf(
                "nav" to 250L,
                "location" to 1_000L,
                "media" to 500L,
                "road" to 500L,
                "hazards" to 500L,
            )
    }
}
