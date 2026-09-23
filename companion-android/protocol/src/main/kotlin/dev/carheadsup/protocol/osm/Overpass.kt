package dev.carheadsup.protocol.osm

import dev.carheadsup.protocol.HazardType
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.net.URLEncoder
import java.util.Locale

/** Builders for Overpass QL queries (https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL). */
public object OverpassQueries {
    /** `highway` values a car can drive on. */
    public val DRIVABLE_HIGHWAYS: List<String> =
        listOf(
            "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
            "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
            "residential", "living_street", "service", "road",
        )

    /** `enforcement` values of enforcement relations that are cameras or checks. */
    public val ENFORCEMENT_KINDS: List<String> = listOf("maxspeed", "traffic_signals", "average_speed", "mindistance")

    private val highwayFilter: String get() = "[\"highway\"~\"^(${DRIVABLE_HIGHWAYS.joinToString("|")})$\"]"

    private fun header(timeoutS: Int, bbox: BoundingBox? = null): String {
        require(timeoutS in 1..180) { "timeout must be within 1..180 s" }
        return "[out:json][timeout:$timeoutS]" + (bbox?.let { "[bbox:${it.toOverpass()}]" } ?: "") + ";"
    }

    /**
     * Drivable ways (tags + geometry, for speed limits, names and road classes) plus speed
     * cameras (`highway=speed_camera` nodes and `type=enforcement` relations with their member
     * geometry) inside [box]: one request per map tile feeds both the road and hazard messages.
     */
    public fun roadsAndCameras(box: BoundingBox, timeoutS: Int = 25): String = header(timeoutS, box) +
        "(" +
        "way$highwayFilter;" +
        "node[\"highway\"=\"speed_camera\"];" +
        "relation[\"type\"=\"enforcement\"][\"enforcement\"~\"^(${ENFORCEMENT_KINDS.joinToString("|")})$\"];" +
        ");" +
        "out tags geom qt;"

    /** Drivable ways within [radiusM] of [center], with tags and geometry. */
    public fun waysAround(center: LatLon, radiusM: Int, timeoutS: Int = 25): String {
        require(radiusM in 1..5_000) { "radius must be within 1..5000 m" }
        val lat = String.format(Locale.ROOT, "%.6f", center.lat)
        val lon = String.format(Locale.ROOT, "%.6f", center.lon)
        return header(timeoutS) + "way(around:$radiusM,$lat,$lon)$highwayFilter;out tags geom qt;"
    }

    /** Speed cameras and enforcement relations inside [box]. */
    public fun speedCameras(box: BoundingBox, timeoutS: Int = 25): String = header(timeoutS, box) +
        "(" +
        "node[\"highway\"=\"speed_camera\"];" +
        "relation[\"type\"=\"enforcement\"][\"enforcement\"~\"^(${ENFORCEMENT_KINDS.joinToString("|")})$\"];" +
        ");" +
        "out tags geom qt;"

    /** `application/x-www-form-urlencoded` body for POSTing [query] to an Overpass interpreter. */
    public fun formBody(query: String): String = "data=" + URLEncoder.encode(query, "UTF-8")
}

// ---------------------------------------------------------------------------------------------
// Response

@Serializable
public data class OverpassPoint(val lat: Double, val lon: Double)

@Serializable
public data class OverpassMember(
    val type: String,
    val ref: Long,
    val role: String = "",
    val lat: Double? = null,
    val lon: Double? = null,
)

@Serializable
public data class OverpassElement(
    val type: String,
    val id: Long,
    val lat: Double? = null,
    val lon: Double? = null,
    val tags: Map<String, String> = emptyMap(),
    /** Way geometry; entries are null for nodes clipped by the query's bounding box. */
    val geometry: List<OverpassPoint?>? = null,
    val members: List<OverpassMember> = emptyList(),
)

@Serializable
public data class OverpassResponse(
    val elements: List<OverpassElement> = emptyList(),
    /** Set by Overpass on runtime errors (timeouts, memory), which still come back as HTTP 200. */
    val remark: String? = null,
)

/** Travel directions allowed on a way. */
public enum class Oneway { BOTH, FORWARD, BACKWARD }

/** A drivable OSM way (or a contiguous run of it when the geometry was clipped). */
public data class OsmWay(val id: Long, val tags: Map<String, String>, val points: List<LatLon>) {
    val highway: String? get() = tags["highway"]
    val name: String? get() = tags["name"]
    val ref: String? get() = tags["ref"]

    /** Name for display: the name, else the route number ("A 8", "I-95"). */
    val displayName: String? get() = name?.takeIf { it.isNotBlank() } ?: ref?.takeIf { it.isNotBlank() }

