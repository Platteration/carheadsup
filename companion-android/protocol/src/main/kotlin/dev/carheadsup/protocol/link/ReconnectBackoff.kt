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

    /**
     * Delay after the session was closed with WebSocket close [code] (null when it just failed).
     * A session the HUD replaced ([PhoneCloseCode.REPLACED]: a newer session with this phone's
     * device id took over — normally this phone's own reconnect, or a copy of the app's data on
     * another phone) waits the maximum like a refusal: coming straight back would take the HUD
     * from that session, which would do the same, and the two would swap every second.
     */
    public fun delayAfterClose(code: Int?): Long =
        if (code == PhoneCloseCode.REPLACED) refusedDelayMs() else nextDelayMs()

    public fun reset() {
        attempts = 0
    }
}

/** WebSocket close codes the HUD uses on `/ws/phone` (hud-server `PHONE_CLOSE`). */
public object PhoneCloseCode {
    /** A newer session from this phone (same `hello.deviceId`) replaced this one. */
    public const val REPLACED: Int = 4000

    /** Wrong pairing token. */
    public const val BAD_TOKEN: Int = 4001

    /** Protocol version mismatch. */
    public const val UNSUPPORTED_VERSION: Int = 4002

    /** Try again later: too many connections waiting, or another phone is connected. */
    public const val BUSY: Int = 1013

    /** This phone did not read what the HUD sent (its unsent backlog passed 1 MiB). */
    public const val NOT_READING: Int = 1008
}
