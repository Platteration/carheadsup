package dev.carheadsup.companion.hud

import android.os.SystemClock
import android.util.Log
import dev.carheadsup.companion.data.CompanionSettings
import dev.carheadsup.protocol.HudCodec
import dev.carheadsup.protocol.HudDecodeResult
import dev.carheadsup.protocol.HudError
import dev.carheadsup.protocol.HudErrorCode
import dev.carheadsup.protocol.HudPong
import dev.carheadsup.protocol.HudToPhone
import dev.carheadsup.protocol.HudWelcome
import dev.carheadsup.protocol.PROTOCOL_VERSION
import dev.carheadsup.protocol.PhoneMessages
import dev.carheadsup.protocol.PhoneToHud
import dev.carheadsup.protocol.PhoneWire
import dev.carheadsup.protocol.link.Heartbeat
import dev.carheadsup.protocol.link.HudEndpoint
import dev.carheadsup.protocol.link.MessageRateLimiter
import dev.carheadsup.protocol.link.ReconnectBackoff
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** What the link to the HUD is doing, for the UI and the service notification. */
sealed interface LinkStatus {
    data object Stopped : LinkStatus

    /** Waiting for mDNS to find the HUD (or for a valid manual address). */
    data object Searching : LinkStatus

    data class Connecting(val endpoint: HudEndpoint) : LinkStatus

    data class Connected(
        val endpoint: HudEndpoint,
        val hudName: String,
        val hudVersion: String,
        val readMessagesAloud: Boolean,
        val rttMs: Long? = null,
    ) : LinkStatus

    /** Disconnected; the next attempt starts at [retryAtElapsedMs] (`SystemClock.elapsedRealtime`). */
    data class Waiting(val endpoint: HudEndpoint?, val reason: String, val retryAtElapsedMs: Long) : LinkStatus

    /** The HUD refused the session (wrong pairing token, incompatible version). */
    data class Refused(
        val endpoint: HudEndpoint,
        val code: HudErrorCode,
        val message: String,
        val retryAtElapsedMs: Long,
    ) : LinkStatus
}

/**
 * The phone side of `ws://<hud>/ws/phone`:
 * - resolves the HUD (manual address or mDNS), connects over the HUD's Wi-Fi and sends `hello`
 *   with the pairing token;
 * - after `welcome`, replays the latest nav/road/hazards/media/call state from [PhoneHub] and
 *   forwards everything published there, rate-limited per message type (nav ≤ 4 Hz, location 1 Hz);
 * - pings every 5 s and tears the socket down when the HUD stays silent for 15 s (a vanished
 *   Wi-Fi never delivers a TCP close);
 * - reconnects with exponential backoff; a refused pairing waits the maximum delay;
 * - hands every other HUD message to [onMessage].
 *
 * Changing the address or pairing token restarts the connection. All work runs in [scope].
 */
