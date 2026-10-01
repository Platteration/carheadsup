package dev.carheadsup.protocol.api

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.decodeFromJsonElement

/** Totals over a set of trips. Fuel and cost only count trips that report them. */
public data class TripTotals(
    val trips: Int,
    val distanceKm: Double,
    val durationS: Double,
    val fuelUsedL: Double?,
    /** Summed cost per currency code. */
    val costByCurrency: Map<String, Double>,
)

/**
 * The phone's copy of the HUD's trip log, merged from `trip-completed` pushes, `trips` answers
 * and `GET /api/trips`. Pure functions over immutable lists; persistence is the app's job
 * ([encode]/[decode] give it a stable file format).
 */
public object TripLog {
    public const val DEFAULT_LIMIT: Int = 1_000

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Merges [incoming] into [existing]: one entry per trip id (the incoming version wins, the
     * HUD may have corrected it), newest first by end time, at most [limit] entries.
     */
    public fun merge(
        existing: List<TripRecord>,
        incoming: List<TripRecord>,
        limit: Int = DEFAULT_LIMIT,
    ): List<TripRecord> {
        val byId = LinkedHashMap<String, TripRecord>()
        for (trip in existing) byId[trip.id] = trip
        for (trip in incoming) byId[trip.id] = trip
        return byId.values.sortedWith(compareByDescending<TripRecord> { it.endedAt }.thenBy { it.id }).take(limit)
    }

    /** Removes a trip (e.g. after `DELETE /api/trips/:id`). */
    public fun remove(existing: List<TripRecord>, id: String): List<TripRecord> = existing.filterNot { it.id == id }

    /**
     * End time of the newest trip without a sequence number (recorded by an older HUD version),
     * for `trips-request.since`; 0 when there is none. Numbered trips are synced by number
     * instead ([TripCursors]): their times are only as right as the HUD's clock was.
     */
    public fun syncCursor(trips: List<TripRecord>): Long =
        trips.filter { it.seq == null }.maxOfOrNull { it.endedAt } ?: 0L

    public fun totals(trips: List<TripRecord>): TripTotals {
        val fuel = trips.mapNotNull { it.fuelUsedL?.takeIf(Double::isFinite) }
        val costs = LinkedHashMap<String, Double>()
        for (trip in trips) {
            val cost = trip.cost?.takeIf(Double::isFinite) ?: continue
            costs[trip.currency] = (costs[trip.currency] ?: 0.0) + cost
        }
        return TripTotals(
            trips = trips.size,
            distanceKm = trips.sumOf { it.distanceKm },
            durationS = trips.sumOf { it.durationS },
            fuelUsedL = if (fuel.isEmpty()) null else fuel.sum(),
            costByCurrency = costs,
        )
    }

    public fun encode(trips: List<TripRecord>): String =
        json.encodeToString(kotlinx.serialization.builtins.ListSerializer(TripRecord.serializer()), trips)

    /**
     * Decodes a stored log (or a `GET /api/trips` body). Malformed entries are skipped rather than
     * failing the whole log; a body that is not a JSON array yields an empty list.
     */
    public fun decode(body: String): List<TripRecord> {
        val array =
            try {
                json.parseToJsonElement(body) as? JsonArray
            } catch (e: SerializationException) {
                null
            } catch (e: IllegalArgumentException) {
                null
            } ?: return emptyList()
        return array.mapNotNull { element ->
            try {
                json.decodeFromJsonElement<TripRecord>(element)
            } catch (e: SerializationException) {
                null
            } catch (e: IllegalArgumentException) {
                null
            }
        }
    }
}
