package dev.carheadsup.protocol.traffic

import dev.carheadsup.protocol.link.ReconnectBackoff
import dev.carheadsup.protocol.osm.Geo
import dev.carheadsup.protocol.osm.LatLon

/**
 * Requests per day, so a free API key's daily quota (TomTom: 2,500 non-tile requests a day) is
 * never exceeded, with room to spare for other uses of the same key. Days are UTC days
 * ([dayOf]); a clock that goes back to an earlier day keeps counting on the current one. Not
 * thread-safe.
 */
public class TrafficBudget(public val dailyLimit: Int = DEFAULT_DAILY_LIMIT) {
    init {
        require(dailyLimit > 0) { "dailyLimit must be positive" }
    }

    /** The day [used] counts (a [dayOf] value), or [Long.MIN_VALUE] before the first request. */
    public var day: Long = Long.MIN_VALUE
        private set

    public var used: Int = 0
        private set

    /** Requests made on [day]. */
    public fun usedOn(day: Long): Int = if (day <= this.day) used else 0

    public fun remaining(day: Long): Int = (dailyLimit - usedOn(day)).coerceAtLeast(0)

    /** Counts a request on [day]; false (and nothing counted) when the day's budget is used up. */
    public fun tryConsume(day: Long): Boolean {
        if (day > this.day) {
            this.day = day
            used = 0
        }
        if (used >= dailyLimit) return false
        used++
        return true
    }

    /** Restores a saved count (after an app restart). */
    public fun restore(day: Long, used: Int) {
        this.day = day
        this.used = used.coerceAtLeast(0)
    }

    public companion object {
        /** 80 % of TomTom's free 2,500 requests a day. */
        public const val DEFAULT_DAILY_LIMIT: Int = 2_000
        private const val DAY_MS = 24L * 60 * 60 * 1000

        /** The UTC day of a wall-clock time (days since 1970-01-01). */
        public fun dayOf(epochMs: Long): Long = Math.floorDiv(epochMs, DAY_MS)
    }
}

/** A GPS fix as the traffic policy sees it. */
public data class TrafficFix(
    val position: LatLon,
    /** Direction of travel (the last known one while slow), or null when unknown. */
    val headingDeg: Double?,
    /** Speed, m/s, or null when unknown. */
    val speedMps: Double?,
)

/** What [TrafficPolicy.decide] says about asking the service now. */
public enum class TrafficDecision {
    /** Ask now (then call [TrafficPolicy.onRequestStarted]). */
    REQUEST,

    /** The data is recent enough for where the car is and where it is heading. */
    UP_TO_DATE,

    /** A request is running. */
    IN_FLIGHT,

    /** No direction of travel yet (parked since the start): nothing counts as ahead. */
    NO_HEADING,

    /** The car has been standing for a while: no polling until it moves. */
    STATIONARY,

    /** Due, but waiting: the minimum interval, or backing off after a failure. */
    WAITING,

    /** The service refused the API key; nothing more is asked with it. */
    BAD_KEY,

    /** Today's request budget is used up. */
    BUDGET_EXHAUSTED,
}

/**
 * When to ask a traffic service for the incidents ahead. Pure and clock-agnostic: times are
 * monotonic milliseconds, days come from [TrafficBudget.dayOf]. Not thread-safe; confine it.
 *
 * - Poll every [pollIntervalMs] (2 min) while driving, and at once after moving
 *   [refreshAfterM] (3 km) or turning by [refreshAfterTurnDeg] from where and how the last
 *   answer was asked for — but never more often than every [minIntervalMs].
 * - A car stopped at lights or in a queue keeps polling (the delay changes); one that has stood
 *   still for [stationaryPauseMs] (5 min: parked, a long wait) stops until it moves again.
 * - Failures back off exponentially (30 s → 15 min, or the server's `Retry-After`); a refused
 *   key ([onBadKey]) stops all requests — the caller makes a new policy when the key changes.
 * - Every request counts against the [budget]; once it is used up, nothing is asked until the
 *   next (UTC) day.
 * - Data older than [maxDataAgeMs] (10 min) is no longer used ([dataUsable]): a missing warning
 *   is better than a stale one.
 */
