package dev.carheadsup.protocol.traffic

import dev.carheadsup.protocol.HazardItem
import dev.carheadsup.protocol.HazardType
import dev.carheadsup.protocol.PhoneHazards
import dev.carheadsup.protocol.PhoneWire
import dev.carheadsup.protocol.link.ReconnectBackoff
import dev.carheadsup.protocol.osm.BoundingBox
import dev.carheadsup.protocol.osm.Geo
import dev.carheadsup.protocol.osm.LatLon
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import java.net.URLDecoder

/** A realistic TomTom Incident Details v5 answer around the A7 in Hamburg (see the file's incidents). */
private fun sample(): String =
    requireNotNull(TrafficTest::class.java.getResource("/traffic/tomtom-a7-northbound.json")).readText()

/** The car of [sample]: on the A7 northbound, heading due north. */
private val CAR = LatLon(53.56, 9.9)
private const val NORTH = 0.0

private const val KEY = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"

private fun incident(
    id: String = "tomtom-1",
    kind: TrafficIncidentKind = TrafficIncidentKind.JAM,
    magnitude: DelayMagnitude = DelayMagnitude.MAJOR,
    delaySeconds: Double? = 300.0,
    points: List<LatLon> = listOf(Geo.destination(CAR, NORTH, 2_000.0), Geo.destination(CAR, NORTH, 3_000.0)),
    eventDescription: String? = null,
) = TrafficIncident(id, kind, magnitude, delaySeconds, lengthM = null, points, eventDescription)

class TrafficTest {
    @Nested
    inner class TomTomRequest {
        private val tomtom = TomTomTraffic()

        private fun params(url: String): Map<String, String> = url.substringAfter('?').split('&').associate {
            val (name, value) = it.split('=', limit = 2)
            name to URLDecoder.decode(value, "UTF-8")
        }

        @Test
        fun `incident details v5 with key, bbox, fields, language and present incidents only`() {
            val area = BoundingBox(south = 53.558, west = 9.855, north = 53.65, east = 9.945)
            val request = tomtom.request(area, " $KEY ")
            assertTrue(request.url.startsWith("https://api.tomtom.com/traffic/services/5/incidentDetails?"))
            val params = params(request.url)
            assertEquals(setOf("key", "bbox", "fields", "language", "timeValidityFilter"), params.keys)
            assertEquals(KEY, params["key"])
            // minLon,minLat,maxLon,maxLat
            assertEquals("9.855000,53.558000,9.945000,53.650000", params["bbox"])
            assertEquals(TomTomTraffic.FIELDS, params["fields"])
            assertEquals("en-GB", params["language"])
            assertEquals("present", params["timeValidityFilter"])
            // The fields projection's braces and commas are escaped in the URL.
            assertFalse(request.url.contains('{') || request.url.contains('}'))
            assertEquals("application/json", request.headers["Accept"])
        }

        @Test
        fun `the key never shows up in logs`() {
            val request = tomtom.request(BoundingBox(53.5, 9.8, 53.6, 9.9), KEY)
            assertFalse(request.toString().contains(KEY))
            assertEquals(
                "TrafficRequest(https://api.tomtom.com/traffic/services/5/incidentDetails)",
                request.toString(),
            )
        }

        @Test
        fun `the fields projection asks for what the parser reads`() {
            for (field in listOf("id", "iconCategory", "magnitudeOfDelay", "events{description", "delay", "length")) {
                assertTrue(TomTomTraffic.FIELDS.contains(field), field)
            }
            // Balanced braces, no whitespace (it is a query parameter).
            assertEquals(TomTomTraffic.FIELDS.count { it == '{' }, TomTomTraffic.FIELDS.count { it == '}' })
            assertFalse(TomTomTraffic.FIELDS.any { it.isWhitespace() })
        }

        @Test
        fun `implausible keys and oversized boxes are refused`() {
            val area = BoundingBox(53.5, 9.8, 53.6, 9.9)
            assertThrows(IllegalArgumentException::class.java) { tomtom.request(area, "") }
            assertThrows(IllegalArgumentException::class.java) { tomtom.request(area, "short") }
            assertThrows(IllegalArgumentException::class.java) {
                tomtom.request(area, "has spaces in it, 32 chars long!")
            }
            assertThrows(IllegalArgumentException::class.java) { tomtom.request(area, "$KEY&bbox=1,2,3,4") }
            // About 110 × 130 km: over TomTom's 10,000 km².
            assertThrows(IllegalArgumentException::class.java) {
                tomtom.request(BoundingBox(53.0, 9.0, 54.0, 11.0), KEY)
            }
            assertTrue(TomTomTraffic.isPlausibleKey(KEY))
            assertThrows(IllegalArgumentException::class.java) { TomTomTraffic(baseUrl = "http://api.tomtom.com") }
        }

        @ParameterizedTest
        @CsvSource(
            "200, OK",
            "204, OK",
            "400, REJECTED",
            "401, BAD_KEY",
            "403, BAD_KEY",
            "404, REJECTED",
            "405, REJECTED",
            "408, UNAVAILABLE",
            "429, RATE_LIMITED",
            "500, UNAVAILABLE",
            "503, UNAVAILABLE",
            "596, UNAVAILABLE",
        )
        fun `HTTP status codes`(code: Int, outcome: TrafficHttpOutcome) {
            assertEquals(outcome, tomtom.classify(code))
        }
    }

