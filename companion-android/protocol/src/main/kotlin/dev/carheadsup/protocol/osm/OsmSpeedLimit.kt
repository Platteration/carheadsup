package dev.carheadsup.protocol.osm

import dev.carheadsup.protocol.RoadClass
import java.util.Locale

/** A speed limit resolved from OpenStreetMap tags. */
public sealed interface SpeedLimit {
    /** A posted or implied limit in km/h (always > 0). */
    public data class Limited(val kph: Double) : SpeedLimit

    /** No limit, e.g. German Autobahn `maxspeed=none`. */
    public data object Unlimited : SpeedLimit

    /** Set by variable signs (`signals`, `variable`): known to exist but not knowable here. */
    public data object Variable : SpeedLimit
}

/**
 * Parsing of OSM `maxspeed` values (https://wiki.openstreetmap.org/wiki/Key:maxspeed):
 * - plain numbers are km/h ("50"); units may follow ("30 mph", "50 km/h", "10 knots");
 * - "none" means no limit; "signals"/"variable" means electronic signs; "walk" is walking pace;
 * - implicit values name a country and road type ("DE:urban", "RU:rural", "GB:nsl_single",
 *   "FR:motorway", "DE:zone30", "DE:zone:30", "DE:30"), resolved with [IMPLICIT] — the legal default for
 *   that road type, cross-checked against the OSM wiki "Default speed limits" page;
 * - semicolon lists ("50;30") resolve to the lowest limit, the conservative choice for a
 *   driver-facing display.
 */
public object OsmSpeedLimit {
    public const val MPH_TO_KPH: Double = 1.609344
    public const val KNOT_TO_KPH: Double = 1.852

    /** Walking pace ("Schrittgeschwindigkeit"): courts in DE/AT read it as roughly 4–7 km/h. */
    public const val WALK_KPH: Double = 7.0

    private val NUMBER_WITH_UNIT = Regex("^(\\d+(?:\\.\\d+)?)\\s*(mph|km/h|kmh|kph|knots|kn)?$")

    /** "DE:zone30", "DE:zone:30" and the `zone:maxspeed` form "DE:30". */
    private val ZONE = Regex("^([a-z]{2}(?:-[a-z]+)?):(?:zone:?)?(\\d+)$")

