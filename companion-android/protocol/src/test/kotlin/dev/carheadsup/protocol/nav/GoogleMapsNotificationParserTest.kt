package dev.carheadsup.protocol.nav

import dev.carheadsup.protocol.ManeuverType
import dev.carheadsup.protocol.ManeuverType.ARRIVE
import dev.carheadsup.protocol.ManeuverType.ARRIVE_LEFT
import dev.carheadsup.protocol.ManeuverType.ARRIVE_RIGHT
import dev.carheadsup.protocol.ManeuverType.EXIT_LEFT
import dev.carheadsup.protocol.ManeuverType.EXIT_RIGHT
import dev.carheadsup.protocol.ManeuverType.FERRY
import dev.carheadsup.protocol.ManeuverType.FORK_LEFT
import dev.carheadsup.protocol.ManeuverType.FORK_RIGHT
import dev.carheadsup.protocol.ManeuverType.KEEP_LEFT
import dev.carheadsup.protocol.ManeuverType.KEEP_RIGHT
import dev.carheadsup.protocol.ManeuverType.LEFT
import dev.carheadsup.protocol.ManeuverType.MERGE_LEFT
import dev.carheadsup.protocol.ManeuverType.MERGE_RIGHT
import dev.carheadsup.protocol.ManeuverType.RAMP_LEFT
import dev.carheadsup.protocol.ManeuverType.RAMP_RIGHT
import dev.carheadsup.protocol.ManeuverType.RIGHT
import dev.carheadsup.protocol.ManeuverType.ROUNDABOUT_CCW
import dev.carheadsup.protocol.ManeuverType.ROUNDABOUT_CW
import dev.carheadsup.protocol.ManeuverType.SHARP_LEFT
import dev.carheadsup.protocol.ManeuverType.SHARP_RIGHT
import dev.carheadsup.protocol.ManeuverType.SLIGHT_LEFT
import dev.carheadsup.protocol.ManeuverType.SLIGHT_RIGHT
import dev.carheadsup.protocol.ManeuverType.STRAIGHT
import dev.carheadsup.protocol.ManeuverType.UNKNOWN
import dev.carheadsup.protocol.ManeuverType.UTURN_LEFT
import dev.carheadsup.protocol.ManeuverType.UTURN_RIGHT
import dev.carheadsup.protocol.PhoneNav
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import java.time.Clock
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.util.Locale

class GoogleMapsNotificationParserTest {
    private val maps = GoogleMapsNotificationParser.GOOGLE_MAPS_PACKAGE
    private val losAngeles = ZoneId.of("America/Los_Angeles")
    private val berlin = ZoneId.of("Europe/Berlin")

    /** 2026-09-23 10:00 local time in [zone]. */
    private fun clockAt(zone: ZoneId, hour: Int = 10, minute: Int = 0): Clock =
        Clock.fixed(ZonedDateTime.of(2026, 9, 23, hour, minute, 0, 0, zone).toInstant(), zone)

    private fun epoch(zone: ZoneId, day: Int, hour: Int, minute: Int): Long =
        ZonedDateTime.of(2026, 9, day, hour, minute, 0, 0, zone).toInstant().toEpochMilli()

    private val parser = GoogleMapsNotificationParser()

    private fun parse(
        title: String?,
        text: String?,
        subText: String? = null,
        clock: Clock = clockAt(losAngeles),
        parser: GoogleMapsNotificationParser = this.parser,
        bigText: String? = null,
        category: String? = "navigation",
        ongoing: Boolean = true,
    ): PhoneNav? = parser.parse(
        NavNotificationContent(maps, title, text, subText, bigText, category = category, isOngoing = ongoing),
        clock,
    )