    @Nested
    inner class TomTomResponse {
        private val incidents = TomTomTraffic().parse(sample())

        private fun byId(id: String) = incidents.single { it.id == "tomtom-$id" }

        @Test
        fun `incidents are parsed, de-duplicated, and future, unlikely or unplaceable ones skipped`() {
            // 12 features: one duplicate, one in the future, one without geometry.
            assertEquals(9, incidents.size)
            assertEquals(incidents.size, incidents.map { it.id }.toSet().size)
            assertTrue(incidents.all { it.id.startsWith(TomTomTraffic.ID_PREFIX) })
            assertTrue(incidents.none { it.id.contains("future") || it.id.contains("nogeometry") })
        }

        @Test
        fun `a jam with its geometry in the direction of traffic`() {
            val jam = byId("4819f7d0a15db3d9b0c3cd9203be7ba5")
            assertEquals(TrafficIncidentKind.JAM, jam.kind)
            assertEquals(DelayMagnitude.MAJOR, jam.magnitude)
            assertEquals(540.0, jam.delaySeconds)
            assertEquals(1558.2, jam.lengthM)
            assertEquals(LatLon(53.596, 9.9005), jam.start)
            assertEquals(4, jam.points.size)
            assertEquals("Stationary traffic", jam.eventDescription)
            assertEquals(listOf("A7", "E45"), jam.roadNumbers)
        }

        @Test
        fun `points, closures, missing delays and missing fields`() {
            val closed = byId("7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d")
            assertEquals(TrafficIncidentKind.ROAD_CLOSED, closed.kind)
            assertEquals(DelayMagnitude.INDEFINITE, closed.magnitude)
            assertNull(closed.delaySeconds) // 0: closures have no delay figure
            val brokenDown = byId("99887766554433221100ffeeddccbbaa")
            assertEquals(listOf(LatLon(53.5654, 9.9001)), brokenDown.points)
            assertNull(brokenDown.delaySeconds) // null in the answer
            // Only geometry and category (TomTom's default projection): an id from both, the rest unknown.
            val fog = incidents.single { it.kind == TrafficIncidentKind.FOG }
            assertEquals("tomtom-at-2-53.60500-9.90040", fog.id)
            assertEquals(DelayMagnitude.UNKNOWN, fog.magnitude)
            assertNull(fog.delaySeconds)
            assertNull(fog.lengthM)
            assertNull(fog.eventDescription)
            assertEquals(emptyList<String>(), fog.roadNumbers)
        }

        @ParameterizedTest
        @CsvSource(
            "0, UNKNOWN",
            "1, ACCIDENT",
            "2, FOG",
            "3, DANGEROUS_CONDITIONS",
            "4, RAIN",
            "5, ICE",
            "6, JAM",
            "7, LANE_CLOSED",
            "8, ROAD_CLOSED",
            "9, ROAD_WORKS",
            "10, WIND",
            "11, FLOODING",
            "12, UNKNOWN",
            "14, BROKEN_DOWN_VEHICLE",
            "99, UNKNOWN",
        )
        fun `icon categories`(category: Int, kind: TrafficIncidentKind) {
            assertEquals(kind, TomTomTraffic.kindOf(category))
        }

        @Test
        fun `delay magnitudes`() {
            assertEquals(
                listOf(
                    DelayMagnitude.UNKNOWN,
                    DelayMagnitude.MINOR,
                    DelayMagnitude.MODERATE,
                    DelayMagnitude.MAJOR,
                    DelayMagnitude.INDEFINITE,
                    DelayMagnitude.UNKNOWN,
                    DelayMagnitude.UNKNOWN,
                ),
                listOf(0, 1, 2, 3, 4, 5, null).map { TomTomTraffic.magnitudeOf(it) },
            )
        }

        @Test
        fun `odd but readable answers are tolerated`() {
            val parser = TomTomTraffic()
            assertEquals(emptyList<TrafficIncident>(), parser.parse("""{"incidents": []}"""))
            val odd =
                parser.parse(
                    """
                    {"incidents": [
                      null, 42, {"type": "Feature"},
                      {"geometry": {"coordinates": [9.9, 53.6]}, "properties": {"id": 17, "iconCategory": "6",
                        "magnitudeOfDelay": null, "delay": "600", "events": "none", "roadNumbers": [null, " A1 "]}},
                      {"geometry": {"type": "LineString", "coordinates": [[9.9, 95.0], [9.91, 53.61], "x", [9.92]]},
                        "properties": {"id": "bad-points", "iconCategory": 1}},
                      {"geometry": {"type": "Point", "coordinates": [200.0, 53.6]}, "properties": {"id": "off-globe"}},
                      {"geometry": {"type": "Point", "coordinates": [9.9, 53.6]},
                        "properties": {"id": "unlikely", "probabilityOfOccurrence": "improbable"}}
                    ], "extra": true}
                    """.trimIndent(),
                )
            assertEquals(listOf("tomtom-17", "tomtom-bad-points"), odd.map { it.id })
            assertEquals(TrafficIncidentKind.JAM, odd[0].kind)
            assertEquals(600.0, odd[0].delaySeconds)
            assertEquals(listOf("A1"), odd[0].roadNumbers)
            assertEquals(listOf(LatLon(53.61, 9.91)), odd[1].points)
        }

        @Test
        fun `garbage and error bodies are reported`() {
            val parser = TomTomTraffic()
            for (body in listOf("", "<html>", "[]", "{}", """{"incidents": {}}""")) {
                assertThrows(TrafficParseException::class.java) { parser.parse(body) }
            }
            val error =
                assertThrows(TrafficParseException::class.java) {
                    parser.parse("""{"detailedError ": {"code": "INVALID_REQUEST", "message": "Unknown field"}}""")
                }
            assertTrue(error.message!!.contains("Unknown field"))
        }
    }

