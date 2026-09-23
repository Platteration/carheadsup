package dev.carheadsup.protocol.osm

import dev.carheadsup.protocol.HazardType
import dev.carheadsup.protocol.RoadClass
import dev.carheadsup.protocol.RoadSource
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
import org.junit.jupiter.params.provider.ValueSource
import java.net.URLDecoder

class OsmTest {
    @Nested
    inner class Maxspeed {
        @ParameterizedTest
        @CsvSource(
            delimiter = '|',
            value = [
                "50 | 50.0",
                "50 km/h | 50.0",
                "100kmh | 100.0",
                "30 mph | 48.28032",
                "70 MPH | 112.65408",
                "10 knots | 18.52",
                "walk | 7.0",
                "DE:urban | 50.0",
                "de:rural | 100.0",
                "RU:urban | 60.0",
                "RU:rural | 90.0",
                "FR:motorway | 130.0",
                "AT:motorway | 130.0",
                "CH:rural | 80.0",
                "GB:nsl_single | 96.56064",
                "GB:nsl_dual | 112.65408",
                "UK:nsl_single | 96.56064",
                "GB:motorway | 112.65408",
                "DE:living_street | 7.0",
                "DE:zone30 | 30.0",
                "DE:zone:20 | 20.0",
                "GB:zone20 | 32.18688",
                "BE-VLG:rural | 70.0",
                "50;30 | 30.0",
                "DE:urban;30 | 30.0",
                " 60 | 60.0",
            ],
        )
        fun `limited values`(value: String, kph: Double) {
            val limit = OsmSpeedLimit.parse(value) as SpeedLimit.Limited
            assertEquals(kph, limit.kph, 1e-6)
        }

        @Test
        fun `unlimited and variable values`() {
            assertEquals(SpeedLimit.Unlimited, OsmSpeedLimit.parse("none"))
            assertEquals(SpeedLimit.Unlimited, OsmSpeedLimit.parse("DE:motorway"))
            assertEquals(SpeedLimit.Variable, OsmSpeedLimit.parse("signals"))
            assertEquals(SpeedLimit.Variable, OsmSpeedLimit.parse("variable"))
            assertEquals(SpeedLimit.Variable, OsmSpeedLimit.parse("signals;none"))
            assertEquals(SpeedLimit.Unlimited, OsmSpeedLimit.parse("none;none"))
        }

        @ParameterizedTest
        @ValueSource(strings = ["", "  ", "fast", "0", "-30", "XX:urban", "US:urban", "50 furlongs", "DE:zone:0", ";"])
        fun `unknown values`(value: String) {
            assertNull(OsmSpeedLimit.parse(value))
        }

        @Test
        fun `null is unknown`() {
            assertNull(OsmSpeedLimit.parse(null))
        }

        @Test
        fun `every implicit entry resolves`() {
            for ((key, value) in OsmSpeedLimit.IMPLICIT) {
                assertNotNull(OsmSpeedLimit.parse(key), "$key → $value")
            }
        }

        @Test
        fun `directional and implicit tags on a way`() {
            val tags = mapOf("maxspeed" to "80", "maxspeed:forward" to "60", "maxspeed:backward" to "70")
            assertEquals(SpeedLimit.Limited(60.0), OsmSpeedLimit.forWay(tags, forward = true))
            assertEquals(SpeedLimit.Limited(70.0), OsmSpeedLimit.forWay(tags, forward = false))
            assertEquals(
                SpeedLimit.Limited(80.0),
                OsmSpeedLimit.forWay(
                    mapOf(
                        "maxspeed" to "80",
                        "maxspeed:forward" to "60",
                    ),
                    forward = false,
                ),
            )
            assertEquals(SpeedLimit.Limited(50.0), OsmSpeedLimit.forWay(mapOf("maxspeed:type" to "DE:urban")))
            assertEquals(SpeedLimit.Limited(100.0), OsmSpeedLimit.forWay(mapOf("source:maxspeed" to "DE:rural")))
            assertEquals(SpeedLimit.Limited(30.0), OsmSpeedLimit.forWay(mapOf("zone:maxspeed" to "DE:30")))
            assertEquals(
                SpeedLimit.Limited(30.0),
                OsmSpeedLimit.forWay(
                    mapOf(
                        "maxspeed" to "garbage",
                        "zone:maxspeed" to "DE:30",
                    ),
                ),
            )
            assertNull(OsmSpeedLimit.forWay(mapOf("highway" to "residential")))
        }

        @Test
        fun `road classes`() {
            assertEquals(RoadClass.MOTORWAY, OsmSpeedLimit.roadClassOf("motorway_link"))
            assertEquals(RoadClass.TRUNK, OsmSpeedLimit.roadClassOf("trunk"))
            assertEquals(RoadClass.RESIDENTIAL, OsmSpeedLimit.roadClassOf("living_street"))
            assertEquals(RoadClass.SERVICE, OsmSpeedLimit.roadClassOf("service"))
            assertEquals(RoadClass.OTHER, OsmSpeedLimit.roadClassOf("unclassified"))
            assertNull(OsmSpeedLimit.roadClassOf(null))
        }
    }

