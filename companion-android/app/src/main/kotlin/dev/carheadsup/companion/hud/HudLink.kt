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
import dev.carheadsup.protocol.link.HudAdvertisement
import dev.carheadsup.protocol.link.HudEndpoint
import dev.carheadsup.protocol.link.HudRoute
import dev.carheadsup.protocol.link.MessageRateLimiter
import dev.carheadsup.protocol.link.PhoneCloseCode
import dev.carheadsup.protocol.link.ReconnectBackoff
import dev.carheadsup.protocol.tls.HudTrustManager
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
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
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
     * HUD the user confirmed, which nothing proves ([authenticated] false). [certFingerprint] is
     * its TLS certificate (pinned).
     */
    data class Connected(
        val endpoint: HudEndpoint,
        val hudName: String,
        val hudVersion: String,
        val readMessagesAloud: Boolean,
        val hudId: String,
        val authenticated: Boolean,
        val certFingerprint: String,
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
     * the paired one, a HUD without pairing token the user has not confirmed, a HUD that could
     * not prove the token, or another TLS certificate than the pinned (or advertised) one. The
     * next attempt starts at [retryAtElapsedMs]; null for a changed certificate, a hard stop:
     * nothing is tried until the user re-pairs (or asks to retry).
     */
    data class Untrusted(val endpoint: HudEndpoint, val problem: TrustProblem, val retryAtElapsedMs: Long?) : LinkStatus
}

/**
 * A HUD that proved itself on the phone link (or, without a pairing token, the HUD the user
 * confirmed): where it is and the TLS certificate it proved itself with, which REST calls and
 * the settings page pin.
 */
data class TrustedHud(val endpoint: HudEndpoint, val certFingerprint: String)

