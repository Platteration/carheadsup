// PhoneStateListener, EXTRA_INCOMING_NUMBER, acceptRingingCall() and endCall() are deprecated, but
// they are the only public APIs for these tasks short of becoming the default dialer app.
@file:Suppress("DEPRECATION")

package dev.carheadsup.companion.calls

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.ContactsContract
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import dev.carheadsup.protocol.CallAction
import dev.carheadsup.protocol.HudCallAction
import dev.carheadsup.protocol.PhoneCall
import dev.carheadsup.protocol.phone.CallStateTracker
import dev.carheadsup.protocol.phone.TelephonyState
import java.util.UUID
import java.util.concurrent.Executors

/** Why a HUD call action could not be carried out. */
enum class CallActionFailure { NO_PERMISSION, UNSUPPORTED, NOT_APPLICABLE, REFUSED }

/**
 * Phone calls ⇄ HUD:
 * - call state from `TelephonyCallback` (Android 12+) or `PhoneStateListener`, plus the
 *   `PHONE_STATE` broadcast which carries the caller's number (needs READ_CALL_LOG);
 * - the number is resolved to a contact name (READ_CONTACTS); a dialer's CallStyle notification
 *   can supply the name too ([onCallerHint]);
 * - `call-action` from the HUD: accept → `TelecomManager.acceptRingingCall()`, decline →
 *   `TelecomManager.endCall()` (ANSWER_PHONE_CALLS; ending calls needs Android 9+).
 *
 * The state machine lives in [CallStateTracker]; this class only adapts Android's APIs.
 */
class CallMonitor(context: Context, private val publish: (PhoneCall) -> Unit) {
    private val appContext = context.applicationContext
    private val telephony: TelephonyManager? = appContext.getSystemService(TelephonyManager::class.java)
    private val telecom: TelecomManager? = appContext.getSystemService(TelecomManager::class.java)
    private val tracker = CallStateTracker { "call-" + UUID.randomUUID().toString().take(8) }
    private val executor = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "call-monitor") }
    private var callback: Any? = null
    private var receiverRegistered = false

    private val receiver =
        object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
                val state =
                    when (intent.getStringExtra(TelephonyManager.EXTRA_STATE)) {
                        TelephonyManager.EXTRA_STATE_RINGING -> TelephonyState.RINGING
                        TelephonyManager.EXTRA_STATE_OFFHOOK -> TelephonyState.OFFHOOK
                        TelephonyManager.EXTRA_STATE_IDLE -> TelephonyState.IDLE
                        else -> return
                    }
                val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
                executor.execute { onState(state, number) }
            }
        }

    @Synchronized
    fun start(): Boolean {
        if (callback != null || receiverRegistered) return true
        if (!granted(Manifest.permission.READ_PHONE_STATE) || telephony == null) return false
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                registerTelephonyCallback(telephony)
            } else {
                registerPhoneStateListener(telephony)
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "Cannot watch call state", e)
            return false
        }
        ContextCompat.registerReceiver(
            appContext,
            receiver,
            IntentFilter(TelephonyManager.ACTION_PHONE_STATE_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        receiverRegistered = true
        return true
    }

    @Synchronized
    fun stop() {
        val registered = callback
        if (registered != null && telephony != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                telephony.unregisterTelephonyCallback(registered as TelephonyCallback)
            } else {
                telephony.listen(registered as PhoneStateListener, PhoneStateListener.LISTEN_NONE)
            }
        }
        callback = null
        if (receiverRegistered) {
            appContext.unregisterReceiver(receiver)
            receiverRegistered = false
        }
    }

    /** A caller name from the dialer's notification. */
    fun onCallerHint(name: String) {
        executor.execute { tracker.onCallerIdentified(name)?.let(publish) }
    }

    /**
     * Carries out the HUD's accept/decline; returns null on success. Only applies to the call the
     * HUD is showing (a stale action for an earlier call is ignored).
     */
    @SuppressLint("MissingPermission")
    fun handleAction(action: HudCallAction): CallActionFailure? {
        if (!tracker.accepts(action.callId, action.action)) return CallActionFailure.NOT_APPLICABLE
        val manager = telecom ?: return CallActionFailure.UNSUPPORTED
        if (!granted(Manifest.permission.ANSWER_PHONE_CALLS)) return CallActionFailure.NO_PERMISSION
        return try {
            when (action.action) {
                CallAction.ACCEPT -> {
                    manager.acceptRingingCall()
                    null
                }

                CallAction.DECLINE ->
                    when {
                        Build.VERSION.SDK_INT < Build.VERSION_CODES.P -> CallActionFailure.UNSUPPORTED
                        manager.endCall() -> null
                        else -> CallActionFailure.REFUSED
                    }
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "Call action refused", e)
            CallActionFailure.NO_PERMISSION
        }
    }

    private fun onState(state: TelephonyState, number: String?) {
        val update = tracker.onTelephonyState(state, number) ?: return
        publish(update)
        val lookupNumber = update.number
        if (update.callerName == null && lookupNumber != null) {
            contactName(lookupNumber)?.let { name -> tracker.onCallerIdentified(name)?.let(publish) }
        }
    }

    /** Display name of the contact with [number], or null (unknown, or no READ_CONTACTS). */
    private fun contactName(number: String): String? {
        if (!granted(Manifest.permission.READ_CONTACTS)) return null
        val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
        return try {
            appContext.contentResolver
                .query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)
                ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
        } catch (e: SecurityException) {
            null
        } catch (e: IllegalArgumentException) {
            null
        }
    }

    @RequiresApi(Build.VERSION_CODES.S)
    @SuppressLint("MissingPermission")
    private fun registerTelephonyCallback(manager: TelephonyManager) {
        val listener =
            object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                override fun onCallStateChanged(state: Int) {
                    // The number arrives with the PHONE_STATE broadcast.
                    onState(telephonyState(state), null)
                }
            }
        manager.registerTelephonyCallback(executor, listener)
        callback = listener
    }

    @SuppressLint("MissingPermission")
    private fun registerPhoneStateListener(manager: TelephonyManager) {
        val listener =
            // Callbacks arrive on the calling thread's looper (start() runs on the main thread).
            object : PhoneStateListener() {
                @Deprecated("Deprecated in Java")
                override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                    executor.execute { onState(telephonyState(state), phoneNumber?.ifEmpty { null }) }
                }
            }
        manager.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
        callback = listener
    }

    private fun telephonyState(state: Int): TelephonyState = when (state) {
        TelephonyManager.CALL_STATE_RINGING -> TelephonyState.RINGING
        TelephonyManager.CALL_STATE_OFFHOOK -> TelephonyState.OFFHOOK
        else -> TelephonyState.IDLE
    }

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(appContext, permission) == PackageManager.PERMISSION_GRANTED

    private companion object {
        const val TAG = "CallMonitor"
    }
}