    @Nested
    inner class Queries {
        private val box = BoundingBox(48.13, 11.56, 48.15, 11.58)

        private fun assertBalanced(query: String) {
            assertEquals(query.count { it == '(' }, query.count { it == ')' }, query)
            assertEquals(query.count { it == '[' }, query.count { it == ']' }, query)
            assertEquals(0, query.count { it == '"' } % 2, query)
        }

        @Test
        fun `roads and cameras for a tile`() {
            val query = OverpassQueries.roadsAndCameras(box)
            assertTrue(query.startsWith("[out:json][timeout:25][bbox:48.130000,11.560000,48.150000,11.580000];"), query)
            assertTrue(query.contains("way[\"highway\"~\"^(motorway|motorway_link|trunk|"), query)
            assertTrue(query.contains("node[\"highway\"=\"speed_camera\"];"), query)
            assertTrue(
                query.contains(
                    "relation[\"type\"=\"enforcement\"][\"enforcement\"~\"^(maxspeed|traffic_signals|average_speed|mindistance)$\"];",
                ),
                query,
            )
            assertTrue(query.endsWith("out tags geom qt;"), query)
            assertFalse(query.contains("footway"))
            assertBalanced(query)
        }

        @Test
        fun `ways around a point and cameras only`() {
            val around = OverpassQueries.waysAround(LatLon(48.137154, 11.576124), 60)
            assertTrue(around.contains("way(around:60,48.137154,11.576124)[\"highway\"~"), around)
            assertBalanced(around)
            val cameras = OverpassQueries.speedCameras(box, timeoutS = 10)
            assertTrue(cameras.startsWith("[out:json][timeout:10][bbox:"), cameras)
            assertFalse(cameras.contains("way["))
            assertBalanced(cameras)
        }

        @Test
        fun `invalid parameters are rejected`() {
            assertThrows(IllegalArgumentException::class.java) { OverpassQueries.waysAround(LatLon(0.0, 0.0), 0) }
            assertThrows(IllegalArgumentException::class.java) { OverpassQueries.roadsAndCameras(box, timeoutS = 0) }
            assertThrows(IllegalArgumentException::class.java) { BoundingBox(1.0, 0.0, 0.0, 1.0) }
        }

        @Test
        fun `form body round-trips`() {
            val query = OverpassQueries.roadsAndCameras(box)
            val body = OverpassQueries.formBody(query)
            assertTrue(body.startsWith("data="))
            assertFalse(body.contains(' ') || body.contains('"') || body.contains('['))
            assertEquals(query, URLDecoder.decode(body.removePrefix("data="), "UTF-8"))
        }
    }

