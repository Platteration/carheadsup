package dev.carheadsup.protocol.traffic

import dev.carheadsup.protocol.HazardItem
import dev.carheadsup.protocol.osm.BoundingBox
import dev.carheadsup.protocol.osm.Geo
import dev.carheadsup.protocol.osm.HeadingCone
import dev.carheadsup.protocol.osm.LatLon
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos

/**
 * The stretch of the world a traffic request covers: a rectangle reaching [aheadM] along the
 * heading and [lateralM] to either side (plus [behindM] behind the car), not a big square around
 * it — traffic behind the car or far to the side is of no use, and a smaller box is a smaller
 * answer. Between two requests the car moves at most a few kilometres ([TrafficPolicy]), so the
 * data still reaches well ahead.
 */
public class TrafficCorridor(
    public val aheadM: Double = 10_000.0,
    public val lateralM: Double = 3_000.0,
    public val behindM: Double = 200.0,
) {
    init {
        require(aheadM > 0 && lateralM > 0 && behindM >= 0) { "invalid corridor" }
    }

    /**
     * The bounding box of the corridor from [position] along [headingDeg]. Near the antimeridian
     * it is cut at ±180° (a box never crosses it); near the poles, where no roads are, it is only
     * approximate.
     */
    public fun box(position: LatLon, headingDeg: Double): BoundingBox {
        val corners =
            listOf(-behindM, aheadM).flatMap { along ->
                listOf(-lateralM, lateralM).map { across -> offset(position, headingDeg, along, across) }
            } + position
        // Longitudes relative to the car, so a corridor reaching across ±180° stays in one piece.
        val lons = corners.map { position.lon + wrap(it.lon - position.lon) }
        val lats = corners.map { it.lat }
        return BoundingBox(
            south = lats.min().coerceIn(-90.0, 90.0),
            west = lons.min().coerceIn(-180.0, 180.0),
            north = lats.max().coerceIn(-90.0, 90.0),
            east = lons.max().coerceIn(-180.0, 180.0),
        )
    }

    private fun offset(from: LatLon, headingDeg: Double, alongM: Double, acrossM: Double): LatLon {
        val onAxis =
            if (alongM >=
                0
            ) {
                Geo.destination(from, headingDeg, alongM)
            } else {
                Geo.destination(from, headingDeg + 180, -alongM)
            }
        return if (acrossM >= 0) {
            Geo.destination(onAxis, headingDeg + 90, acrossM)
        } else {
            Geo.destination(onAxis, headingDeg - 90, -acrossM)
        }
    }

    private fun wrap(dLon: Double): Double = ((dLon + 540.0) % 360.0) - 180.0

    public companion object {
        /** Approximate area of [box], km². */
        public fun areaKm2(box: BoundingBox): Double {
            val degree = Geo.EARTH_RADIUS_M * PI / 180.0 / 1000.0
            val midLat = (box.south + box.north) / 2 * PI / 180.0
            return (box.north - box.south) * degree * (box.east - box.west) * degree * abs(cos(midLat))
        }
    }
}

/**
 * Picks the traffic incidents ahead of the car, as HUD hazards (nearest first, at most
 * [maxResults]), with the same idea of "ahead" as speed cameras ([HeadingCone]):
 * - where traffic reaches the incident (the first point of its geometry — the tail of a jam)
 *   lies in the cone around the heading and inside the [corridor] (along the heading up to its
 *   length, across it up to its width); an incident whose start is behind the car is not ahead,
 *   even while the car is still in it — like a camera it has been passed;
 * - an incident with extent runs the same way as the car (within [maxDirectionDiffDeg] of the
 *   heading, measured over its first [directionSampleM]): a jam on the opposite carriageway of
 *   the same motorway, or on a road crossing it, is not the driver's;
 * - duplicates (the same id twice) count once.
 *
 * The heading is the last known direction of travel ([dev.carheadsup.protocol.osm.HeadingMemory]),
 * so a car stopped in a queue keeps looking the way it was going. Distances are straight-line to
 * the start, which is never more than the road distance: a warning comes early rather than late.
 */
public class TrafficIncidentFinder(
    private val cone: HeadingCone = HeadingCone(),
    private val corridor: TrafficCorridor = TrafficCorridor(),
    private val maxDirectionDiffDeg: Double = 75.0,
    private val directionSampleM: Double = 200.0,
    private val maxResults: Int = 20,
) {
    public fun ahead(incidents: List<TrafficIncident>, position: LatLon, headingDeg: Double): List<HazardItem> =
        incidents
            .asSequence()
            .distinctBy { it.id }
            .mapNotNull { incident -> distanceAhead(incident, position, headingDeg)?.let { incident to it } }
            .sortedBy { it.second }
            .take(maxResults)
            .map { (incident, distance) -> TrafficHazards.toHazard(incident, distance) }
            .toList()

    /** Straight-line distance to where traffic reaches [incident], or null when it is not ahead. */
    public fun distanceAhead(incident: TrafficIncident, position: LatLon, headingDeg: Double): Double? {
        val relative = Geo.relative(position, headingDeg, incident.start)
        if (!cone.contains(position, headingDeg, incident.start, relative.distanceM)) return null
        val inCorridor = relative.alongM <= corridor.aheadM && abs(relative.acrossM) <= corridor.lateralM
        if (relative.distanceM > cone.nearbyM && !inCorridor) return null
        val direction = directionOf(incident)
        if (direction != null && Geo.angleDiffDeg(direction, headingDeg) > maxDirectionDiffDeg) return null
        return relative.distanceM
    }

    /** The direction traffic flows through [incident] near its start; null for a point. */
    public fun directionOf(incident: TrafficIncident): Double? {
        val points = incident.points
        if (points.size < 2) return null
        var travelled = 0.0
        for (i in 1 until points.size) {
            travelled += Geo.distanceM(points[i - 1], points[i])
            if (travelled >= directionSampleM) return Geo.bearingDeg(points[0], points[i])
        }
        // Shorter than the sample: its whole length, unless it is too short to have a direction.
        return if (travelled >= MIN_DIRECTION_M) Geo.bearingDeg(points[0], points.last()) else null
    }

    private companion object {
        const val MIN_DIRECTION_M = 10.0
    }
}