public class TrafficPolicy(
    public val budget: TrafficBudget = TrafficBudget(),
    private val pollIntervalMs: Long = 120_000,
    private val minIntervalMs: Long = 60_000,
    private val refreshAfterM: Double = 3_000.0,
    private val refreshAfterTurnDeg: Double = 60.0,
    private val movingSpeedMps: Double = 2.0,
    private val stationaryPauseMs: Long = 5 * 60_000L,
    private val maxDataAgeMs: Long = 10 * 60_000L,
    private val backoff: ReconnectBackoff = ReconnectBackoff(initialMs = 30_000, maxMs = 15 * 60_000L, jitter = 0.1),
) {
    private var inFlight = false
    private var badKey = false
    private var nextAllowedAt = Long.MIN_VALUE
    private var stationarySince: Long? = null
    private var moving = false

    /** Where, when and in which direction the running request, and the last answered one, asked. */
    private var pending: Asked? = null
    private var answered: Asked? = null

    private class Asked(val atMs: Long, val position: LatLon, val headingDeg: Double)

    /** Whether the key was refused. */
    public val keyRefused: Boolean get() = badKey

    /** Earliest time the next request may start (after the minimum interval or a backoff). */
    public fun nextAllowedAtMs(): Long = nextAllowedAt

    /** Called with every fix: whether to ask the service now, and if not, why. */
    public fun decide(fix: TrafficFix, nowMs: Long, day: Long): TrafficDecision {
        trackMotion(fix.speedMps, nowMs)
        val heading = fix.headingDeg
        return when {
            badKey -> TrafficDecision.BAD_KEY
            inFlight -> TrafficDecision.IN_FLIGHT
            heading == null -> TrafficDecision.NO_HEADING
            isPaused(nowMs) -> TrafficDecision.STATIONARY
            !isDue(fix.position, heading, nowMs) -> TrafficDecision.UP_TO_DATE
            nowMs < nextAllowedAt -> TrafficDecision.WAITING
            budget.remaining(day) <= 0 -> TrafficDecision.BUDGET_EXHAUSTED
            else -> TrafficDecision.REQUEST
        }
    }

    /**
     * A request for [fix] starts: counts it against the budget. False (and nothing starts) when
     * the day's budget is used up or the fix has no heading.
     */
    public fun onRequestStarted(fix: TrafficFix, nowMs: Long, day: Long): Boolean {
        val heading = fix.headingDeg ?: return false
        if (!budget.tryConsume(day)) return false
        inFlight = true
        pending = Asked(nowMs, fix.position, heading)
        nextAllowedAt = nowMs + minIntervalMs
        return true
    }

    public fun onSuccess(nowMs: Long) {
        inFlight = false
        answered = pending
        pending = null
        backoff.reset()
        nextAllowedAt = maxOf(nextAllowedAt, nowMs + minIntervalMs)
    }

    /** A failed request (network, 429, 5xx, unreadable answer); [retryAfterMs] from the server. */
    public fun onFailure(nowMs: Long, retryAfterMs: Long? = null) {
        inFlight = false
        pending = null
        nextAllowedAt = nowMs + maxOf(backoff.nextDelayMs(), retryAfterMs ?: 0L)
    }

    /** The service refused the key (401/403). */
    public fun onBadKey() {
        inFlight = false
        pending = null
        badKey = true
    }

    /** Whether data fetched at [fetchedAtMs] may still be shown at [nowMs]. */
    public fun dataUsable(fetchedAtMs: Long, nowMs: Long): Boolean =
        nowMs >= fetchedAtMs && nowMs - fetchedAtMs <= maxDataAgeMs

    private fun trackMotion(speedMps: Double?, nowMs: Long) {
        moving = speedMps != null && speedMps.isFinite() && speedMps >= movingSpeedMps
        stationarySince = if (moving) null else stationarySince ?: nowMs
    }

    private fun isPaused(nowMs: Long): Boolean {
        val since = stationarySince ?: return false
        return nowMs - since >= stationaryPauseMs
    }

    private fun isDue(position: LatLon, headingDeg: Double, nowMs: Long): Boolean {
        val last = answered ?: return true
        if (nowMs < last.atMs || nowMs - last.atMs >= pollIntervalMs) return true
        if (Geo.distanceM(last.position, position) >= refreshAfterM) return true
        return moving && Geo.angleDiffDeg(last.headingDeg, headingDeg) >= refreshAfterTurnDeg
    }
}

/** What the traffic look-up is doing, for the companion's status line. */
public enum class TrafficState {
    /** Switched off (or the service is not running). */
    OFF,

    /** Switched on without an API key. */
    NO_KEY,

    /** No GPS fix or direction of travel yet. */
    WAITING_FOR_LOCATION,

    /** Working: updated recently, or the first request is on its way. */
    ACTIVE,

    /** The car has been standing for a while; polling resumes when it moves. */
    PAUSED,

    /** The last request failed; retrying with backoff. */
    ERROR,

    /** The service refused the API key. */
    BAD_KEY,

    /** Today's request budget is used up. */
    BUDGET_EXHAUSTED,
}

/** The traffic look-up's state for the UI. */
public data class TrafficStatus(
    val state: TrafficState,
    /** Wall-clock time of the last successful update, if any. */
    val lastUpdateWallMs: Long? = null,
    /** Incidents ahead, as last sent to the HUD. */
    val incidentsAhead: Int = 0,
    /** What went wrong last (HTTP status, network error), while [state] is ERROR or BAD_KEY. */
    val error: String? = null,
    val requestsToday: Int = 0,
    val dailyBudget: Int = TrafficBudget.DEFAULT_DAILY_LIMIT,
) {
    public companion object {
        /** The state for a policy [decision], given whether the last request failed. */
        public fun stateOf(decision: TrafficDecision, lastRequestFailed: Boolean): TrafficState = when (decision) {
            TrafficDecision.BAD_KEY -> TrafficState.BAD_KEY

            TrafficDecision.BUDGET_EXHAUSTED -> TrafficState.BUDGET_EXHAUSTED

            TrafficDecision.NO_HEADING -> TrafficState.WAITING_FOR_LOCATION

            TrafficDecision.STATIONARY -> TrafficState.PAUSED

            TrafficDecision.REQUEST,
            TrafficDecision.UP_TO_DATE,
            TrafficDecision.IN_FLIGHT,
            TrafficDecision.WAITING,
            -> if (lastRequestFailed) TrafficState.ERROR else TrafficState.ACTIVE
        }
    }
}