    @Nested
    inner class Parsing {
        private val sample =
            """
            {"version":0.6,"generator":"Overpass API 0.7.62","osm3s":{"timestamp_osm_base":"2026-09-23T10:00:00Z"},
             "elements":[
              {"type":"way","id":100,"bounds":{"minlat":48.0,"minlon":11.0,"maxlat":48.1,"maxlon":11.1},
               "geometry":[{"lat":48.0,"lon":11.0},{"lat":48.001,"lon":11.0},null,{"lat":48.003,"lon":11.0},{"lat":48.004,"lon":11.0}],
               "tags":{"highway":"primary","name":"Leopoldstraße","maxspeed":"50","oneway":"yes"}},
              {"type":"way","id":101,"geometry":[{"lat":48.0,"lon":11.001},{"lat":48.0,"lon":11.002}],"tags":{"highway":"footway"}},
              {"type":"way","id":102,"geometry":[{"lat":48.0,"lon":11.003}],"tags":{"highway":"residential"}},
              {"type":"node","id":200,"lat":48.002,"lon":11.0,"tags":{"highway":"speed_camera","maxspeed":"50"}},
              {"type":"node","id":201,"lat":48.005,"lon":11.0,"tags":{"highway":"speed_camera"}},
              {"type":"node","id":202,"lat":48.006,"lon":11.0,"tags":{"amenity":"cafe"}},
              {"type":"relation","id":300,"tags":{"type":"enforcement","enforcement":"maxspeed","maxspeed":"80"},
               "members":[{"type":"node","ref":201,"role":"device","lat":48.005,"lon":11.0},
                          {"type":"node","ref":203,"role":"from","lat":48.0049,"lon":11.0}]},
              {"type":"relation","id":301,"tags":{"type":"enforcement","enforcement":"average_speed"},
               "members":[{"type":"node","ref":204,"role":"from","lat":48.01,"lon":11.0},
                          {"type":"way","ref":100,"role":"section","geometry":[{"lat":48.0,"lon":11.0}]}]},
              {"type":"relation","id":302,"tags":{"type":"enforcement","enforcement":"traffic_signals"},"members":[]},
              {"type":"relation","id":303,"tags":{"type":"enforcement","enforcement":"toll"},
               "members":[{"type":"node","ref":205,"role":"device","lat":48.02,"lon":11.0}]}
             ]}
            """.trimIndent()

        @Test
        fun `ways are split at clipped nodes and non-drivable ways dropped`() {
            val data = OverpassParser.parse(sample)
            assertEquals(2, data.ways.size)
            assertTrue(data.ways.all { it.id == 100L })
            assertEquals(listOf(LatLon(48.0, 11.0), LatLon(48.001, 11.0)), data.ways[0].points)
            assertEquals("Leopoldstraße", data.ways[0].displayName)
            assertEquals(Oneway.FORWARD, data.ways[0].oneway)
        }

        @Test
        fun `cameras from nodes and enforcement relations, relation devices de-duplicated`() {
            val cameras = OverpassParser.parse(sample).cameras.associateBy { it.id }
            assertEquals(setOf("osm-relation-300", "osm-relation-301", "osm-node-200"), cameras.keys)
            assertEquals(
                OsmCamera("osm-relation-300", HazardType.SPEED_CAMERA, LatLon(48.005, 11.0), 80.0),
                cameras["osm-relation-300"],
            )
            assertEquals(HazardType.SECTION_CONTROL, cameras["osm-relation-301"]!!.type)
            assertEquals(LatLon(48.01, 11.0), cameras["osm-relation-301"]!!.position)
            assertEquals(50.0, cameras["osm-node-200"]!!.maxspeedKph)
        }

        @Test
        fun `Overpass runtime errors and garbage are reported`() {
            val timeout =
                """{"elements":[],"remark":"runtime error: Query timed out in \"query\" at line 1 after 26 seconds."}"""
            assertThrows(OverpassException::class.java) { OverpassParser.parse(timeout) }
            assertThrows(OverpassException::class.java) { OverpassParser.parse("<html>504 Gateway Timeout</html>") }
            assertThrows(OverpassException::class.java) { OverpassParser.parse("""{"elements":[{"type":"way"}]}""") }
            assertEquals(RoadData.EMPTY, OverpassParser.parse("""{"elements":[],"remark":"note: nothing to see"}"""))
        }

        @Test
        fun `oneway variants`() {
            fun way(vararg tags: Pair<String, String>) = OsmWay(1, mapOf(*tags), emptyList())
            assertEquals(Oneway.BACKWARD, way("highway" to "primary", "oneway" to "-1").oneway)
            assertEquals(Oneway.FORWARD, way("highway" to "motorway").oneway)
            assertEquals(Oneway.BOTH, way("highway" to "motorway", "oneway" to "no").oneway)
            assertEquals(Oneway.FORWARD, way("highway" to "tertiary", "junction" to "roundabout").oneway)
            assertEquals(Oneway.BOTH, way("highway" to "residential").oneway)
            assertEquals("A 8", way("highway" to "motorway", "ref" to "A 8").displayName)
        }

        @Test
        fun `road data merges without duplicate cameras`() {
            val data = OverpassParser.parse(sample)
            val merged = data + data
            assertEquals(data.cameras.size, merged.cameras.size)
            assertEquals(data.ways.size * 2, merged.ways.size)
        }
    }

