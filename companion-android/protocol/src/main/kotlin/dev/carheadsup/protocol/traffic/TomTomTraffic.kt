package dev.carheadsup.protocol.traffic

import dev.carheadsup.protocol.osm.BoundingBox
import dev.carheadsup.protocol.osm.LatLon
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.net.URLEncoder
import java.util.Locale

/**
 * TomTom Traffic API, Incident Details v5 (`GET /traffic/services/5/incidentDetails`): the
 * incidents inside, or crossing, a bounding box of at most 10,000 km², as GeoJSON features whose
 * geometry is a `Point` or a `LineString` of `[lon, lat]` pairs in the direction of traffic (from
 * the incident's `from` to its `to`). Only the fields used here are requested (`fields=`), in
 * English (the HUD's labels are English; descriptions of dangerous conditions are passed on), and
 * only incidents in effect now (`timeValidityFilter=present`).
 *
 * The API key is a query parameter (TomTom has no header alternative for this endpoint), so the
 * request URL must never be logged. Status codes: 400 malformed request, 403 invalid key, 429 too
 * many requests, 5xx server trouble ([TrafficHttpOutcome]).
 */
public class TomTomTraffic(
    private val baseUrl: String = DEFAULT_BASE_URL,
    private val language: String = DEFAULT_LANGUAGE,
) : TrafficIncidentService {
    init {
        require(baseUrl.startsWith("https://")) { "TomTom is only called over HTTPS" }
        require(language.isNotBlank()) { "language must not be blank" }
    }

    override val name: String = "TomTom"

    override fun request(area: BoundingBox, apiKey: String): TrafficRequest {
        val key = apiKey.trim()
        require(isPlausibleKey(key)) { "not a TomTom API key" }
        require(TrafficCorridor.areaKm2(area) <= MAX_BBOX_KM2) { "bounding box larger than $MAX_BBOX_KM2 km²" }
        val query =
            listOf(
                "key" to key,
                "bbox" to bbox(area),
                "fields" to FIELDS,
                "language" to language,
                "timeValidityFilter" to "present",
            ).joinToString("&") { (name, value) -> "$name=${URLEncoder.encode(value, "UTF-8")}" }
        return TrafficRequest("${baseUrl.trimEnd('/')}$PATH?$query", mapOf("Accept" to "application/json"))
    }

    override fun parse(body: String): List<TrafficIncident> {
        val root =
            try {
                Json.parseToJsonElement(body)
            } catch (e: SerializationException) {
                throw TrafficParseException("invalid TomTom response: ${e.message?.lineSequence()?.firstOrNull()}")
            } catch (e: IllegalArgumentException) {
                throw TrafficParseException("invalid TomTom response: ${e.message?.lineSequence()?.firstOrNull()}")
            }
        val response = root as? JsonObject ?: throw TrafficParseException("TomTom response is not an object")
        // Errors normally come with a 4xx/5xx status; one in a 200 body is reported the same way.
        response.entries.firstOrNull { it.key.trim() == "detailedError" }?.let { (_, error) ->
            val message = (error as? JsonObject)?.string("message") ?: (error as? JsonObject)?.string("code")
            throw TrafficParseException("TomTom error: ${message ?: "unknown"}")
        }
        val incidents = response["incidents"] as? JsonArray ?: throw TrafficParseException("no incidents in response")
        return incidents.mapNotNull { (it as? JsonObject)?.let(::incident) }.distinctBy { it.id }
    }

    private fun incident(feature: JsonObject): TrafficIncident? {
        val properties = feature["properties"] as? JsonObject ?: JsonObject(emptyMap())
        val points = points(feature["geometry"] as? JsonObject) ?: return null
        // Requested with timeValidityFilter=present; anything else, or unlikely, is not "ahead now".
        if (properties.string("timeValidity") == "future") return null
        if (properties.string("probabilityOfOccurrence") == "improbable") return null
        val events = (properties["events"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
        val category = properties.int("iconCategory") ?: events.firstOrNull()?.int("iconCategory")
        val id =
            properties.string("id")
                // Without an id (a projection that left it out), the category and start position
                // still identify the incident from one poll to the next.
                ?: String.format(Locale.ROOT, "at-%d-%.5f-%.5f", category ?: 0, points[0].lat, points[0].lon)
        return TrafficIncident(
            id = ID_PREFIX + id,
            kind = kindOf(category),
            magnitude = magnitudeOf(properties.int("magnitudeOfDelay")),
            delaySeconds = properties.double("delay")?.takeIf { it > 0 },
            lengthM = properties.double("length")?.takeIf { it >= 0 },
            points = points,
            eventDescription = events.firstNotNullOfOrNull { it.string("description") },
            roadNumbers = (properties["roadNumbers"] as? JsonArray).orEmpty().mapNotNull {
                (it as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf(String::isNotEmpty)
            },
        )
    }

    /** `Point` → one position; `LineString` → its positions; invalid coordinates are skipped. */
    private fun points(geometry: JsonObject?): List<LatLon>? {
        val coordinates = geometry?.get("coordinates") as? JsonArray ?: return null
        val points =
            when (geometry.string("type")) {
                "Point" -> listOfNotNull(position(coordinates))

                "LineString" -> coordinates.mapNotNull(::position)

                // A missing or unknown type: tell by the shape.
                else ->
                    if (coordinates.firstOrNull() is JsonArray) {
                        coordinates.mapNotNull(::position)
                    } else {
                        listOfNotNull(position(coordinates))
                    }
            }
        return points.takeIf { it.isNotEmpty() }
    }

    /** A GeoJSON `[lon, lat]` pair. */
    private fun position(element: JsonElement): LatLon? {
        val pair = element as? JsonArray ?: return null
        if (pair.size < 2) return null
        val lon = (pair[0] as? JsonPrimitive)?.doubleOrNull ?: return null
        val lat = (pair[1] as? JsonPrimitive)?.doubleOrNull ?: return null
        if (!lat.isFinite() || !lon.isFinite() || lat !in -90.0..90.0 || lon !in -180.0..180.0) return null
        return LatLon(lat, lon)
    }

    public companion object {
        public const val DEFAULT_BASE_URL: String = "https://api.tomtom.com"
        public const val DEFAULT_LANGUAGE: String = "en-GB"
        public const val PATH: String = "/traffic/services/5/incidentDetails"

        /** The fields requested: only what [parse] reads. */
        public const val FIELDS: String =
            "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay," +
                "events{description,code,iconCategory},from,to,length,delay,roadNumbers,timeValidity," +
                "probabilityOfOccurrence}}}"

        /** TomTom's limit on the bounding box. */
        public const val MAX_BBOX_KM2: Double = 10_000.0

        /** Prefix of incident (and hazard) ids from TomTom. */
        public const val ID_PREFIX: String = "tomtom-"

        private val KEY_PATTERN = Regex("^[A-Za-z0-9_-]{16,128}$")

        /** Whether [key] looks like a TomTom API key (letters and digits; 32 of them today). */
        public fun isPlausibleKey(key: String): Boolean = KEY_PATTERN.matches(key.trim())

        /** `iconCategory` → kind (0 Unknown … 14 Broken Down Vehicle; unknown codes are Unknown). */
        public fun kindOf(iconCategory: Int?): TrafficIncidentKind = when (iconCategory) {
            1 -> TrafficIncidentKind.ACCIDENT
            2 -> TrafficIncidentKind.FOG
            3 -> TrafficIncidentKind.DANGEROUS_CONDITIONS
            4 -> TrafficIncidentKind.RAIN
            5 -> TrafficIncidentKind.ICE
            6 -> TrafficIncidentKind.JAM
            7 -> TrafficIncidentKind.LANE_CLOSED
            8 -> TrafficIncidentKind.ROAD_CLOSED
            9 -> TrafficIncidentKind.ROAD_WORKS
            10 -> TrafficIncidentKind.WIND
            11 -> TrafficIncidentKind.FLOODING
            14 -> TrafficIncidentKind.BROKEN_DOWN_VEHICLE
            else -> TrafficIncidentKind.UNKNOWN
        }

        /** `magnitudeOfDelay`: 0 Unknown, 1 Minor, 2 Moderate, 3 Major, 4 Undefined (closures). */
        public fun magnitudeOf(code: Int?): DelayMagnitude = when (code) {
            1 -> DelayMagnitude.MINOR
            2 -> DelayMagnitude.MODERATE
            3 -> DelayMagnitude.MAJOR
            4 -> DelayMagnitude.INDEFINITE
            else -> DelayMagnitude.UNKNOWN
        }

        /** TomTom's `minLon,minLat,maxLon,maxLat`. */
        public fun bbox(area: BoundingBox): String =
            String.format(Locale.ROOT, "%.6f,%.6f,%.6f,%.6f", area.west, area.south, area.east, area.north)

        private fun JsonObject.string(key: String): String? =
            (this[key] as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }

        private fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

        private fun JsonObject.double(key: String): Double? =
            (this[key] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() }
    }
}