    /**
     * Legal defaults behind implicit `maxspeed` values, keyed by lower-case `CC:type`. Values
     * are themselves `maxspeed` strings (so "60 mph", "none" and "walk" work). Countries whose
     * national default differs by region (e.g. the US) have no entry and stay unknown.
     */
    public val IMPLICIT: Map<String, String> =
        buildMap {
            fun country(code: String, vararg entries: Pair<String, String>) {
                for ((type, value) in entries) put("$code:$type", value)
            }
            country(
                "at",
                "urban" to "50",
                "rural" to "100",
                "motorroad" to "100",
                "motorway" to "130",
                "living_street" to "walk",
                "bicycle_road" to "30",
            )
            country(
                "be",
                "urban" to "50",
                "motorway" to "120",
                "living_street" to "20",
                "cyclestreet" to "30",
            )
            country("be-vlg", "urban" to "50", "rural" to "70", "motorway" to "120")
            country("be-wal", "urban" to "50", "rural" to "90", "motorway" to "120")
            country("be-bru", "urban" to "30", "rural" to "70", "motorway" to "120")
            country(
                "bg",
                "urban" to "50",
                "rural" to "90",
                "motorroad" to "120",
                "motorway" to "140",
                "living_street" to "20",
            )
            country("by", "urban" to "60", "rural" to "90", "motorway" to "110", "living_street" to "20")
            country(
                "ch",
                "urban" to "50",
                "rural" to "80",
                "trunk" to "100",
                "motorroad" to "100",
                "motorway" to "120",
                "living_street" to "20",
            )
            country(
                "cz",
                "urban" to "50",
                "rural" to "90",
                "trunk" to "110",
                "motorroad" to "110",
                "motorway" to "130",
                "living_street" to "20",
                "pedestrian_zone" to "20",
            )
            country(
                "de",
                "urban" to "50",
                "rural" to "100",
                "motorway" to "none",
                "living_street" to "walk",
                "bicycle_road" to "30",
                "pedestrian_zone" to "walk",
            )
            country(
                "dk",
                "urban" to "50",
                "rural" to "80",
                "motorroad" to "80",
                "motorway" to "130",
                "living_street" to "15",
            )
            country("ee", "urban" to "50", "rural" to "90", "living_street" to "20")
            country("es", "urban" to "30", "rural" to "90", "motorway" to "120", "living_street" to "20")
            country("fi", "urban" to "50", "rural" to "80", "living_street" to "20")
            country(
                "fr",
                "urban" to "50",
                "rural" to "80",
                "trunk" to "110",
                "motorway" to "130",
                "living_street" to "20",
            )
            country(
                "gb",
                "nsl_single" to "60 mph",
                "nsl_dual" to "70 mph",
                "nsl_restricted" to "30 mph",
                "motorway" to "70 mph",
                "urban" to "30 mph",
                "rural" to "60 mph",
            )
            country(
                "uk",
                "nsl_single" to "60 mph",
                "nsl_dual" to "70 mph",
                "nsl_restricted" to "30 mph",
                "motorway" to "70 mph",
                "urban" to "30 mph",
                "rural" to "60 mph",
            )
            country(
                "gr",
                "urban" to "50",
                "rural" to "90",
                "motorroad" to "110",
                "motorway" to "130",
                "living_street" to "20",
            )
            country(
                "hr",
                "urban" to "50",
                "rural" to "90",
                "motorroad" to "110",
                "motorway" to "130",
                "living_street" to "walk",
            )
            country(
                "hu",
                "urban" to "50",
                "rural" to "90",
                "trunk" to "110",
                "motorroad" to "110",
                "motorway" to "130",
                "living_street" to "20",
            )
            country("ie", "urban" to "50", "rural" to "80", "national" to "100", "motorway" to "120")
            country("it", "urban" to "50", "rural" to "90", "trunk" to "110", "motorway" to "130")
            country(
                "lt",
                "urban" to "50",
                "rural" to "90",
                "motorroad" to "120",
                "motorway" to "130",
                "living_street" to "20",
            )
            country("lu", "urban" to "50", "rural" to "90", "motorway" to "130", "living_street" to "20")
            country("lv", "urban" to "50", "rural" to "90", "motorroad" to "110", "living_street" to "20")
            country(
                "nl",
                "urban" to "50",
                "rural" to "80",
                "trunk" to "100",
                "motorroad" to "100",
                "motorway" to "130",
                "living_street" to "15",
            )
            country("no", "urban" to "50", "rural" to "80", "motorway" to "110", "living_street" to "walk")
            country(
                "pl",
                "urban" to "50",
                "rural" to "90",
                "expressway" to "120",
                "motorway" to "140",
                "living_street" to "20",
            )
            country(
                "pt",
                "urban" to "50",
                "rural" to "90",
                "motorroad" to "100",
                "motorway" to "120",
                "living_street" to "20",
            )
            country(
                "ro",
                "urban" to "50",
                "rural" to "90",
                "trunk" to "100",
                "motorway" to "130",
                "living_street" to "20",
            )
            country(
                "rs",
                "urban" to "50",
                "rural" to "80",
                "motorroad" to "100",
                "motorway" to "120",
                "living_street" to "10",
            )
            country("ru", "urban" to "60", "rural" to "90", "motorway" to "110", "living_street" to "20")
            country("se", "urban" to "50", "rural" to "70", "motorway" to "110", "living_street" to "walk")
            country(
                "si",
                "urban" to "50",
                "rural" to "90",
                "trunk" to "110",
                "motorway" to "130",
                "living_street" to "10",
            )
            country(
                "sk",
                "urban" to "50",
                "rural" to "90",
                "motorroad" to "130",
                "motorway" to "130",
                "living_street" to "20",
            )
            country("tr", "urban" to "50", "rural" to "90", "motorway" to "120")
            country("ua", "urban" to "50", "rural" to "90", "motorway" to "130", "living_street" to "20")
            country("au", "urban" to "50", "rural" to "100")
            country("nz", "urban" to "50", "rural" to "100")
            country("za", "urban" to "60", "rural" to "100", "motorway" to "120")
            country("jp", "rural" to "60", "motorway" to "100")
            country("in", "urban" to "70", "rural" to "70", "motorway" to "120")
        }