    @Nested
    inner class Matching {
        // A north–south two-way street and, 12 m east, a parallel one-way street southbound.
        private val main =
            OsmWay(
                1,
                mapOf("highway" to "secondary", "name" to "Main St", "maxspeed" to "50"),
                listOf(LatLon(48.0, 11.0), LatLon(48.01, 11.0)),
            )
        private val frontage =
            OsmWay(
                2,
                mapOf("highway" to "tertiary", "name" to "Frontage Rd", "maxspeed" to "30", "oneway" to "yes"),
                listOf(LatLon(48.01, 11.00016), LatLon(48.0, 11.00016)),
            )

        // An east–west street crossing Main St at 48.005.
        private val cross =
            OsmWay(
                3,
                mapOf("highway" to "residential", "name" to "Cross St", "maxspeed" to "30"),
                listOf(LatLon(48.005, 10.995), LatLon(48.005, 11.005)),
            )
        private val ways = listOf(main, frontage, cross)
        private val matcher = WayMatcher()

        @Test
        fun `nearest way without heading`() {
            val match = matcher.match(ways, LatLon(48.002, 11.00003))!!
            assertEquals(1L, match.way.id)
            assertTrue(match.distanceM < 3)
            assertNull(match.headingDiffDeg)
        }

        @Test
        fun `heading decides between parallel roads`() {
            // Nearer the frontage road: heading south it fits (one-way southbound) …
            val between = LatLon(48.002, 11.0001)
            assertEquals(2L, matcher.match(ways, between, bearingDeg = 180.0, speedMps = 15.0)!!.way.id)
            // … heading north it would be wrong-way, so the farther two-way street wins.
            assertEquals(1L, matcher.match(ways, between, bearingDeg = 0.0, speedMps = 15.0)!!.way.id)
        }

        @Test
        fun `at an intersection the street matching the heading wins`() {
            val corner = LatLon(48.00502, 11.00002)
            assertEquals(1L, matcher.match(ways, corner, bearingDeg = 2.0, speedMps = 10.0)!!.way.id)
            assertEquals(3L, matcher.match(ways, corner, bearingDeg = 91.0, speedMps = 10.0)!!.way.id)
        }

        @Test
        fun `slow bearings are ignored and stickiness avoids flicker`() {
            val corner = LatLon(48.00502, 11.00002)
            val slow = matcher.match(ways, corner, bearingDeg = 91.0, speedMps = 0.5)!!
            assertNull(slow.headingDiffDeg)
            // Equidistant-ish point: the previous way is kept.
            val point = LatLon(48.00504, 11.00004)
            assertEquals(3L, matcher.match(ways, point, previousWayId = 3)!!.way.id)
            assertEquals(1L, matcher.match(ways, point, previousWayId = 1)!!.way.id)
        }

        @Test
        fun `far from every road nothing matches, poor accuracy widens the search`() {
            val far = LatLon(48.002, 11.0006) // ~45 m east
            assertNull(matcher.match(ways, far))
            assertNotNull(matcher.match(ways, far, accuracyM = 40.0))
            assertNull(matcher.match(emptyList(), far))
        }

        @Test
        fun `direction of travel selects directional limits`() {
            val twoWay =
                OsmWay(
                    4,
                    mapOf("highway" to "primary", "maxspeed:forward" to "60", "maxspeed:backward" to "80"),
                    listOf(LatLon(48.0, 11.0), LatLon(48.01, 11.0)),
                )
            val north = matcher.match(listOf(twoWay), LatLon(48.005, 11.0), bearingDeg = 0.0, speedMps = 20.0)!!
            val south = matcher.match(listOf(twoWay), LatLon(48.005, 11.0), bearingDeg = 180.0, speedMps = 20.0)!!
            assertEquals(true, north.forward)
            assertEquals(false, south.forward)
            assertEquals(SpeedLimit.Limited(60.0), north.speedLimit)
            assertEquals(SpeedLimit.Limited(80.0), south.speedLimit)
        }

        @Test
        fun `slow traffic keeps the direction of travel instead of guessing forward (android-9)`() {
            val twoWay =
                OsmWay(
                    4,
                    mapOf("highway" to "primary", "maxspeed:forward" to "50", "maxspeed:backward" to "70"),
                    listOf(LatLon(48.0, 11.0), LatLon(48.01, 11.0)),
                )
            val here = LatLon(48.005, 11.0)
            val southbound = matcher.match(listOf(twoWay), here, bearingDeg = 180.0, speedMps = 15.0)!!
            assertEquals(SpeedLimit.Limited(70.0), southbound.speedLimit)
            // Stopped at a light on the same way: the bearing is noise, the direction is kept.
            val stopped =
                matcher.match(
                    listOf(twoWay),
                    here,
                    bearingDeg = 10.0,
                    speedMps = 1.0,
                    previousWayId = 4,
                    previousForward = southbound.forward,
                )!!
            assertEquals(false, stopped.forward)
            assertEquals(SpeedLimit.Limited(70.0), stopped.speedLimit)
            // No known direction (or one from another way): a limit that depends on it is unknown.
            val guess = matcher.match(listOf(twoWay), here, speedMps = 1.0)!!
            assertNull(guess.forward)
            assertNull(guess.speedLimit)
            assertNull(guess.toPhoneRoad().speedLimitKph)
            assertNull(matcher.match(listOf(twoWay), here, previousWayId = 9, previousForward = false)!!.forward)
            // Without directional limits the direction does not matter …
            val plain = OsmWay(5, mapOf("highway" to "primary", "maxspeed" to "50"), twoWay.points)
            assertEquals(SpeedLimit.Limited(50.0), matcher.match(listOf(plain), here)!!.speedLimit)
            // … and a one-way road has one.
            val oneway = OsmWay(6, twoWay.tags + ("oneway" to "yes"), twoWay.points)
            assertEquals(SpeedLimit.Limited(50.0), matcher.match(listOf(oneway), here)!!.speedLimit)
        }

        @Test
        fun `parking aisles lose against a nearby street`() {
            val aisle =
                OsmWay(
                    5,
                    mapOf("highway" to "service", "service" to "parking_aisle"),
                    listOf(LatLon(48.0, 11.00005), LatLon(48.01, 11.00005)),
                )
            assertEquals(1L, matcher.match(listOf(main, aisle), LatLon(48.002, 11.00004))!!.way.id)
        }

        @Test
        fun `a match becomes a road message`() {
            val unlimited =
                OsmWay(
                    6,
                    mapOf("highway" to "motorway", "ref" to "A 9", "maxspeed" to "none"),
                    listOf(LatLon(48.0, 11.0), LatLon(48.01, 11.0)),
                )
            val road = matcher.match(listOf(unlimited), LatLon(48.005, 11.0))!!.toPhoneRoad()
            assertNull(road.speedLimitKph)
            assertTrue(road.unlimited)
            assertEquals(RoadSource.OSM, road.source)
            assertEquals("A 9", road.roadName)
            assertEquals(RoadClass.MOTORWAY, road.roadClass)
            val limited = matcher.match(listOf(main), LatLon(48.005, 11.0))!!.toPhoneRoad()
            assertEquals(50.0, limited.speedLimitKph)
            assertFalse(limited.unlimited)
        }
    }

