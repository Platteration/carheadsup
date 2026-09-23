package dev.carheadsup.protocol.nav

import dev.carheadsup.protocol.Maneuver
import dev.carheadsup.protocol.ManeuverType
import dev.carheadsup.protocol.PhoneMessages
import dev.carheadsup.protocol.PhoneNav
import java.time.Clock
import java.util.Locale

/**
 * The text fields of a notification, extracted on the phone from `Notification.extras`
 * (`android.title`, `android.text`, `android.subText`, `android.bigText`, and the Android 16
 * Live Update status-chip text `android.shortCriticalText`).
 */
public data class NavNotificationContent(
    val packageName: String,
    val title: String?,
    val text: String?,
    val subText: String?,
    val bigText: String? = null,
    val shortCriticalText: String? = null,
    /** `Notification.category`; Google Maps uses "navigation" for turn-by-turn. */
    val category: String? = null,
    /** `StatusBarNotification.isOngoing`. */
    val isOngoing: Boolean = true,
)

/**
 * Parses Google Maps' ongoing turn-by-turn notification into a [PhoneNav].
 *
 * Google Maps has no public navigation API; its notification is the only source and its format
 * drifts between app versions. Observed layout (2023–2026):
 * - **title**: distance to the next maneuver ("300 m", "0.2 mi", "500 ft", "100 yd") — or,
 *   without a distance, the instruction itself ("Head north on Main St", "Rerouting…");
 * - **text**: the instruction or street ("Turn right onto Main St", "Main St toward Downtown",
 *   "toward Downtown");
 * - **subText**: "12 min · 5.2 km · 10:42 ETA" (English) or "12 Min. · 5,2 km · Ankunft 10:42"
 *   (German), with no-break spaces;
 * - the large icon is the maneuver arrow (handled by the app, see `PhoneNav.iconPng`).
 *
 * The parser therefore classifies each piece by what it looks like rather than by position,
 * keeps language knowledge in [NavLanguage] tables, and degrades gracefully: an unrecognised
 * instruction yields [ManeuverType.UNKNOWN] (the HUD then shows the Maps icon), missing parts
 * are null. Returns null for anything that is not an active navigation notification (location
 * sharing, trip suggestions, other packages).
 */
