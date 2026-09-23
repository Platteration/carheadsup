package dev.carheadsup.protocol.nav

import java.time.Clock
import java.time.Duration
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZonedDateTime
import kotlin.math.abs
import kotlin.math.max

/**
 * Turns a wall-clock arrival time ("10:42") into an absolute instant.
 *
 * The notification only shows hour and minute, so the date is inferred: with a known remaining
 * duration the candidate day closest to `now + remaining` wins (this also handles multi-day
 * trips); otherwise the next occurrence at or after now (with a few minutes of tolerance for
 * rounding) is used, which crosses midnight correctly ("00:15" seen at 23:50 is tomorrow).
 * A time that occurs twice (the night the clocks go back) is considered at both offsets; DST
 * gaps resolve to the first valid instant after the gap. A clock time far from `now + remaining`
 * (e.g. one shown in another time zone) is not trusted: the remaining duration wins.
 */
public object EtaResolver {
    private val PAST_TOLERANCE: Duration = Duration.ofMinutes(5)

    /** Least disagreement with `now + remaining` at which the clock time is dropped. */
    private val MIN_DISAGREEMENT: Duration = Duration.ofMinutes(20)

    /** Share of the remaining time the clock time may be off by (the duration text is rounded). */
    private const val DISAGREEMENT_SHARE = 0.1

    public fun resolve(hour: Int, minute: Int, clock: Clock, remainingSeconds: Double? = null): Long {
        require(hour in 0..23 && minute in 0..59) { "invalid clock time $hour:$minute" }
        val now = clock.instant()
        val zone = clock.zone
        val today = now.atZone(zone).toLocalDate()
        val time = LocalTime.of(hour, minute)
        val candidates =
            (-1L..3L).flatMap { day ->
                val local = ZonedDateTime.of(LocalDateTime.of(today.plusDays(day), time), zone)
                listOf(local.withEarlierOffsetAtOverlap().toInstant(), local.withLaterOffsetAtOverlap().toInstant())
                    .distinct()
            }
        if (remainingSeconds == null || !remainingSeconds.isFinite() || remainingSeconds < 0) {
            val earliest = now.minus(PAST_TOLERANCE)
            return candidates.first { !it.isBefore(earliest) }.toEpochMilli()
        }
        val remainingMs = (remainingSeconds * 1000).toLong()
        val target = now.plusMillis(remainingMs)
        val chosen = candidates.minBy { abs(Duration.between(target, it).toMillis()) }
        val tolerance = max(MIN_DISAGREEMENT.toMillis(), (remainingMs * DISAGREEMENT_SHARE).toLong())
        return if (abs(Duration.between(target, chosen).toMillis()) > tolerance) {
            target.toEpochMilli()
        } else {
            chosen.toEpochMilli()
        }
    }
}
