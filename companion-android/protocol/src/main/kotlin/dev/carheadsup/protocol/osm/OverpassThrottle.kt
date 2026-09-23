package dev.carheadsup.protocol.osm

import dev.carheadsup.protocol.link.ReconnectBackoff

/**
 * Keeps the app a polite Overpass client (the public instances allow roughly one request at a
 * time and a few per minute per client): at most one request per [minIntervalMs], and after a
 * failure (network error, 429 "rate limited", 504 "server busy") an exponentially growing pause,
 * or the server's `Retry-After` when longer. Not thread-safe; confine to one coroutine.
 */
public class OverpassThrottle(
    private val minIntervalMs: Long = 10_000,
    private val backoff: ReconnectBackoff = ReconnectBackoff(initialMs = 30_000, maxMs = 15 * 60_000L, jitter = 0.1),
) {
    private var nextAllowedAt: Long = Long.MIN_VALUE
    private var inFlight = false

    public fun canRequest(nowMs: Long): Boolean = !inFlight && nowMs >= nextAllowedAt

    /** Earliest time the next request may start. */
    public fun nextAllowedAtMs(): Long = nextAllowedAt

    public fun onRequestStarted(nowMs: Long) {
        inFlight = true
        nextAllowedAt = nowMs + minIntervalMs
    }

    public fun onSuccess(nowMs: Long) {
        inFlight = false
        backoff.reset()
        nextAllowedAt = maxOf(nextAllowedAt, nowMs + minIntervalMs)
    }

    /** @param retryAfterMs the server's `Retry-After`, if it sent one. */
    public fun onFailure(nowMs: Long, retryAfterMs: Long? = null) {
        inFlight = false
        val pause = maxOf(backoff.nextDelayMs(), retryAfterMs ?: 0L)
        nextAllowedAt = nowMs + pause
    }
}

/** How long cached tile data is trusted. Speed limits change rarely; stale data beats none offline. */
public object TileFreshness {
    /** Refetch a tile after a week when online. */
    public const val REFRESH_AFTER_MS: Long = 7L * 24 * 60 * 60 * 1000

    /** Never use tile data older than this. */
    public const val MAX_AGE_MS: Long = 90L * 24 * 60 * 60 * 1000

    public fun needsRefresh(fetchedAtMs: Long, nowMs: Long): Boolean =
        nowMs - fetchedAtMs >= REFRESH_AFTER_MS || nowMs < fetchedAtMs

    public fun isUsable(fetchedAtMs: Long, nowMs: Long): Boolean =
        nowMs - fetchedAtMs < MAX_AGE_MS && nowMs >= fetchedAtMs
}
