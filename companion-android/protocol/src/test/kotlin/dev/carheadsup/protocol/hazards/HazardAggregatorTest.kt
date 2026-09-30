package dev.carheadsup.protocol.hazards

import dev.carheadsup.protocol.HazardItem
import dev.carheadsup.protocol.HazardType
import dev.carheadsup.protocol.PhoneHazards
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class HazardAggregatorTest {
    private val sent = ArrayList<PhoneHazards>()
    private val hazards = HazardAggregator(publish = { sent += it }, refreshMs = 5_000)

    private fun camera(id: String, distanceM: Double?) = HazardItem(
        id,
        HazardType.SPEED_CAMERA,
        distanceM,
        speedLimitKph = 100.0,
        delaySeconds = null,
        description = null,
    )

    private fun jam(id: String, distanceM: Double?, delaySeconds: Double? = 420.0) = HazardItem(
        id,
        HazardType.TRAFFIC_JAM,
        distanceM,
        speedLimitKph = null,
        delaySeconds = delaySeconds,
        description = "Stationary traffic",
    )

    @Test
    fun `cameras and traffic go out as one list, nearest first`() {
        hazards.update(HazardSource.CAMERAS, listOf(camera("osm-node-1", 900.0)), 0)
        hazards.update(HazardSource.TRAFFIC, listOf(jam("tomtom-a", 2_500.0), jam("tomtom-b", 400.0)), 1_000)
        assertEquals(listOf("tomtom-b", "osm-node-1", "tomtom-a"), sent.last().items.map { it.id })
        assertEquals(sent.last().items, hazards.current())
    }

    @Test
    fun `one source's update never wipes the other's hazards`() {
        hazards.update(HazardSource.TRAFFIC, listOf(jam("tomtom-a", 2_500.0)), 0)
        hazards.update(HazardSource.CAMERAS, listOf(camera("osm-node-1", 900.0)), 1_000)
        hazards.clear(HazardSource.CAMERAS, 2_000)
        assertEquals(listOf("tomtom-a"), sent.last().items.map { it.id })
        hazards.clear(HazardSource.TRAFFIC, 3_000)
        assertEquals(emptyList<HazardItem>(), sent.last().items)
    }

    @Test
    fun `ids are unique, hazards without a distance come last, the list is capped`() {
        val capped = HazardAggregator(publish = { sent += it }, limit = 3)
        capped.update(HazardSource.CAMERAS, listOf(camera("x", 300.0), camera("unknown", null)), 0)
        capped.update(HazardSource.TRAFFIC, listOf(jam("x", 100.0), jam("y", 200.0), jam("z", 5_000.0)), 0)
        // "x" is the camera's (the first source wins); the jam of the same id is dropped.
        assertEquals(listOf("y", "x", "z"), sent.last().items.map { it.id })
        assertEquals(HazardType.SPEED_CAMERA, sent.last().items[1].type)
        val merged =
            HazardAggregator.merge(
                listOf(listOf(camera("x", 300.0), camera("unknown", null)), listOf(jam("y", 200.0), jam("z", 5_000.0))),
            )
        assertEquals(listOf("y", "x", "z", "unknown"), merged.map { it.id })
    }

    @Test
    fun `distances alone are refreshed every few seconds, anything else goes out at once`() {
        hazards.update(HazardSource.TRAFFIC, listOf(jam("tomtom-a", 3_000.0)), 0)
        assertEquals(1, sent.size)
        hazards.update(HazardSource.TRAFFIC, listOf(jam("tomtom-a", 2_970.0)), 1_000)
        hazards.update(HazardSource.TRAFFIC, listOf(jam("tomtom-a", 2_940.0)), 2_000)
        assertEquals(1, sent.size)
        // The delay changed: at once.
        hazards.update(HazardSource.TRAFFIC, listOf(jam("tomtom-a", 2_910.0, delaySeconds = 600.0)), 3_000)
        assertEquals(2, sent.size)
        assertEquals(600.0, sent.last().items.single().delaySeconds)
        // Unchanged: re-sent with the current distance after the refresh interval.
        hazards.update(HazardSource.TRAFFIC, listOf(jam("tomtom-a", 2_760.0, delaySeconds = 600.0)), 8_000)
        assertEquals(3, sent.size)
        assertEquals(2_760.0, sent.last().items.single().distanceM)
        // A new camera: at once.
        hazards.update(HazardSource.CAMERAS, listOf(camera("osm-node-1", 1_200.0)), 8_500)
        assertEquals(4, sent.size)
        // An empty list is refreshed too (it keeps the HUD's copy current).
        hazards.clear(HazardSource.CAMERAS, 9_000)
        hazards.clear(HazardSource.TRAFFIC, 9_000)
        val cleared = sent.size
        hazards.clear(HazardSource.TRAFFIC, 14_000)
        assertEquals(cleared + 1, sent.size)
        assertEquals(emptyList<HazardItem>(), sent.last().items)
    }

    @Test
    fun `a stopped provider's late update never brings its hazards back`() {
        val cameras = hazards.open(HazardSource.CAMERAS, 0)
        val traffic = hazards.open(HazardSource.TRAFFIC, 0)
        cameras.update(listOf(camera("osm-node-1", 900.0)), 1_000)
        traffic.update(listOf(jam("tomtom-a", 2_500.0)), 1_000)
        assertEquals(listOf("osm-node-1", "tomtom-a"), sent.last().items.map { it.id })
        // Traffic is switched off while its worker is still busy with a fix.
        traffic.close(2_000)
        assertEquals(listOf("osm-node-1"), sent.last().items.map { it.id })
        traffic.update(listOf(jam("tomtom-a", 2_450.0)), 2_100)
        traffic.clear(2_200)
        traffic.close(2_300)
        // The cameras' own updates and refreshes do not carry the stopped provider's jam either.
        cameras.update(listOf(camera("osm-node-1", 850.0)), 8_000)
        assertEquals(listOf("osm-node-1"), sent.last().items.map { it.id })
        assertEquals(listOf("osm-node-1"), hazards.current().map { it.id })
    }

    @Test
    fun `a new provider of a source replaces the old one's feed`() {
        val oldKey = hazards.open(HazardSource.TRAFFIC, 0)
        oldKey.update(listOf(jam("tomtom-a", 2_500.0)), 1_000)
        // Another API key: a new provider opens its feed, which withdraws the old list at once.
        val newKey = hazards.open(HazardSource.TRAFFIC, 2_000)
        assertEquals(emptyList<HazardItem>(), sent.last().items)
        oldKey.update(listOf(jam("tomtom-a", 2_400.0)), 2_100)
        oldKey.close(2_200)
        assertEquals(emptyList<HazardItem>(), hazards.current())
        newKey.update(listOf(jam("tomtom-b", 1_800.0)), 3_000)
        assertEquals(listOf("tomtom-b"), sent.last().items.map { it.id })
        // The old feed's close did not close the new one.
        newKey.update(listOf(jam("tomtom-b", 1_700.0), jam("tomtom-c", 2_000.0)), 4_000)
        assertEquals(listOf("tomtom-b", "tomtom-c"), hazards.current().map { it.id })
        assertEquals(HazardSource.TRAFFIC, newKey.source)
    }

    @Test
    fun `a close racing updates on another thread leaves nothing behind`() {
        repeat(200) {
            val shared = HazardAggregator(publish = {}, refreshMs = 0)
            val feed = shared.open(HazardSource.TRAFFIC, 0)
            val started = CountDownLatch(1)
            val worker =
                Thread {
                    started.countDown()
                    repeat(200) { i -> feed.update(listOf(jam("t", i.toDouble())), i.toLong()) }
                }
            worker.start()
            started.await()
            feed.close(1)
            worker.join()
            assertEquals(emptyList<HazardItem>(), shared.current())
        }
    }

    @Test
    fun `sources on different threads publish in merge order`() {
        val published = ArrayList<PhoneHazards>()
        val shared = HazardAggregator(publish = { synchronized(published) { published += it } }, refreshMs = 0)
        val pool = Executors.newFixedThreadPool(2)
        val done = CountDownLatch(2)
        for (source in HazardSource.entries) {
            pool.execute {
                repeat(500) { i ->
                    val item = if (source == HazardSource.CAMERAS) camera("c", i.toDouble()) else jam("t", i.toDouble())
                    shared.update(source, listOf(item), i.toLong())
                }
                done.countDown()
            }
        }
        done.await(10, TimeUnit.SECONDS)
        pool.shutdown()
        // The last message holds both sources' last lists: nothing was published out of order.
        assertEquals(setOf("c" to 499.0, "t" to 499.0), published.last().items.map { it.id to it.distanceM }.toSet())
        assertEquals(published.last().items, shared.current())
    }
}
