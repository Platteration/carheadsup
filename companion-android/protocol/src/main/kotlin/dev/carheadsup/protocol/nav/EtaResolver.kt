package dev.carheadsup.protocol.nav

import java.time.Clock
import java.time.Duration
import java.time.LocalTime
import java.time.ZonedDateTime
import kotlin.math.abs

/**
 * Turns a wall-clock arrival time ("10:42") into an absolute instant.
 *
 * The notification only shows hour and minute, so the date is inferred: with a known remaining
 * duration the candidate day closest to `now + remaining` wins (this also handles multi-day
 * trips); otherwise the next occurrence at or after now (with a few minutes of tolerance for
 * rounding) is used, which crosses midnight correctly ("00:15" seen at 23:50 is tomorrow).
 * DST gaps resolve to the first valid instant after the gap.
 */
public object EtaResolver {
    private val PAST_TOLERANCE: Duration = Duration.ofMinutes(5)

    public fun resolve(hour: Int, minute: Int, clock: Clock, remainingSeconds: Double? = null): Long {
        require(hour in 0..23 && minute in 0..59) { "invalid clock time $hour:$minute" }
        val now = clock.instant()
        val zone = clock.zone
        val today = now.atZone(zone).toLocalDate()
        val time = LocalTime.of(hour, minute)
        val candidates = (-1L..3L).map { ZonedDateTime.of(today.plusDays(it), time, zone).toInstant() }
        val chosen =
            if (remainingSeconds != null && remainingSeconds.isFinite() && remainingSeconds >= 0) {
                val target = now.plusMillis((remainingSeconds * 1000).toLong())
                candidates.minBy { abs(Duration.between(target, it).toMillis()) }
            } else {
                val earliest = now.minus(PAST_TOLERANCE)
                candidates.first { !it.isBefore(earliest) }
            }
        return chosen.toEpochMilli()
    }
}