    @Nested
    inner class Hazards {
        @Test
        fun `jams by magnitude, and by delay when the magnitude is unknown`() {
            fun type(magnitude: DelayMagnitude, delay: Double?) =
                TrafficHazards.typeOf(incident(magnitude = magnitude, delaySeconds = delay))
            assertEquals(HazardType.TRAFFIC_JAM, type(DelayMagnitude.MAJOR, null))
            assertEquals(HazardType.TRAFFIC_JAM, type(DelayMagnitude.MODERATE, 60.0))
            assertEquals(HazardType.SLOWDOWN, type(DelayMagnitude.MINOR, 900.0))
            assertEquals(HazardType.SLOWDOWN, type(DelayMagnitude.UNKNOWN, 299.0))
            assertEquals(HazardType.TRAFFIC_JAM, type(DelayMagnitude.UNKNOWN, 300.0))
            assertEquals(HazardType.SLOWDOWN, type(DelayMagnitude.UNKNOWN, null))
            assertEquals("Stationary traffic", TrafficHazards.description(incident(magnitude = DelayMagnitude.MAJOR)))
            assertEquals("Queuing traffic", TrafficHazards.description(incident(magnitude = DelayMagnitude.MODERATE)))
            assertEquals("Slow traffic", TrafficHazards.description(incident(magnitude = DelayMagnitude.MINOR)))
            assertEquals(
                "Traffic jam",
                TrafficHazards.description(incident(magnitude = DelayMagnitude.UNKNOWN, delaySeconds = 600.0)),
            )
        }

        @ParameterizedTest
        @CsvSource(
            "ACCIDENT, ACCIDENT, Accident",
            "ROAD_WORKS, ROAD_WORKS, Road works",
            "LANE_CLOSED, OTHER, Lane closed",
            "ROAD_CLOSED, OTHER, Road closed",
            "FOG, WEATHER, Fog",
            "RAIN, WEATHER, Heavy rain",
            "ICE, WEATHER, Ice",
            "WIND, WEATHER, Strong wind",
            "FLOODING, WEATHER, Flooding",
            "BROKEN_DOWN_VEHICLE, OBJECT_ON_ROAD, Broken-down vehicle",
            "DANGEROUS_CONDITIONS, OTHER, Dangerous conditions",
            "UNKNOWN, OTHER, Traffic incident",
        )
        fun `kinds become HUD hazard types with a short description`(
            kind: TrafficIncidentKind,
            type: HazardType,
            description: String,
        ) {
            val item = TrafficHazards.toHazard(incident(kind = kind), 1_234.0)
            assertEquals(type, item.type)
            assertEquals(description, item.description)
            assertEquals(1_234.0, item.distanceM)
            assertNull(item.speedLimitKph)
        }

        @Test
        fun `the service's text only where the kind says too little`() {
            val danger =
                incident(kind = TrafficIncidentKind.DANGEROUS_CONDITIONS, eventDescription = " Animals\non the road ")
            assertEquals("Animals on the road", TrafficHazards.description(danger))
            val long = incident(kind = TrafficIncidentKind.UNKNOWN, eventDescription = "x".repeat(200))
            assertEquals(TrafficHazards.DESCRIPTION_MAX, TrafficHazards.description(long).length)
            // A closure keeps its own phrase whatever the service calls it.
            val closed = incident(kind = TrafficIncidentKind.ROAD_CLOSED, eventDescription = "Closed")
            assertEquals("Road closed", TrafficHazards.description(closed))
        }

        @Test
        fun `only a real delay is passed on`() {
            assertEquals(420.0, TrafficHazards.toHazard(incident(delaySeconds = 420.0), 1.0).delaySeconds)
            assertNull(TrafficHazards.toHazard(incident(delaySeconds = 0.0), 1.0).delaySeconds)
            assertNull(TrafficHazards.toHazard(incident(delaySeconds = null), 1.0).delaySeconds)
            assertNull(TrafficHazards.toHazard(incident(delaySeconds = Double.NaN), 1.0).delaySeconds)
        }
    }

