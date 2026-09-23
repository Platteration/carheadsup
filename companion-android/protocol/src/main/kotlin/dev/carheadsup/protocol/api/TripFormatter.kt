package dev.carheadsup.protocol.api

import dev.carheadsup.protocol.MaintenanceStatusKind
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Currency
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Formats trip and maintenance data for the phone UI in the driver's units (the HUD's
 * `units` config): distances in km or mi, fuel in litres or (US/imperial) gallons, economy in
 * L/100 km, km/L or mpg, money in the trip's currency.
 */
public class TripFormatter(
    private val units: DisplayUnits,
    private val locale: Locale,
    private val zone: ZoneId,
    private val use24HourClock: Boolean = true,
) {
    private val imperial get() = units.system == UnitSystem.IMPERIAL

    private fun number(value: Double, decimals: Int): String = String.format(locale, "%,.${decimals}f", value)

    /** Distance with 1 decimal below 100, whole units above: "12.3 km", "7.6 mi", "240 km". */
    public fun distance(km: Double): String {
        val value = if (imperial) km / KM_PER_MILE else km
        return distanceWith(km, if (abs(value) < 100) 1 else 0)
    }

    private fun distanceWith(km: Double, decimals: Int): String {
        val value = if (imperial) km / KM_PER_MILE else km
        val unit = if (imperial) "mi" else "km"
        return "${number(value, decimals)} $unit"
    }

    /** "42 min", "1 h 05 min", "< 1 min". */
    public fun duration(seconds: Double): String {
        if (!seconds.isFinite() || seconds < 60) return "< 1 min"
        val minutes = (seconds / 60).roundToLong()
        val hours = minutes / 60
        return if (hours == 0L) "$minutes min" else String.format(Locale.ROOT, "%d h %02d min", hours, minutes % 60)
    }

    /** Fuel volume: "1.23 L", or gallons matching the economy unit ("0.33 gal"). */
    public fun fuel(liters: Double?): String? {
        if (liters == null || !liters.isFinite()) return null
        return when (units.fuelEconomy) {
            FuelEconomyUnit.MPG_US -> "${number(liters / LITERS_PER_US_GALLON, 2)} gal"
            FuelEconomyUnit.MPG_UK -> "${number(liters / LITERS_PER_UK_GALLON, 2)} gal"
            else -> "${number(liters, 2)} L"
        }
    }

    /** Fuel economy in the configured unit, from L/100 km: "6.1 L/100 km", "38.6 mpg". */
    public fun economy(lPer100km: Double?): String? {
        if (lPer100km == null || !lPer100km.isFinite() || lPer100km <= 0) return null
        return when (units.fuelEconomy) {
            FuelEconomyUnit.L_PER_100KM -> "${number(lPer100km, 1)} L/100 km"
            FuelEconomyUnit.KM_PER_L -> "${number(100 / lPer100km, 1)} km/L"
            FuelEconomyUnit.MPG_US -> "${number(MPG_US_FACTOR / lPer100km, 1)} mpg"
            FuelEconomyUnit.MPG_UK -> "${number(MPG_UK_FACTOR / lPer100km, 1)} mpg"
        }
    }

    /** Speed: "87 km/h" / "54 mph". */
    public fun speed(kph: Double): String =
        if (imperial) "${number(kph / KM_PER_MILE, 0)} mph" else "${number(kph, 0)} km/h"

    /** Money in [currency] (ISO 4217), e.g. "€4.20"; plain "4.20 XYZ" for unknown codes. */
    public fun cost(amount: Double?, currency: String): String? {
        if (amount == null || !amount.isFinite()) return null
        val code = currency.trim().uppercase(Locale.ROOT)
        return try {
            NumberFormat.getCurrencyInstance(locale).apply { this.currency = Currency.getInstance(code) }.format(amount)
        } catch (e: IllegalArgumentException) {
            "${number(amount, 2)} $code".trim()
        }
    }

    /** "Tue 23 Sep · 08:12–08:47" in the phone's zone. */
    public fun timeRange(startedAtMs: Long, endedAtMs: Long): String {
        val day = DateTimeFormatter.ofPattern("EEE d MMM", locale)
        val time = DateTimeFormatter.ofPattern(if (use24HourClock) "HH:mm" else "h:mm a", locale)
        val start = Instant.ofEpochMilli(startedAtMs).atZone(zone)
        val end = Instant.ofEpochMilli(endedAtMs).atZone(zone)
        val endText = if (end.toLocalDate() == start.toLocalDate()) {
            time.format(end)
        } else {
            "${day.format(end)} ${time.format(end)}"
        }
        return "${day.format(start)} · ${time.format(start)}–$endText"
    }

    /** One line for lists: "12.3 km · 24 min · 0.87 L · €1.52". */
    public fun summary(trip: TripRecord): String = listOfNotNull(
        distance(trip.distanceKm),
        duration(trip.durationS),
        fuel(trip.fuelUsedL),
        cost(trip.cost, trip.currency),
    ).joinToString(" · ")

    /**
     * Remaining distance/time of a maintenance item: "in 1,200 km or 30 days", or only the
     * exceeded limits when overdue: "overdue by 300 km". Null when neither is known.
     */
    public fun maintenanceRemaining(item: MaintenanceItemStatus): String? {
        val km = item.remainingKm?.takeIf { it.isFinite() }
        val days = item.remainingDays?.takeIf { it.isFinite() }
        val overdue =
            listOfNotNull(
                km?.takeIf {
                    it < 0
                }?.let { distanceWith(-it, 0) },
                days?.takeIf { it < 0 }?.let { dayCount(-it) },
            )
        if (overdue.isNotEmpty()) return "overdue by ${overdue.joinToString(" and ")}"
        val remaining = listOfNotNull(km?.let { distanceWith(it, 0) }, days?.let(::dayCount))
        return if (remaining.isEmpty()) null else "in ${remaining.joinToString(" or ")}"
    }

    private fun dayCount(days: Double): String {
        val d = days.roundToLong()
        return if (d == 1L) "1 day" else "$d days"
    }

    public companion object {
        public const val KM_PER_MILE: Double = 1.609344
        public const val LITERS_PER_US_GALLON: Double = 3.785411784
        public const val LITERS_PER_UK_GALLON: Double = 4.54609

        /** mpg(US) = 235.214583… / (L/100 km). */
        public const val MPG_US_FACTOR: Double = 100 * LITERS_PER_US_GALLON / KM_PER_MILE

        /** mpg(UK) = 282.480936… / (L/100 km). */
        public const val MPG_UK_FACTOR: Double = 100 * LITERS_PER_UK_GALLON / KM_PER_MILE

        /** Short label for a maintenance status. */
        public fun statusLabel(status: MaintenanceStatusKind): String = when (status) {
            MaintenanceStatusKind.OK -> "OK"
            MaintenanceStatusKind.DUE_SOON -> "Due soon"
            MaintenanceStatusKind.OVERDUE -> "Overdue"
            MaintenanceStatusKind.UNKNOWN -> "Unknown"
        }
    }
}