    @Nested
    inner class Cameras {
        private val here = LatLon(48.0, 11.0)
        private val ahead = OsmCamera("a", HazardType.SPEED_CAMERA, Geo.destination(here, 0.0, 800.0), 50.0)
        private val behind = OsmCamera("b", HazardType.SPEED_CAMERA, Geo.destination(here, 180.0, 300.0), null)
        private val side = OsmCamera("c", HazardType.RED_LIGHT_CAMERA, Geo.destination(here, 90.0, 400.0), null)
        private val passing = OsmCamera("d", HazardType.SPEED_CAMERA, Geo.destination(here, 170.0, 20.0), null)
        private val far = OsmCamera("e", HazardType.SPEED_CAMERA, Geo.destination(here, 0.0, 3_000.0), null)
        private val slightlyOff = OsmCamera("f", HazardType.SECTION_CONTROL, Geo.destination(here, 20.0, 500.0), 100.0)
        private val finder = SpeedCameraFinder()

        @Test
        fun `only cameras ahead within range, nearest first`() {
            val found = finder.ahead(listOf(ahead, behind, side, passing, far, slightlyOff), here, bearingDeg = 0.0)
            assertEquals(listOf("d", "f", "a"), found.map { it.id })
            assertEquals(800.0, found.last().distanceM!!, 0.5)
            assertEquals(50.0, found.last().speedLimitKph)
            assertEquals(HazardType.SECTION_CONTROL, found[1].type)
        }

        @Test
        fun `without a bearing everything in range counts`() {
            assertEquals(
                setOf("a", "b", "c", "d", "f"),
                finder.ahead(listOf(ahead, behind, side, passing, far, slightlyOff), here, null).map {
                    it.id
                }.toSet(),
            )
        }

        @Test
        fun `a car that stops keeps looking ahead (android-20)`() {
            val memory = HeadingMemory()
            // Parked since the app started: no direction known yet.
            assertNull(memory.update(here, bearingDeg = 250.0, speedMps = 0.5, nowMs = 0))
            // Driving north, then stopping at a light 50 m on.
            assertEquals(0.0, memory.update(here, bearingDeg = 0.0, speedMps = 14.0, nowMs = 1_000))
            val light = Geo.destination(here, 0.0, 50.0)
            assertEquals(0.0, memory.update(light, bearingDeg = 190.0, speedMps = 0.3, nowMs = 5_000))
            val heading = memory.update(light, bearingDeg = null, speedMps = null, nowMs = 90_000)
            assertEquals(0.0, heading)
            // The camera 1 km behind the car is not reported as ahead; the one ahead still is.
            val behindCar = OsmCamera("x", HazardType.SPEED_CAMERA, Geo.destination(light, 180.0, 1_000.0), null)
            val aheadOfCar = OsmCamera("y", HazardType.SPEED_CAMERA, Geo.destination(light, 0.0, 600.0), null)
            assertEquals(listOf("y"), finder.ahead(listOf(behindCar, aheadOfCar), light, heading).map { it.id })
        }

        @Test
        fun `a remembered heading expires after creeping far or waiting long`() {
            val memory = HeadingMemory(maxTravelM = 300.0, maxAgeMs = 60_000)
            memory.update(here, bearingDeg = 90.0, speedMps = 10.0, nowMs = 0)
            assertEquals(90.0, memory.update(Geo.destination(here, 90.0, 250.0), null, 1.0, nowMs = 30_000))
            assertNull(memory.update(Geo.destination(here, 90.0, 350.0), null, 1.0, nowMs = 31_000))
            memory.update(here, bearingDeg = 90.0, speedMps = 10.0, nowMs = 100_000)
            assertNull(memory.update(here, null, 0.0, nowMs = 170_000))
            // A clock that went backwards does not keep it either.
            memory.update(here, bearingDeg = 90.0, speedMps = 10.0, nowMs = 200_000)
            assertNull(memory.update(here, null, 0.0, nowMs = 100_000))
        }

        @Test
        fun `results are capped`() {
            val many = (1..30).map {
                OsmCamera("m$it", HazardType.SPEED_CAMERA, Geo.destination(here, 0.0, it * 10.0), null)
            }
            assertEquals(10, finder.ahead(many, here, 0.0).size)
        }
    }