class HudLink(
    private val scope: CoroutineScope,
    private val baseClient: OkHttpClient,
    private val localNetwork: LocalNetwork,
    private val discovery: HudDiscovery,
    private val hub: PhoneHub,
    private val settings: StateFlow<CompanionSettings>,
    private val deviceName: String,
    private val appVersion: String,
    private val onConnected: suspend (HudWelcome) -> Unit,
    private val onMessage: suspend (HudToPhone) -> Unit,
) {
    private val state = MutableStateFlow<LinkStatus>(LinkStatus.Stopped)
    private val wakeUp = Channel<Unit>(Channel.CONFLATED)
    private val backoff = ReconnectBackoff(initialMs = 1_000, maxMs = 30_000)
    private var job: Job? = null

    val status: StateFlow<LinkStatus> = state.asStateFlow()

    /** The endpoint of the current or last session, for REST calls. */
    @Volatile
    var lastEndpoint: HudEndpoint? = null
        private set

    @Synchronized
    fun start() {
        if (job?.isActive == true) return
        job =
            scope.launch {
                settings
                    .map { it.connectionKey }
                    .distinctUntilChanged()
                    .collectLatest {
                        backoff.reset()
                        runLoop()
                    }
            }
    }

    @Synchronized
    fun stop() {
        job?.cancel()
        job = null
        discovery.stop()
        state.value = LinkStatus.Stopped
    }

    /** Skip the remaining backoff delay and try again now. */
    fun reconnectNow() {
        wakeUp.trySend(Unit)
    }

    private suspend fun runLoop() {
        while (currentCoroutineContext().isActive) {
            val endpoint = resolveEndpoint()
            lastEndpoint = endpoint
            state.value = LinkStatus.Connecting(endpoint)
            val outcome =
                try {
                    runSession(endpoint)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: RuntimeException) {
                    Log.e(TAG, "Session crashed", e)
                    SessionOutcome.Closed("internal error: ${e.message}")
                }
            val delayMs =
                when (outcome) {
                    is SessionOutcome.Refused -> backoff.refusedDelayMs()
                    is SessionOutcome.Closed -> backoff.nextDelayMs()
                }
            val retryAt = SystemClock.elapsedRealtime() + delayMs
            state.value =
                when (outcome) {
                    is SessionOutcome.Refused -> LinkStatus.Refused(endpoint, outcome.code, outcome.message, retryAt)
                    is SessionOutcome.Closed -> LinkStatus.Waiting(endpoint, outcome.reason, retryAt)
                }
            // Drain a stale wake-up, then wait for the delay or an explicit "reconnect now".
            wakeUp.tryReceive()
            withTimeoutOrNull(delayMs) { wakeUp.receive() }
        }
    }

    /** The configured manual endpoint, or the first one mDNS finds. */
    private suspend fun resolveEndpoint(): HudEndpoint {
        val current = settings.value
        if (!current.useDiscovery) {
            discovery.stop()
            current.manualEndpoint?.let { return it }
            state.value = LinkStatus.Searching
            // An invalid manual address: wait for the settings to change (collectLatest restarts us).
            return settings.map { it.manualEndpoint }.filterNotNull().first()
        }
        discovery.start()
        discovery.endpoint.value?.let { return it }
        state.value = LinkStatus.Searching
        return discovery.endpoint.filterNotNull().first()
    }

    private sealed interface SessionOutcome {
        data class Closed(val reason: String) : SessionOutcome

        data class Refused(val code: HudErrorCode, val message: String) : SessionOutcome
    }

    private sealed interface LoopEvent {
        data object Opened : LoopEvent

        data class Frame(val text: String) : LoopEvent

        data class Closed(val reason: String) : LoopEvent

        data class Outgoing(val message: PhoneToHud) : LoopEvent

        data object Tick : LoopEvent
    }

    /**
     * One WebSocket session, from connecting to closing. Socket callbacks, outgoing messages and
     * a 100 ms tick are funnelled into one event channel, so all session state is confined to
     * this coroutine.
     */
    private suspend fun runSession(endpoint: HudEndpoint): SessionOutcome = coroutineScope {
        val events = Channel<LoopEvent>(Channel.UNLIMITED)
        val socket = localNetwork.bind(baseClient).newWebSocket(
            Request.Builder().url(endpoint.webSocketUrl).build(),
            SocketListener(events),
        )
        val session = Session(this, endpoint, socket, events)
        val ticker = launch {
            while (isActive) {
                delay(TICK_MS)
                events.send(LoopEvent.Tick)
            }
        }
        try {
            for (event in events) {
                val outcome = session.handle(event, SystemClock.elapsedRealtime())
                if (outcome != null) return@coroutineScope outcome
            }
            SessionOutcome.Closed("closed")
        } finally {
            ticker.cancel()
            session.close()
            // cancel() rather than close(): the peer may be gone, and close() would wait for it.
            socket.cancel()
            events.close()
        }
    }

    private class SocketListener(private val events: Channel<LoopEvent>) : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            events.trySend(LoopEvent.Opened)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            events.trySend(LoopEvent.Frame(text))
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(NORMAL_CLOSURE, null)
            events.trySend(LoopEvent.Closed(reason.ifBlank { "closed by the HUD ($code)" }))
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            events.trySend(LoopEvent.Closed(reason.ifBlank { "closed ($code)" }))
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            events.trySend(LoopEvent.Closed(t.message ?: t.javaClass.simpleName))
        }
    }

    /** Protocol state of one session; [handle] returns an outcome when the session must end. */
    private inner class Session(
        private val scope: CoroutineScope,
        private val endpoint: HudEndpoint,
        private val socket: WebSocket,
        private val events: Channel<LoopEvent>,
    ) {
        private val limiter = MessageRateLimiter()
        private val heartbeat = Heartbeat(intervalMs = PING_INTERVAL_MS, timeoutMs = SILENCE_TIMEOUT_MS)
        private val openedAt = SystemClock.elapsedRealtime()
        private var welcome: HudWelcome? = null
        private var forwarder: Job? = null

        suspend fun handle(event: LoopEvent, now: Long): SessionOutcome? = when (event) {
            LoopEvent.Opened -> sendHello()

            is LoopEvent.Frame -> onFrame(event.text, now)

            is LoopEvent.Outgoing -> {
                if (welcome != null) sendLimited(event.message, now)
                null
            }

            LoopEvent.Tick -> onTick(now)

            is LoopEvent.Closed -> SessionOutcome.Closed(event.reason)
        }

        fun close() {
            forwarder?.cancel()
        }

        private fun sendHello(): SessionOutcome? {
            val hello = PhoneMessages.hello(deviceName, appVersion, settings.value.pairingToken)
            if (PhoneWire.encode(hello) == null) {
                return SessionOutcome.Refused(HudErrorCode.BAD_TOKEN, "pairing token is too long")
            }
            sendNow(hello)
            return null
        }

        private suspend fun onFrame(text: String, now: Long): SessionOutcome? {
            heartbeat.onFrameReceived(now)
            val message =
                when (val decoded = HudCodec.decode(text)) {
                    is HudDecodeResult.Message -> decoded.message

                    is HudDecodeResult.UnknownType -> {
                        Log.d(TAG, "Ignoring HUD message type ${decoded.type}")
                        return null
                    }

                    is HudDecodeResult.Malformed -> {
                        Log.w(TAG, "Malformed HUD frame: ${decoded.error}")
                        return null
                    }
                }
            when (message) {
                is HudWelcome -> onWelcome(message, now)
                is HudError -> return onError(message)
                is HudPong -> onPong(message, now)
                else -> onMessage(message)
            }
            return null
        }

        private suspend fun onWelcome(message: HudWelcome, now: Long) {
            if (message.v != PROTOCOL_VERSION) Log.w(TAG, "HUD speaks v${message.v}, we speak v$PROTOCOL_VERSION")
            welcome = message
            backoff.reset()
            limiter.reset()
            heartbeat.start(now)
            state.value = LinkStatus.Connected(endpoint, message.hudName, message.hudVersion, message.readMessagesAloud)
            // Subscribe first, then replay: nothing published in between is lost.
            forwarder = scope.launch { hub.outgoing.collect { events.send(LoopEvent.Outgoing(it)) } }
            hub.replay().forEach(::sendNow)
            onConnected(message)
        }

        private fun onError(message: HudError): SessionOutcome? {
            if (message.code == HudErrorCode.BAD_TOKEN || message.code == HudErrorCode.UNSUPPORTED_VERSION) {
                return SessionOutcome.Refused(message.code, message.message)
            }
            // bad-message / internal concern a single message; the session goes on.
            Log.w(TAG, "HUD reported ${message.code}: ${message.message}")
            return null
        }

        private fun onPong(message: HudPong, now: Long) {
            val rtt = heartbeat.onPong(message.id, now) ?: return
            val connected = state.value as? LinkStatus.Connected ?: return
            state.value = connected.copy(rttMs = rtt)
        }

        private fun onTick(now: Long): SessionOutcome? {
            if (welcome == null) {
                return if (now - openedAt >
                    WELCOME_TIMEOUT_MS
                ) {
                    SessionOutcome.Closed("no answer from the HUD")
                } else {
                    null
                }
            }
            heartbeat.onTick(now)?.let(::sendNow)
            limiter.drainDue(now).forEach(::sendNow)
            return if (heartbeat.isTimedOut(now)) SessionOutcome.Closed("the HUD stopped responding") else null
        }

        private fun sendLimited(message: PhoneToHud, now: Long) {
            if (limiter.offer(message, now) == MessageRateLimiter.Decision.SendNow) sendNow(message)
        }

        private fun sendNow(message: PhoneToHud) {
            val frame = PhoneWire.encode(message)
            if (frame == null) {
                Log.w(TAG, "Dropping a ${message.javaClass.simpleName} the HUD would reject")
            } else if (!socket.send(frame)) {
                events.trySend(LoopEvent.Closed("send failed"))
            }
        }
    }

    private companion object {
        const val TAG = "HudLink"
        const val NORMAL_CLOSURE = 1000
        const val TICK_MS = 100L
        const val PING_INTERVAL_MS = 5_000L
        const val SILENCE_TIMEOUT_MS = 15_000L
        const val WELCOME_TIMEOUT_MS = 15_000L
    }
}