    @Nested
    inner class Corridor {
        private val corridor = TrafficCorridor()

        @Test
        fun `a box reaching 10 km ahead along the heading, not a square around the car`() {
            val box = corridor.box(CAR, NORTH)
            assertTrue(CAR in box)
            assertTrue(Geo.destination(CAR, NORTH, 9_900.0) in box)
            assertTrue(Geo.destination(Geo.destination(CAR, NORTH, 9_900.0), 90.0, 2_900.0) in box)
            assertTrue(Geo.destination(CAR, 180.0, 150.0) in box)
            assertFalse(Geo.destination(CAR, NORTH, 10_300.0) in box)
            assertFalse(Geo.destination(CAR, 180.0, 1_000.0) in box) // behind
            assertFalse(Geo.destination(CAR, 90.0, 3_500.0) in box) // off to the side
            // 10.2 km × 6 km.
            assertEquals(61.2, TrafficCorridor.areaKm2(box), 1.0)
        }

        @Test
        fun `turned corridors grow their box but stay far below TomTom's limit`() {
            for (heading in listOf(45.0, 90.0, 135.0, 210.0, 270.0, 315.0)) {
                val box = corridor.box(CAR, heading)
                assertTrue(CAR in box, "$heading")
                assertTrue(Geo.destination(CAR, heading, 9_900.0) in box, "$heading")
                assertTrue(TrafficCorridor.areaKm2(box) < 200.0, "$heading")
            }
            // Along an axis the box is the corridor itself; diagonally it takes in some of the sides.
            val east = corridor.box(CAR, 90.0)
            assertFalse(Geo.destination(CAR, 270.0, 1_000.0) in east)
            assertEquals(61.2, TrafficCorridor.areaKm2(east), 1.0)
        }

        @Test
        fun `a corridor across the antimeridian is cut there`() {
            val fiji = LatLon(-17.0, 179.99)
            val box = corridor.box(fiji, 90.0)
            assertEquals(180.0, box.east)
            assertTrue(box.west < 179.99 && box.west > 179.9)
            assertTrue(fiji in box)
            // As far north as roads go (Svalbard): still a small box.
            val svalbard = LatLon(78.22, 15.65)
            val arctic = corridor.box(svalbard, NORTH)
            assertTrue(svalbard in arctic)
            assertEquals(61.2, TrafficCorridor.areaKm2(arctic), 1.0)
        }
    }