    /** Parses one `maxspeed` value; null when unparseable or unknown. */
    public fun parse(value: String?): SpeedLimit? = parse(value, depth = 0)

    private fun parse(value: String?, depth: Int): SpeedLimit? {
        if (value == null || depth > 2) return null
        val text = value.trim().lowercase(Locale.ROOT)
        if (text.isEmpty()) return null
        if (';' in text) {
            val parts = text.split(';').mapNotNull { parse(it, depth + 1) }
            if (parts.isEmpty()) return null
            val limits = parts.filterIsInstance<SpeedLimit.Limited>()
            return when {
                limits.isNotEmpty() -> limits.minBy { it.kph }
                parts.any { it == SpeedLimit.Variable } -> SpeedLimit.Variable
                else -> SpeedLimit.Unlimited
            }
        }
        when (text) {
            "none", "no" -> return SpeedLimit.Unlimited
            "signals", "variable" -> return SpeedLimit.Variable
            "walk" -> return SpeedLimit.Limited(WALK_KPH)
        }
        NUMBER_WITH_UNIT.matchEntire(text)?.let { m ->
            val number = m.groupValues[1].toDouble()
            if (number <= 0.0) return null
            val kph =
                when (m.groupValues[2]) {
                    "mph" -> number * MPH_TO_KPH
                    "knots", "kn" -> number * KNOT_TO_KPH
                    else -> number
                }
            return SpeedLimit.Limited(kph)
        }
        ZONE.matchEntire(text)?.let { m ->
            val number = m.groupValues[2].toDouble()
            if (number <= 0.0) return null
            val imperial = m.groupValues[1] in setOf("gb", "uk", "us")
            return SpeedLimit.Limited(if (imperial) number * MPH_TO_KPH else number)
        }
        IMPLICIT[text]?.let { return parse(it, depth + 1) }
        return null
    }

    /**
     * The limit that applies to a vehicle travelling along the way ([forward] = in the direction
     * of the way's node order), from its tags:
     * `maxspeed:forward`/`maxspeed:backward`, then `maxspeed`, then the implicit type tags
     * `maxspeed:type`, `source:maxspeed` and `zone:maxspeed`. Conditional limits
     * (`maxspeed:conditional`) and vehicle-specific ones (`maxspeed:hgv`) are ignored.
     */
    public fun forWay(tags: Map<String, String>, forward: Boolean = true): SpeedLimit? {
        val directional = if (forward) tags["maxspeed:forward"] else tags["maxspeed:backward"]
        return parse(directional)
            ?: parse(tags["maxspeed"])
            ?: parse(tags["maxspeed:type"])
            ?: parse(tags["source:maxspeed"])
            ?: parse(tags["zone:maxspeed"])
    }

    /** Maps an OSM `highway` value onto the HUD's road classes. */
    public fun roadClassOf(highway: String?): RoadClass? = when (highway) {
        null -> null
        "motorway", "motorway_link" -> RoadClass.MOTORWAY
        "trunk", "trunk_link" -> RoadClass.TRUNK
        "primary", "primary_link" -> RoadClass.PRIMARY
        "secondary", "secondary_link" -> RoadClass.SECONDARY
        "tertiary", "tertiary_link" -> RoadClass.TERTIARY
        "residential", "living_street" -> RoadClass.RESIDENTIAL
        "service" -> RoadClass.SERVICE
        else -> RoadClass.OTHER
    }
}
