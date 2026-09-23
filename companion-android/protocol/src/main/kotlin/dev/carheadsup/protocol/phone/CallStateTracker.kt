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

/**
 * Turns Android's coarse telephony state changes into HUD `call` messages with stable ids.
 *
 * - IDLE → RINGING starts an incoming call (`ringing`); RINGING → OFFHOOK answers it (`active`).
 * - IDLE → OFFHOOK is an outgoing call. Android does not report when the far end picks up, so
 *   it is reported `active` from dialling on (never stuck at `dialing`).
 * - OFFHOOK → RINGING is a waiting call; it replaces the displayed call.
 * - → IDLE ends the call (`ended`), after which the tracker is empty.
 * - A repeated state with a newly available number (Android reports RINGING twice when the app
 *   may read call logs) or a caller name resolved later updates the current call.
 *
 * Every method returns the message to send, or null when nothing changed. Thread-safe.
 */
public class CallStateTracker(private val newCallId: () -> String) {
    private var state = TelephonyState.IDLE
    private var current: PhoneCall? = null

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
                current = null
                call?.copy(state = CallState.ENDED)
            }

            TelephonyState.RINGING ->
                if (previous == TelephonyState.RINGING && call != null) {
                    updateNumber(call, cleanNumber)
                } else {
                    startCall(CallState.RINGING, cleanNumber)
                }

            TelephonyState.OFFHOOK ->
                when {
                    call == null -> startCall(CallState.ACTIVE, cleanNumber)
                    call.state == CallState.RINGING -> call.copy(state = CallState.ACTIVE).also { current = it }
                    else -> updateNumber(call, cleanNumber)
                }
        }
    }

    /** A caller name (from contacts or the dialer's notification) for the current call. */
    @Synchronized
    public fun onCallerIdentified(name: String?, number: String? = null): PhoneCall? {
        val call = current ?: return null
        val cleanName = name?.trim()?.ifEmpty { null }
        val updated =
            call.copy(
                callerName = cleanName ?: call.callerName,
                number = call.number ?: number?.trim()?.ifEmpty { null },
            )
        if (updated == call) return null
        current = updated
        return updated
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
        PhoneCall(newCallId(), state, callerName = null, number = number).also { current = it }

    private fun updateNumber(call: PhoneCall, number: String?): PhoneCall? {
        if (number == null || number == call.number) return null
        return call.copy(number = number).also { current = it }
    }
}