    @Nested
    inner class Ahead {
        private val finder = TrafficIncidentFinder()
        private val incidents = TomTomTraffic().parse(sample())

        @Test
        fun `incidents ahead on the car's carriageway, nearest first`() {
            val ahead = finder.ahead(incidents, CAR, NORTH)
            assertEquals(
                listOf(
                    HazardType.OBJECT_ON_ROAD to "tomtom-99887766554433221100ffeeddccbbaa",
                    HazardType.ACCIDENT to "tomtom-0f9e8d7c6b5a49382716f5e4d3c2b1a0",
                    HazardType.TRAFFIC_JAM to "tomtom-4819f7d0a15db3d9b0c3cd9203be7ba5",
                    HazardType.WEATHER to "tomtom-at-2-53.60500-9.90040",
                    HazardType.OTHER to "tomtom-5f5f5f5f4e4e4e4e3d3d3d3d2c2c2c2c",
                ),
                ahead.map { it.type to it.id },
            )
            val distances = ahead.map { it.distanceM!! }
            assertEquals(
                listOf(600.0, 2_000.0, 4_000.0, 5_000.0, 8_000.0),
                distances.map {
                    Math.round(it / 100.0) *
                        100.0
                },
            )
            val jam = ahead[2]
            assertEquals(Geo.distanceM(CAR, LatLon(53.596, 9.9005)), jam.distanceM!!, 1e-6)
            assertEquals(540.0, jam.delaySeconds)
            assertEquals("Stationary traffic", jam.description)
            assertEquals("Lane closed", ahead[4].description)
            assertEquals(120.0, ahead[4].delaySeconds)
        }

        @Test
        fun `the other carriageway, a crossing road, behind the car and beyond the corridor are not ahead`() {
            val ids = finder.ahead(incidents, CAR, NORTH).map { it.id }.toSet()
            // Queuing southbound on the same motorway, 200 m to the side.
            assertFalse("tomtom-b2c4e1f09d8a7c6b5a4f3e2d1c0b9a88" in ids)
            // A closed road crossing 1 km ahead, running east.
            assertFalse("tomtom-7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d" in ids)
            // Road works 1 km behind and 12 km ahead.
            assertFalse("tomtom-1122334455667788990011223344aabb" in ids)
            assertFalse("tomtom-aabbccddeeff00112233445566778899" in ids)
        }

        @Test
        fun `driving the other way, the southbound jam is the one ahead`() {
            val northOfIt = LatLon(53.615, 9.903)
            val ahead = finder.ahead(incidents, northOfIt, 180.0)
            assertEquals("tomtom-b2c4e1f09d8a7c6b5a4f3e2d1c0b9a88", ahead.first().id)
            assertEquals(HazardType.TRAFFIC_JAM, ahead.first().type) // queuing = moderate
            assertTrue(ahead.none { it.id == "tomtom-4819f7d0a15db3d9b0c3cd9203be7ba5" })
        }

        @Test
        fun `a jam the car has reached is behind it, just before its start it still counts`() {
            val jam = incidents.single { it.id == "tomtom-4819f7d0a15db3d9b0c3cd9203be7ba5" }
            assertNull(finder.distanceAhead(jam, Geo.destination(jam.start, NORTH, 500.0), NORTH))
            assertEquals(30.0, finder.distanceAhead(jam, Geo.destination(jam.start, 180.0, 30.0), NORTH)!!, 0.5)
            // Right next to its start but crossing it: close enough for the cone, yet the traffic
            // in the jam runs another way.
            assertNull(finder.distanceAhead(jam, Geo.destination(jam.start, 270.0, 30.0), 90.0))
        }

        @Test
        fun `a point incident has no direction and counts from any side`() {
            val point = incident(points = listOf(Geo.destination(CAR, 20.0, 1_500.0)))
            assertNull(finder.directionOf(point))
            assertNotNull(finder.distanceAhead(point, CAR, NORTH))
            assertNull(finder.distanceAhead(point, CAR, 90.0)) // 70° off the heading: outside the cone
            // A line too short to have a direction behaves like a point.
            val stub = incident(points = listOf(Geo.destination(CAR, NORTH, 900.0), Geo.destination(CAR, NORTH, 905.0)))
            assertNull(finder.directionOf(stub))
        }

        @Test
        fun `the direction is taken near the start, so a jam round a bend still counts`() {
            val start = Geo.destination(CAR, NORTH, 3_000.0)
            val bend = Geo.destination(start, 10.0, 400.0)
            val afterBend = Geo.destination(bend, 100.0, 2_000.0) // the road turns east after 400 m
            val jam = incident(points = listOf(start, bend, afterBend))
            assertEquals(10.0, finder.directionOf(jam)!!, 0.5)
            assertNotNull(finder.distanceAhead(jam, CAR, NORTH))
        }

        @Test
        fun `duplicates count once and results are capped`() {
            val many = (1..40).map {
                incident(id = "tomtom-$it", points = listOf(Geo.destination(CAR, NORTH, it * 200.0)))
            }
            val found = TrafficIncidentFinder(maxResults = 20).ahead(many + many, CAR, NORTH)
            assertEquals(20, found.size)
            assertEquals((1..20).map { "tomtom-$it" }, found.map { it.id })
        }

        @Test
        fun `the hazards pass the wire sanitizer unchanged`() {
            val items = finder.ahead(incidents, CAR, NORTH)
            val json = requireNotNull(PhoneWire.encode(PhoneHazards(items)))
            assertEquals(PhoneHazards(items), PhoneWire.decodeOrNull(json))
        }
    }