public class GoogleMapsNotificationParser(
    private val languages: List<NavLanguage> = NavLanguages.ALL,
    private val drivingSide: DrivingSide = DrivingSide.RIGHT,
) {
    init {
        require(languages.isNotEmpty()) { "at least one language is required" }
    }

    /**
     * Parses [content]; [drivingSide] is where traffic keeps to right now (it can change during a
     * drive, e.g. from France into the UK), defaulting to the side given at construction.
     */
    public fun parse(
        content: NavNotificationContent,
        clock: Clock,
        drivingSide: DrivingSide = this.drivingSide,
    ): PhoneNav? {
        if (content.packageName != GOOGLE_MAPS_PACKAGE) return null
        val isNavigationCategory = content.category == CATEGORY_NAVIGATION
        if (!content.isOngoing && !isNavigationCategory) return null

        val title = normalize(content.title)
        val text = normalize(content.text)
        val subText = normalize(content.subText)
        val bigLines = content.bigText?.lines()?.mapNotNull(::normalize).orEmpty()
        val chip = normalize(content.shortCriticalText)

        val language = detectLanguage(listOfNotNull(title, text) + bigLines, subText)

        // Title: a distance, a distance plus an instruction, or an instruction.
        var distanceM: Double? = null
        var titleInstruction: String? = null
        if (title != null) {
            distanceM = Quantities.parseDistance(title, language)
            if (distanceM == null) {
                val split = DISTANCE_PREFIXED.find(title)
                val prefixed = split?.let { Quantities.parseDistance(it.groupValues[1], language) }
                if (split != null && prefixed != null) {
                    distanceM = prefixed
                    titleInstruction = split.groupValues[2]
                } else {
                    titleInstruction = title
                }
            }
        }
        if (distanceM == null && chip != null) distanceM = Quantities.parseDistance(chip, language)

        // Follow-up maneuvers: whole lines ("Then turn left") and inline clauses ("Turn left, then
        // keep right"), which are cut off so that they cannot decide this maneuver or its street.
        val thenLines = (listOfNotNull(text) + bigLines).mapNotNull {
            language.thenMarker.find(it)?.groupValues?.get(1)
        }.toMutableList()
        fun mainClause(part: String?): String? {
            if (part == null || language.thenMarker.find(part) != null) return null
            val separator = language.inlineThen?.find(part) ?: return part
            part.substring(separator.range.last + 1).trim().takeIf { it.isNotEmpty() }?.let(thenLines::add)
            return part.substring(0, separator.range.first).trim().ifEmpty { null }
        }
        val titleClause = mainClause(titleInstruction)
        val instructionParts =
            (listOf(titleClause, mainClause(text)) + (if (text == null) bigLines.map(::mainClause) else emptyList()))
                .filterNotNull()
                .distinct()

        val summary = subText?.let { parseSummary(it, language) } ?: Summary()
        val hasQuantities =
            distanceM != null || summary.remainingSeconds != null || summary.remainingDistanceM != null ||
                summary.eta != null
        if (!isNavigationCategory && !hasQuantities) return null

        // A title is a distance or a sentence, never a bare street name.
        val guidance =
            parseGuidance(instructionParts, language, instructionParts - setOfNotNull(titleClause), drivingSide)
        val thenManeuver = thenLines.firstNotNullOfOrNull { line ->
            parseGuidance(listOf(line), language, bareCandidates = emptyList(), drivingSide).toManeuver(line)
        }
        val maneuver = Maneuver(
            type = guidance.type,
            roundaboutExit = guidance.roundaboutExit,
            instruction = instructionParts.joinToString(" ").ifEmpty { null },
        )
        val remainingSeconds = summary.remainingSeconds
        val etaEpochMs = summary.eta?.let { EtaResolver.resolve(it.hour, it.minute, clock, remainingSeconds) }
        val derivedRemaining =
            remainingSeconds ?: etaEpochMs?.let { ((it - clock.millis()) / 1000.0).coerceAtLeast(0.0) }

        return PhoneNav(
            active = true,
            source = PhoneMessages.SOURCE_GOOGLE_MAPS,
            maneuver = maneuver,
            distanceM = distanceM,
            street = guidance.street,
            currentStreet = guidance.currentStreet,
            then = thenManeuver,
            lanes = null,
            etaEpochMs = etaEpochMs,
            remainingDistanceM = summary.remainingDistanceM,
            remainingSeconds = derivedRemaining,
            iconPng = null,
        )
    }

    private data class Summary(
        val remainingSeconds: Double? = null,
        val remainingDistanceM: Double? = null,
        val eta: Quantities.ClockTime? = null,
    )

    /** "12 min · 5.2 km · 10:42 ETA": each segment is classified by its content, in any order. */
    private fun parseSummary(subText: String, language: NavLanguage): Summary {
        var seconds: Double? = null
        var distance: Double? = null
        var markedEta: Quantities.ClockTime? = null
        var anyClock: Quantities.ClockTime? = null
        for (segment in subText.split(SUMMARY_SEPARATOR).map { it.trim() }.filter { it.isNotEmpty() }) {
            val duration = Quantities.parseDuration(segment, language)
            if (duration != null) {
                if (seconds == null) seconds = duration
                continue
            }
            val meters = Quantities.parseDistance(segment, language)
            if (meters != null) {
                if (distance == null) distance = meters
                continue
            }
            val clock = Quantities.findClockTime(segment, language) ?: continue
            if (language.etaMarkers.containsMatchIn(segment.lowercase(Locale.ROOT))) {
                if (markedEta == null) markedEta = clock
            } else {
                anyClock = clock
            }
        }
        return Summary(seconds, distance, markedEta ?: anyClock)
    }

    private data class Guidance(
        val type: ManeuverType,
        val kind: ManeuverKind?,
        val roundaboutExit: Int?,
        val street: String?,
        val currentStreet: String?,
    ) {
        fun toManeuver(instruction: String): Maneuver? =
            kind?.let { Maneuver(type = type, roundaboutExit = roundaboutExit, instruction = instruction) }
    }

    /**
     * Maneuver, roundabout exit and streets from the instruction [parts]. [bareCandidates] are
     * the parts that may be a bare street name when no maneuver verb is found (the notification
     * text, but never a title, which is a distance or a sentence).
     */
    private fun parseGuidance(
        parts: List<String>,
        language: NavLanguage,
        bareCandidates: List<String>,
        drivingSide: DrivingSide,
    ): Guidance {
        // The maneuver comes from the first part that names one: its head (before the street
        // part) first, so a street such as "Exit Rd" cannot masquerade as a maneuver. Leading
        // lane guidance ("Use the right lane to …") is set aside: its side is the lanes' side.
        var found: ManeuverMatch? = null
        var primaryPart: String? = null
        var primary: LaneGuidance? = null
        for (part in parts) {
            val guidance = language.withoutLaneGuidance(part)
            val lower = guidance.instruction.lowercase(Locale.ROOT)
            val head = language.streetStart.find(lower)?.let { lower.substring(0, it.range.first) } ?: lower
            found = language.findManeuver(head) ?: language.findManeuver(lower)
            if (found != null) {
                primaryPart = part
                primary = guidance
                break
            }
        }
        val kind = found?.kind
        val lowerPrimary = primary?.instruction?.lowercase(Locale.ROOT)
        // The side named with the maneuver ("turn left") wins; then any side named in the
        // instruction ("take the exit on the left"); the lanes to use only hint at it last.
        val side = found?.side ?: lowerPrimary?.let(language::sideOf) ?: primary?.laneSide
        val type = kind?.resolve(side, drivingSide) ?: ManeuverType.UNKNOWN
        val exit = if (kind == ManeuverKind.ROUNDABOUT) lowerPrimary?.let(language::roundaboutExitOf) else null

        val streetParts = parts.filter { !language.statusText.containsMatchIn(it) }
        val street =
            when (kind) {
                ManeuverKind.ARRIVE -> null

                // No verb: the text may be the street itself, possibly with a direction.
                null ->
                    bareCandidates
                        .filter { !language.statusText.containsMatchIn(it) }
                        .firstNotNullOfOrNull { bareStreet(it, language) }

                else -> {
                    val others =
                        streetParts.filter { it != primaryPart }.map { language.withoutLaneGuidance(it).instruction }
                    val ordered = listOfNotNull(primary?.instruction) + others
                    ordered.firstNotNullOfOrNull { streetFromPattern(it, language) }
                }
            }
        return Guidance(
            type = type,
            kind = kind,
            roundaboutExit = exit,
            street = street,
            currentStreet = if (kind == ManeuverKind.STRAIGHT) street else null,
        )
    }

    private fun streetFromPattern(text: String, language: NavLanguage): String? {
        for (pattern in language.streetPatterns) {
            val captured = pattern.pattern.find(text)?.groupValues?.get(1) ?: continue
            cleanStreet(captured, language)?.let { return it }
        }
        return null
    }

    /**
     * Text without a maneuver verb: "Main St toward Downtown", "toward Downtown", "Main St". Only
     * text that reads as a name is taken for the street — the HUD shows the street while moving,
     * so an unrecognised sentence ("Pass through the toll plaza") must not end up there; a street
     * named inside such a sentence ("Enter the tunnel on I-90 E") is still found.
     */
    private fun bareStreet(text: String, language: NavLanguage): String? {
        language.towardOnly.find(text)?.let { return cleanStreet(it.groupValues[1], language) }
        val toward = language.bareStreetToward.find(text)
        if (toward == null &&
            (Quantities.parseDistance(text, language) != null || Quantities.findClockTime(text, language) != null)
        ) {
            return null
        }
        // The name test runs before cleanStreet strips anything: "Durch den Tunnel fahren" is an
        // instruction even though "Durch den Tunnel" alone could be a name.
        val candidate = toward?.groupValues?.get(1) ?: text
        val name = if (looksLikeName(candidate.trim(), language)) cleanStreet(candidate, language) else null
        return name
            ?: streetFromPattern(text, language)
            ?: toward?.let { cleanStreet(it.groupValues[2], language) }
    }

    private fun cleanStreet(raw: String, language: NavLanguage): String? {
        var street = raw.trim().trimEnd('.', ',', ';', ':', '·', '-', '–').trim()
        language.trailingVerbs?.let { street = street.replace(it, "").trim() }
        language.leadingArticle?.let { street = street.replace(it, "").trim() }
        if (street.isEmpty() || street.length > MAX_STREET_CHARS) return null
        if (language.notAStreet.containsMatchIn(street)) return null
        if (street.none { it.isLetterOrDigit() }) return null
        if (!looksLikeName(street, language)) return null
        return street
    }

    /**
     * Whether [text] reads as a name ("Main St", "I-90 E", "Rue de la Paix", "Unter den Linden")
     * rather than a sentence ("Cross the bridge", "Mautstelle passieren"): a few words, no
     * clause punctuation, mostly capitalised, not ending in a lower-case word (German
     * instructions end in a verb) and not opening like an instruction.
     */
    private fun looksLikeName(text: String, language: NavLanguage): Boolean {
        if (text.any { it in CLAUSE_PUNCTUATION }) return false
        if (language.sentence?.containsMatchIn(text) == true) return false
        val words = text.split(' ').filter { it.isNotEmpty() }
        if (words.size > MAX_STREET_WORDS) return false
        val lettered = words.filter { it.first().isLetter() }
        val last = lettered.lastOrNull() ?: return true
        if (last.first().isLowerCase()) return false
        return lettered.count { it.first().isLowerCase() } * 2 <= lettered.size
    }

    private fun detectLanguage(instructions: List<String>, summary: String?): NavLanguage {
        if (languages.size == 1) return languages.first()
        val lowerInstructions = instructions.map { it.lowercase(Locale.ROOT) }
        val lowerSummary = summary?.lowercase(Locale.ROOT)
        // maxBy keeps the first maximum, so the preferred (first) language wins ties.
        return languages.maxBy { it.score(lowerInstructions, lowerSummary) }
    }

    public companion object {
        public const val GOOGLE_MAPS_PACKAGE: String = "com.google.android.apps.maps"
        public const val CATEGORY_NAVIGATION: String = "navigation"
        private const val MAX_STREET_CHARS = 100
        private const val MAX_STREET_WORDS = 8
        private const val CLAUSE_PUNCTUATION = ",;!?"

        private val SUMMARY_SEPARATOR = Regex("\\s*[·•‧∙|]\\s*")
        private val DISTANCE_PREFIXED = Regex("^(.{1,24}?)\\s*[-–—·•:|]\\s+(.+)$")
        private val SPACES = Regex("[\\u00a0\\u2007\\u2009\\u200a\\u202f\\u3000\\t]")
        private val INVISIBLE = Regex("[\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff]")
        private val RUNS = Regex(" {2,}")

        /** Collapses the no-break/thin spaces and bidi marks Maps uses; null when blank. */
        internal fun normalize(value: String?): String? = value
            ?.replace(INVISIBLE, "")
            ?.replace(SPACES, " ")
            ?.replace(RUNS, " ")
            ?.trim()
            ?.ifEmpty { null }
    }
}
