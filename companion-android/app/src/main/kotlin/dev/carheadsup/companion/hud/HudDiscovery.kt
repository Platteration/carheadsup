package dev.carheadsup.companion.hud

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import dev.carheadsup.protocol.auth.PhoneAuth
import dev.carheadsup.protocol.link.HudEndpoint
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.Executors

/**
 * Finds the HUD with DNS-SD: it advertises `_carheadsup._tcp` (see `server.mdns`) with its id in
 * the TXT record `id`. The newest resolved address of a HUD that [accept]s (given that id, or
 * null when the advertisement has none) is published on [endpoint]; it becomes null when the
 * service disappears. Once the phone is paired, [accept] passes only the paired HUD (and HUDs
 * without an id, whose `challenge` is checked instead), so other HUDs are never contacted; an
 * advertisement without an id never replaces one with an accepted id.
 *
 * Resolution uses `registerServiceInfoCallback` on Android 14+ and `resolveService` before
 * (which allows only one resolution at a time, so services are resolved one after another).
 * NSD does not retry failed discoveries or resolutions itself; [HudLink] calls [restart] when
 * nothing has been found for a while.
 */
class HudDiscovery(context: Context, private val accept: (advertisedHudId: String?) -> Boolean = { true }) {
    private val nsd = context.getSystemService(NsdManager::class.java)
    private val executor = Executors.newSingleThreadExecutor()
    private val state = MutableStateFlow<HudEndpoint?>(null)
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private var infoCallback: Any? = null
    private var resolving = false
    private val resolveQueue = ArrayDeque<NsdServiceInfo>()
    private var currentServiceName: String? = null

    /** Whether the published service advertises an id (then one without cannot displace it). */
    private var currentHasId = false

    val endpoint: StateFlow<HudEndpoint?> = state.asStateFlow()

    @Synchronized
    fun start() {
        if (discoveryListener != null) return
        val listener =
            object : NsdManager.DiscoveryListener {
                override fun onDiscoveryStarted(serviceType: String) {
                    Log.d(TAG, "Discovery started for $serviceType")
                }

                override fun onServiceFound(serviceInfo: NsdServiceInfo) = resolve(serviceInfo)

                override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                    synchronized(this@HudDiscovery) {
                        if (serviceInfo.serviceName == currentServiceName) {
                            currentServiceName = null
                            currentHasId = false
                            state.value = null
                        }
                    }
                }

                override fun onDiscoveryStopped(serviceType: String) {
                    Log.d(TAG, "Discovery stopped")
                }

                override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                    Log.w(TAG, "Discovery failed to start: $errorCode")
                    synchronized(this@HudDiscovery) { discoveryListener = null }
                }

                override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                    Log.w(TAG, "Discovery failed to stop: $errorCode")
                }
            }
        discoveryListener = listener
        try {
            nsd.discoverServices(HudEndpoint.SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "Discovery could not start", e)
            discoveryListener = null
        }
    }

    /** Stops and starts discovery again, e.g. after a start or resolution failure. */
    @Synchronized
    fun restart() {
        stop()
        start()
    }

    @Synchronized
    fun stop() {
        discoveryListener?.let { listener ->
            try {
                nsd.stopServiceDiscovery(listener)
            } catch (e: IllegalArgumentException) {
                // Not running.
            }
        }
        discoveryListener = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) unregisterInfoCallback()
        resolveQueue.clear()
        resolving = false
        currentServiceName = null
        currentHasId = false
        state.value = null
    }

    private fun resolve(service: NsdServiceInfo) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            resolveWithCallback(service)
        } else {
            synchronized(this) {
                resolveQueue.addLast(service)
                if (!resolving) resolveNext()
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun resolveNext() {
        val next = resolveQueue.removeFirstOrNull() ?: return
        resolving = true
        nsd.resolveService(
            next,
            object : NsdManager.ResolveListener {
                override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                    publish(serviceInfo, serviceInfo.host?.let(::listOf).orEmpty())
                    synchronized(this@HudDiscovery) {
                        resolving = false
                        resolveNext()
                    }
                }

                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                    Log.w(TAG, "Resolving ${serviceInfo.serviceName} failed: $errorCode")
                    synchronized(this@HudDiscovery) {
                        resolving = false
                        resolveNext()
                    }
                }
            },
        )
    }

    @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private fun resolveWithCallback(service: NsdServiceInfo) {
        synchronized(this) { unregisterInfoCallback() }
        val callback =
            object : NsdManager.ServiceInfoCallback {
                override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
                    // Nothing to unregister; HudLink restarts discovery when nothing is found.
                    Log.w(TAG, "Service info callback failed: $errorCode")
                    synchronized(this@HudDiscovery) { if (infoCallback === this) infoCallback = null }
                }

                override fun onServiceUpdated(serviceInfo: NsdServiceInfo) {
                    publish(serviceInfo, serviceInfo.hostAddresses)
                }

                override fun onServiceLost() {
                    synchronized(this@HudDiscovery) {
                        if (service.serviceName == currentServiceName) {
                            currentServiceName = null
                            currentHasId = false
                            state.value = null
                        }
                    }
                }

                override fun onServiceInfoCallbackUnregistered() = Unit
            }
        try {
            nsd.registerServiceInfoCallback(service, executor, callback)
            synchronized(this) { infoCallback = callback }
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "Cannot resolve ${service.serviceName}", e)
        }
    }

    @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private fun unregisterInfoCallback() {
        val callback = infoCallback as? NsdManager.ServiceInfoCallback ?: return
        try {
            nsd.unregisterServiceInfoCallback(callback)
        } catch (e: IllegalArgumentException) {
            // Already unregistered.
        }
        infoCallback = null
    }

    private fun publish(serviceInfo: NsdServiceInfo, addresses: List<InetAddress>) {
        val serviceName = serviceInfo.serviceName
        val port = serviceInfo.port
        val advertisedId =
            serviceInfo.attributes[TXT_ID]?.toString(Charsets.UTF_8)?.takeIf(PhoneAuth::isValidId)
        if (!accept(advertisedId)) {
            Log.i(TAG, "Ignoring HUD \"$serviceName\" ($advertisedId): not the paired HUD")
            synchronized(this) {
                if (serviceName == currentServiceName) {
                    currentServiceName = null
                    currentHasId = false
                    state.value = null
                }
            }
            return
        }
        // Prefer IPv4: link-local IPv6 addresses need a scope id that URLs handle poorly.
        val address = addresses.firstOrNull { it is Inet4Address } ?: addresses.firstOrNull() ?: return
        val host = address.hostAddress ?: return
        if (port !in 1..65535) return
        synchronized(this) {
            if (advertisedId == null && currentHasId && serviceName != currentServiceName) {
                Log.i(TAG, "Keeping the HUD with an id over \"$serviceName\" (no id)")
                return
            }
            currentServiceName = serviceName
            currentHasId = advertisedId != null
            state.value = HudEndpoint(host.substringBefore('%'), port)
        }
        Log.i(TAG, "Found HUD \"$serviceName\" at $host:$port")
    }

    private companion object {
        const val TAG = "HudDiscovery"

        /** TXT record with the HUD's id (hud-server `discovery/mdns.ts`). */
        const val TXT_ID = "id"
    }
}
