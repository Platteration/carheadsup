package dev.carheadsup.protocol.nav

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import java.time.Clock
import java.time.ZoneId
import java.time.ZonedDateTime

class QuantitiesTest {
    private val en = NavLanguages.ENGLISH
    private val de = NavLanguages.GERMAN

    @ParameterizedTest
    @CsvSource(
        delimiter = '|',
        value = [
            "300 m | 300.0",
            "300m | 300.0",
            "1.2 km | 1200.0",
            "1,2 km | 1200.0",
            "0.3 mi | 482.8032",
            "500 ft | 152.4",
            "1,500 ft | 457.2",
            "100 yd | 91.44",
            "½ mi | 804.672",
            "1½ mi | 2414.016",
            "In 300 m | 300.0",
            "2 miles | 3218.688",
            "250 metres | 250.0",
            "0 m | 0.0",
        ],
    )
    fun `english distances`(text: String, meters: Double) {
        assertEquals(meters, Quantities.parseDistance(text, en)!!, 1e-6)
    }

    @ParameterizedTest
    @CsvSource(
        delimiter = '|',
        value = [
            "1,2 km | 1200.0", "1.500 m | 1500.0", "1,500 km | 1500.0", "800 m | 800.0", "In 300 m | 300.0",
            "nach 2 km | 2000.0",
        ],
    )
    fun `german distances`(text: String, meters: Double) {
        assertEquals(meters, Quantities.parseDistance(text, de)!!, 1e-6)
    }

    @ParameterizedTest
    @ValueSource(strings = ["", "m", "km", "12 min", "Main St", "5 km away", "1..2 km", "1,,2 km", "three km", "10:42"])
    fun `non-distances`(text: String) {
        assertNull(Quantities.parseDistance(text, en))
    }

    @ParameterizedTest
    @CsvSource(
        delimiter = '|',
        value = [
            "1 | '.' | 1.0",
            "1.5 | '.' | 1.5",
            "1,5 | '.' | 1.5",
            "1,500 | '.' | 1500.0",
            "1,500 | ',' | 1.5",
            "1.500 | ',' | 1500.0",
            "1,234.5 | '.' | 1234.5",
            "1.234,5 | ',' | 1234.5",
            "1,234,567 | '.' | 1234567.0",
        ],
    )
    fun `number separators`(text: String, decimal: Char, expected: Double) {
        assertEquals(expected, Quantities.parseNumber(text, decimal)!!, 1e-9)
    }

    @Test
    fun `malformed numbers`() {
        assertNull(Quantities.parseNumber("", '.'))
        assertNull(Quantities.parseNumber(".5", '.'))
        assertNull(Quantities.parseNumber("1,23,456", '.'))
        assertNull(Quantities.parseNumber("1.234.56", ','))
    }

    @ParameterizedTest
    @CsvSource(
        delimiter = '|',
        value = [
            "12 min | 720.0",
            "1 hr 5 min | 3900.0",
            "1 h 5 min | 3900.0",
            "2 hr | 7200.0",
            "1 day 3 hr | 97200.0",
            "45 mins | 2700.0",
            "< 1 min | 30.0",
            "less than 1 minute | 30.0",
        ],
    )
    fun `english durations`(text: String, seconds: Double) {
        assertEquals(seconds, Quantities.parseDuration(text, en))
    }

    @ParameterizedTest
    @CsvSource(
        delimiter = '|',
        value = [
            "12 Min. | 720.0", "1 Std. 5 Min. | 3900.0", "2 Std. | 7200.0", "1 Tag 2 Std. | 93600.0", "<1 Min. | 30.0",
        ],
    )
    fun `german durations`(text: String, seconds: Double) {
        assertEquals(seconds, Quantities.parseDuration(text, de))
    }

    @ParameterizedTest
    @ValueSource(strings = ["", "5.2 km", "10:42 ETA", "12", "min", "12 min late", "about 12 min"])
    fun `non-durations`(text: String) {
        assertNull(Quantities.parseDuration(text, en))
    }

    @ParameterizedTest
    @CsvSource(
        delimiter = '|',
        value = [
            "10:42 ETA | 10 | 42",
            "10:42 AM ETA | 10 | 42",
            "10:42 PM ETA | 22 | 42",
            "12:05 AM ETA | 0 | 5",
            "12:30 PM | 12 | 30",
            "9.05 p.m. | 21 | 5",
            "Ankunft 23:59 | 23 | 59",
            "11:55 Uhr | 11 | 55",
            "ETA 7:03pm | 19 | 3",
        ],
    )
    fun `clock times`(text: String, hour: Int, minute: Int) {
        assertEquals(Quantities.ClockTime(hour, minute), Quantities.findClockTime(text, en))
    }

    @ParameterizedTest
    @ValueSource(strings = ["", "ETA", "25:00", "10:61", "13:00 PM", "0:30 AM", "1.2 km"])
    fun `invalid clock times`(text: String) {
        assertNull(Quantities.findClockTime(text, en))
    }

    @Test
    fun `ETA resolution picks the next occurrence, tolerating rounding`() {
        val zone = ZoneId.of("Europe/Berlin")
        val clock = Clock.fixed(ZonedDateTime.of(2026, 9, 23, 10, 0, 0, 0, zone).toInstant(), zone)
        fun at(day: Int, h: Int, m: Int) = ZonedDateTime.of(2026, 9, day, h, m, 0, 0, zone).toInstant().toEpochMilli()
        assertEquals(at(23, 10, 30), EtaResolver.resolve(10, 30, clock))
        assertEquals(at(23, 9, 57), EtaResolver.resolve(9, 57, clock)) // 3 min "in the past" = rounding
        assertEquals(at(24, 9, 0), EtaResolver.resolve(9, 0, clock)) // an hour ago → tomorrow
        assertEquals(at(24, 1, 0), EtaResolver.resolve(1, 0, clock, remainingSeconds = 15.0 * 3600))
        assertEquals(at(25, 10, 0), EtaResolver.resolve(10, 0, clock, remainingSeconds = 48.0 * 3600))
        assertThrows(IllegalArgumentException::class.java) { EtaResolver.resolve(24, 0, clock) }
    }

    @Test
    fun `ETA inside a DST gap resolves after the gap`() {
        val zone = ZoneId.of("Europe/Berlin")
        // 2026-03-29 02:00 → 03:00 (clocks spring forward).
        val clock = Clock.fixed(ZonedDateTime.of(2026, 3, 29, 1, 50, 0, 0, zone).toInstant(), zone)
        val eta = EtaResolver.resolve(2, 30, clock, remainingSeconds = 600.0)
        assertEquals(ZonedDateTime.of(2026, 3, 29, 3, 30, 0, 0, zone).toInstant().toEpochMilli(), eta)
    }
}