    @Nested
    inner class Policy {
        private val day = 20_000L
        private val moving = TrafficFix(CAR, NORTH, speedMps = 30.0)

        private fun at(distanceM: Double, heading: Double? = NORTH, speed: Double? = 30.0) =
            TrafficFix(Geo.destination(CAR, NORTH, distanceM), heading, speed)

        private fun policy(budget: TrafficBudget = TrafficBudget()) = TrafficPolicy(
            budget = budget,
            backoff = ReconnectBackoff(initialMs = 30_000, maxMs = 15 * 60_000L, jitter = 0.0),
        )

        /** Runs a request that succeeds at [nowMs]. */
        private fun TrafficPolicy.fetch(fix: TrafficFix, nowMs: Long) {
            assertEquals(TrafficDecision.REQUEST, decide(fix, nowMs, day))
            assertTrue(onRequestStarted(fix, nowMs, day))
            assertEquals(TrafficDecision.IN_FLIGHT, decide(fix, nowMs + 500, day))
            onSuccess(nowMs + 800)
        }

        @Test
        fun `polls every 2 minutes while driving`() {
            val policy = policy()
            policy.fetch(moving, 0)
            assertEquals(TrafficDecision.UP_TO_DATE, policy.decide(at(1_000.0), 60_000, day))
            assertEquals(TrafficDecision.UP_TO_DATE, policy.decide(at(2_000.0), 119_999, day))
            policy.fetch(at(2_500.0), 120_000)
            assertEquals(2, policy.budget.usedOn(day))
        }

        @Test
        fun `asks again at once after 3 km or a turn, but not more than once a minute`() {
            val policy = policy()
            policy.fetch(moving, 0)
            // 3 km in 40 s (a fast car): due, but the minimum interval holds it back.
            assertEquals(TrafficDecision.WAITING, policy.decide(at(3_050.0), 40_000, day))
            policy.fetch(at(3_100.0), 61_000)
            // Turning onto another road (east): the corridor no longer covers the way ahead.
            val turned = TrafficFix(Geo.destination(CAR, NORTH, 3_500.0), 90.0, 20.0)
            assertEquals(TrafficDecision.WAITING, policy.decide(turned, 100_000, day))
            policy.fetch(turned, 122_000)
            // Small wiggles of the heading do not count.
            val wiggle = TrafficFix(turned.position, 120.0, 20.0)
            assertEquals(TrafficDecision.UP_TO_DATE, policy.decide(wiggle, 190_000, day))
        }

        @Test
        fun `nothing is asked without a direction of travel`() {
            val policy = policy()
            assertEquals(TrafficDecision.NO_HEADING, policy.decide(at(0.0, heading = null), 0, day))
            assertFalse(policy.onRequestStarted(at(0.0, heading = null), 0, day))
            assertEquals(0, policy.budget.usedOn(day))
        }

        @Test
        fun `keeps polling at lights and in queues, pauses after standing 5 minutes`() {
            val policy = policy()
            policy.fetch(moving, 0)
            val stopped = at(500.0, speed = 0.0)
            assertEquals(TrafficDecision.UP_TO_DATE, policy.decide(stopped, 30_000, day))
            // Standing in a queue for 2 minutes: the delay changes, so it is asked again.
            policy.fetch(stopped, 150_000)
            assertEquals(TrafficDecision.UP_TO_DATE, policy.decide(stopped, 260_000, day))
            assertEquals(TrafficDecision.STATIONARY, policy.decide(stopped, 330_000, day))
            assertEquals(TrafficDecision.STATIONARY, policy.decide(at(500.0, speed = null), 3_600_000, day))
            // Driving off: asked at once (the data is old).
            assertEquals(TrafficDecision.REQUEST, policy.decide(at(520.0, speed = 8.0), 3_601_000, day))
        }

        @Test
        fun `failures back off, honour Retry-After, and success resets the backoff`() {
            val policy = policy()
            assertTrue(policy.onRequestStarted(moving, 0, day))
            policy.onFailure(1_000)
            assertEquals(31_000, policy.nextAllowedAtMs())
            assertEquals(TrafficDecision.WAITING, policy.decide(moving, 30_000, day))
            assertEquals(TrafficDecision.REQUEST, policy.decide(moving, 31_000, day))
            policy.onRequestStarted(moving, 31_000, day)
            policy.onFailure(32_000)
            assertEquals(92_000, policy.nextAllowedAtMs())
            policy.onRequestStarted(moving, 92_000, day)
            policy.onFailure(93_000, retryAfterMs = 600_000)
            assertEquals(693_000, policy.nextAllowedAtMs())
            policy.fetch(moving, 693_000)
            assertTrue(policy.onRequestStarted(moving, 900_000, day))
            policy.onFailure(900_000)
            assertEquals(930_000, policy.nextAllowedAtMs()) // back to 30 s
        }

        @Test
        fun `a refused key stops all requests`() {
            val policy = policy()
            policy.onRequestStarted(moving, 0, day)
            policy.onBadKey()
            assertTrue(policy.keyRefused)
            assertEquals(TrafficDecision.BAD_KEY, policy.decide(moving, 3_600_000, day + 1))
        }

        @Test
        fun `the daily budget is never exceeded and renews the next UTC day`() {
            val policy = policy(TrafficBudget(dailyLimit = 3))
            var now = 0L
            repeat(3) {
                policy.fetch(at(now / 10.0), now)
                now += 120_000
            }
            assertEquals(TrafficDecision.BUDGET_EXHAUSTED, policy.decide(at(now / 10.0), now, day))
            assertFalse(policy.onRequestStarted(at(now / 10.0), now, day))
            assertEquals(3, policy.budget.usedOn(day))
            assertEquals(TrafficDecision.REQUEST, policy.decide(at(now / 10.0), now, day + 1))
        }

        @Test
        fun `old data is not shown`() {
            val policy = policy()
            assertTrue(policy.dataUsable(0, 600_000))
            assertFalse(policy.dataUsable(0, 600_001))
            assertFalse(policy.dataUsable(10_000, 0)) // clock confusion
        }

        @Test
        fun `status for the UI`() {
            assertEquals(
                TrafficState.ACTIVE,
                TrafficStatus.stateOf(TrafficDecision.UP_TO_DATE, lastRequestFailed = false),
            )
            assertEquals(
                TrafficState.ACTIVE,
                TrafficStatus.stateOf(TrafficDecision.IN_FLIGHT, lastRequestFailed = false),
            )
            assertEquals(TrafficState.ERROR, TrafficStatus.stateOf(TrafficDecision.WAITING, lastRequestFailed = true))
            assertEquals(
                TrafficState.PAUSED,
                TrafficStatus.stateOf(TrafficDecision.STATIONARY, lastRequestFailed = true),
            )
            assertEquals(TrafficState.WAITING_FOR_LOCATION, TrafficStatus.stateOf(TrafficDecision.NO_HEADING, false))
            assertEquals(TrafficState.BAD_KEY, TrafficStatus.stateOf(TrafficDecision.BAD_KEY, true))
            assertEquals(TrafficState.BUDGET_EXHAUSTED, TrafficStatus.stateOf(TrafficDecision.BUDGET_EXHAUSTED, false))
        }
    }

