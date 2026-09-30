package dev.carheadsup.companion.traffic

import android.location.Location
import android.os.SystemClock
import android.util.Log
import dev.carheadsup.companion.hud.await
import dev.carheadsup.protocol.hazards.HazardAggregator
import dev.carheadsup.protocol.hazards.HazardFeed
import dev.carheadsup.protocol.hazards.HazardSource
import dev.carheadsup.protocol.link.FixWatchdog
import dev.carheadsup.protocol.osm.HeadingMemory
import dev.carheadsup.protocol.osm.LatLon
import dev.carheadsup.protocol.traffic.TomTomTraffic
import dev.carheadsup.protocol.traffic.TrafficBudget
import dev.carheadsup.protocol.traffic.TrafficCorridor
import dev.carheadsup.protocol.traffic.TrafficDecision
import dev.carheadsup.protocol.traffic.TrafficFix
import dev.carheadsup.protocol.traffic.TrafficHttpOutcome
import dev.carheadsup.protocol.traffic.TrafficIncident
import dev.carheadsup.protocol.traffic.TrafficIncidentFinder
import dev.carheadsup.protocol.traffic.TrafficIncidentService
import dev.carheadsup.protocol.traffic.TrafficParseException
import dev.carheadsup.protocol.traffic.TrafficPolicy
import dev.carheadsup.protocol.traffic.TrafficRequest
import dev.carheadsup.protocol.traffic.TrafficStatus
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
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

