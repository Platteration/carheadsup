package dev.carheadsup.protocol.link

import kotlin.math.min
import kotlin.math.pow
import kotlin.random.Random

/**
 * Exponential reconnect backoff with jitter: `initialMs · multiplier^attempt`, capped at
 * [maxMs], then spread by ±[jitter] so a fleet of phones does not reconnect in lock-step.
 * Call [reset] once a session is established (the HUD answered `welcome`).
 */
public class ReconnectBackoff(
    private val initialMs: Long = 1_000,
    private val maxMs: Long = 30_000,
    private val multiplier: Double = 2.0,
    private val jitter: Double = 0.2,
    private val random: Random = Random.Default,
) {
    init {
        require(initialMs > 0) { "initialMs must be positive" }
        require(maxMs >= initialMs) { "maxMs must be >= initialMs" }
        require(multiplier >= 1.0) { "multiplier must be >= 1" }
        require(jitter in 0.0..1.0) { "jitter must be within 0..1" }
    }

    /** Failed attempts since the last [reset]. */
    public var attempts: Int = 0
        private set

    /** Delay before the next attempt; advances the attempt counter. */
    public fun nextDelayMs(): Long {
        val base = min(maxMs.toDouble(), initialMs * multiplier.pow(attempts.coerceAtMost(62)))
        attempts++
        if (jitter == 0.0) return base.toLong()
        val factor = 1.0 + random.nextDouble(-jitter, jitter)
        return (base * factor).toLong().coerceIn(1, (maxMs * (1.0 + jitter)).toLong())
    }

    /** Delay used after the HUD refused us for a reason retrying will not fix soon (bad token). */
    public fun refusedDelayMs(): Long {
        attempts++
        return maxMs
    }

    public fun reset() {
        attempts = 0
    }
}