    @Nested
    inner class Geometry {
        @Test
        fun `distances and bearings`() {
            val munich = LatLon(48.137154, 11.576124)
            val berlin = LatLon(52.520008, 13.404954)
            assertEquals(504_000.0, Geo.distanceM(munich, berlin), 2_000.0)
            assertEquals(0.0, Geo.distanceM(munich, munich))
            assertEquals(0.0, Geo.bearingDeg(LatLon(0.0, 0.0), LatLon(1.0, 0.0)), 1e-9)
            assertEquals(90.0, Geo.bearingDeg(LatLon(0.0, 0.0), LatLon(0.0, 1.0)), 1e-9)
            assertEquals(180.0, Geo.angleDiffDeg(0.0, 180.0))
            assertEquals(20.0, Geo.angleDiffDeg(350.0, 10.0))
            assertEquals(350.0, Geo.normalizeDeg(-10.0))
        }

        @Test
        fun `destination round-trips`() {
            val start = LatLon(48.0, 11.0)
            val end = Geo.destination(start, 45.0, 1_000.0)
            assertEquals(1_000.0, Geo.distanceM(start, end), 0.01)
            assertEquals(45.0, Geo.bearingDeg(start, end), 0.01)
        }

        @Test
        fun `segment projection`() {
            val a = LatLon(48.0, 11.0)
            val b = LatLon(48.001, 11.0)
            val mid = Geo.projectOntoSegment(LatLon(48.0005, 11.0001), a, b)
            assertEquals(0.5, mid.fraction, 1e-3)
            assertEquals(7.45, mid.distanceM, 0.05)
            assertEquals(0.0, Geo.projectOntoSegment(LatLon(47.999, 11.0), a, b).fraction)
            assertEquals(0.0, Geo.projectOntoSegment(a, a, a).distanceM)
        }

        @Test
        fun `tiles`() {
            val p = LatLon(48.137154, 11.576124)
            val tile = GeoTile.of(p)
            assertTrue(p in tile.bounds)
            assertEquals(tile, GeoTile.of(LatLon(tile.bounds.south + 1e-9, tile.bounds.west + 1e-9)))
            assertEquals(
                listOf(tile),
                GeoTile.covering(
                    LatLon(
                        (tile.bounds.south + tile.bounds.north) / 2,
                        (tile.bounds.west + tile.bounds.east) / 2,
                    ),
                    100.0,
                ),
            )
            val corner = LatLon(tile.bounds.north - 1e-6, tile.bounds.east - 1e-6)
            val covering = GeoTile.covering(corner, 500.0)
            assertEquals(4, covering.size)
            assertEquals(tile, covering.first())
            val padded = tile.paddedBounds()
            assertTrue(padded.south < tile.bounds.south && padded.north > tile.bounds.north)
            assertEquals(tile.key, GeoTile(tile.x, tile.y).key)
            assertEquals(GeoTile.of(LatLon(90.0, 180.0)).y, GeoTile.of(LatLon(89.9999999, 179.99)).y)
        }
    }