/**
 * Traffic incidents ahead (jams, accidents, closures, road works …) from a traffic service —
 * TomTom ([TomTomTraffic]) — for the driver who turned it on and entered an API key:
 * - asks for the incidents in a corridor reaching about 10 km ahead along the direction of travel
 *   ([TrafficCorridor]) whenever [TrafficPolicy] says so: every 2 minutes while driving, at once
 *   after 3 km or a turn, not while parked, backing off after failures, never beyond the daily
 *   budget ([TrafficBudgetStore]), and never again with a key the service refused;
 * - over the internet ([dev.carheadsup.companion.AppGraph.internetClient], like Overpass), never
 *   over the HUD's Wi-Fi, which usually has no internet;
 * - on every GPS fix, the incidents ahead of the car ([TrafficIncidentFinder]: in the heading
 *   cone, on the car's carriageway, nearest first) go to the HUD through the [HazardAggregator],
 *   merged with the speed cameras;
 * - data older than 10 minutes is not shown, and everything is withdrawn when usable fixes stop
 *   for a few seconds ([FixWatchdog]) or the provider stops.
 *
 * The request URL carries the key: it is never logged. [onStatus] receives the state for the UI.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TrafficProvider(
    scope: CoroutineScope,
    private val client: OkHttpClient,
    /** The key this provider asks with; a different key needs a new provider. */
    val apiKey: String,
    private val budgetStore: TrafficBudgetStore,
    hazards: HazardAggregator,
    private val onStatus: (TrafficStatus) -> Unit,
    private val service: TrafficIncidentService = TomTomTraffic(),
) {
    private val worker = Dispatchers.Default.limitedParallelism(1)
    private val fixes =
        MutableSharedFlow<Location>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    private val policy = TrafficPolicy(budget = budgetStore.load())
    private val corridor = TrafficCorridor()
    private val finder = TrafficIncidentFinder(corridor = corridor)
    private val heading = HeadingMemory(minSpeedMps = MIN_SPEED_FOR_BEARING_MPS)
    private val watchdog = FixWatchdog(timeoutMs = FIX_TIMEOUT_MS, maxAccuracyM = MAX_ACCURACY_M)

    private var snapshot: Snapshot? = null
    private var lastUpdateWallMs: Long? = null
    private var lastError: String? = null
    private var lastDecision = TrafficDecision.NO_HEADING
    private var incidentsAhead = 0
    private var fetchJob: Job? = null

    @Volatile
    private var stopped = false

    /**
     * This provider's incidents at the HUD. Opening it withdraws whatever a previous provider
     * (another key) left; once closed ([stop]), a fix still being processed cannot bring them back.
     */
    private val feed: HazardFeed = hazards.open(HazardSource.TRAFFIC, SystemClock.elapsedRealtime())
    private val job: Job

    /** The incidents of the last answer, and when (monotonic) it came. */
    private class Snapshot(val incidents: List<TrafficIncident>, val fetchedAtMs: Long)

    private class KeyRefusedException(val code: Int) : IOException("HTTP $code")

    private class RetryLaterException(val retryAfterMs: Long?, message: String) : IOException(message)

    init {
        // Nothing is known until the first answer (the feed starts empty).
        publishStatus()
        job =
            scope.launch(worker) {
                launch {
                    while (isActive) {
                        delay(WATCHDOG_TICK_MS)
                        withdrawIfFixesStopped()
                    }
                }
                fixes.collect { process(it) }
            }
    }

    /** Feed a GPS fix (any thread). */
    fun onLocation(location: Location) {
        val accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null
        if (!watchdog.isUsable(accuracy)) return
        fixes.tryEmit(location)
    }

    /** Stops polling and takes the incidents off the HUD. */
    fun stop() {
        stopped = true
        job.cancel()
        fetchJob?.cancel()
        feed.close(SystemClock.elapsedRealtime())
    }

    private fun process(location: Location) {
        val nowMs = SystemClock.elapsedRealtime()
        watchdog.onFix(nowMs)
        val position = LatLon(location.latitude, location.longitude)
        val speed = if (location.hasSpeed()) location.speed.toDouble() else null
        val bearing = if (location.hasBearing()) location.bearing.toDouble() else null
        // While too slow for a GPS bearing (a queue, a red light), the last direction of travel.
        val headingDeg = heading.update(position, bearing, speed, nowMs)
        val fix = TrafficFix(position, headingDeg, speed)
        val day = TrafficBudget.dayOf(System.currentTimeMillis())
        lastDecision = policy.decide(fix, nowMs, day)
        if (lastDecision == TrafficDecision.REQUEST && headingDeg != null) fetch(fix, headingDeg, nowMs, day)

        val data = snapshot?.takeIf { policy.dataUsable(it.fetchedAtMs, nowMs) }
        val ahead =
            if (data != null && headingDeg != null) finder.ahead(data.incidents, position, headingDeg) else emptyList()
        incidentsAhead = ahead.size
        feed.update(ahead, nowMs)
        publishStatus()
    }

    /** No usable fix for a while: "ahead" is no longer known. */
    private fun withdrawIfFixesStopped() {
        val nowMs = SystemClock.elapsedRealtime()
        if (!watchdog.expired(nowMs)) return
        Log.i(TAG, "No usable GPS fix for ${FIX_TIMEOUT_MS / 1000} s; traffic ahead unknown")
        incidentsAhead = 0
        lastDecision = TrafficDecision.NO_HEADING
        feed.clear(nowMs)
        publishStatus()
    }

    private fun fetch(fix: TrafficFix, headingDeg: Double, nowMs: Long, day: Long) {
        if (!policy.onRequestStarted(fix, nowMs, day)) return
        budgetStore.save(policy.budget)
        val request =
            try {
                service.request(corridor.box(fix.position, headingDeg), apiKey)
            } catch (e: IllegalArgumentException) {
                // A key of the wrong shape (the Setup screen should not have let it through).
                Log.w(TAG, "Cannot ask ${service.name}: ${e.message}")
                refused("invalid key")
                return
            }
        fetchJob =
            CoroutineScope(worker + job).launch {
                try {
                    val incidents = download(request)
                    snapshot = Snapshot(incidents, SystemClock.elapsedRealtime())
                    lastUpdateWallMs = System.currentTimeMillis()
                    lastError = null
                    policy.onSuccess(SystemClock.elapsedRealtime())
                    lastDecision = TrafficDecision.UP_TO_DATE
                    Log.d(TAG, "${service.name}: ${incidents.size} incidents in the corridor")
                } catch (e: KeyRefusedException) {
                    Log.w(TAG, "${service.name} refused the API key (HTTP ${e.code})")
                    refused("HTTP ${e.code}")
                } catch (e: RetryLaterException) {
                    Log.i(TAG, "${service.name} busy: ${e.message}")
                    failed(e.message, e.retryAfterMs)
                } catch (e: IOException) {
                    Log.i(TAG, "${service.name} unavailable: ${redact(e.message)}")
                    failed(redact(e.message) ?: e.javaClass.simpleName, null)
                } catch (e: TrafficParseException) {
                    Log.w(TAG, "${service.name}: ${e.message}")
                    failed("invalid answer", null)
                }
                publishStatus()
            }
    }

    private fun failed(reason: String?, retryAfterMs: Long?) {
        policy.onFailure(SystemClock.elapsedRealtime(), retryAfterMs)
        lastError = reason ?: "error"
        lastDecision = TrafficDecision.WAITING
    }

    private fun refused(reason: String) {
        policy.onBadKey()
        lastError = reason
        lastDecision = TrafficDecision.BAD_KEY
    }

    private suspend fun download(request: TrafficRequest): List<TrafficIncident> = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(request.url)
        request.headers.forEach { (name, value) -> builder.header(name, value) }
        client.newCall(builder.build()).await().use { response ->
            when (service.classify(response.code)) {
                TrafficHttpOutcome.OK -> service.parse(response.body.string())

                TrafficHttpOutcome.BAD_KEY -> throw KeyRefusedException(response.code)

                TrafficHttpOutcome.RATE_LIMITED ->
                    throw RetryLaterException(
                        response.header("Retry-After")?.trim()?.toLongOrNull()?.times(1000),
                        "HTTP ${response.code}",
                    )

                TrafficHttpOutcome.UNAVAILABLE, TrafficHttpOutcome.REJECTED ->
                    throw IOException("HTTP ${response.code}")
            }
        }
    }

    private fun publishStatus() {
        if (stopped) return
        onStatus(
            TrafficStatus(
                state = TrafficStatus.stateOf(lastDecision, lastRequestFailed = lastError != null),
                lastUpdateWallMs = lastUpdateWallMs,
                incidentsAhead = incidentsAhead,
                error = lastError,
                requestsToday = policy.budget.usedOn(TrafficBudget.dayOf(System.currentTimeMillis())),
                dailyBudget = policy.budget.dailyLimit,
            ),
        )
    }

    private companion object {
        const val TAG = "TrafficProvider"
        const val MIN_SPEED_FOR_BEARING_MPS = 2.5

        /** Without a usable fix for this long, the incidents ahead are withdrawn. */
        const val FIX_TIMEOUT_MS = 5_000L
        const val WATCHDOG_TICK_MS = 1_000L

        /** Fixes less accurate than this say too little about the direction of travel. */
        const val MAX_ACCURACY_M = 50.0

        private val QUERY = Regex("\\?\\S*")

        /** An error message without any URL query (which would hold the API key). */
        fun redact(message: String?): String? = message?.replace(QUERY, "")
    }
}
