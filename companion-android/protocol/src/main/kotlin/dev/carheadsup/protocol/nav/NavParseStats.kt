package dev.carheadsup.protocol.nav

import dev.carheadsup.protocol.ManeuverType
import dev.carheadsup.protocol.PhoneNav
import kotlin.math.max

/**
 * How well the phone understands Google Maps' guidance, for the Status screen: when it does not,
 * the HUD simply shows no arrow, and nobody could tell whether notification access, an
 * unsupported language or a new Maps format is to blame.
 */
public data class NavParseStats(
    /** Updates understood with their maneuver. */
    val understood: Int = 0,
    /** Updates understood but for the maneuver: the HUD shows Maps' own arrow. */
    val unknownManeuver: Int = 0,
    /** Navigation notifications not understood at all: no guidance on the HUD. */
    val notUnderstood: Int = 0,
    /** When the last one was not understood (monotonic ms), if any. */
    val lastNotUnderstoodAtMs: Long? = null,
    /** When guidance last reached the HUD from Maps (monotonic ms), if ever. */
    val lastGuidanceAtMs: Long? = null,
) {
    /**
     * [result] is what the parser made of [content] at [nowMs]. A Maps notification that is not
     * about navigation (location sharing, a trip suggestion) is not counted as misunderstood: only
     * ones Maps marks as navigation are.
     */
    public fun record(content: NavNotificationContent, result: PhoneNav?, nowMs: Long): NavParseStats = when {
        result != null && result.maneuver?.type == ManeuverType.UNKNOWN ->
            copy(unknownManeuver = unknownManeuver + 1, lastGuidanceAtMs = nowMs)

        result != null -> copy(understood = understood + 1, lastGuidanceAtMs = nowMs)

        content.category == GoogleMapsNotificationParser.CATEGORY_NAVIGATION ->
            copy(notUnderstood = notUnderstood + 1, lastNotUnderstoodAtMs = nowMs)

        else -> this
    }

    /** Updates counted so far. */
    val total: Int get() = understood + unknownManeuver + notUnderstood
}

/**
 * Android Auto: while the phone projects to the car's display, Google Maps guides there, the
 * phone's own guidance notification is usually missing or bare, and no other app can read
 * Android Auto's guidance — so the HUD gets none. Detected from Android Auto's ongoing
 * notification ([PACKAGE]) or the phone's car mode.
 */
public object AndroidAuto {
    /** Android Auto's package ("gearhead"). */
    public const val PACKAGE: String = "com.google.android.projection.gearhead"

    /** How long projection may run without guidance from the phone before the app says why. */
    public const val QUIET_MS: Long = 15_000

    /**
     * Whether to tell the driver that the HUD cannot get guidance while Android Auto projects:
     * projecting since [projectingSinceMs] (null: not projecting), and no guidance from the
     * phone's Maps ([lastGuidanceAtMs]) for [QUIET_MS] since then, at [nowMs] (monotonic ms).
     */
    public fun noticeDue(projectingSinceMs: Long?, lastGuidanceAtMs: Long?, nowMs: Long): Boolean {
        val since = projectingSinceMs ?: return false
        val quietSince = max(since, lastGuidanceAtMs ?: since)
        return nowMs - quietSince >= QUIET_MS
    }
}