    @Nested
    inner class Throttle {
        @Test
        fun `one request at a time with a minimum interval`() {
            val throttle = OverpassThrottle(minIntervalMs = 10_000)
            assertTrue(throttle.canRequest(0))
            throttle.onRequestStarted(0)
            assertFalse(throttle.canRequest(20_000)) // still in flight
            throttle.onSuccess(2_000)
            assertFalse(throttle.canRequest(9_999))
            assertTrue(throttle.canRequest(12_000))
        }

        @Test
        fun `failures back off and honour Retry-After`() {
            val throttle =
                OverpassThrottle(
                    minIntervalMs = 1_000,
                    backoff = dev.carheadsup.protocol.link.ReconnectBackoff(
                        initialMs = 30_000,
                        maxMs = 600_000,
                        jitter = 0.0,
                    ),
                )
            throttle.onRequestStarted(0)
            throttle.onFailure(0)
            assertEquals(30_000, throttle.nextAllowedAtMs())
            throttle.onRequestStarted(30_000)
            throttle.onFailure(30_000)
            assertEquals(90_000, throttle.nextAllowedAtMs())
            throttle.onRequestStarted(90_000)
            throttle.onFailure(90_000, retryAfterMs = 300_000)
            assertEquals(390_000, throttle.nextAllowedAtMs())
            throttle.onRequestStarted(390_000)
            throttle.onSuccess(391_000)
            assertTrue(throttle.canRequest(392_000))
        }

        @Test
        fun `tile freshness`() {
            val day = 24 * 60 * 60 * 1000L
            assertFalse(TileFreshness.needsRefresh(0, 6 * day))
            assertTrue(TileFreshness.needsRefresh(0, 7 * day))
            assertTrue(TileFreshness.isUsable(0, 89 * day))
            assertFalse(TileFreshness.isUsable(0, 90 * day))
            assertFalse(TileFreshness.isUsable(10 * day, 0)) // from the future
            assertTrue(TileFreshness.needsRefresh(10 * day, 0))
        }
    }
}
