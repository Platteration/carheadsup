package dev.carheadsup.companion.road

import android.location.Location
import android.os.SystemClock
import android.util.Log
import dev.carheadsup.companion.hud.await
import dev.carheadsup.protocol.PhoneMessages
import dev.carheadsup.protocol.PhoneToHud
import dev.carheadsup.protocol.hazards.HazardAggregator
import dev.carheadsup.protocol.hazards.HazardFeed
import dev.carheadsup.protocol.hazards.HazardSource
import dev.carheadsup.protocol.link.ChangeGate
import dev.carheadsup.protocol.link.FixWatchdog
import dev.carheadsup.protocol.osm.GeoTile
import dev.carheadsup.protocol.osm.HeadingMemory
import dev.carheadsup.protocol.osm.LatLon
import dev.carheadsup.protocol.osm.OverpassException
import dev.carheadsup.protocol.osm.OverpassParser
import dev.carheadsup.protocol.osm.OverpassQueries
import dev.carheadsup.protocol.osm.OverpassThrottle
import dev.carheadsup.protocol.osm.RoadData
import dev.carheadsup.protocol.osm.SpeedCameraFinder
import dev.carheadsup.protocol.osm.TileFreshness
import dev.carheadsup.protocol.osm.WayMatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException

/**
 * Speed limit, road name/class and speed cameras from OpenStreetMap via the Overpass API:
 * - data is fetched per map tile (≈2 km, [GeoTile]) around the vehicle, one polite request at a
 *   time ([OverpassThrottle]), and cached in memory and on disk for a week — stale tiles (up to
 *   90 days) are used while offline;
 * - each GPS fix is matched to a way ([WayMatcher]) → `road`; cameras ahead ([SpeedCameraFinder])
 *   → the [HazardAggregator], which merges them with traffic incidents into the HUD's `hazards`
 *   and re-sends them every few seconds so the HUD's copy stays fresh;
 * - without data for the current tile the limit is reported unknown rather than stale, and so
 *   is everything when usable fixes stop for a few seconds ([FixWatchdog]: tunnels, location
 *   switched off, GPS never started) — the HUD must not keep showing the last limit as current;
 * - while the car is too slow for a GPS bearing, cameras are looked for in the direction it was
 *   last heading ([HeadingMemory]), not all around it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RoadInfoProvider(
    scope: CoroutineScope,
    private val client: OkHttpClient,
    cacheDir: File,
    private val userAgent: String,
    /** Whether speed-camera warnings are wanted right now (the driver's setting). */
    private val camerasEnabled: () -> Boolean,
    /** Where cameras ahead go (merged with the other hazard sources). */
    hazards: HazardAggregator,
    /** Where `road` messages go. */
    private val publish: (PhoneToHud) -> Unit,
) {
    private val worker = Dispatchers.Default.limitedParallelism(1)
    private val fixes =
        MutableSharedFlow<Location>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    private val tileDir = File(cacheDir, "osm-tiles").apply { mkdirs() }
    private val memory = object : LinkedHashMap<String, Tile>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Tile>?) = size > MEMORY_TILES
    }
    private val throttle = OverpassThrottle()
    private val matcher = WayMatcher()
    private val cameraFinder = SpeedCameraFinder()
    private val roadGate = ChangeGate<Any>(refreshMs = ROAD_REFRESH_MS)
    private val watchdog = FixWatchdog(timeoutMs = FIX_TIMEOUT_MS, maxAccuracyM = MAX_ACCURACY_M)
    private val heading = HeadingMemory(minSpeedMps = MIN_SPEED_FOR_BEARING_MPS)
    private var previousWayId: Long? = null
    private var previousForward: Boolean? = null

    @Volatile
    private var endpointIndex = 0
    private var fetchJob: Job? = null

    /**
     * The cameras ahead at the HUD. Opening it withdraws whatever a previous provider left; once
     * closed ([stop]), a fix still being processed cannot bring them back.
     */
    private val cameraFeed: HazardFeed = hazards.open(HazardSource.CAMERAS, SystemClock.elapsedRealtime())
    private val job: Job

    private class Tile(val data: RoadData, val fetchedAtMs: Long)

    init {
        // Nothing is known until the first fix; this also replaces a limit the HUD may still
        // hold from before (the replay after a reconnect would otherwise bring nothing newer).
        publish(PhoneMessages.roadUnknown())
        job =
            scope.launch(worker) {
                launch {
                    while (isActive) {
                        delay(WATCHDOG_TICK_MS)
                        withdrawIfFixesStopped()
                    }
                }
                fixes.collect(::process)
            }
    }

    /** Feed a GPS fix (any thread). */
    fun onLocation(location: Location) {
        // A fix too inaccurate to place the car on a road counts as none.
        val accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null
        if (!watchdog.isUsable(accuracy)) return
        fixes.tryEmit(location)
    }

    /** No usable fix for a while: what the last one said may no longer be true. */
    private fun withdrawIfFixesStopped() {
        if (!watchdog.expired(SystemClock.elapsedRealtime())) return
        Log.i(TAG, "No usable GPS fix for ${FIX_TIMEOUT_MS / 1000} s; speed limit and cameras unknown")
        // Forget what was sent, so the first value after the gap goes out at once.
        roadGate.reset()
        publish(PhoneMessages.roadUnknown())
        cameraFeed.clear(SystemClock.elapsedRealtime())
    }

    /** Stops lookups; tells the HUD the limit and cameras are no longer known. */
    fun stop() {
        job.cancel()
        fetchJob?.cancel()
        publish(PhoneMessages.roadUnknown())
        cameraFeed.close(SystemClock.elapsedRealtime())
    }

    private suspend fun process(location: Location) {
        watchdog.onFix(SystemClock.elapsedRealtime())
        val position = LatLon(location.latitude, location.longitude)
        val now = System.currentTimeMillis()
        val tiles = GeoTile.covering(position, LOOKAHEAD_M)
        val loaded = tiles.mapNotNull { tile -> tileData(tile, now) }
        tiles.firstOrNull { tile -> needsFetch(tile, now) }?.let { requestFetch(it) }

        val centerLoaded = memory.containsKey(tiles.first().key)
        val data = loaded.fold(RoadData.EMPTY) { acc, tile -> acc + tile }
        val speed = if (location.hasSpeed()) location.speed.toDouble() else null
        val bearing = if (location.hasBearing()) location.bearing.toDouble() else null
        val accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null

        val road =
            if (!centerLoaded) {
                PhoneMessages.roadUnknown()
            } else {
                val match =
                    matcher.match(data.ways, position, bearing, speed, accuracy, previousWayId, previousForward)
                previousWayId = match?.way?.id
                previousForward = match?.forward
                match?.toPhoneRoad() ?: PhoneMessages.roadUnknown()
            }
        if (roadGate.shouldSend(road, now)) publish(road)

        // Without any known heading (parked since the start) nothing counts as ahead.
        val headingDeg = heading.update(position, bearing, speed, SystemClock.elapsedRealtime())
        val cameras =
            if (camerasEnabled() && headingDeg != null) {
                cameraFinder.ahead(data.cameras, position, headingDeg)
            } else {
                emptyList()
            }
        cameraFeed.update(cameras, SystemClock.elapsedRealtime())
    }

    /** Tile data from memory or disk, if usable. */
    private suspend fun tileData(tile: GeoTile, now: Long): RoadData? {
        memory[tile.key]?.let { cached ->
            if (TileFreshness.isUsable(cached.fetchedAtMs, now)) return cached.data
            memory.remove(tile.key)
        }
        val file = File(tileDir, "${tile.key}.json")
        val fromDisk =
            withContext(Dispatchers.IO) {
                if (!file.isFile || !TileFreshness.isUsable(file.lastModified(), now)) return@withContext null
                try {
                    Tile(OverpassParser.parse(file.readText()), file.lastModified())
                } catch (e: IOException) {
                    null
                } catch (e: OverpassException) {
                    file.delete()
                    null
                }
            } ?: return null
        memory[tile.key] = fromDisk
        return fromDisk.data
    }

    private fun needsFetch(tile: GeoTile, now: Long): Boolean {
        val cached = memory[tile.key] ?: return true
        return TileFreshness.needsRefresh(cached.fetchedAtMs, now)
    }

    private fun requestFetch(tile: GeoTile) {
        if (fetchJob?.isActive == true || !throttle.canRequest(SystemClock.elapsedRealtime())) return
        throttle.onRequestStarted(SystemClock.elapsedRealtime())
        fetchJob =
            CoroutineScope(worker + job).launch {
                try {
                    val body = download(tile)
                    val data = OverpassParser.parse(body)
                    val now = System.currentTimeMillis()
                    memory[tile.key] = Tile(data, now)
                    withContext(Dispatchers.IO) { store(tile, body) }
                    throttle.onSuccess(SystemClock.elapsedRealtime())
                    Log.d(TAG, "Tile ${tile.key}: ${data.ways.size} ways, ${data.cameras.size} cameras")
                } catch (e: RetryAfterException) {
                    throttle.onFailure(SystemClock.elapsedRealtime(), e.retryAfterMs)
                    endpointIndex++
                } catch (e: IOException) {
                    Log.i(TAG, "Overpass unavailable: ${e.message}")
                    throttle.onFailure(SystemClock.elapsedRealtime())
                    endpointIndex++
                } catch (e: OverpassException) {
                    Log.w(TAG, "Overpass error: ${e.message}")
                    throttle.onFailure(SystemClock.elapsedRealtime())
                    endpointIndex++
                }
            }
    }

    private class RetryAfterException(val retryAfterMs: Long?, message: String) : IOException(message)

    private suspend fun download(tile: GeoTile): String = withContext(Dispatchers.IO) {
        val endpoint = ENDPOINTS[endpointIndex % ENDPOINTS.size]
        val query = OverpassQueries.roadsAndCameras(tile.paddedBounds())
        val request =
            Request.Builder()
                .url(endpoint)
                .header("User-Agent", userAgent)
                .post(OverpassQueries.formBody(query).toRequestBody(FORM))
                .build()
        client.newCall(request).await().use { response ->
            when {
                response.code == 429 || response.code == 503 || response.code == 504 ->
                    throw RetryAfterException(
                        response.header("Retry-After")?.toLongOrNull()?.times(1000),
                        "Overpass busy (${response.code})",
                    )

                !response.isSuccessful -> throw IOException("Overpass HTTP ${response.code}")

                else -> response.body.string()
            }
        }
    }

    private fun store(tile: GeoTile, body: String) {
        try {
            val target = File(tileDir, "${tile.key}.json")
            val temp = File(tileDir, "${tile.key}.json.tmp")
            temp.writeText(body)
            if (!temp.renameTo(target)) temp.delete()
            trimDiskCache()
        } catch (e: IOException) {
            Log.w(TAG, "Cannot cache tile ${tile.key}", e)
        }
    }

    /** Keeps the tile cache under [DISK_CACHE_BYTES], dropping the least recently written tiles. */
    private fun trimDiskCache() {
        val files = tileDir.listFiles { file -> file.name.endsWith(".json") }?.sortedBy { it.lastModified() } ?: return
        var total = files.sumOf { it.length() }
        for (file in files) {
            if (total <= DISK_CACHE_BYTES) break
            total -= file.length()
            file.delete()
        }
    }

    private companion object {
        const val TAG = "RoadInfoProvider"

        /** Public Overpass instances, tried in turn after failures. */
        val ENDPOINTS =
            listOf("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter")
        val FORM = "application/x-www-form-urlencoded".toMediaType()

        const val LOOKAHEAD_M = 1_500.0
        const val MEMORY_TILES = 12
        const val DISK_CACHE_BYTES = 64L * 1024 * 1024
        const val ROAD_REFRESH_MS = 30_000L
        const val MIN_SPEED_FOR_BEARING_MPS = 2.5

        /** Without a usable fix for this long, the limit and cameras are withdrawn. */
        const val FIX_TIMEOUT_MS = 5_000L
        const val WATCHDOG_TICK_MS = 1_000L

        /** Fixes less accurate than this cannot tell parallel roads apart and are ignored. */
        const val MAX_ACCURACY_M = 50.0
    }
}
