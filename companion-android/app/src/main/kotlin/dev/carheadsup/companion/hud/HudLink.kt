package dev.carheadsup.companion.hud

import android.os.SystemClock
import android.util.Log
import dev.carheadsup.companion.data.CompanionSettings
import dev.carheadsup.protocol.HudChallenge
import dev.carheadsup.protocol.HudCodec
import dev.carheadsup.protocol.HudDecodeResult
import dev.carheadsup.protocol.HudError
import dev.carheadsup.protocol.HudErrorCode
import dev.carheadsup.protocol.HudPong
import dev.carheadsup.protocol.HudToPhone
import dev.carheadsup.protocol.HudWelcome
import dev.carheadsup.protocol.PROTOCOL_VERSION
import dev.carheadsup.protocol.PhoneToHud
import dev.carheadsup.protocol.PhoneWire
import dev.carheadsup.protocol.auth.HudHandshake
import dev.carheadsup.protocol.auth.HudPin
import dev.carheadsup.protocol.auth.PhoneAuth
import dev.carheadsup.protocol.auth.TrustProblem
import dev.carheadsup.protocol.link.Heartbeat
import dev.carheadsup.protocol.link.HudEndpoint
import dev.carheadsup.protocol.link.MessageRateLimiter
import dev.carheadsup.protocol.link.PhoneCloseCode
import dev.carheadsup.protocol.link.ReconnectBackoff
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
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
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.receiveAsFlow
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

    /**
     * The HUD proved it knows the pairing token ([authenticated]), or — without a token — is the
     * HUD the user confirmed, which nothing proves ([authenticated] false).
     */
    data class Connected(
        val endpoint: HudEndpoint,
        val hudName: String,
        val hudVersion: String,
        val readMessagesAloud: Boolean,
        val hudId: String,
        val authenticated: Boolean,
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

    /**
     * The phone did not trust the HUD that answered and sent it nothing: a different HUD than
     * the paired one, a HUD without pairing token the user has not confirmed, or a HUD that
     * could not prove the token.
     */
    data class Untrusted(val endpoint: HudEndpoint, val problem: TrustProblem, val retryAtElapsedMs: Long) : LinkStatus
}

