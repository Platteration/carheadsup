package dev.carheadsup.protocol.nav

import java.util.Locale

/** Parsing of the distances, durations and clock times Google Maps prints. */
internal object Quantities {
    private val FRACTIONS = mapOf('¼' to 0.25, '½' to 0.5, '¾' to 0.75)

    /** A number with optional separators and an optional vulgar fraction, then a unit word. */
    private val DISTANCE =
        Regex("(\\d+(?:[.,]\\d+)*)?\\s*([¼½¾])?\\s*([\\p{L}]+)\\.?")

    /**
     * Parses [text] when it is *exactly* one distance ("300 m", "1.2 km", "1,2 km", "0.3 mi",
     * "500 ft", "100 yd", "½ mi", "In 300 m"); returns metres or null.
     */
    fun parseDistance(text: String, language: NavLanguage): Double? {
        val lower = text.trim().lowercase(Locale.ROOT)
        val body = language.distancePrefix.find(lower)?.let { lower.substring(it.range.last + 1) } ?: lower
        val match = DISTANCE.matchEntire(body.trim()) ?: return null
        val numberText = match.groupValues[1]
        val fraction = match.groupValues[2].firstOrNull()?.let { FRACTIONS[it] } ?: 0.0
        if (numberText.isEmpty() && fraction == 0.0) return null
        val number = if (numberText.isEmpty()) {
            0.0
        } else {
            parseNumber(numberText, language.decimalSeparator)
                ?: return null
        }
        val unit = match.groupValues[3]
        val factor = NavLanguages.UNIVERSAL_DISTANCE_UNITS[unit] ?: language.distanceUnits[unit] ?: return null
        return (number + fraction) * factor
    }

    /**
     * Parses a number with locale separators. A separator followed by exactly three digits is a
     * thousands separator unless it is the language's decimal separator and the only one; any other
     * separator is the decimal point. So "1,2" is 1.2 everywhere, "1,500" is 1500 in English and
     * 1.5 in German, and "1.500" is 1500 in German.
     */
    fun parseNumber(text: String, decimalSeparator: Char): Double? {
        if (text.isEmpty() || !text[0].isDigit()) return null
        val separators = text.filter { it == '.' || it == ',' }
        if (separators.isEmpty()) return text.toDoubleOrNull()
        val groups = text.split('.', ',')
        if (groups.any { it.isEmpty() }) return null
        val last = groups.last()
        val lastSeparator = separators.last()
        val lastIsDecimal =
            when {
                last.length != 3 -> true
                separators.length == 1 -> lastSeparator == decimalSeparator
                else -> lastSeparator != separators.first()
            }
        if (!lastIsDecimal) {
            if (groups.drop(1).any { it.length != 3 }) return null
            return groups.joinToString("").toDoubleOrNull()
        }
        // The decimal separator may appear only once ("1.234.56" is ambiguous).
        if (separators.count { it == lastSeparator } > 1) return null
        val integerGroups = groups.dropLast(1)
        if (integerGroups.size > 1 && integerGroups.drop(1).any { it.length != 3 }) return null
        return (integerGroups.joinToString("") + "." + last).toDoubleOrNull()
    }

    private val DURATION_TOKEN = Regex("(\\d+)\\s*([\\p{L}]+)\\.?")
    private val DURATION_FILLER = Regex("[\\s,]+|\\b(?:and|und)\\b")

    /**
     * Parses [text] when it is exactly a duration ("12 min", "1 hr 5 min", "1 h 5 min",
     * "2 Std. 10 Min.", "1 day 3 hr", "< 1 min"); returns seconds or null. "Less than one
     * minute" counts as 30 s.
     */
    fun parseDuration(text: String, language: NavLanguage): Double? {
        var lower = text.trim().lowercase(Locale.ROOT)
        val lessThan = language.lessThan.find(lower)
        if (lessThan != null) lower = lower.substring(lessThan.range.last + 1)
        var total = 0.0
        var matched = 0
        var cursor = 0
        for (token in DURATION_TOKEN.findAll(lower)) {
            val gap = lower.substring(cursor, token.range.first)
            if (gap.isNotEmpty() && gap.replace(DURATION_FILLER, "").isNotEmpty()) return null
            val unitSeconds = language.durationUnits[token.groupValues[2]] ?: return null
            total += token.groupValues[1].toLong() * unitSeconds.toDouble()
            matched++
            cursor = token.range.last + 1
        }
        if (matched == 0 || lower.substring(cursor).isNotBlank()) return null
        return if (lessThan != null) total / 2 else total
    }

    /** A wall-clock time. */
    data class ClockTime(val hour: Int, val minute: Int)

    private val CLOCK =
        Regex("(?<![\\d:.])(\\d{1,2})[:.](\\d{2})(?!\\d)(?:\\s*(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)(?![\\p{L}]))?")

    /** The first clock time in [text] ("10:42", "10:42 PM", "9.05 a.m."), or null. */
    fun findClockTime(text: String, language: NavLanguage): ClockTime? {
        val lower = text.lowercase(Locale.ROOT)
        for (match in CLOCK.findAll(lower)) {
            var hour = match.groupValues[1].toInt()
            val minute = match.groupValues[2].toInt()
            if (minute > 59) continue
            val meridiem = match.groupValues[3].replace(".", "").replace(" ", "")
            when {
                meridiem.isEmpty() -> if (hour > 23) continue

                meridiem in language.amMarkers || meridiem == "am" -> {
                    if (hour !in 1..12) continue
                    if (hour == 12) hour = 0
                }

                meridiem in language.pmMarkers || meridiem == "pm" -> {
                    if (hour !in 1..12) continue
                    if (hour != 12) hour += 12
                }

                else -> continue
            }
            return ClockTime(hour, minute)
        }
        return null
    }
}
