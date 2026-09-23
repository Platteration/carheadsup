package dev.carheadsup.protocol.nav

import java.util.Locale

/**
 * Built-in languages of the Google Maps notification parser.
 *
 * Patterns use `\b` for word boundaries; [w] rewrites it into a Unicode-aware look-around because
 * `\b` is ASCII-only on recent JDKs but Unicode-aware on Android, and German words start and end
 * with umlauts. Maneuver patterns see lower-cased text; street patterns see the original text.
 */
public object NavLanguages {
    private const val WORD_BOUNDARY =
        "(?:(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}])|(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}]))"

    /** Compiles [pattern] with `\b` meaning a Unicode word boundary. */
    internal fun w(pattern: String, ignoreCase: Boolean = false): Regex {
        val source = pattern.replace("\\b", WORD_BOUNDARY)
        return if (ignoreCase) Regex(source, RegexOption.IGNORE_CASE) else Regex(source)
    }

    private fun rule(pattern: String, kind: ManeuverKind) = ManeuverRule(w(pattern), kind)

    private fun street(pattern: String) = StreetPattern(w(pattern, ignoreCase = true))

    /** Universal unit symbols shared by all languages. */
    internal val UNIVERSAL_DISTANCE_UNITS: Map<String, Double> =
        mapOf("m" to 1.0, "km" to 1000.0, "mi" to 1609.344, "ft" to 0.3048, "yd" to 0.9144)

    public val ENGLISH: NavLanguage =
        NavLanguage(
            code = "en",
            decimalSeparator = '.',
            maneuverRules =
            listOf(
                rule(
                    "\\b(roundabout|traffic circle|rotary)\\b|" +
                        "\\btake the (\\d{1,2}(st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth) exit\\b",
                    ManeuverKind.ROUNDABOUT,
                ),
                rule("\\bu-?turn\\b|\\bturn around\\b", ManeuverKind.UTURN),
                rule("\\bfork\\b", ManeuverKind.FORK),
                rule(
                    "\\btake (the )?exit\\b|\\bexit \\d+[a-z]?\\b|\\bexit (onto|toward|towards|to)\\b",
                    ManeuverKind.EXIT,
                ),
                rule("\\bramp\\b|\\bslip road\\b", ManeuverKind.RAMP),
                rule("\\bmerge\\b|^join\\b", ManeuverKind.MERGE),
                rule("\\bsharp (left|right)\\b", ManeuverKind.SHARP),
                rule("\\bslight(ly)? (left|right)\\b|\\bbear (left|right)\\b", ManeuverKind.SLIGHT),
                rule("\\b(keep|stay) (left|right)\\b", ManeuverKind.KEEP),
                rule(
                    "\\bturn (left|right)\\b|\\bmake a (left|right)\\b|^(left|right) (onto|on|at|to|toward|towards)\\b",
                    ManeuverKind.TURN,
                ),
                rule("\\b(arrive|arrived|arriving|destination)\\b|\\byou have reached\\b", ManeuverKind.ARRIVE),
                rule("\\bferry\\b", ManeuverKind.FERRY),
                rule(
                    "^(continue|head|proceed|drive|stay on|follow)\\b|\\bgo straight\\b|\\bstraight ahead\\b|\\bcontinue straight\\b",
                    ManeuverKind.STRAIGHT,
                ),
            ),
            explicitSide = w("\\b(?:on|to) (?:the|your) (left|right)\\b"),
            sideWord = w("\\b(left|right)\\b"),
            leftWords = setOf("left"),
            rightWords = setOf("right"),
            streetStart = w("\\s(?:onto|on|toward|towards|for|to)\\s"),
            streetPatterns =
            listOf(
                street("\\bonto\\s+(.+?)(?:\\s+towards?\\s+.+)?$"),
                street("\\bon\\s+(?!(?:the|your)\\s+(?:left|right)\\b)(.+?)(?:\\s+towards?\\s+.+)?$"),
                street("\\bfor\\s+(.+?)(?:\\s+towards?\\s+.+)?$"),
                street("\\btowards?\\s+(.+)$"),
                street("^join\\s+(.+?)(?:\\s+towards?\\s+.+)?$"),
                street("\\bto\\s+(?!(?:the|your)\\s+(?:left|right)\\b)(.+)$"),
            ),
            bareStreetToward = w("^(.+?)\\s+towards?\\s+(.+)$", ignoreCase = true),
            towardOnly = w("^towards?\\s+(.+)$", ignoreCase = true),
            notAStreet = w("^(?:(?:the|your)\\s+)?(?:left|right)(?:\\s+side)?$|^stay\\s", ignoreCase = true),
            trailingVerbs = null,
            leadingArticle = w("^the\\s+", ignoreCase = true),
            statusText =
            w(
                "\\b(rerouting|recalculating|searching|getting route|finding route|gps|signal|paused|offline)\\b",
                ignoreCase = true,
            ),
            roundaboutExit =
            w(
                "\\b(\\d{1,2}(?=st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)" +
                    "(?:st|nd|rd|th)? exit\\b",
            ),
            ordinalWords =
            mapOf(
                "first" to 1, "second" to 2, "third" to 3, "fourth" to 4, "fifth" to 5,
                "sixth" to 6, "seventh" to 7, "eighth" to 8, "ninth" to 9, "tenth" to 10,
            ),
            thenMarker = w("^then\\s+(.+)$", ignoreCase = true),
            durationUnits =
            mapOf(
                "d" to 86_400, "day" to 86_400, "days" to 86_400,
                "h" to 3_600, "hr" to 3_600, "hrs" to 3_600, "hour" to 3_600, "hours" to 3_600,
                "min" to 60, "mins" to 60, "minute" to 60, "minutes" to 60,
            ),
            lessThan = w("^(?:<|less than|under)\\s*"),
            etaMarkers = w("\\b(?:eta|arrival|arrive|arriving)\\b"),
            amMarkers = setOf("am"),
            pmMarkers = setOf("pm"),
            distanceUnits =
            mapOf(
                "meter" to 1.0, "meters" to 1.0, "metre" to 1.0, "metres" to 1.0,
                "kilometer" to 1000.0, "kilometers" to 1000.0, "kilometre" to 1000.0, "kilometres" to 1000.0,
                "mile" to 1609.344, "miles" to 1609.344,
                "foot" to 0.3048, "feet" to 0.3048,
                "yard" to 0.9144, "yards" to 0.9144,
            ),
            distancePrefix = w("^(?:in|after)\\s+", ignoreCase = true),
        )