/**
 * The phone side of `wss://<hud>:<tls port>/ws/phone` (protocol v3):
 * - resolves the HUD (manual address or mDNS; once paired, discovery skips HUDs advertising
 *   another id), connects over the HUD's Wi-Fi with TLS, trusting exactly the pinned certificate
 *   ([HudTrustManager]; on a first pairing the one presented, or the advertised one) — any
 *   other certificate for a paired HUD is a hard stop ([TrustProblem.CertificateChanged]) — and
 *   answers its `challenge` through [HudHandshake], binding the proofs to that certificate:
 *   nothing at all goes to a HUD other than the paired one, or — without a pairing token — to a
 *   HUD the user has not confirmed ([LinkStatus.Untrusted]);
 * - checks the proof in `welcome` before anything else: only a verified HUD is reported
 *   [LinkStatus.Connected], gets the phone's data, and has its messages (call actions …) acted
 *   on; the first verified HUD is pinned with its certificate ([onPinned]) and becomes
 *   [trusted], the only HUD REST calls and the settings page may use;
 * - after that, replays the latest nav/road/hazards/media/call state from [PhoneHub] and
 *   forwards everything published there, rate-limited per message type (nav ≤ 4 Hz, location 1 Hz);
 * - pings every 5 s and tears the socket down when the HUD stays silent for 15 s (a vanished
 *   Wi-Fi never delivers a TCP close); the hello and every ping carry the phone's clock, which a
 *   HUD without network time sets its own by;
 * - reconnects with exponential backoff; a refused or untrusted pairing, or a session a newer one
 *   of this phone replaced (close 4000), waits the maximum delay; while another phone holds the
 *   HUD it is refused with close 1013 ("another phone is connected") and backs off as usual;
 * - tries again at once when a Wi-Fi network comes or goes ([LocalNetwork.generation]) — the
 *   car's Wi-Fi usually comes up after the phone gave up on it — and, with no network to reach
 *   the HUD over ([HudRoute.NONE]: no Wi-Fi, no hotspot of its own), waits for one instead of
 *   dialling the HUD's private address over mobile data;
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
     * with the current connection settings, and its certificate: the only HUD REST calls and the
     * settings page may use, since they carry the API token. Kept across disconnects (the remote
     * buttons fall back to REST), dropped when the settings change or another HUD (or
     * certificate) answers there.
     */
    @Volatile
    var trusted: TrustedHud? = null
        private set

    @Synchronized
    fun start() {
        if (job?.isActive == true) return
        job =
            scope.launch {
                launch {
                    localNetwork.generation.drop(1).collect {
                        val current = state.value
                        // Not after a hard stop (a changed certificate): that waits for the user.
                        val hardStop = current is LinkStatus.Untrusted && current.retryAtElapsedMs == null
                        if (current !is LinkStatus.Connected && !hardStop) reconnectNow()
                    }
                }
                settings
                    .map { it.connectionKey }
                    .distinctUntilChanged()
                    .collectLatest {
                        backoff.reset()
                        trusted = null
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
            val target = resolveTarget()
            val endpoint = target.endpoint
            val network = localNetwork.generation.value
            if (localNetwork.route(endpoint) == HudRoute.NONE) {
                awaitNetwork(endpoint, network)
                continue
            }
            state.value = LinkStatus.Connecting(endpoint)
            val outcome =
                try {
                    runSession(target)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: RuntimeException) {
                    Log.e(TAG, "Session crashed", e)
                    SessionOutcome.Closed("internal error: ${e.message}")
                }
            if (outcome is SessionOutcome.Untrusted && endpoint == trusted?.endpoint) trusted = null
            // Another certificate for the paired HUD: stop until the user re-pairs or retries.
            val hardStop = outcome is SessionOutcome.Untrusted && outcome.problem is TrustProblem.CertificateChanged
            val backoffMs =
                when (outcome) {
                    is SessionOutcome.Refused, is SessionOutcome.Untrusted -> backoff.refusedDelayMs()
                    is SessionOutcome.Closed -> backoff.delayAfterClose(outcome.code)
                }
            // The Wi-Fi changed while this attempt ran on the old one: try the new one soon.
            val networkChanged = localNetwork.generation.value != network
            val delayMs =
                if (networkChanged && outcome is SessionOutcome.Closed) {
                    minOf(backoffMs, NETWORK_RETRY_MS)
                } else {
                    backoffMs
                }
            val retryAt = SystemClock.elapsedRealtime() + delayMs
            state.value =
                when (outcome) {
                    is SessionOutcome.Refused -> LinkStatus.Refused(endpoint, outcome.code, outcome.message, retryAt)

                    is SessionOutcome.Untrusted ->
                        LinkStatus.Untrusted(endpoint, outcome.problem, if (hardStop) null else retryAt)

                    is SessionOutcome.Closed -> LinkStatus.Waiting(endpoint, outcome.reason, retryAt)
                }
            // Drain a stale wake-up, then wait for the delay (none after a hard stop) or an
            // explicit "reconnect now" (also sent when the paired HUD is forgotten).
            wakeUp.tryReceive()
            if (hardStop) {
                Log.w(TAG, "The HUD's certificate changed; not reconnecting until it is paired again")
                wakeUp.receive()
            } else {
                withTimeoutOrNull(delayMs) { wakeUp.receive() }
            }
        }
    }

    /**
     * Nothing local reaches the HUD (see [HudRoute.NONE]): wait until a Wi-Fi network comes or
     * goes after [network], a "reconnect now", or [NETWORK_POLL_MS] — the phone's own hotspot
     * switched on brings no callback. No backoff: nothing was tried.
     */
    private suspend fun awaitNetwork(endpoint: HudEndpoint, network: Long) {
        state.value = LinkStatus.Waiting(endpoint, NO_NETWORK_REASON, SystemClock.elapsedRealtime() + NETWORK_POLL_MS)
        wakeUp.tryReceive()
        withTimeoutOrNull(NETWORK_POLL_MS) {
            merge(
                localNetwork.generation.filter { it != network }.map { },
                wakeUp.receiveAsFlow(),
            ).first()
        }
    }

    /** The configured manual endpoint, or the first HUD mDNS finds (with what it advertises). */
    private suspend fun resolveTarget(): HudAdvertisement {
        val current = settings.value
        if (!current.useDiscovery) {
            discovery.stop()
            current.manualEndpoint?.let { return HudAdvertisement(it, hudId = null, certFingerprint = null) }
            state.value = LinkStatus.Searching
            // An invalid manual address: wait for the settings to change (collectLatest restarts us).
            val endpoint = settings.map { it.manualEndpoint }.filterNotNull().first()
            return HudAdvertisement(endpoint, hudId = null, certFingerprint = null)
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
            discovery.advertisement.value?.let { return it }
            state.value = LinkStatus.Searching
            // Drain a stale wake-up, then wait for the HUD, a "reconnect now" or the timeout.
            wakeUp.tryReceive()
            val found =
                withTimeoutOrNull(DISCOVERY_RESTART_MS) {
                    merge(discovery.advertisement.filterNotNull(), wakeUp.receiveAsFlow().map { null }).first()
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
     * this coroutine. The TLS connection trusts through a trust manager of its own, which records
     * the certificate the handshake binds (and why one was refused).
     */
    private suspend fun runSession(target: HudAdvertisement): SessionOutcome = coroutineScope {
        val endpoint = target.endpoint
        val current = settings.value
        val pinnedCertificate = HudPin.active(current.hudPin, current.pairingToken)?.certFingerprint
        val trust =
            HudTrustManager(pinnedFingerprint = pinnedCertificate, advertisedFingerprint = target.certFingerprint)
        val events = Channel<LoopEvent>(Channel.UNLIMITED)
        val socket = localNetwork.bind(baseClient).withHudTrust(trust).newWebSocket(
            Request.Builder().url(endpoint.webSocketUrl).build(),
            SocketListener(events),
        )
        val session = Session(this, endpoint, socket, events, trust, current.pairingToken, current.hudPin)
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
        private val trust: HudTrustManager,
        private val pairingToken: String,
        private val pin: HudPin?,
    ) {
        private val limiter = MessageRateLimiter()
        private val heartbeat = Heartbeat(intervalMs = PING_INTERVAL_MS, timeoutMs = SILENCE_TIMEOUT_MS)
        private val openedAt = SystemClock.elapsedRealtime()

        /** Made once the TLS connection is open: its proofs are bound to the certificate it presented. */
        private var handshake: HudHandshake? = null

        /** Set once the HUD's `welcome` checked out; nothing is sent or acted on before. */
        private var welcome: HudWelcome? = null
        private var forwarder: Job? = null

        suspend fun handle(event: LoopEvent, now: Long): SessionOutcome? = when (event) {
            // The HUD speaks first (`challenge`); a token it cannot hold can never match.
            LoopEvent.Opened -> onOpened()

            is LoopEvent.Frame -> onFrame(event.text, now)

            is LoopEvent.Outgoing -> {
                if (welcome != null) sendLimited(event.message, now)
                null
            }

            LoopEvent.Tick -> onTick(now)

            // A refused certificate fails the connection: report why.
            is LoopEvent.Closed ->
                trust.rejection?.let { SessionOutcome.Untrusted(it) } ?: SessionOutcome.Closed(event.reason, event.code)
        }

        private fun onOpened(): SessionOutcome? {
            if (!PhoneAuth.isValidToken(pairingToken)) {
                return SessionOutcome.Refused(HudErrorCode.BAD_TOKEN, "pairing token is too long")
            }
            val certificate = trust.acceptedFingerprint ?: return SessionOutcome.Closed("no TLS certificate")
            handshake =
                HudHandshake(
                    pairingToken = pairingToken,
                    deviceId = deviceId,
                    device = deviceName,
                    appVersion = appVersion,
                    pin = pin,
                    certFingerprint = certificate,
                )
            return null
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

        private fun onChallenge(message: HudChallenge): SessionOutcome? {
            val handshake = handshake ?: return SessionOutcome.Closed("challenge before the connection was open")
            return when (val result = handshake.onChallenge(message)) {
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
        }

        private suspend fun onWelcome(message: HudWelcome, now: Long): SessionOutcome? {
            val handshake =
                handshake ?: return SessionOutcome.Untrusted(TrustProblem.ProtocolViolation("welcome before hello"))
            val certificate = trust.acceptedFingerprint ?: return SessionOutcome.Closed("no TLS certificate")
            val verified =
                when (val result = handshake.onWelcome(message)) {
                    is HudHandshake.WelcomeResult.Refuse -> {
                        Log.w(TAG, "The HUD at ${endpoint.display()} failed verification: ${result.problem}")
                        return SessionOutcome.Untrusted(result.problem)
                    }

                    is HudHandshake.WelcomeResult.Verified -> result
                }
            verified.newPin?.let(onPinned)
            trusted = TrustedHud(endpoint, certificate)
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
                    certFingerprint = certificate,
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
            // With the phone's clock: a HUD without network time takes its time from it.
            heartbeat.onTick(now, System.currentTimeMillis())?.let(::sendNow)
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

        /** Without a network to reach the HUD over, how often to look again (a hotspot has no callback). */
        const val NETWORK_POLL_MS = 30_000L

        /** The retry after an attempt that failed on a Wi-Fi network that has since changed. */
        const val NETWORK_RETRY_MS = 500L

        const val NO_NETWORK_REASON = "no Wi-Fi to reach the HUD over"
    }
}
