package dev.carheadsup.protocol.phone

import dev.carheadsup.protocol.CallAction
import dev.carheadsup.protocol.CallState
import dev.carheadsup.protocol.PhoneCall

/** Android's aggregate telephony call state (`TelephonyManager.CALL_STATE_*`). */
public enum class TelephonyState {
    /** No call. */
    IDLE,

    /** A call is ringing, or waiting while another call is active. */
    RINGING,

    /** At least one call is dialing, active or on hold, and none is ringing. */
    OFFHOOK,
}

/** The kind of call a call notification describes (`Notification.CallStyle` call types). */
public enum class CallHintType {
    /** An incoming call that is ringing. */
    INCOMING,

    /** A call in progress. */
    ONGOING,

    /** Not said. */
    UNKNOWN,
}

/**
 * A caller's name from a call notification (a dialer's `CallStyle` notification — or any other
 * app's, such as a VoIP call). [number] is the notification person's `tel:` number, if any.
 */
public data class CallerHint(
    val name: String,
    val number: String? = null,
    val type: CallHintType = CallHintType.UNKNOWN,
)

/**
 * Turns Android's coarse telephony state changes into HUD `call` messages with stable ids.
 *
 * - IDLE → RINGING starts an incoming call (`ringing`); RINGING → OFFHOOK answers it (`active`).
 * - IDLE → OFFHOOK is an outgoing call. Android does not report when the far end picks up, so
 *   it is reported `active` from dialling on (never stuck at `dialing`).
 * - OFFHOOK → RINGING is a waiting call; it replaces the displayed call while it rings. When it
 *   stops ringing (RINGING → OFFHOOK) Android does not say whether it was answered or declined,
 *   so the call that continues is reported without a caller — unless the HUD answered or declined
 *   the waiting call itself ([noteHudAction]); a dialer's ongoing-call notification can name it.
 * - → IDLE ends the call (`ended`), after which the tracker is empty.
 * - A repeated state with a newly available number (Android reports RINGING twice when the app
 *   may read call logs) or a caller name resolved later updates the current call.
 * - Caller names from contacts ([onCallerIdentified]) are authoritative; names from call
 *   notifications ([onCallerHint]) are only taken when the notification plausibly describes the
 *   current call.
 *
 * Every method returns the message to send, or null when nothing changed. Thread-safe.
 */
public class CallStateTracker(private val newCallId: () -> String) {
    private enum class NameSource { NONE, HINT, CONTACTS }

    private class Tracked(val call: PhoneCall, val nameSource: NameSource)

    private var state = TelephonyState.IDLE
    private var current: PhoneCall? = null
    private var nameSource = NameSource.NONE

    /** The call that was active when the current (waiting) call started ringing. */
    private var held: Tracked? = null

    /** What the HUD did to the current call, when it did something that succeeded. */
    private var hudAction: CallAction? = null

    /** The current call's identity is unknown (a waiting call stopped ringing): ignore numbers. */
    private var identityUnknown = false

    /** The call currently shown (never an ended one). */
    @get:Synchronized
    public val currentCall: PhoneCall?
        get() = current

    @Synchronized
    public fun onTelephonyState(newState: TelephonyState, number: String? = null): PhoneCall? {
        val cleanNumber = number?.trim()?.ifEmpty { null }
        val previous = state
        state = newState
        val call = current
        return when (newState) {
            TelephonyState.IDLE -> {
                reset(null, NameSource.NONE)
                held = null
                call?.copy(state = CallState.ENDED)
            }

            TelephonyState.RINGING ->
                when {
                    previous == TelephonyState.RINGING && call != null -> updateNumber(call, cleanNumber)

                    else -> {
                        // A call that rings while another is in progress is a waiting call.
                        held = call?.takeIf { previous == TelephonyState.OFFHOOK }?.let { Tracked(it, nameSource) }
                        startCall(CallState.RINGING, cleanNumber)
                    }
                }

            TelephonyState.OFFHOOK ->
                when {
                    call == null -> startCall(CallState.ACTIVE, cleanNumber)
                    call.state == CallState.RINGING -> stoppedRinging(call)
                    else -> updateNumber(call, cleanNumber)
                }
        }
    }

