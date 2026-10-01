package dev.carheadsup.protocol.api

import dev.carheadsup.protocol.PhoneTripsRequest
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * How far the phone's trip log has caught up with each HUD it talks to: the highest trip
 * sequence number ([TripRecord.seq]) received from each, by HUD id. HUDs number their trips
 * 1, 2, 3 … whatever their clock does — a Pi without a real-time clock can restore the same time
 * at every boot, so end times say nothing about which trips the phone is missing — and each HUD
 * counts on its own, hence one cursor per HUD.
 *
 * Only `trips` answers and `trip-completed` pushes move a cursor (not `GET /api/trips`, which
 * returns the newest trips only). A pushed trip is the HUD's newest: one numbered below the
 * cursor means the HUD started counting anew (its data was reset), so the cursor starts over.
 * Pure and immutable; [encode]/[decode] give the app a file format.
 */
public data class TripCursors(val seqByHud: Map<String, Long> = emptyMap()) {
    /** The cursor for [hudId] (0: nothing numbered received yet). */
    public fun cursor(hudId: String): Long = seqByHud[hudId] ?: 0L

    /**
     * The `trips-request` that catches up with [hudId]: the trips it numbered after its cursor,
     * and — by end time ([TripLog.syncCursor] over [trips], the phone's log) — those an older
     * HUD version recorded without a number. An older HUD ignores `sinceSeq`.
     */
    public fun request(hudId: String, trips: List<TripRecord>): PhoneTripsRequest =
        PhoneTripsRequest(since = TripLog.syncCursor(trips), sinceSeq = cursor(hudId))

    /** [trips] arrived from [hudId]: in a `trips` answer, or pushed as `trip-completed` ([pushed]). */
    public fun received(hudId: String, trips: List<TripRecord>, pushed: Boolean = false): TripCursors {
        val newest = trips.mapNotNull { it.seq }.maxOrNull() ?: return this
        val current = cursor(hudId)
        val next = if (pushed && newest < current) 0L else maxOf(current, newest)
        if (next == current && hudId in seqByHud) return this
        // The HUD just heard from goes last; the oldest are dropped beyond the limit.
        val updated = LinkedHashMap(seqByHud)
        updated.remove(hudId)
        updated[hudId] = next
        while (updated.size > MAX_HUDS) updated.remove(updated.keys.first())
        return TripCursors(updated)
    }

    public fun encode(): String = json.encodeToString(MAP_SERIALIZER, seqByHud)

    public companion object {
        /** HUDs remembered; the ones heard from longest ago are forgotten beyond this. */
        public const val MAX_HUDS: Int = 16

        private val json = Json { ignoreUnknownKeys = true }
        private val MAP_SERIALIZER = MapSerializer(String.serializer(), Long.serializer())

        /** Reads [encode]'s output; anything unreadable is an empty set of cursors. */
        public fun decode(text: String): TripCursors = try {
            TripCursors(json.decodeFromString(MAP_SERIALIZER, text).filterValues { it >= 0 })
        } catch (e: SerializationException) {
            TripCursors()
        } catch (e: IllegalArgumentException) {
            TripCursors()
        }
    }
}
