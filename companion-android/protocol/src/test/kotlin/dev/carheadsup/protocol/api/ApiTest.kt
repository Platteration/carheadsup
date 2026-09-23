package dev.carheadsup.protocol.api

import dev.carheadsup.protocol.MaintenanceStatusKind
import dev.carheadsup.protocol.ProtocolJson
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale

class ApiTest {
    private val zone = ZoneId.of("Europe/Berlin")

    private fun trip(
        id: String,
        endedAt: Long,
        distanceKm: Double = 10.0,
        fuel: Double? = 0.8,
        cost: Double? = 1.5,
        currency: String = "EUR",
    ) = TripRecord(
        id = id, startedAt = endedAt - 1_200_000, endedAt = endedAt, distanceKm = distanceKm, durationS = 1_200.0,
        movingS = 1_000.0, idleS = 200.0, fuelUsedL = fuel, avgLPer100km = fuel?.let { it / distanceKm * 100 },
        maxSpeedKph = 95.0, avgMovingSpeedKph = 36.0, cost = cost, currency = currency,
        startOdometerKm = null, endOdometerKm = null,
    )

    @Nested
    inner class Models {
        @Test
        fun `GET api trips body decodes, skipping malformed entries`() {
            val body =
                """[{"id":"a","startedAt":1,"endedAt":2,"distanceKm":3.5,"durationS":60,"movingS":50,"idleS":10,
                    "fuelUsedL":null,"avgLPer100km":null,"maxSpeedKph":50,"avgMovingSpeedKph":30,"cost":null,
                    "currency":"USD","startOdometerKm":null,"endOdometerKm":null},
                   {"id":"broken"},
                   {"id":"b","startedAt":3,"endedAt":4,"distanceKm":1,"durationS":1,"movingS":1,"idleS":0,
                    "maxSpeedKph":1,"avgMovingSpeedKph":1,"currency":"USD"}]"""
            assertEquals(listOf("a", "b"), TripLog.decode(body).map { it.id })
            assertEquals(emptyList<TripRecord>(), TripLog.decode("{\"error\":\"unauthorized\"}"))
            assertEquals(emptyList<TripRecord>(), TripLog.decode("<html>"))
        }

        @Test
        fun `maintenance status decodes with unknown statuses tolerated`() {
            val items =
                ProtocolJson.decodeFromString(
                    kotlinx.serialization.builtins.ListSerializer(MaintenanceItemStatus.serializer()),
                    """[{"itemId":"oil","label":"Oil change","lastDoneAt":1700000000000,"lastDoneKm":12000,"dueAtKm":27000,
                         "dueAtEpochMs":1731536000000,"remainingKm":1200,"remainingDays":30,"status":"due-soon"},
                        {"itemId":"x","label":"X","status":"exploded"}]""",
                )
            assertEquals(MaintenanceStatusKind.DUE_SOON, items[0].status)
            assertEquals(1200.0, items[0].remainingKm)
            assertEquals(MaintenanceStatusKind.UNKNOWN, items[1].status)
            assertNull(items[1].remainingKm)
        }

        @Test
        fun `config view reads only the units`() {
            val view =
                ProtocolJson.decodeFromString(
                    ApiConfigUnitsView.serializer(),
                    """{"version":1,"units":{"system":"imperial","fuelEconomy":"mpg-us","temperature":"F","pressure":"psi",
                        "clock":"12h","currency":"USD"},"vehicle":{"name":"Car"}}""",
                )
            assertEquals(DisplayUnits(UnitSystem.IMPERIAL, FuelEconomyUnit.MPG_US, "USD"), view.units)
            assertEquals(DisplayUnits(), ProtocolJson.decodeFromString(ApiConfigUnitsView.serializer(), "{}").units)
        }

        @Test
        fun `info and input bodies`() {
            val info = ProtocolJson.decodeFromString(
                ApiInfo.serializer(),
                """{"name":"carheadsup","version":"0.1.0","simulated":true,"uptimeS":12.5,"obd":{},"phoneConnected":true}""",
            )
            assertEquals(ApiInfo("carheadsup", "0.1.0", true, 12.5, true), info)
            assertEquals(
                """{"action":"next-page"}""",
                ProtocolJson.encodeToString(
                    ApiInputRequest.serializer(),
                    ApiInputRequest(dev.carheadsup.protocol.InputAction.NEXT_PAGE),
                ),
            )
        }
    }

    @Nested
    inner class Log {
        @Test
        fun `merge de-duplicates by id, newest first, capped`() {
            val old = listOf(trip("a", 1_000), trip("b", 2_000, distanceKm = 5.0))
            val incoming = listOf(trip("b", 2_000, distanceKm = 6.0), trip("c", 3_000))
            val merged = TripLog.merge(old, incoming)
            assertEquals(listOf("c", "b", "a"), merged.map { it.id })
            assertEquals(6.0, merged[1].distanceKm)
            assertEquals(listOf("c", "b"), TripLog.merge(old, incoming, limit = 2).map { it.id })
            assertEquals(listOf("c", "a"), TripLog.remove(merged, "b").map { it.id })
        }

        @Test
        fun `sync cursor is the newest end time`() {
            assertEquals(0L, TripLog.syncCursor(emptyList()))
            assertEquals(3_000L, TripLog.syncCursor(listOf(trip("a", 1_000), trip("c", 3_000))))
        }

        @Test
        fun `totals count fuel and cost only where known, per currency`() {
            val totals = TripLog.totals(
                listOf(
                    trip("a", 1, fuel = 1.0, cost = 2.0),
                    trip("b", 2, fuel = null, cost = null),
                    trip("c", 3, cost = 5.0, currency = "USD"),
                ),
            )
            assertEquals(3, totals.trips)
            assertEquals(30.0, totals.distanceKm)
            assertEquals(3_600.0, totals.durationS)
            assertEquals(1.8, totals.fuelUsedL!!, 1e-9)
            assertEquals(mapOf("EUR" to 2.0, "USD" to 5.0), totals.costByCurrency)
            assertNull(TripLog.totals(listOf(trip("x", 1, fuel = null))).fuelUsedL)
        }

        @Test
        fun `encode and decode round-trip`() {
            val trips = listOf(trip("a", 1_000), trip("b", 2_000, fuel = null, cost = null))
            assertEquals(trips, TripLog.decode(TripLog.encode(trips)))
        }
    }