    /** A ringing call stopped ringing and a call is in progress. */
    private fun stoppedRinging(call: PhoneCall): PhoneCall {
        val waitingFor = held
        held = null
        val answered = call.copy(state = CallState.ACTIVE)
        if (waitingFor == null) {
            // An ordinary incoming call was answered.
            current = answered
            hudAction = null
            return answered
        }
        return when (hudAction) {
            CallAction.ACCEPT -> {
                // The HUD answered the waiting call.
                current = answered
                hudAction = null
                answered
            }

            CallAction.DECLINE -> {
                // The HUD declined the waiting call: the other one goes on as before.
                reset(waitingFor.call, waitingFor.nameSource)
                waitingFor.call
            }

            null -> {
                // Declined, given up or answered on the phone: Android reports all of these alike.
                // Show the call that goes on without anybody's name rather than a wrong one.
                val unknown = PhoneCall(waitingFor.call.id, CallState.ACTIVE, callerName = null, number = null)
                reset(unknown, NameSource.NONE)
                identityUnknown = true
                unknown
            }
        }
    }

    /** A caller name from contacts for the current call; it replaces any name from a notification. */
    @Synchronized
    public fun onCallerIdentified(name: String?, number: String? = null): PhoneCall? {
        val call = current ?: return null
        val cleanName = name?.trim()?.ifEmpty { null }
        val updated =
            call.copy(
                callerName = cleanName ?: call.callerName,
                number = call.number ?: number?.trim()?.ifEmpty { null },
            )
        if (cleanName != null) nameSource = NameSource.CONTACTS
        if (updated == call) return null
        current = updated
        return updated
    }

    /**
     * A caller name from a call notification. It is taken only for the call it describes: its
     * number matches the current call's, or (without numbers to compare) its type matches the
     * call's state — an incoming-call notification while ringing, an ongoing-call notification
     * while in a call — and the call has no name yet. Never replaces a name from contacts.
     */
    @Synchronized
    public fun onCallerHint(hint: CallerHint): PhoneCall? {
        val call = current ?: return null
        if (nameSource == NameSource.CONTACTS) return null
        val name = hint.name.trim().ifEmpty { null } ?: return null
        val hintDigits = hint.number?.let(::digits)?.ifEmpty { null }
        val callDigits = call.number?.let(::digits)?.ifEmpty { null }
        val numbersCompared = hintDigits != null && callDigits != null && !identityUnknown
        if (numbersCompared && !sameNumber(hintDigits, callDigits)) return null
        if (!numbersCompared) {
            val typeFits =
                when (hint.type) {
                    CallHintType.INCOMING -> call.state == CallState.RINGING
                    CallHintType.ONGOING -> call.state == CallState.ACTIVE || call.state == CallState.HELD
                    CallHintType.UNKNOWN -> false
                }
            if (!typeFits || call.callerName != null) return null
        }
        val updated = call.copy(callerName = name)
        nameSource = NameSource.HINT
        if (updated == call) return null
        current = updated
        return updated
    }

    /**
     * The HUD's [action] on [callId] is being carried out; call before asking Telecom, and again
     * with a null action if that failed. It tells an answered waiting call from a declined one.
     */
    @Synchronized
    public fun noteHudAction(callId: String, action: CallAction?) {
        if (current?.id == callId) hudAction = action
    }

    /** Whether the HUD's [action] on [callId] applies to the current call. */
    @Synchronized
    public fun accepts(callId: String, action: CallAction): Boolean {
        val call = current ?: return false
        if (call.id != callId) return false
        return when (action) {
            CallAction.ACCEPT -> call.state == CallState.RINGING
            CallAction.DECLINE -> call.state != CallState.ENDED
        }
    }

    private fun startCall(state: CallState, number: String?): PhoneCall =
        PhoneCall(newCallId(), state, callerName = null, number = number).also { reset(it, NameSource.NONE) }

    private fun reset(call: PhoneCall?, source: NameSource) {
        current = call
        nameSource = source
        hudAction = null
        identityUnknown = false
    }

    private fun updateNumber(call: PhoneCall, number: String?): PhoneCall? {
        if (identityUnknown || number == null || number == call.number) return null
        return call.copy(number = number).also { current = it }
    }

    private companion object {
        /** Trailing digits compared when two numbers are written differently (+49 170 … vs 0170 …). */
        const val SIGNIFICANT_DIGITS = 9
        const val MIN_COMPARABLE_DIGITS = 7

        fun digits(number: String): String = number.filter { it in '0'..'9' }

        fun sameNumber(a: String, b: String): Boolean {
            if (a == b) return true
            val n = minOf(a.length, b.length, SIGNIFICANT_DIGITS)
            return n >= MIN_COMPARABLE_DIGITS && a.takeLast(n) == b.takeLast(n)
        }
    }
}
