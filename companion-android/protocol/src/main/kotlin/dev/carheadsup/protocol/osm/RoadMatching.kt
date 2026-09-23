package dev.carheadsup.protocol.osm

import dev.carheadsup.protocol.HazardItem
import dev.carheadsup.protocol.PhoneRoad
import dev.carheadsup.protocol.RoadSource
import kotlin.math.min

/** The way a position was matched to. */
public data class WayMatch(
    val way: OsmWay,
    /** Distance from the position to the way, metres. */
    val distanceM: Double,
    /** True when travelling in the way's node order (decides `maxspeed:forward/backward`). */
    val forward: Boolean,
    /** Difference between the vehicle's bearing and the travel direction, or null if unknown. */
    val headingDiffDeg: Double?,
) {
    /** The limit for this direction of travel. */
    val speedLimit: SpeedLimit? get() = OsmSpeedLimit.forWay(way.tags, forward)

    /** As a HUD `road` message. */
    public fun toPhoneRoad(): PhoneRoad {
        val limit = speedLimit
        return PhoneRoad(
            speedLimitKph = (limit as? SpeedLimit.Limited)?.kph,
            unlimited = limit == SpeedLimit.Unlimited,
            source = RoadSource.OSM,
            roadName = way.displayName,
            roadClass = OsmSpeedLimit.roadClassOf(way.highway),
        )
    }
}

/**
 * Picks the way a vehicle is most likely on: the nearest segment, penalised by how badly its
 * direction agrees with the vehicle's bearing (so the motorway is preferred over the parallel
 * frontage road only if the heading fits, and a crossing street at an intersection loses), with
 * wrong-way travel on one-way roads ruled out. The previous match gets a small bonus so the
 * result does not flicker between two close roads.
 */
public class WayMatcher(
    /** Positions farther than this from every way (after accuracy allowance) match nothing. */
    private val maxDistanceM: Double = 25.0,
    /** Extra allowance for poor GPS accuracy, capped. */
    private val maxAccuracyAllowanceM: Double = 25.0,
    /** Metres of penalty per degree of heading mismatch. */
    private val headingPenaltyMPerDeg: Double = 0.4,
    /** Heading mismatch beyond which a direction of travel is not plausible at all. */
    private val maxHeadingDiffDeg: Double = 75.0,
    /** Below this speed the GPS bearing is noise and is ignored. */
    private val minSpeedForHeadingMps: Double = 2.5,
    /** Score bonus for the previously matched way (hysteresis). */
    private val stickinessM: Double = 6.0,
) {
    public fun match(
        ways: List<OsmWay>,
        position: LatLon,
        bearingDeg: Double? = null,
        speedMps: Double? = null,
        accuracyM: Double? = null,
        previousWayId: Long? = null,
    ): WayMatch? {
        val useHeading = bearingDeg != null && bearingDeg.isFinite() && (speedMps ?: 0.0) >= minSpeedForHeadingMps
        val limit = maxDistanceM + min(accuracyM?.takeIf { it.isFinite() && it > 0 } ?: 0.0, maxAccuracyAllowanceM)
        var best: WayMatch? = null
        var bestScore = Double.MAX_VALUE
        for (way in ways) {
            val oneway = way.oneway
            for (i in 0 until way.points.size - 1) {
                val a = way.points[i]
                val b = way.points[i + 1]
                val projection = Geo.projectOntoSegment(position, a, b)
                if (projection.distanceM > limit) continue
                var forward = oneway != Oneway.BACKWARD
                var headingDiff: Double? = null
                var score = projection.distanceM
                if (useHeading) {
                    val segmentBearing = Geo.bearingDeg(a, b)
                    val diffForward = Geo.angleDiffDeg(bearingDeg, segmentBearing)
                    val diffBackward = Geo.angleDiffDeg(bearingDeg, segmentBearing + 180.0)
                    val forwardFits = diffForward <= diffBackward
                    val (diff, isForward) =
                        when (oneway) {
                            Oneway.FORWARD -> diffForward to true
                            Oneway.BACKWARD -> diffBackward to false
                            Oneway.BOTH -> if (forwardFits) diffForward to true else diffBackward to false
                        }
                    if (diff > maxHeadingDiffDeg) continue
                    forward = isForward
                    headingDiff = diff
                    score += diff * headingPenaltyMPerDeg
                }
                score += classPenaltyM(way)
                if (previousWayId != null && way.id == previousWayId) score -= stickinessM
                if (score < bestScore) {
                    bestScore = score
                    best = WayMatch(way, projection.distanceM, forward, headingDiff)
                }
            }
        }
        return best
    }

    /** Service roads (parking aisles, driveways) are rarely what a moving car is on. */
    private fun classPenaltyM(way: OsmWay): Double = when {
        way.highway != "service" -> 0.0
        way.tags["service"] in setOf("parking_aisle", "driveway", "drive-through") -> 15.0
        else -> 6.0
    }
}

/**
 * Finds enforcement points ahead: within [maxDistanceM] and inside a cone of ±[coneDeg] around
 * the bearing (cameras within [nearbyM] count regardless, so one is not lost while passing it).
 * Distances are straight-line — a good approximation over the short ranges involved; the HUD
 * dead-reckons them between updates. Camera orientation tags are deliberately not used to
 * filter: their semantics vary between mappers, and a spurious warning is safer than a missing one.
 */
public class SpeedCameraFinder(
    private val maxDistanceM: Double = 1_500.0,
    private val coneDeg: Double = 35.0,
    private val nearbyM: Double = 40.0,
    private val maxResults: Int = 10,
) {
    public fun ahead(cameras: List<OsmCamera>, position: LatLon, bearingDeg: Double?): List<HazardItem> = cameras
        .asSequence()
        .map { it to Geo.distanceM(position, it.position) }
        .filter { (_, distance) -> distance <= maxDistanceM }
        .filter { (camera, distance) ->
            bearingDeg == null ||
                distance <= nearbyM ||
                Geo.angleDiffDeg(Geo.bearingDeg(position, camera.position), bearingDeg) <= coneDeg
        }
        .sortedBy { it.second }
        .take(maxResults)
        .map { (camera, distance) ->
            HazardItem(
                id = camera.id,
                type = camera.type,
                distanceM = distance,
                speedLimitKph = camera.maxspeedKph,
                delaySeconds = null,
                description = null,
            )
        }
        .toList()
}