    @Nested
    inner class RealisticEnglish {
        @Test
        fun `turn with distance, street and full summary`() {
            // What Google Maps posts on a US phone (no-break spaces and narrow no-break space before PM).
            val nav = parse("500\u00a0ft", "Turn right onto Main St", "12\u00a0min · 5.2\u00a0mi · 10:12\u202fAM ETA")!!
            assertEquals(true, nav.active)
            assertEquals("google-maps", nav.source)
            assertEquals(RIGHT, nav.maneuver!!.type)
            assertEquals("Turn right onto Main St", nav.maneuver.instruction)
            assertEquals(152.4, nav.distanceM!!, 1e-9)
            assertEquals("Main St", nav.street)
            assertNull(nav.currentStreet)
            assertEquals(720.0, nav.remainingSeconds)
            assertEquals(5.2 * 1609.344, nav.remainingDistanceM!!, 1e-6)
            assertEquals(epoch(losAngeles, 23, 10, 12), nav.etaEpochMs)
            assertNull(nav.iconPng)
            assertNull(nav.lanes)
        }

        @Test
        fun `bare street with direction keeps the street and leaves the maneuver to the icon`() {
            // Gadgetbridge-documented UK format: title "100 yd", text "High St towards Blah".
            val nav = parse("100 yd", "High St towards Abingdon", "13 min · 4.6 mi · 10:13 ETA", category = null)!!
            assertEquals(UNKNOWN, nav.maneuver!!.type)
            assertEquals(91.44, nav.distanceM!!, 1e-9)
            assertEquals("High St", nav.street)
            assertEquals(780.0, nav.remainingSeconds)
            assertEquals(epoch(losAngeles, 23, 10, 13), nav.etaEpochMs)
        }

        @Test
        fun `direction-only text`() {
            val nav = parse("0.3 mi", "toward Downtown", "8 min · 3.1 mi · 10:08 AM ETA")!!
            assertEquals(UNKNOWN, nav.maneuver!!.type)
            assertEquals("Downtown", nav.street)
            assertEquals(0.3 * 1609.344, nav.distanceM!!, 1e-9)
        }

        @Test
        fun `title holding the instruction when there is no distance`() {
            val nav = parse("Head north on Mission St", "toward 16th St", "25 min · 9.8 km · 10:25 ETA")!!
            assertEquals(STRAIGHT, nav.maneuver!!.type)
            assertEquals("Mission St", nav.street)
            assertEquals("Mission St", nav.currentStreet)
            assertNull(nav.distanceM)
            assertEquals("Head north on Mission St toward 16th St", nav.maneuver.instruction)
        }

        @Test
        fun `distance and instruction in the title (lock-screen style)`() {
            val nav = parse("300 m - Turn left onto Elm St", null, "5 min · 2 km · 10:05 ETA")!!
            assertEquals(300.0, nav.distanceM)
            assertEquals(LEFT, nav.maneuver!!.type)
            assertEquals("Elm St", nav.street)
        }

        @Test
        fun `roundabout exit and a follow-up maneuver from the expanded text`() {
            val nav =
                parse(
                    "250 m",
                    null,
                    "4 min · 1.9 km · 10:04 ETA",
                    bigText = "At the roundabout, take the 2nd exit onto the A40\nThen turn left onto Oxford Rd",
                )!!
            assertEquals(ROUNDABOUT_CCW, nav.maneuver!!.type)
            assertEquals(2, nav.maneuver.roundaboutExit)
            assertEquals("A40", nav.street)
            assertEquals(LEFT, nav.then!!.type)
            assertEquals("turn left onto Oxford Rd", nav.then.instruction)
        }

        @Test
        fun `rerouting keeps guidance active without inventing a street`() {
            val nav = parse("Rerouting…", null, null)!!
            assertEquals(UNKNOWN, nav.maneuver!!.type)
            assertEquals("Rerouting…", nav.maneuver.instruction)
            assertNull(nav.street)
            assertNull(nav.distanceM)
        }

        @Test
        fun `status text is not taken for a street`() {
            val nav = parse("1.2 km", "GPS signal lost", "15 min · 12 km · 10:15 ETA")!!
            assertNull(nav.street)
        }

        @Test
        fun `arrival on a side`() {
            val nav = parse("150 ft", "Your destination is on the right", "1 min · 150 ft · 10:01 AM ETA")!!
            assertEquals(ARRIVE_RIGHT, nav.maneuver!!.type)
            assertNull(nav.street)
            assertEquals(45.72, nav.remainingDistanceM!!, 1e-9)
        }

        @Test
        fun `Android 16 live-update chip supplies the distance`() {
            val content =
                NavNotificationContent(
                    maps,
                    "Turn left onto Oak Ave",
                    "toward Park",
                    "3 min · 1 km · 10:03 ETA",
                    shortCriticalText = "400 m",
                )
            val nav = parser.parse(content, clockAt(losAngeles))!!
            assertEquals(400.0, nav.distanceM)
            assertEquals(LEFT, nav.maneuver!!.type)
            assertEquals("Oak Ave", nav.street)
        }

        @Test
        fun `remaining time is derived from the ETA when missing`() {
            val nav = parse("1 km", "Continue onto I-80 E", "12 km · 10:30 ETA", category = null)!!
            assertEquals(1800.0, nav.remainingSeconds)
            assertEquals(12_000.0, nav.remainingDistanceM)
            assertEquals("I-80 E", nav.street)
            assertEquals("I-80 E", nav.currentStreet)
        }
    }

