package dev.carheadsup.protocol.nav

import dev.carheadsup.protocol.ManeuverType
import java.util.Locale

/** Left or right, as named in an instruction. */
public enum class Side { LEFT, RIGHT }

/** Maneuver families recognised from instruction text; the concrete type also depends on side. */
public enum class ManeuverKind {
    ROUNDABOUT,
    UTURN,
    FORK,
    EXIT,
    RAMP,
    MERGE,
    SHARP,
    SLIGHT,
    KEEP,
    TURN,
    ARRIVE,
    FERRY,
    STRAIGHT,
    ;

    /**
     * The concrete maneuver for this family given the side named in the instruction ([side],
     * null when none) and the traffic side (used for roundabouts, U-turns and default exit sides).
     * Returns [ManeuverType.UNKNOWN] when the family needs a side and none can be inferred.
     */
    public fun resolve(side: Side?, drivingSide: DrivingSide): ManeuverType {
        // Exits, ramps and merges without a named side are on the kerb side in practice:
        // right-hand traffic exits to the right and merges leftwards into traffic.
        val kerb = if (drivingSide == DrivingSide.RIGHT) Side.RIGHT else Side.LEFT
        val traffic = if (kerb == Side.RIGHT) Side.LEFT else Side.RIGHT
        val roundabout = if (drivingSide == DrivingSide.RIGHT) {
            ManeuverType.ROUNDABOUT_CCW
        } else {
            ManeuverType.ROUNDABOUT_CW
        }
        fun pick(s: Side?, left: ManeuverType, right: ManeuverType, fallback: ManeuverType = ManeuverType.UNKNOWN) =
            when (s) {
                Side.LEFT -> left
                Side.RIGHT -> right
                null -> fallback
            }
        return when (this) {
            ROUNDABOUT -> roundabout
            UTURN -> pick(side ?: traffic, ManeuverType.UTURN_LEFT, ManeuverType.UTURN_RIGHT)
            FORK -> pick(side, ManeuverType.FORK_LEFT, ManeuverType.FORK_RIGHT)
            EXIT -> pick(side ?: kerb, ManeuverType.EXIT_LEFT, ManeuverType.EXIT_RIGHT)
            RAMP -> pick(side ?: kerb, ManeuverType.RAMP_LEFT, ManeuverType.RAMP_RIGHT)
            MERGE -> pick(side ?: traffic, ManeuverType.MERGE_LEFT, ManeuverType.MERGE_RIGHT)
            SHARP -> pick(side, ManeuverType.SHARP_LEFT, ManeuverType.SHARP_RIGHT)
            SLIGHT -> pick(side, ManeuverType.SLIGHT_LEFT, ManeuverType.SLIGHT_RIGHT)
            KEEP -> pick(side, ManeuverType.KEEP_LEFT, ManeuverType.KEEP_RIGHT)
            TURN -> pick(side, ManeuverType.LEFT, ManeuverType.RIGHT)
            ARRIVE -> pick(side, ManeuverType.ARRIVE_LEFT, ManeuverType.ARRIVE_RIGHT, ManeuverType.ARRIVE)
            FERRY -> ManeuverType.FERRY
            STRAIGHT -> ManeuverType.STRAIGHT
        }
    }
}

/** An instruction pattern (matched against lower-cased text) and the maneuver family it signals. */
public class ManeuverRule(public val pattern: Regex, public val kind: ManeuverKind)

/** A maneuver found in an instruction: its family and the side named inside the matching words. */
public data class ManeuverMatch(val kind: ManeuverKind, val side: Side?)

/**
 * An instruction without its leading lane guidance ("Use the right lane to turn left" → "turn
 * left"), and the side of the lanes (a hint for maneuvers that name no side themselves).
 */
public data class LaneGuidance(val instruction: String, val laneSide: Side?)

/**
 * Extracts the street a maneuver leads onto: group 1 of [pattern], matched on the original text
 * (case-insensitively). For "continue"/"head" maneuvers it is also the current street.
 */
public class StreetPattern(public val pattern: Regex)

/**
 * Everything language-specific about Google Maps' navigation notification text. Adding a language
 * means adding one of these (see [NavLanguages]); the parser itself has no language knowledge.
 * All keyword patterns are matched against text lower-cased with `Locale.ROOT`.
 */
