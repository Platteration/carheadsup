package dev.carheadsup.protocol.osm

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.sin
import kotlin.math.sqrt

/** A WGS84 position in degrees. */
public data class LatLon(val lat: Double, val lon: Double)

/** An axis-aligned lat/lon box (south ≤ north, west ≤ east; boxes never cross the antimeridian). */
public data class BoundingBox(val south: Double, val west: Double, val north: Double, val east: Double) {
    init {
        require(south <= north && west <= east) { "invalid bounding box" }
    }

    public operator fun contains(p: LatLon): Boolean = p.lat in south..north && p.lon in west..east

    /** Overpass `(south,west,north,east)` order. */
    public fun toOverpass(): String = "${fmt(south)},${fmt(west)},${fmt(north)},${fmt(east)}"

    private fun fmt(v: Double): String = String.format(java.util.Locale.ROOT, "%.6f", v)
}

/** A point seen from a moving vehicle ([Geo.relative]). */
public data class RelativePosition(
    /** Straight-line distance, metres. */
    val distanceM: Double,
    /** Distance along the heading, metres; negative behind the vehicle. */
    val alongM: Double,
    /** Distance across the heading, metres; positive to the right. */
    val acrossM: Double,
    /** Angle between the heading and the direction to the point, 0–180°. */
    val offAxisDeg: Double,
)

/** Spherical-earth geometry, accurate to well under a metre at the few-kilometre scale used here. */
public object Geo {
    public const val EARTH_RADIUS_M: Double = 6_371_008.8

    private fun rad(deg: Double) = deg * PI / 180.0

    private fun deg(rad: Double) = rad * 180.0 / PI

    /** Great-circle distance in metres. */
    public fun distanceM(a: LatLon, b: LatLon): Double {
        val dLat = rad(b.lat - a.lat)
        val dLon = rad(b.lon - a.lon)
        val h = sin(dLat / 2).let { it * it } + cos(rad(a.lat)) * cos(rad(b.lat)) * sin(dLon / 2).let { it * it }
        return 2 * EARTH_RADIUS_M * asin(sqrt(h.coerceIn(0.0, 1.0)))
    }

    /** Initial bearing from [a] to [b], degrees clockwise from north in [0, 360). */
    public fun bearingDeg(a: LatLon, b: LatLon): Double {
        val phi1 = rad(a.lat)
        val phi2 = rad(b.lat)
        val dLon = rad(b.lon - a.lon)
        val y = sin(dLon) * cos(phi2)
        val x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dLon)
        return normalizeDeg(deg(atan2(y, x)))
    }

    /** Wraps into [0, 360). */
    public fun normalizeDeg(value: Double): Double {
        val wrapped = value % 360.0
        return if (wrapped < 0) wrapped + 360.0 else wrapped
    }

    /** Smallest absolute difference between two bearings, 0–180°. */
    public fun angleDiffDeg(a: Double, b: Double): Double {
        val d = abs(normalizeDeg(a) - normalizeDeg(b))
        return if (d > 180) 360 - d else d
    }

    /** A position moved [distanceM] along [bearingDeg]. */
    public fun destination(from: LatLon, bearingDeg: Double, distanceM: Double): LatLon {
        val delta = distanceM / EARTH_RADIUS_M
        val theta = rad(bearingDeg)
        val phi1 = rad(from.lat)
        val lambda1 = rad(from.lon)
        val phi2 = asin(sin(phi1) * cos(delta) + cos(phi1) * sin(delta) * cos(theta))
        val lambda2 = lambda1 + atan2(sin(theta) * sin(delta) * cos(phi1), cos(delta) - sin(phi1) * sin(phi2))
        return LatLon(deg(phi2), (deg(lambda2) + 540) % 360 - 180)
    }

    /**
     * Where [target] lies seen from a vehicle at [from] heading [headingDeg]: the straight-line
     * distance, its components along and across the heading, and the angle off the heading.
     */
    public fun relative(from: LatLon, headingDeg: Double, target: LatLon): RelativePosition {
        val distance = distanceM(from, target)
        val bearing = bearingDeg(from, target)
        val theta = rad(bearing - headingDeg)
        return RelativePosition(
            distanceM = distance,
            alongM = distance * cos(theta),
            acrossM = distance * sin(theta),
            offAxisDeg = angleDiffDeg(bearing, headingDeg),
        )
    }

    /** A box around [center] extending [radiusM] in every direction. */
    public fun boxAround(center: LatLon, radiusM: Double): BoundingBox {
        val dLat = deg(radiusM / EARTH_RADIUS_M)
        val dLon = deg(radiusM / (EARTH_RADIUS_M * cos(rad(center.lat)).coerceAtLeast(1e-6)))
        return BoundingBox(
            (center.lat - dLat).coerceAtLeast(-90.0),
            (center.lon - dLon).coerceAtLeast(-180.0),
            (center.lat + dLat).coerceAtMost(90.0),
            (center.lon + dLon).coerceAtMost(180.0),
        )
    }

    /** Result of projecting a point onto a segment. */
    public data class SegmentProjection(
        /** Distance from the point to the closest point of the segment, metres. */
        val distanceM: Double,
        /** Position of the closest point along the segment, 0 (start) – 1 (end). */
        val fraction: Double,
    )

    /**
     * Closest approach of [p] to segment [a]–[b], using a local equirectangular projection
     * centred on [p] (errors are negligible for segments of a few hundred metres).
     */
    public fun projectOntoSegment(p: LatLon, a: LatLon, b: LatLon): SegmentProjection {
        val cosLat = cos(rad(p.lat))
        fun x(q: LatLon) = rad(q.lon - p.lon) * cosLat * EARTH_RADIUS_M
        fun y(q: LatLon) = rad(q.lat - p.lat) * EARTH_RADIUS_M
        val ax = x(a)
        val ay = y(a)
        val dx = x(b) - ax
        val dy = y(b) - ay
        val lengthSq = dx * dx + dy * dy
        val t = if (lengthSq == 0.0) 0.0 else ((-ax * dx - ay * dy) / lengthSq).coerceIn(0.0, 1.0)
        return SegmentProjection(hypot(ax + t * dx, ay + t * dy), t)
    }
}