    companion object {
        /** English instruction → maneuver, exit, street (right-hand traffic). */
        @JvmStatic
        fun englishInstructions(): List<Arguments> = listOf(
            Arguments.of("Turn left onto Market St", LEFT, null, "Market St"),
            Arguments.of("Turn right on 5th Ave", RIGHT, null, "5th Ave"),
            Arguments.of("Turn left onto Right Bank Rd", LEFT, null, "Right Bank Rd"),
            Arguments.of("Slight right onto Oak St", SLIGHT_RIGHT, null, "Oak St"),
            Arguments.of("Slight left toward Airport", SLIGHT_LEFT, null, "Airport"),
            Arguments.of("Bear left onto B4009", SLIGHT_LEFT, null, "B4009"),
            Arguments.of("Sharp right onto Hill Rd", SHARP_RIGHT, null, "Hill Rd"),
            Arguments.of("Sharp left", SHARP_LEFT, null, null),
            Arguments.of("Keep left to continue on I-5 N", KEEP_LEFT, null, "I-5 N"),
            Arguments.of("Keep right to stay on US-101 S", KEEP_RIGHT, null, "US-101 S"),
            Arguments.of("Keep left at the fork, follow signs for Downtown", FORK_LEFT, null, "Downtown"),
            Arguments.of("At the fork, keep right toward Sacramento", FORK_RIGHT, null, "Sacramento"),
            Arguments.of("Merge onto I-280 S", MERGE_LEFT, null, "I-280 S"),
            Arguments.of("Merge right onto Bay St", MERGE_RIGHT, null, "Bay St"),
            Arguments.of("Take the ramp onto CA-1 N", RAMP_RIGHT, null, "CA-1 N"),
            Arguments.of("Take the ramp on the left to I-80 E", RAMP_LEFT, null, "I-80 E"),
            Arguments.of("Take exit 43 for Elm St toward Downtown", EXIT_RIGHT, null, "Elm St"),
            Arguments.of("Take the exit on the left toward I-95", EXIT_LEFT, null, "I-95"),
            Arguments.of("Take exit 12 toward Exit Rd", EXIT_RIGHT, null, "Exit Rd"),
            Arguments.of("At the roundabout, take the 3rd exit onto High St", ROUNDABOUT_CCW, 3, "High St"),
            Arguments.of("At the traffic circle, take the first exit", ROUNDABOUT_CCW, 1, null),
            Arguments.of("Take the 2nd exit onto Station Rd", ROUNDABOUT_CCW, 2, "Station Rd"),
            Arguments.of("Enter the roundabout", ROUNDABOUT_CCW, null, null),
            Arguments.of("Make a U-turn", UTURN_LEFT, null, null),
            Arguments.of("Make a U-turn at Pine St", UTURN_LEFT, null, null),
            Arguments.of("Continue straight", STRAIGHT, null, null),
            Arguments.of("Continue on Broadway", STRAIGHT, null, "Broadway"),
            Arguments.of("Head southwest on Lake Ave toward Elm St", STRAIGHT, null, "Lake Ave"),
            Arguments.of("Destination will be on the left", ARRIVE_LEFT, null, null),
            Arguments.of("Arrive at destination", ARRIVE, null, null),
            Arguments.of("Take the ferry", FERRY, null, null),
            Arguments.of("Join the M25", MERGE_LEFT, null, "M25"),
            // Lane guidance names a lane, not the maneuver's side (android-2).
            Arguments.of("Use the right lane to turn left onto Main St", LEFT, null, "Main St"),
            Arguments.of("Use the left 2 lanes to turn slightly right onto I-5 N", SLIGHT_RIGHT, null, "I-5 N"),
            Arguments.of("Use any lane to turn left onto Oak St", LEFT, null, "Oak St"),
            Arguments.of("Use the left lane to turn left", LEFT, null, null),
            Arguments.of("Use the right 2 lanes to take exit 12 toward Downtown", EXIT_RIGHT, null, "Downtown"),
            // … but it still hints at the side of an exit that names none.
            Arguments.of("Use the left 2 lanes to take exit 43B toward Airport", EXIT_LEFT, null, "Airport"),
            Arguments.of("Take exit 5 on the left toward Oxford", EXIT_LEFT, null, "Oxford"),
            // Unrecognised instructions are not streets (android-5).
            Arguments.of("Pass through the toll plaza", UNKNOWN, null, null),
            Arguments.of("Go through the tunnel", UNKNOWN, null, null),
            Arguments.of("Cross the bridge", UNKNOWN, null, null),
            Arguments.of("Drive through 2 roundabouts", STRAIGHT, null, null),
            Arguments.of("Enter the tunnel on I-90 E", UNKNOWN, null, "I-90 E"),
            Arguments.of("Proceed to the route", STRAIGHT, null, null),
            Arguments.of("Cross St toward Downtown", UNKNOWN, null, "Cross St"),
            Arguments.of("Rue de la Paix", UNKNOWN, null, "Rue de la Paix"),
            Arguments.of("Avenue of the Americas", UNKNOWN, null, "Avenue of the Americas"),
        )

        /** German instruction → maneuver, exit, street (right-hand traffic). */
        @JvmStatic
        fun germanInstructions(): List<Arguments> = listOf(
            Arguments.of("Rechts abbiegen auf Hauptstraße", RIGHT, null, "Hauptstraße"),
            Arguments.of("Links abbiegen in die Königstraße", LEFT, null, "Königstraße"),
            Arguments.of("Leicht rechts abbiegen auf B27", SLIGHT_RIGHT, null, "B27"),
            Arguments.of("Halblinks auf Parkweg", SLIGHT_LEFT, null, "Parkweg"),
            Arguments.of("Scharf links abbiegen", SHARP_LEFT, null, null),
            Arguments.of("Links halten, um auf A8 zu bleiben", KEEP_LEFT, null, "A8"),
            Arguments.of("Rechts halten Richtung Stuttgart", KEEP_RIGHT, null, "Stuttgart"),
            Arguments.of("An der Gabelung links halten", FORK_LEFT, null, null),
            Arguments.of("Auf A8 auffahren", MERGE_LEFT, null, "A8"),
            Arguments.of("Ausfahrt 52 nehmen Richtung München-Ost", EXIT_RIGHT, null, "München-Ost"),
            Arguments.of("Ausfahrt links nehmen Richtung Ulm", EXIT_LEFT, null, "Ulm"),
            Arguments.of("Auffahrt nehmen auf B10", RAMP_RIGHT, null, "B10"),
            Arguments.of(
                "Im Kreisverkehr die 2. Ausfahrt nehmen auf Schillerstraße",
                ROUNDABOUT_CCW,
                2,
                "Schillerstraße",
            ),
            Arguments.of("Im Kreisverkehr die dritte Ausfahrt nehmen", ROUNDABOUT_CCW, 3, null),
            Arguments.of("Wenden", UTURN_LEFT, null, null),
            Arguments.of("Weiter auf B27 Richtung Tübingen", STRAIGHT, null, "B27"),
            Arguments.of("Richtung Norden auf Bahnhofstraße", STRAIGHT, null, "Bahnhofstraße"),
            Arguments.of("Das Ziel befindet sich auf der rechten Seite", ARRIVE_RIGHT, null, null),
            Arguments.of("Ziel erreicht", ARRIVE, null, null),
            Arguments.of("Fähre nehmen", FERRY, null, null),
            // Lane guidance and the "um … zu" forms (android-2, android-5).
            Arguments.of("Rechte Spur benutzen, um links abzubiegen auf Hauptstraße", LEFT, null, "Hauptstraße"),
            Arguments.of("Die linken 2 Spuren benutzen, um rechts abzubiegen", RIGHT, null, null),
            Arguments.of("Rechts halten, um die A8 zu nehmen", KEEP_RIGHT, null, "A8"),
            Arguments.of("Mautstelle passieren", UNKNOWN, null, null),
            Arguments.of("Durch den Tunnel fahren", UNKNOWN, null, null),
            Arguments.of("Rechts halten, um auf die A8 zu fahren", KEEP_RIGHT, null, "A8"),
            Arguments.of("Links abbiegen auf Bahnhofstraße, dann rechts abbiegen", LEFT, null, "Bahnhofstraße"),
            Arguments.of("Unter den Linden", UNKNOWN, null, "Unter den Linden"),
        )
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("englishInstructions")
    fun `english instructions`(instruction: String, type: ManeuverType, exit: Int?, street: String?) {
        val nav = parse("200 m", instruction, "5 min · 2.0 km · 10:05 ETA")!!
        assertEquals(type, nav.maneuver!!.type, "maneuver of: $instruction")
        assertEquals(exit, nav.maneuver.roundaboutExit, "exit of: $instruction")
        assertEquals(street, nav.street, "street of: $instruction")
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("germanInstructions")
    fun `german instructions`(instruction: String, type: ManeuverType, exit: Int?, street: String?) {
        val nav = parse("200 m", instruction, "5 Min. · 2,0 km · Ankunft 10:05", clock = clockAt(berlin))!!
        assertEquals(type, nav.maneuver!!.type, "maneuver of: $instruction")
        assertEquals(exit, nav.maneuver.roundaboutExit, "exit of: $instruction")
        assertEquals(street, nav.street, "street of: $instruction")
    }

    @Nested
    inner class RealisticGerman {
        @Test
        fun `full German notification with decimal comma and ETA marker`() {
            val nav = parse(
                "1,2\u00a0km",
                "Rechts abbiegen auf Hauptstraße",
                "1\u00a0Std. 5\u00a0Min. · 84,5\u00a0km · Ankunft 11:05",
                clock = clockAt(berlin),
            )!!
            assertEquals(RIGHT, nav.maneuver!!.type)
            assertEquals(1_200.0, nav.distanceM)
            assertEquals("Hauptstraße", nav.street)
            assertEquals(3_900.0, nav.remainingSeconds)
            assertEquals(84_500.0, nav.remainingDistanceM)
            assertEquals(epoch(berlin, 23, 11, 5), nav.etaEpochMs)
        }

        @Test
        fun `German bare street toward a city`() {
            val nav = parse(
                "800 m",
                "B27 Richtung Stuttgart",
                "20 Min. · 25 km · 10:20 Ankunft",
                clock = clockAt(berlin),
                category = null,
            )!!
            assertEquals(UNKNOWN, nav.maneuver!!.type)
            assertEquals("B27", nav.street)
            assertEquals(epoch(berlin, 23, 10, 20), nav.etaEpochMs)
        }

        @Test
        fun `German with a German-preferring parser and 1-point-500 thousands`() {
            val german = GoogleMapsNotificationParser(NavLanguages.preferring(Locale.GERMANY))
            val nav = parse(
                "1.500 m",
                "Scharf rechts abbiegen",
                null,
                clock = clockAt(berlin),
                parser = german,
                category = null,
            )!!
            assertEquals(1_500.0, nav.distanceM)
            assertEquals(SHARP_RIGHT, nav.maneuver!!.type)
        }
    }

    @Nested
    inner class FollowUps {
        @Test
        fun `an inline then-clause is the next maneuver, not this one (android-2)`() {
            val nav = parse("200 m", "Turn left, then keep right", "5 min · 2.0 km · 10:05 ETA")!!
            assertEquals(LEFT, nav.maneuver!!.type)
            assertEquals("Turn left", nav.maneuver.instruction)
            assertEquals(KEEP_RIGHT, nav.then!!.type)
            assertEquals("keep right", nav.then.instruction)
        }

        @Test
        fun `the street of an inline then-clause belongs to the next maneuver`() {
            val nav = parse("200 m", "Turn left, then turn right onto Main St", "5 min · 2.0 km · 10:05 ETA")!!
            assertEquals(LEFT, nav.maneuver!!.type)
            assertNull(nav.street)
            assertEquals(RIGHT, nav.then!!.type)
        }

        @Test
        fun `German inline follow-up`() {
            val nav = parse(
                "200 m",
                "Links abbiegen, dann rechts halten",
                "5 Min. · 2,0 km · Ankunft 10:05",
                clock = clockAt(berlin),
            )!!
            assertEquals(LEFT, nav.maneuver!!.type)
            assertEquals(KEEP_RIGHT, nav.then!!.type)
        }
    }

    @Nested
    inner class LeftHandTraffic {
        private val uk = GoogleMapsNotificationParser(drivingSide = DrivingSide.LEFT)

        @Test
        fun `roundabouts run clockwise and U-turns go right`() {
            assertEquals(
                ROUNDABOUT_CW,
                parse(
                    "100 yd",
                    "At the roundabout, take the 1st exit onto the A34",
                    "2 min · 0.5 mi · 10:02 ETA",
                    parser = uk,
                )!!.maneuver!!.type,
            )
            assertEquals(
                UTURN_RIGHT,
                parse("100 yd", "Make a U-turn", "2 min · 0.5 mi · 10:02 ETA", parser = uk)!!.maneuver!!.type,
            )
        }

        @Test
        fun `unsided exits and slip roads are on the left, merges go right`() {
            assertEquals(
                EXIT_LEFT,
                parse("0.5 mi", "Take exit 5 toward Oxford", "9 min · 8 mi · 10:09 ETA", parser = uk)!!.maneuver!!.type,
            )
            assertEquals(
                RAMP_LEFT,
                parse(
                    "0.5 mi",
                    "Take the slip road to the M4",
                    "9 min · 8 mi · 10:09 ETA",
                    parser = uk,
                )!!.maneuver!!.type,
            )
            assertEquals(
                MERGE_RIGHT,
                parse("0.5 mi", "Join the M4", "9 min · 8 mi · 10:09 ETA", parser = uk)!!.maneuver!!.type,
            )
        }

        @Test
        fun `the driving side is decided per notification (android-11)`() {
            // One long-lived parser: the phone crossed from France into the UK.
            val content =
                NavNotificationContent(
                    maps,
                    "100 yd",
                    "At the roundabout, take the 1st exit",
                    "2 min · 0.5 mi · 10:02 ETA",
                    category = "navigation",
                )
            assertEquals(ROUNDABOUT_CCW, parser.parse(content, clockAt(losAngeles))!!.maneuver!!.type)
            assertEquals(
                ROUNDABOUT_CW,
                parser.parse(content, clockAt(losAngeles), DrivingSide.LEFT)!!.maneuver!!.type,
            )
            assertEquals(
                ROUNDABOUT_CCW,
                uk.parse(content, clockAt(losAngeles), DrivingSide.RIGHT)!!.maneuver!!.type,
            )
        }

        @Test
        fun `driving side by country`() {
            assertEquals(DrivingSide.LEFT, DrivingSide.forCountry("gb"))
            assertEquals(DrivingSide.LEFT, DrivingSide.forCountry("JP"))
            assertEquals(DrivingSide.RIGHT, DrivingSide.forCountry("DE"))
            assertEquals(DrivingSide.RIGHT, DrivingSide.forCountry(null))
        }
    }

    @Nested
    inner class NotNavigation {
        @Test
        fun `other packages are ignored`() {
            val content = NavNotificationContent("com.waze", "300 m", "Turn right", "5 min · 2 km · 10:05 ETA")
            assertNull(parser.parse(content, clockAt(losAngeles)))
        }

        @Test
        fun `non-ongoing notifications without the navigation category are ignored`() {
            assertNull(parse("300 m", "Turn right", "5 min · 2 km · 10:05 ETA", category = null, ongoing = false))
        }

        @Test
        fun `ongoing Maps notifications without navigation data are ignored`() {
            assertNull(
                parse(
                    "Location sharing",
                    "You're sharing your real-time location with Alice",
                    null,
                    category = "location_sharing",
                ),
            )
            assertNull(parse("Google Maps", "Your destination is 20 min away by car", "Suggested", category = null))
            assertNull(parse(null, null, null, category = null))
        }

        @Test
        fun `a navigation-category notification is kept even without numbers`() {
            assertNotNull(parse("Starting navigation…", null, null))
        }
    }

    @Nested
    inner class Robustness {
        @Test
        fun `bidi marks, odd spaces and missing parts do not break parsing`() {
            val nav = parse(
                "\u200e300\u2009m\u200e",
                "  Turn   left\u00a0onto  Rue de Rivoli ",
                "\u2068 7 min\u2069 · · 10:07 ETA",
            )!!
            assertEquals(300.0, nav.distanceM)
            assertEquals(LEFT, nav.maneuver!!.type)
            assertEquals("Rue de Rivoli", nav.street)
            assertEquals(420.0, nav.remainingSeconds)
            assertNull(nav.remainingDistanceM)
        }

        @Test
        fun `unparseable summary leaves numbers null`() {
            val nav = parse("200 m", "Turn left", "Fastest route · Tolls")!!
            assertEquals(200.0, nav.distanceM)
            assertNull(nav.remainingSeconds)
            assertNull(nav.etaEpochMs)
        }

        @Test
        fun `an unknown verb yields an unknown maneuver but keeps the instruction`() {
            val nav = parse("200 m", "Pass through the toll plaza", "1 min · 200 m · 10:01 ETA")!!
            assertEquals(UNKNOWN, nav.maneuver!!.type)
            assertEquals("Pass through the toll plaza", nav.maneuver.instruction)
        }

        @Test
        fun `very long street names are not used`() {
            val nav = parse("200 m", "Turn left onto " + "x".repeat(150), "1 min · 200 m · 10:01 ETA")!!
            assertNull(nav.street)
        }

        @Test
        fun `parser needs a language`() {
            assertThrows(IllegalArgumentException::class.java) { GoogleMapsNotificationParser(emptyList()) }
        }

        @Test
        fun `ETA crossing midnight lands on the next day`() {
            val nav = parse("5 km", "Continue on A7", "35 min · 40 km · 0:05 ETA", clock = clockAt(berlin, 23, 30))!!
            assertEquals(epoch(berlin, 24, 0, 5), nav.etaEpochMs)
            assertEquals(2_100.0, nav.remainingSeconds)
        }

        @Test
        fun `12-hour ETA in the evening`() {
            val nav = parse(
                "5 mi",
                "Continue on I-5 S",
                "2 hr 10 min · 140 mi · 9:40 PM ETA",
                clock = clockAt(losAngeles, 19, 30),
            )!!
            assertEquals(epoch(losAngeles, 23, 21, 40), nav.etaEpochMs)
            assertEquals(7_800.0, nav.remainingSeconds)
        }

        @Test
        fun `instant epoch is independent of the clock's zone offset`() {
            val clock = Clock.fixed(Instant.parse("2026-09-23T17:00:00Z"), losAngeles)
            val nav = parse("5 mi", "Continue", "30 min · 20 mi · 10:30 AM ETA", clock = clock)!!
            assertEquals(Instant.parse("2026-09-23T17:30:00Z").toEpochMilli(), nav.etaEpochMs)
        }

        @Test
        fun `ETA on the night the clocks go back (android-15)`() {
            // Europe/Berlin, 2026-10-25: 03:00 CEST becomes 02:00 CET. It is 02:40 CEST with
            // 40 minutes to go, so Maps shows an arrival at 2:20 (CET, the second 2:20 that night).
            val now = ZonedDateTime.ofLocal(LocalDateTime.of(2026, 10, 25, 2, 40), berlin, ZoneOffset.ofHours(2))
            val clock = Clock.fixed(now.toInstant(), berlin)
            val arrival = now.toInstant().plusSeconds(2_400).toEpochMilli()
            assertEquals(arrival, EtaResolver.resolve(2, 20, clock, 2_400.0))
            // Without the remaining time the next 2:20 is still the later one, not tomorrow's.
            assertEquals(arrival, EtaResolver.resolve(2, 20, clock))
            val nav = parse("5 km", "Continue on A7", "40 min · 40 km · 2:20 ETA", clock = clock)!!
            assertEquals(arrival, nav.etaEpochMs)
        }

        @Test
        fun `a clock time that disagrees with the remaining time yields to it (android-15)`() {
            // 2 h 30 min to go at 10:00, but the text says 11:30 (e.g. the destination's zone).
            val clock = clockAt(losAngeles)
            val nav = parse("5 mi", "Continue on I-10 E", "2 hr 30 min · 150 mi · 11:30 AM ETA", clock = clock)!!
            assertEquals(epoch(losAngeles, 23, 12, 30), nav.etaEpochMs)
            assertEquals(9_000.0, nav.remainingSeconds)
            // Rounding differences are fine: 12:31 stays 12:31.
            assertEquals(
                epoch(losAngeles, 23, 12, 31),
                EtaResolver.resolve(12, 31, clock, 9_000.0),
            )
        }

        @Test
        fun `every result passes the wire sanitizer unchanged`() {
            val nav = parse("500 ft", "Turn right onto Main St", "12 min · 5.2 mi · 10:12 AM ETA")!!
            assertTrue(dev.carheadsup.protocol.WireSanitizer.sanitize(nav) == nav)
        }
    }
}