public class NavLanguage(
    /** BCP 47 language code, e.g. "en". */
    public val code: String,
    /** Decimal separator used for distances ("1.2 km" vs "1,2 km"). */
    public val decimalSeparator: Char,
    /** Maneuver rules, most specific first; the first match wins. */
    public val maneuverRules: List<ManeuverRule>,
    /** A side named explicitly, e.g. "on the left"; group 1 is a side word. */
    public val explicitSide: Regex,
    /** Any side word; group 1 is the word. Only searched before the street part of the text. */
    public val sideWord: Regex,
    public val leftWords: Set<String>,
    public val rightWords: Set<String>,
    /** Where the street part of an instruction starts (side words after it are street names). */
    public val streetStart: Regex,
    /** Street-name patterns, tried in order on each instruction. */
    public val streetPatterns: List<StreetPattern>,
    /** "Main St toward Downtown" without a verb: group 1 is the street, group 2 the direction. */
    public val bareStreetToward: Regex,
    /** Text that is only a direction: "toward Downtown"; group 1 is the destination. */
    public val towardOnly: Regex,
    /** Captures that are not street names (e.g. "the left" from "on the left"). */
    public val notAStreet: Regex,
    /** Trailing verbs to strip from captured street names (German puts verbs last). */
    public val trailingVerbs: Regex?,
    /** A leading article to strip from street names ("onto the A40" → "A40"). */
    public val leadingArticle: Regex?,
    /** Status lines that are neither instructions nor streets ("Rerouting…", "GPS signal lost"). */
    public val statusText: Regex,
    /** Roundabout exit number: group 1 is digits or an ordinal word from [ordinalWords]. */
    public val roundaboutExit: Regex,
    public val ordinalWords: Map<String, Int>,
    /** A follow-up maneuver line such as "Then turn left"; group 1 is the instruction. */
    public val thenMarker: Regex,
    /** Duration units (lower-case, without trailing dot) → seconds. */
    public val durationUnits: Map<String, Int>,
    /** "less than" prefix of durations ("< 1 min"). */
    public val lessThan: Regex,
    /** Words that mark a clock time as the arrival time ("ETA", "Ankunft"). */
    public val etaMarkers: Regex,
    public val amMarkers: Set<String>,
    public val pmMarkers: Set<String>,
    /** Extra distance unit spellings (lower-case) → metres, on top of the universal symbols. */
    public val distanceUnits: Map<String, Double>,
    /** Words that may precede a distance in the title ("In 300 m"). */
    public val distancePrefix: Regex,
    /**
     * Leading lane guidance, matched on the original text: "Use the right lane to ", "Rechte Spur
     * benutzen, um ". Group 1 describes the lanes ("the right", "rechte"). The lanes' side is not
     * the maneuver's side: "Use the right lane to turn left" is a left turn.
     */
    public val laneGuidance: Regex? = null,
    /**
     * Separator of an inline follow-up maneuver, matched on the original text: ", then " in
     * "Turn left, then keep right". The text after it is the next maneuver.
     */
    public val inlineThen: Regex? = null,
    /**
     * Text that reads as a sentence rather than a name when it has no known maneuver verb
     * ("Pass through the toll plaza", "Cross the bridge"); matched on the original text.
     */
    public val sentence: Regex? = null,
) {
    /** The maneuver family named in [lowerText], or null. */
    public fun matchManeuver(lowerText: String): ManeuverKind? = findManeuver(lowerText)?.kind

    /**
     * The maneuver named in [lowerText] (first matching rule), with the side named within the
     * matching words ("turn left", "keep right", "halblinks"), if any. The side is taken from the
     * match itself so that other side words in the instruction — lane guidance, street names, a
     * follow-up clause — cannot flip it.
     */
    public fun findManeuver(lowerText: String): ManeuverMatch? {
        for (rule in maneuverRules) {
            val match = rule.pattern.find(lowerText) ?: continue
            val side = sideWord.findAll(match.value).firstNotNullOfOrNull { wordSide(it.groupValues[1]) }
            return ManeuverMatch(rule.kind, side)
        }
        return null
    }

    /** [text] without leading lane guidance, and the lanes' side (see [laneGuidance]). */
    public fun withoutLaneGuidance(text: String): LaneGuidance {
        val match = laneGuidance?.find(text) ?: return LaneGuidance(text, null)
        val rest = text.substring(match.range.last + 1).trim()
        if (rest.isEmpty()) return LaneGuidance(text, null)
        val lanes = match.groupValues[1].lowercase(Locale.ROOT)
        val side = sideWord.findAll(lanes).firstNotNullOfOrNull { wordSide(it.groupValues[1]) }
        return LaneGuidance(rest, side)
    }

    /** The side named in [lowerText]: explicit phrases anywhere, else a side word before the street part. */
    public fun sideOf(lowerText: String): Side? {
        explicitSide.find(lowerText)?.let { return wordSide(it.groupValues[1]) }
        val head = streetStart.find(lowerText)?.let { lowerText.substring(0, it.range.first) } ?: lowerText
        return sideWord.find(head)?.let { wordSide(it.groupValues[1]) }
    }

    private fun wordSide(word: String): Side? = when (word) {
        in leftWords -> Side.LEFT
        in rightWords -> Side.RIGHT
        else -> null
    }

    /** Roundabout exit number named in [lowerText] (1-based), or null. */
    public fun roundaboutExitOf(lowerText: String): Int? {
        val token = roundaboutExit.find(lowerText)?.groupValues?.get(1) ?: return null
        return token.toIntOrNull() ?: ordinalWords[token]
    }

    private val durationDetector: Regex =
        Regex(
            "\\d\\s*(?:" + durationUnits.keys.sortedByDescending {
                it.length
            }.joinToString("|") { Regex.escape(it) } +
                ")(?![\\p{L}])",
        )

    /** Detection score of this language for the given lower-cased instruction and summary texts. */
    internal fun score(lowerInstructions: List<String>, lowerSummary: String?): Int {
        var score = 2 * lowerInstructions.count { text -> maneuverRules.any { it.pattern.containsMatchIn(text) } }
        score +=
            lowerInstructions.count { text ->
                streetPatterns.any { it.pattern.containsMatchIn(text) } || towardOnly.containsMatchIn(text)
            }
        if (lowerSummary != null) {
            if (etaMarkers.containsMatchIn(lowerSummary)) score += 2
            if (durationDetector.containsMatchIn(lowerSummary)) score += 1
        }
        return score
    }
}