/**
 * The phone side of `ws://<hud>/ws/phone` (protocol v2):
 * - resolves the HUD (manual address or mDNS; once paired, discovery skips HUDs advertising
 *   another id), connects over the HUD's Wi-Fi and answers its `challenge` through
 *   [HudHandshake]: nothing at all goes to a HUD other than the paired one, or — without a
 *   pairing token — to a HUD the user has not confirmed ([LinkStatus.Untrusted]);
 * - checks the proof in `welcome` before anything else: only a verified HUD is reported
 *   [LinkStatus.Connected], gets the phone's data, and has its messages (call actions …) acted
 *   on; the first verified HUD is pinned ([onPinned]) and its address becomes [trustedEndpoint],
 *   the only one REST calls and the settings page may use;
 * - after that, replays the latest nav/road/hazards/media/call state from [PhoneHub] and
 *   forwards everything published there, rate-limited per message type (nav ≤ 4 Hz, location 1 Hz);
 * - pings every 5 s and tears the socket down when the HUD stays silent for 15 s (a vanished
 *   Wi-Fi never delivers a TCP close);
 * - reconnects with exponential backoff; a refused or untrusted pairing, or a session a newer one
 *   of this phone replaced (close 4000), waits the maximum delay; while another phone holds the
 *   HUD it is refused with close 1013 ("another phone is connected") and backs off as usual;
 * - hands every other message of a verified HUD to [onMessage].
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
    /** This install's identity (`hello.deviceId`). */
    private val deviceId: String,
    private val appVersion: String,
    /** Store the pin of the first HUD verified with the current pairing token. */
    private val onPinned: (HudPin) -> Unit,
    private val onConnected: suspend (HudWelcome) -> Unit,
    private val onMessage: suspend (HudToPhone) -> Unit,
) {
    private val state = MutableStateFlow<LinkStatus>(LinkStatus.Stopped)
    private val wakeUp = Channel<Unit>(Channel.CONFLATED)
    private val backoff = ReconnectBackoff(initialMs = 1_000, maxMs = 30_000)
    private var job: Job? = null

    /** The paired HUD id discovery was last started for (it filters advertisements by it). */
    private var discoveryPinnedId: String? = null

    val status: StateFlow<LinkStatus> = state.asStateFlow()

    /**
     * Where a HUD last proved itself (or, without a pairing token, the HUD the user confirmed)
     * with the current connection settings: the only address REST calls and the settings page
     * may use, since they carry the API token. Kept across disconnects (the remote buttons fall
     * back to REST), dropped when the settings change or another HUD answers there.
     */
    @Volatile
    var trustedEndpoint: HudEndpoint? = null
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
                        trustedEndpoint = null
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

    /** Skip the remaining backoff delay (or restart a discovery that finds nothing) and try again now. */
    fun reconnectNow() {
        wakeUp.trySend(Unit)
    }

    private suspend fun runLoop() {
        while (currentCoroutineContext().isActive) {
            val endpoint = resolveEndpoint()
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
            if (outcome is SessionOutcome.Untrusted && endpoint == trustedEndpoint) trustedEndpoint = null
            val delayMs =
                when (outcome) {
                    is SessionOutcome.Refused, is SessionOutcome.Untrusted -> backoff.refusedDelayMs()
                    is SessionOutcome.Closed -> backoff.delayAfterClose(outcome.code)
                }
            val retryAt = SystemClock.elapsedRealtime() + delayMs
            state.value =
                when (outcome) {
                    is SessionOutcome.Refused -> LinkStatus.Refused(endpoint, outcome.code, outcome.message, retryAt)
                    is SessionOutcome.Untrusted -> LinkStatus.Untrusted(endpoint, outcome.problem, retryAt)
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
        // Discovery skips advertisements of other HUDs once paired, and does not report them
        // again by itself: start afresh when the pairing changed.
        val pinnedId = HudPin.active(current.hudPin, current.pairingToken)?.hudId
        if (pinnedId != discoveryPinnedId) {
            discoveryPinnedId = pinnedId
            discovery.restart()
        } else {
            discovery.start()
        }
        while (true) {
            discovery.endpoint.value?.let { return it }
            state.value = LinkStatus.Searching
            // Drain a stale wake-up, then wait for the HUD, a "reconnect now" or the timeout.
            wakeUp.tryReceive()
            val found =
                withTimeoutOrNull(DISCOVERY_RESTART_MS) {
                    merge(discovery.endpoint.filterNotNull(), wakeUp.receiveAsFlow().map { null }).first()
                }
            if (found != null) return found
            // NSD does not retry by itself: a discovery that failed to start (Wi-Fi not up yet,
            // FAILURE_INTERNAL_ERROR / MAX_LIMIT) or a failed resolution would leave us here
            // for good, since a service that is still present is not reported again.
            Log.i(TAG, "HUD not found yet; restarting discovery")
            discovery.restart()
        }
    }

    private sealed interface SessionOutcome {
        /** The session ended; [code] is the WebSocket close code when the HUD closed it. */
        data class Closed(val reason: String, val code: Int? = null) : SessionOutcome

        data class Refused(val code: HudErrorCode, val message: String) : SessionOutcome

        /** The phone refused the HUD (see [HudHandshake]). */
        data class Untrusted(val problem: TrustProblem) : SessionOutcome
    }

    private sealed interface LoopEvent {
        data object Opened : LoopEvent

        data class Frame(val text: String) : LoopEvent

        data class Closed(val reason: String, val code: Int? = null) : LoopEvent

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
            events.trySend(LoopEvent.Closed(closeReason(code, reason, "closed by the HUD ($code)"), code))
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            events.trySend(LoopEvent.Closed(closeReason(code, reason, "closed ($code)"), code))
        }

        private fun closeReason(code: Int, reason: String, fallback: String): String =
            if (code == PhoneCloseCode.REPLACED) "a newer connection took over the HUD" else reason.ifBlank { fallback }

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
        private val pairingToken = settings.value.pairingToken
        private val handshake =
            HudHandshake(
                pairingToken = pairingToken,
                deviceId = deviceId,
                device = deviceName,
                appVersion = appVersion,
                pin = settings.value.hudPin,
            )

        /** Set once the HUD's `welcome` checked out; nothing is sent or acted on before. */
        private var welcome: HudWelcome? = null
        private var forwarder: Job? = null

        suspend fun handle(event: LoopEvent, now: Long): SessionOutcome? = when (event) {
            // The HUD speaks first (`challenge`); a token it cannot hold can never match.
            LoopEvent.Opened ->
                if (PhoneAuth.isValidToken(pairingToken)) {
                    null
                } else {
                    SessionOutcome.Refused(HudErrorCode.BAD_TOKEN, "pairing token is too long")
                }

            is LoopEvent.Frame -> onFrame(event.text, now)

            is LoopEvent.Outgoing -> {
                if (welcome != null) sendLimited(event.message, now)
                null
            }

            LoopEvent.Tick -> onTick(now)

            is LoopEvent.Closed -> SessionOutcome.Closed(event.reason, event.code)
        }

        fun close() {
            forwarder?.cancel()
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
                is HudChallenge -> return onChallenge(message)

                is HudWelcome -> return onWelcome(message, now)

                is HudError -> return onError(message)

                else ->
                    if (welcome == null) {
                        // Not verified: a peer that has not proven itself is not obeyed.
                        Log.w(TAG, "Ignoring ${message.javaClass.simpleName} from an unverified HUD")
                    } else if (message is HudPong) {
                        onPong(message, now)
                    } else {
                        onMessage(message)
                    }
            }
            return null
        }

        private fun onChallenge(message: HudChallenge): SessionOutcome? =
            when (val result = handshake.onChallenge(message)) {
                is HudHandshake.ChallengeResult.SendHello -> {
                    sendNow(result.hello)
                    null
                }

                is HudHandshake.ChallengeResult.Refuse -> {
                    Log.w(TAG, "Not talking to the HUD at ${endpoint.display()}: ${result.problem}")
                    SessionOutcome.Untrusted(result.problem)
                }

                is HudHandshake.ChallengeResult.UnsupportedVersion ->
                    SessionOutcome.Refused(
                        HudErrorCode.UNSUPPORTED_VERSION,
                        "the HUD speaks protocol version ${result.hudVersion}, this app $PROTOCOL_VERSION",
                    )
            }

        private suspend fun onWelcome(message: HudWelcome, now: Long): SessionOutcome? {
            val verified =
                when (val result = handshake.onWelcome(message)) {
                    is HudHandshake.WelcomeResult.Refuse -> {
                        Log.w(TAG, "The HUD at ${endpoint.display()} failed verification: ${result.problem}")
                        return SessionOutcome.Untrusted(result.problem)
                    }

                    is HudHandshake.WelcomeResult.Verified -> result
                }
            verified.newPin?.let(onPinned)
            trustedEndpoint = endpoint
            welcome = message
            backoff.reset()
            limiter.reset()
            heartbeat.start(now)
            // Subscribe before anything can be published for this session — the replay, the
            // trips-request from onConnected, messages MessageRelay sends once the status says
            // Connected. PhoneHub drops what nobody collects, and a plain launch would only
            // subscribe once dispatched; UNDISPATCHED runs the collector up to its first
            // suspension, after the subscription is in place.
            forwarder =
                scope.launch(start = CoroutineStart.UNDISPATCHED) {
                    hub.outgoing.collect { events.send(LoopEvent.Outgoing(it)) }
                }
            state.value =
                LinkStatus.Connected(
                    endpoint = endpoint,
                    hudName = message.hudName,
                    hudVersion = message.hudVersion,
                    readMessagesAloud = message.readMessagesAloud,
                    hudId = verified.hudId,
                    authenticated = verified.authenticated,
                )
            hub.replay().forEach(::sendNow)
            onConnected(message)
            return null
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

        /** How long to wait for mDNS before restarting discovery. */
        const val DISCOVERY_RESTART_MS = 30_000L
    }
}