    @Nested
    inner class Formatter {
        private val metric = TripFormatter(DisplayUnits(), Locale.US, zone)
        private val us =
            TripFormatter(
                DisplayUnits(UnitSystem.IMPERIAL, FuelEconomyUnit.MPG_US, "USD"),
                Locale.US,
                zone,
                use24HourClock = false,
            )
        private val german = TripFormatter(DisplayUnits(), Locale.GERMANY, zone)

        @Test
        fun distances() {
            assertEquals("12.3 km", metric.distance(12.34))
            assertEquals("240 km", metric.distance(240.4))
            assertEquals("1,234 km", metric.distance(1_234.0))
            assertEquals("7.7 mi", us.distance(12.34))
            assertEquals("12,3 km", german.distance(12.34))
        }

        @Test
        fun durations() {
            assertEquals("< 1 min", metric.duration(59.0))
            assertEquals("< 1 min", metric.duration(Double.NaN))
            assertEquals("42 min", metric.duration(42 * 60.0))
            assertEquals("1 h 05 min", metric.duration(3_900.0))
            assertEquals("26 h 00 min", metric.duration(26 * 3_600.0))
        }

        @Test
        fun `fuel and economy in every unit`() {
            assertEquals("1.23 L", metric.fuel(1.234))
            assertNull(metric.fuel(null))
            assertEquals("0.33 gal", us.fuel(1.25))
            assertEquals("6.1 L/100 km", metric.economy(6.1))
            assertEquals("38.6 mpg", us.economy(6.1))
            assertEquals(
                "46.3 mpg",
                TripFormatter(DisplayUnits(UnitSystem.IMPERIAL, FuelEconomyUnit.MPG_UK), Locale.UK, zone).economy(6.1),
            )
            assertEquals(
                "16.4 km/L",
                TripFormatter(DisplayUnits(fuelEconomy = FuelEconomyUnit.KM_PER_L), Locale.US, zone).economy(6.1),
            )
            assertNull(metric.economy(0.0))
            assertNull(metric.economy(null))
            assertEquals(235.214583, TripFormatter.MPG_US_FACTOR, 1e-6)
            assertEquals(282.480936, TripFormatter.MPG_UK_FACTOR, 1e-6)
        }

        @Test
        fun speeds() {
            assertEquals("87 km/h", metric.speed(87.4))
            assertEquals("54 mph", us.speed(87.0))
        }

        @Test
        fun money() {
            assertEquals("$4.20", us.cost(4.2, "USD"))
            assertEquals("€4.20", metric.cost(4.2, "eur"))
            assertTrue(german.cost(4.2, "EUR")!!.replace('\u00a0', ' ').startsWith("4,20 €"))
            assertEquals("4.20 XYZ", metric.cost(4.2, "XYZ"))
            assertNull(metric.cost(null, "EUR"))
        }

        @Test
        fun `time ranges in the phone's zone`() {
            val start = ZonedDateTime.of(2026, 9, 22, 8, 12, 0, 0, zone).toInstant().toEpochMilli()
            val end = ZonedDateTime.of(2026, 9, 22, 8, 47, 0, 0, zone).toInstant().toEpochMilli()
            assertEquals("Tue 22 Sep · 08:12–08:47", metric.timeRange(start, end))
            assertEquals("Tue 22 Sep · 8:12 AM–8:47 AM", us.timeRange(start, end))
            val nextDay = ZonedDateTime.of(2026, 9, 23, 0, 30, 0, 0, zone).toInstant().toEpochMilli()
            assertEquals("Tue 22 Sep · 08:12–Wed 23 Sep 00:30", metric.timeRange(start, nextDay))
        }

        @Test
        fun `trip summary line`() {
            assertEquals("10.0 km · 20 min · 0.80 L · €1.50", metric.summary(trip("a", 1_758_600_000_000)))
            assertEquals("10.0 km · 20 min", metric.summary(trip("b", 1_758_600_000_000, fuel = null, cost = null)))
        }

        @Test
        fun `maintenance wording`() {
            fun item(km: Double?, days: Double?) =
                MaintenanceItemStatus("oil", "Oil change", remainingKm = km, remainingDays = days)
            assertEquals("in 1,200 km or 30 days", metric.maintenanceRemaining(item(1_200.0, 30.0)))
            assertEquals("in 1 day", metric.maintenanceRemaining(item(null, 1.2)))
            assertEquals("overdue by 300 km", metric.maintenanceRemaining(item(-300.0, 20.0)))
            assertEquals("overdue by 300 km and 4 days", metric.maintenanceRemaining(item(-300.0, -4.0)))
            assertEquals("in 746 mi", us.maintenanceRemaining(item(1_200.0, null)))
            assertNull(metric.maintenanceRemaining(item(null, Double.NaN)))
            assertEquals("Due soon", TripFormatter.statusLabel(MaintenanceStatusKind.DUE_SOON))
            assertEquals("Overdue", TripFormatter.statusLabel(MaintenanceStatusKind.OVERDUE))
        }
    }
}
