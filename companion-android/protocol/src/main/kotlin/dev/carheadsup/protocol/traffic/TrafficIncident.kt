package dev.carheadsup.protocol.traffic

import dev.carheadsup.protocol.HazardItem
import dev.carheadsup.protocol.HazardType
import dev.carheadsup.protocol.WireSanitizer
import dev.carheadsup.protocol.osm.LatLon

/** What a traffic incident is, independent of the service that reported it. */
public enum class TrafficIncidentKind {
    ACCIDENT,
    JAM,
    ROAD_WORKS,
    LANE_CLOSED,
    ROAD_CLOSED,
    FOG,
    RAIN,
    ICE,
    WIND,
    FLOODING,

    /** Obstacles, people or animals on the road, slippery surface … (TomTom's catch-all). */
    DANGEROUS_CONDITIONS,
    BROKEN_DOWN_VEHICLE,
    UNKNOWN,
}

/** How much an incident slows traffic down (TomTom's `magnitudeOfDelay`). */
public enum class DelayMagnitude {
    UNKNOWN,

    /** Slow traffic. */
    MINOR,

    /** Queuing traffic. */
    MODERATE,

    /** Stationary traffic. */
    MAJOR,

    /** No meaningful delay figure: closures and other indefinite delays. */
    INDEFINITE,
}

/** A traffic incident as any [TrafficIncidentService] reports it. */
public data class TrafficIncident(
    /** Unique across services: prefixed with the service ("tomtom-…"). */
    val id: String,
    val kind: TrafficIncidentKind,
    val magnitude: DelayMagnitude,
    /** Expected delay, seconds, or null when unknown or none (closures have none). */
    val delaySeconds: Double?,
    /** Length of the affected stretch, metres, if known. */
    val lengthM: Double?,
    /**
     * Where it is, in the direction of traffic: the first point is where traffic reaches it (the
     * tail of a jam). A single point for incidents without extent.
     */
    val points: List<LatLon>,
    /** The service's own description of the (first) event, if any. */
    val eventDescription: String? = null,
    /** Road numbers ("A7"), if known. */
    val roadNumbers: List<String> = emptyList(),
) {
    init {
        require(points.isNotEmpty()) { "an incident needs a position" }
    }

    /** Where traffic reaches the incident. */
    val start: LatLon get() = points.first()
}

/**
 * Maps [TrafficIncident]s onto the HUD's hazard types. The HUD labels hazards itself ("Traffic
 * jam", "Accident" …) and shows a phone description only for `other` hazards and only while the
 * car is not moving, so descriptions here are short fixed phrases (English, like the HUD), not
 * the service's free text — except where the kind says too little (dangerous conditions).
 */
public object TrafficHazards {
    /** A jam of unknown magnitude counts as a jam rather than a slowdown from this delay on. */
    public const val JAM_DELAY_S: Double = 300.0

    /** Longest description passed on (the HUD cuts `other` labels to 24 characters anyway). */
    public const val DESCRIPTION_MAX: Int = 60

    public fun typeOf(incident: TrafficIncident): HazardType = when (incident.kind) {
        TrafficIncidentKind.ACCIDENT -> HazardType.ACCIDENT

        TrafficIncidentKind.JAM -> if (isJam(incident)) HazardType.TRAFFIC_JAM else HazardType.SLOWDOWN

        TrafficIncidentKind.ROAD_WORKS -> HazardType.ROAD_WORKS

        TrafficIncidentKind.FOG,
        TrafficIncidentKind.RAIN,
        TrafficIncidentKind.ICE,
        TrafficIncidentKind.WIND,
        TrafficIncidentKind.FLOODING,
        -> HazardType.WEATHER

        TrafficIncidentKind.BROKEN_DOWN_VEHICLE -> HazardType.OBJECT_ON_ROAD

        TrafficIncidentKind.LANE_CLOSED,
        TrafficIncidentKind.ROAD_CLOSED,
        TrafficIncidentKind.DANGEROUS_CONDITIONS,
        TrafficIncidentKind.UNKNOWN,
        -> HazardType.OTHER
    }

    /**
     * Queuing or stationary traffic is a jam, slow traffic a slowdown; without a magnitude the
     * delay decides.
     */
    private fun isJam(incident: TrafficIncident): Boolean = when (incident.magnitude) {
        DelayMagnitude.MAJOR, DelayMagnitude.MODERATE -> true
        DelayMagnitude.MINOR -> false
        DelayMagnitude.UNKNOWN, DelayMagnitude.INDEFINITE -> (incident.delaySeconds ?: 0.0) >= JAM_DELAY_S
    }

    /** A short description ("Road closed", "Stationary traffic" …). */
    public fun description(incident: TrafficIncident): String = when (incident.kind) {
        TrafficIncidentKind.ACCIDENT -> "Accident"

        TrafficIncidentKind.JAM -> when (incident.magnitude) {
            DelayMagnitude.MAJOR -> "Stationary traffic"

            DelayMagnitude.MODERATE -> "Queuing traffic"

            DelayMagnitude.MINOR -> "Slow traffic"

            DelayMagnitude.UNKNOWN, DelayMagnitude.INDEFINITE ->
                if (isJam(incident)) "Traffic jam" else "Slow traffic"
        }

        TrafficIncidentKind.ROAD_WORKS -> "Road works"

        TrafficIncidentKind.LANE_CLOSED -> "Lane closed"

        TrafficIncidentKind.ROAD_CLOSED -> "Road closed"

        TrafficIncidentKind.FOG -> "Fog"

        TrafficIncidentKind.RAIN -> "Heavy rain"

        TrafficIncidentKind.ICE -> "Ice"

        TrafficIncidentKind.WIND -> "Strong wind"

        TrafficIncidentKind.FLOODING -> "Flooding"

        TrafficIncidentKind.DANGEROUS_CONDITIONS -> eventText(incident) ?: "Dangerous conditions"

        TrafficIncidentKind.BROKEN_DOWN_VEHICLE -> "Broken-down vehicle"

        TrafficIncidentKind.UNKNOWN -> eventText(incident) ?: "Traffic incident"
    }

    private fun eventText(incident: TrafficIncident): String? =
        incident.eventDescription?.let { WireSanitizer.label(it, DESCRIPTION_MAX) }?.takeIf { it.isNotEmpty() }

    /** The hazard for [incident], [distanceM] ahead. */
    public fun toHazard(incident: TrafficIncident, distanceM: Double): HazardItem = HazardItem(
        id = incident.id,
        type = typeOf(incident),
        distanceM = distanceM,
        speedLimitKph = null,
        delaySeconds = incident.delaySeconds?.takeIf { it.isFinite() && it > 0 },
        description = description(incident),
    )
}