/**
 * A cell of a fixed lat/lon grid, used as the unit of Overpass requests and caching: every
 * position maps to exactly one tile, so neighbouring positions share cached data.
 */
public data class GeoTile(val x: Int, val y: Int, val sizeDeg: Double = DEFAULT_SIZE_DEG) {
    public val bounds: BoundingBox
        get() = BoundingBox(
            y * sizeDeg - 90.0,
            x * sizeDeg - 180.0,
            (y + 1) * sizeDeg - 90.0,
            (x + 1) * sizeDeg - 180.0,
        )

    /** The tile's bounds grown by [marginDeg] (so ways crossing the edge are complete enough). */
    public fun paddedBounds(marginDeg: Double = sizeDeg * 0.1): BoundingBox {
        val b = bounds
        return BoundingBox(
            (b.south - marginDeg).coerceAtLeast(-90.0),
            (b.west - marginDeg).coerceAtLeast(-180.0),
            (b.north + marginDeg).coerceAtMost(90.0),
            (b.east + marginDeg).coerceAtMost(180.0),
        )
    }

    /** Stable identifier, usable as a cache file name. */
    public val key: String get() = "${sizeDeg}_${x}_$y"

    public companion object {
        /** ≈ 2.2 km north–south; one Overpass request per tile stays small in cities. */
        public const val DEFAULT_SIZE_DEG: Double = 0.02

        public fun of(p: LatLon, sizeDeg: Double = DEFAULT_SIZE_DEG): GeoTile = GeoTile(
            floor((p.lon + 180.0) / sizeDeg).toInt(),
            floor((p.lat.coerceIn(-90.0, 89.999999) + 90.0) / sizeDeg).toInt(),
            sizeDeg,
        )

        /** Tiles intersecting the circle of [radiusM] around [center] (1–4 for small radii). */
        public fun covering(center: LatLon, radiusM: Double, sizeDeg: Double = DEFAULT_SIZE_DEG): List<GeoTile> {
            val box = Geo.boxAround(center, radiusM)
            val sw = of(LatLon(box.south, box.west), sizeDeg)
            val ne = of(LatLon(box.north, box.east), sizeDeg)
            val centerTile = of(center, sizeDeg)
            val tiles = ArrayList<GeoTile>()
            for (y in sw.y..ne.y) for (x in sw.x..ne.x) tiles += GeoTile(x, y, sizeDeg)
            // The tile under the vehicle first: it matters most.
            return listOf(centerTile) + (tiles - centerTile)
        }
    }
}