    @Nested
    inner class Budget {
        @Test
        fun `UTC days`() {
            assertEquals(0, TrafficBudget.dayOf(0))
            assertEquals(0, TrafficBudget.dayOf(86_399_999))
            assertEquals(1, TrafficBudget.dayOf(86_400_000))
            assertEquals(-1, TrafficBudget.dayOf(-1))
            assertEquals(20_361, TrafficBudget.dayOf(1_759_190_400_000)) // 2025-09-30T00:00Z
        }

        @Test
        fun `counts per day, survives a restart, and a clock going back keeps counting`() {
            val budget = TrafficBudget(dailyLimit = 2)
            assertEquals(2, budget.remaining(5))
            assertTrue(budget.tryConsume(5))
            val restored = TrafficBudget(dailyLimit = 2).apply { restore(budget.day, budget.used) }
            assertEquals(1, restored.usedOn(5))
            assertTrue(restored.tryConsume(4)) // yesterday, per a clock that went back
            assertEquals(2, restored.usedOn(5))
            assertFalse(restored.tryConsume(5))
            assertEquals(0, restored.remaining(5))
            assertTrue(restored.tryConsume(6))
            assertEquals(1, restored.usedOn(6))
            assertEquals(0, restored.usedOn(7))
        }
    }

    @Test
    fun `a hazard list from the sample stays within the HUD's limits`() {
        val items: List<HazardItem> = TrafficIncidentFinder().ahead(TomTomTraffic().parse(sample()), CAR, NORTH)
        assertTrue(items.all { it.id.length <= 256 && (it.description?.length ?: 0) <= 300 })
    }
}