    val oneway: Oneway
        get() =
            when (tags["oneway"]) {
                "yes", "true", "1" -> Oneway.FORWARD

                "-1", "reverse" -> Oneway.BACKWARD

                "no", "false", "0" -> Oneway.BOTH

                else ->
                    if (highway == "motorway" || tags["junction"] == "roundabout" || tags["junction"] == "circular") {
                        Oneway.FORWARD
                    } else {
                        Oneway.BOTH
                    }
            }
}

/** A speed camera or enforcement point. */
public data class OsmCamera(
    /** Stable id, e.g. "osm-node-123" or "osm-relation-45". */
    val id: String,
    val type: HazardType,
    val position: LatLon,
    /** Enforced limit, when tagged. */
    val maxspeedKph: Double?,
)

/** Roads and cameras of one area. */
public data class RoadData(val ways: List<OsmWay>, val cameras: List<OsmCamera>) {
    /** Union with [other] (cameras de-duplicated by id). */
    public operator fun plus(other: RoadData): RoadData =
        RoadData(ways + other.ways, (cameras + other.cameras).distinctBy { it.id })

    public companion object {
        public val EMPTY: RoadData = RoadData(emptyList(), emptyList())
    }
}

/** Thrown for unusable Overpass responses. */
public class OverpassException(message: String) : Exception(message)

/** Parses Overpass JSON into [RoadData]. */
public object OverpassParser {
    private val json = Json { ignoreUnknownKeys = true }

    /** @throws OverpassException when the body is not valid Overpass JSON or reports an error. */
    public fun parse(body: String): RoadData {
        val response =
            try {
                json.decodeFromString(OverpassResponse.serializer(), body)
            } catch (e: SerializationException) {
                throw OverpassException("invalid Overpass response: ${e.message?.lineSequence()?.firstOrNull()}")
            } catch (e: IllegalArgumentException) {
                throw OverpassException("invalid Overpass response: ${e.message?.lineSequence()?.firstOrNull()}")
            }
        val remark = response.remark
        if (remark != null && remark.contains("error", ignoreCase = true)) throw OverpassException(remark)
        return toRoadData(response)
    }

    public fun toRoadData(response: OverpassResponse): RoadData {
        val ways = ArrayList<OsmWay>()
        val cameras = ArrayList<OsmCamera>()
        val relationDevices = HashSet<Long>()

        for (element in response.elements) {
            if (element.type != "relation" || element.tags["type"] != "enforcement") continue
            val kind = element.tags["enforcement"]
            val type =
                when (kind) {
                    "maxspeed" -> HazardType.SPEED_CAMERA
                    "traffic_signals" -> HazardType.RED_LIGHT_CAMERA
                    "average_speed" -> HazardType.SECTION_CONTROL
                    "mindistance" -> HazardType.OTHER
                    else -> continue
                }
            val nodeMembers = element.members.filter { it.type == "node" && it.lat != null && it.lon != null }
            val anchor =
                listOf("device", "from", "force", "to")
                    .firstNotNullOfOrNull { role -> nodeMembers.firstOrNull { it.role == role } }
                    ?: nodeMembers.firstOrNull()
                    ?: continue
            nodeMembers.filter { it.role == "device" }.forEach { relationDevices += it.ref }
            cameras +=
                OsmCamera(
                    id = "osm-relation-${element.id}",
                    type = type,
                    position = LatLon(anchor.lat!!, anchor.lon!!),
                    maxspeedKph = limitOf(element.tags["maxspeed"]),
                )
        }

        for (element in response.elements) {
            when (element.type) {
                "way" -> {
                    if (element.tags["highway"] !in OverpassQueries.DRIVABLE_HIGHWAYS) continue
                    for (run in runs(element.geometry.orEmpty())) {
                        ways += OsmWay(element.id, element.tags, run)
                    }
                }

                "node" -> {
                    if (element.tags["highway"] != "speed_camera" || element.id in relationDevices) continue
                    val lat = element.lat ?: continue
                    val lon = element.lon ?: continue
                    cameras +=
                        OsmCamera(
                            id = "osm-node-${element.id}",
                            type = HazardType.SPEED_CAMERA,
                            position = LatLon(lat, lon),
                            maxspeedKph = limitOf(element.tags["maxspeed"]),
                        )
                }
            }
        }
        return RoadData(ways, cameras)
    }

    /** Splits clipped geometry (null entries) into contiguous runs of at least two points. */
    private fun runs(geometry: List<OverpassPoint?>): List<List<LatLon>> {
        val result = ArrayList<List<LatLon>>()
        var current = ArrayList<LatLon>()
        for (point in geometry) {
            if (point == null) {
                if (current.size >= 2) result += current
                current = ArrayList()
            } else {
                current += LatLon(point.lat, point.lon)
            }
        }
        if (current.size >= 2) result += current
        return result
    }

    private fun limitOf(value: String?): Double? = (OsmSpeedLimit.parse(value) as? SpeedLimit.Limited)?.kph
}
