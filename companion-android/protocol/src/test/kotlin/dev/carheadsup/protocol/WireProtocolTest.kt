package dev.carheadsup.protocol

import dev.carheadsup.protocol.api.TripRecord
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

class WireProtocolTest {
    private fun encode(message: PhoneToHud): JsonObject =
        ProtocolJson.parseToJsonElement(PhoneWire.encodeUnchecked(message)).jsonObject

    @Nested
    inner class PhoneToHudEncoding {
        @Test
        fun `hello carries the discriminator, version and token`() {
            val json = encode(PhoneMessages.hello(device = "Pixel 9", appVersion = "1.2.0", token = "s3cret"))
            assertEquals(
                mapOf(
                    "t" to JsonPrimitive("hello"),
                    "v" to JsonPrimitive(1),
                    "device" to JsonPrimitive("Pixel 9"),
                    "app" to JsonPrimitive("carheadsup-companion"),
                    "appVersion" to JsonPrimitive("1.2.0"),
                    "token" to JsonPrimitive("s3cret"),
                ),
                json,
            )
        }

        @Test
        fun `nav writes nullable fields as explicit nulls`() {
            val json =
                encode(
                    PhoneNav(
                        active = true,
                        source = "google-maps",
                        maneuver = Maneuver(ManeuverType.ROUNDABOUT_CCW, roundaboutExit = 2),
                        distanceM = 300.0,
                    ),
                )
            assertEquals("nav", json["t"]!!.jsonPrimitive.content)
            assertEquals(JsonNull, json["street"])
            assertEquals(JsonNull, json["currentStreet"])
            assertEquals(JsonNull, json["then"])
            assertEquals(JsonNull, json["lanes"])
            assertEquals(JsonNull, json["etaEpochMs"])
            assertEquals(JsonNull, json["iconPng"])
            val maneuver = json["maneuver"]!!.jsonObject
            assertEquals("roundabout-ccw", maneuver["type"]!!.jsonPrimitive.content)
            assertEquals(2, maneuver["roundaboutExit"]!!.jsonPrimitive.content.toInt())
            assertEquals(JsonNull, maneuver["instruction"])
        }

        @Test
        fun `nav omits the maneuver when there is none (the contract field is not nullable)`() {
            val json = encode(PhoneMessages.navEnded("google-maps"))
            assertFalse("maneuver" in json)
            assertEquals(JsonPrimitive(false), json["active"])
        }

        @Test
        fun `ping omits a missing id and sends a present one`() {
            assertEquals(mapOf("t" to JsonPrimitive("ping")), encode(PhonePing()))
            assertEquals(JsonPrimitive(7), encode(PhoneMessages.ping(7))["id"])
        }

        @Test
        fun `road always sends unlimited and uses contract enum names`() {
            val json =
                encode(
                    PhoneRoad(
                        speedLimitKph = 50.0,
                        source = RoadSource.SIGN_RECOGNITION,
                        roadClass = RoadClass.RESIDENTIAL,
                    ),
                )
            assertEquals(JsonPrimitive(false), json["unlimited"])
            assertEquals(JsonPrimitive("sign-recognition"), json["source"])
            assertEquals(JsonPrimitive("residential"), json["roadClass"])
        }

        @Test
        fun `message has no field that could carry content`() {
            val json = encode(PhoneMessage(id = "m1", sender = "Alice", app = "Signal", readingAloud = true))
            assertEquals(setOf("t", "id", "sender", "app", "readingAloud"), json.keys)
        }

        @Test
        fun `hazards, call, location, input and trips-request use contract names`() {
            val hazards = encode(PhoneHazards(listOf(HazardItem("c1", HazardType.RED_LIGHT_CAMERA, distanceM = 120.0))))
            assertEquals(
                "red-light-camera",
                hazards["items"].toString().substringAfter("\"type\":\"").substringBefore('"'),
            )
            assertEquals(JsonPrimitive("ringing"), encode(PhoneCall("c", CallState.RINGING, null, "+491234"))["state"])
            assertEquals(JsonPrimitive("toggle-blank"), encode(PhoneInput(InputAction.TOGGLE_BLANK))["action"])
            assertEquals(JsonPrimitive(1_700_000_000_000L), encode(PhoneTripsRequest(1_700_000_000_000L))["since"])
            val location = encode(PhoneLocation(48.1, 11.5, accuracyM = 4.0))
            assertEquals(JsonNull, location["speedMps"])
            assertEquals("location", location["t"]!!.jsonPrimitive.content)
        }

        @Test
        fun `epoch milliseconds are encoded as integers`() {
            val raw = PhoneWire.encodeUnchecked(PhoneNav(active = true, source = "x", etaEpochMs = 1_758_600_000_123L))
            assertTrue(raw.contains("\"etaEpochMs\":1758600000123"), raw)
        }

        @Test
        fun `phone frames round-trip through the decoder`() {
            val messages =
                listOf(
                    PhoneMessages.hello("d", "1", "t"),
                    PhoneNav(
                        active = true,
                        source = "google-maps",
                        maneuver = Maneuver(ManeuverType.LEFT, instruction = "Turn left"),
                        lanes = listOf(
                            Lane(listOf(LaneDirection.LEFT, LaneDirection.STRAIGHT), true, LaneDirection.LEFT),
                        ),
                    ),
                    PhoneMedia(true, "Song", "Artist", "Album", "Spotify", "k"),
                    PhoneMessages.noHazards(),
                    PhonePing(3),
                )
            for (message in messages) assertEquals(message, PhoneWire.decodeOrNull(PhoneWire.encodeUnchecked(message)))
            assertNull(PhoneWire.decodeOrNull("{\"t\":\"nope\"}"))
        }

        @Test
        fun `wireType matches the encoded discriminator for every message type`() {
            val all: List<PhoneToHud> =
                listOf(
                    PhoneMessages.hello("d", "1", "t"),
                    PhoneMessages.navEnded("s"),
                    PhoneMessages.roadUnknown(),
                    PhoneMessages.noHazards(),
                    PhoneMessages.mediaStopped(),
                    PhoneCall("c", CallState.ACTIVE, null, null),
                    PhoneMessage("m", "s", null, false),
                    PhoneLocation(0.0, 0.0, null),
                    PhoneMessages.input(InputAction.PRIMARY),
                    PhoneMessages.tripsRequest(0),
                    PhoneMessages.ping(1),
                )
            for (message in all) assertEquals(message.wireType, encode(message)["t"]!!.jsonPrimitive.content)
        }
    }