    public val GERMAN: NavLanguage =
        NavLanguage(
            code = "de",
            decimalSeparator = ',',
            maneuverRules =
            listOf(
                rule(
                    "\\b(kreisverkehr|kreisel)\\b|\\b\\d{1,2}\\.\\s*ausfahrt\\b|" +
                        "\\b(erste|zweite|dritte|vierte|fünfte|sechste|siebte|siebente|achte)n? ausfahrt\\b",
                    ManeuverKind.ROUNDABOUT,
                ),
                rule("\\bwenden\\b|\\bkehrtwende\\b|\\bumkehren\\b", ManeuverKind.UTURN),
                rule("\\bgabelung\\b|\\babzweigung\\b", ManeuverKind.FORK),
                rule("\\bausfahrt\\b", ManeuverKind.EXIT),
                rule("\\bauffahrt\\b", ManeuverKind.RAMP),
                rule("\\beinfädeln\\b|\\bauffahren\\b", ManeuverKind.MERGE),
                rule("\\bscharf (links|rechts)\\b", ManeuverKind.SHARP),
                rule("\\bleicht (links|rechts)\\b|\\bhalb(links|rechts)\\b", ManeuverKind.SLIGHT),
                rule(
                    "\\b(links|rechts) halten\\b|\\bhalten sie sich (links|rechts)\\b|\\b(links|rechts) bleiben\\b",
                    ManeuverKind.KEEP,
                ),
                rule(
                    "\\b(links|rechts) abbiegen\\b|\\bbiegen sie (links|rechts) ab\\b|" +
                        "\\bnach (links|rechts) abbiegen\\b|\\babbiegen nach (links|rechts)\\b|^(links|rechts) (auf|in)\\b",
                    ManeuverKind.TURN,
                ),
                rule("\\b(ziel|zielort|angekommen)\\b|\\bziel erreicht\\b", ManeuverKind.ARRIVE),
                rule("\\bfähre\\b", ManeuverKind.FERRY),
                rule(
                    "^(weiter|geradeaus|folgen sie|bleiben sie)\\b|\\bweiterfahren\\b|\\bgeradeaus\\b|" +
                        "^richtung (norden|süden|osten|westen|nordosten|nordwesten|südosten|südwesten)\\b",
                    ManeuverKind.STRAIGHT,
                ),
            ),
            explicitSide = w("\\b(?:auf der |zur )?(linken|rechten) seite\\b|\\bnach (links|rechts)\\b"),
            sideWord = w("(?:\\b|(?<=halb))(links|rechts|linke[nrs]?|rechte[nrs]?)\\b"),
            leftWords = setOf("links", "linke", "linken", "linker", "linkes"),
            rightWords = setOf("rechts", "rechte", "rechten", "rechter", "rechtes"),
            streetStart = w("\\s(?:auf|richtung|in die|in den|in das)\\s"),
            streetPatterns =
            listOf(
                street("\\bauf\\s+(?:die\\s+|den\\s+|der\\s+|das\\s+)?(.+?)(?:\\s+richtung\\s+.+)?$"),
                street("\\bin\\s+(?:die|den|das)\\s+(.+?)(?:\\s+richtung\\s+.+)?$"),
                street("\\brichtung\\s+(.+)$"),
            ),
            bareStreetToward = w("^(.+?)\\s+richtung\\s+(.+)$", ignoreCase = true),
            towardOnly = w("^richtung\\s+(.+)$", ignoreCase = true),
            notAStreet =
            w(
                "^(?:der\\s+)?(?:linken|rechten)(?:\\s+seite)?$|^(?:links|rechts)$|" +
                    "^(?:norden|süden|osten|westen|nordosten|nordwesten|südosten|südwesten)$",
                ignoreCase = true,
            ),
            trailingVerbs =
            w(
                "(?:,?\\s+um)?\\s+(?:zu bleiben|bleiben|auffahren|abbiegen|einfädeln|weiterfahren|fahren|nehmen|folgen|wechseln)$",
                ignoreCase = true,
            ),
            leadingArticle = w("^(?:die|den|der|das)\\s+", ignoreCase = true),
            statusText =
            w(
                "\\b(route wird|neu berechnet|neuberechnung|suche|gps|signal|pausiert|offline)\\b",
                ignoreCase = true,
            ),
            roundaboutExit =
            w(
                "\\b(\\d{1,2}(?=\\.)|erste|zweite|dritte|vierte|fünfte|sechste|siebte|siebente|achte|neunte|zehnte)" +
                    "n?\\.?\\s+ausfahrt\\b",
            ),
            ordinalWords =
            mapOf(
                "erste" to 1, "zweite" to 2, "dritte" to 3, "vierte" to 4, "fünfte" to 5,
                "sechste" to 6, "siebte" to 7, "siebente" to 7, "achte" to 8, "neunte" to 9, "zehnte" to 10,
            ),
            thenMarker = w("^(?:dann|danach|anschließend)\\s+(.+)$", ignoreCase = true),
            durationUnits =
            mapOf(
                "tag" to 86_400, "tage" to 86_400, "tg" to 86_400, "d" to 86_400,
                "std" to 3_600, "stunde" to 3_600, "stunden" to 3_600, "h" to 3_600,
                "min" to 60, "minute" to 60, "minuten" to 60,
            ),
            lessThan = w("^(?:<|weniger als|unter)\\s*"),
            etaMarkers = w("\\b(?:ankunft|ankunftszeit|an)\\b"),
            amMarkers = emptySet(),
            pmMarkers = emptySet(),
            distanceUnits =
            mapOf(
                "meter" to 1.0,
                "kilometer" to 1000.0,
                "meile" to 1609.344,
                "meilen" to 1609.344,
                "fuß" to 0.3048,
                "yard" to 0.9144,
                "yards" to 0.9144,
            ),
            distancePrefix = w("^(?:in|nach)\\s+", ignoreCase = true),
        )

    /** All built-in languages, English first. */
    public val ALL: List<NavLanguage> = listOf(ENGLISH, GERMAN)

    /**
     * [ALL] ordered for a device locale: the locale's language first (it wins ties in language
     * detection), the others after it.
     */
    public fun preferring(locale: Locale): List<NavLanguage> {
        val preferred = ALL.filter { it.code == locale.language }
        return preferred + (ALL - preferred.toSet())
    }
}