    @Nested
    inner class HudToPhoneDecoding {
        private fun decode(raw: String): HudToPhone = (HudCodec.decode(raw) as HudDecodeResult.Message).message

        @Test
        fun welcome() {
            val welcome =
                decode("""{"t":"welcome","v":1,"hudName":"carheadsup","hudVersion":"0.1.0","readMessagesAloud":true}""")
            assertEquals(HudWelcome(1, "carheadsup", "0.1.0", readMessagesAloud = true), welcome)
        }

        @Test
        fun `error with a known and an unknown code`() {
            assertEquals(
                HudError(HudErrorCode.BAD_TOKEN, "pairing token mismatch"),
                decode("""{"t":"error","code":"bad-token","message":"pairing token mismatch"}"""),
            )
            assertEquals(
                HudErrorCode.INTERNAL,
                (decode("""{"t":"error","code":"brand-new","message":"x"}""") as HudError).code,
            )
        }

        @Test
        fun `call action`() {
            assertEquals(
                HudCallAction("call-17", CallAction.DECLINE),
                decode("""{"t":"call-action","callId":"call-17","action":"decline"}"""),
            )
        }

        @Test
        fun `trips and trip-completed carry full trip records, ignoring unknown fields`() {
            val trip =
                """{"id":"t1","startedAt":1758600000000,"endedAt":1758601800000,"distanceKm":23.4,"durationS":1800,
                   "movingS":1500,"idleS":300,"fuelUsedL":1.9,"avgLPer100km":8.1,"maxSpeedKph":102,
                   "avgMovingSpeedKph":56.2,"cost":3.42,"currency":"EUR","startOdometerKm":10500.2,
                   "endOdometerKm":10523.6,"futureField":{"x":1}}"""
            val trips = decode("""{"t":"trips","trips":[$trip]}""") as HudTrips
            val expected =
                TripRecord(
                    id = "t1", startedAt = 1_758_600_000_000, endedAt = 1_758_601_800_000, distanceKm = 23.4,
                    durationS = 1800.0, movingS = 1500.0, idleS = 300.0, fuelUsedL = 1.9, avgLPer100km = 8.1,
                    maxSpeedKph = 102.0, avgMovingSpeedKph = 56.2, cost = 3.42, currency = "EUR",
                    startOdometerKm = 10500.2, endOdometerKm = 10523.6,
                )
            assertEquals(listOf(expected), trips.trips)
            assertEquals(HudTripCompleted(expected), decode("""{"t":"trip-completed","trip":$trip}"""))
        }

        @Test
        fun `trip with unknown fuel`() {
            val trip =
                decode(
                    """{"t":"trip-completed","trip":{"id":"t2","startedAt":1,"endedAt":2,"distanceKm":1.5,"durationS":60,
                       "movingS":50,"idleS":10,"fuelUsedL":null,"avgLPer100km":null,"maxSpeedKph":30,
                       "avgMovingSpeedKph":20,"cost":null,"currency":"USD","startOdometerKm":null,"endOdometerKm":null}}""",
                ) as HudTripCompleted
            assertNull(trip.trip.fuelUsedL)
            assertNull(trip.trip.cost)
        }

        @Test
        fun `maintenance due`() {
            val due =
                decode(
                    """{"t":"maintenance-due","items":[{"itemId":"oil","label":"Oil change","status":"overdue",
                       "remainingKm":-250,"remainingDays":null}]}""",
                ) as HudMaintenanceDue
            assertEquals(
                listOf(MaintenanceDueItem("oil", "Oil change", MaintenanceDueStatus.OVERDUE, -250.0, null)),
                due.items,
            )
        }

        @Test
        fun pong() {
            assertEquals(HudPong(42), decode("""{"t":"pong","id":42}"""))
            assertEquals(HudPong(null), decode("""{"t":"pong"}"""))
        }

        @Test
        fun `unknown types are reported separately from malformed frames`() {
            assertEquals(HudDecodeResult.UnknownType("weather"), HudCodec.decode("""{"t":"weather","temp":3}"""))
        }

        @ParameterizedTest
        @ValueSource(
            strings = [
                "", "not json", "[1,2]", "42", "{}", """{"t":5}""", """{"t":"welcome"}""",
                """{"t":"call-action","callId":"c"}""", """{"t":"call-action","callId":"c","action":"snooze"}""",
                """{"t":"trips","trips":[{"id":"x"}]}""",
            ],
        )
        fun `malformed frames never throw`(raw: String) {
            assertInstanceOf(HudDecodeResult.Malformed::class.java, HudCodec.decode(raw))
        }

        @Test
        fun `HUD messages round-trip through the codec`() {
            val messages: List<HudToPhone> =
                listOf(
                    HudWelcome(1, "hud", "1.0", false),
                    HudError(HudErrorCode.UNSUPPORTED_VERSION, "v2 required"),
                    HudCallAction("c", CallAction.ACCEPT),
                    HudMaintenanceDue(
                        listOf(MaintenanceDueItem("tires", "Tyres", MaintenanceDueStatus.DUE_SOON, 800.0, 12.0)),
                    ),
                    HudPong(1),
                )
            for (message in messages) {
                assertEquals(
                    HudDecodeResult.Message(message),
                    HudCodec.decode(HudCodec.encode(message)),
                )
            }
        }
    }
}
