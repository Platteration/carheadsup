package dev.carheadsup.companion.hud

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import dev.carheadsup.protocol.link.HudEndpoint
import okhttp3.Dns
import okhttp3.OkHttpClient
import java.io.IOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.UnknownHostException
import javax.net.SocketFactory

/**
 * Tracks the Wi-Fi network the HUD is on.
 *
 * The HUD usually runs its own access point without internet. Android then keeps mobile data as
 * the default network, and sockets opened without a network binding go out over mobile data,
 * where the HUD's private address is unreachable. Connections to the HUD are therefore bound to
 * the Wi-Fi network explicitly ([bind]); internet traffic (Overpass) keeps the default network.
 */
class LocalNetwork(context: Context) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val wifiNetworks = LinkedHashSet<Network>()
    private var registered = false

    private val callback =
        object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                synchronized(wifiNetworks) { wifiNetworks += network }
            }

            override fun onLost(network: Network) {
                synchronized(wifiNetworks) { wifiNetworks -= network }
            }
        }

    /** The most recently connected Wi-Fi network (with or without internet), if any. */
    val wifi: Network?
        get() = synchronized(wifiNetworks) { wifiNetworks.lastOrNull() }

    fun start() {
        if (registered) return
        val request =
            NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                // Match access points without internet access too (the default request requires it).
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
        try {
            connectivity.registerNetworkCallback(request, callback)
            registered = true
        } catch (e: RuntimeException) {
            // SecurityException / TooManyRequestsException: fall back to default routing.
            registered = false
        }
    }

    fun stop() {
        if (!registered) return
        try {
            connectivity.unregisterNetworkCallback(callback)
        } catch (e: IllegalArgumentException) {
            // Already unregistered.
        }
        registered = false
        synchronized(wifiNetworks) { wifiNetworks.clear() }
    }

    /**
     * Routes the whole process over the Wi-Fi network (for components that cannot be bound per
     * socket, such as the settings WebView). Undo with [unbindProcess]. Unbound internet requests
     * would fail meanwhile when the Wi-Fi has no internet; clients made with
     * [bindToDefaultNetwork] are not affected.
     */
    fun bindProcess(): Boolean {
        val network = wifi ?: return false
        return connectivity.bindProcessToNetwork(network)
    }

    fun unbindProcess() {
        connectivity.bindProcessToNetwork(null)
    }

    /**
     * Whether a TCP connection to [endpoint] opens within [timeoutMs], over the Wi-Fi network
     * when there is one (else the default network). Blocking: call it off the main thread. Only
     * opens and closes the connection — nothing is sent.
     */
    fun canConnect(endpoint: HudEndpoint, timeoutMs: Int): Boolean {
        val network = wifi
        return try {
            val addresses = network?.getAllByName(endpoint.host) ?: InetAddress.getAllByName(endpoint.host)
            val address = addresses.firstOrNull { it is Inet4Address } ?: addresses.firstOrNull() ?: return false
            (network?.socketFactory ?: SocketFactory.getDefault()).createSocket().use { socket ->
                socket.connect(InetSocketAddress(address, endpoint.port), timeoutMs)
                true
            }
        } catch (e: IOException) {
            false
        }
    }

    /** [client] with sockets and DNS bound to the Wi-Fi network, or unchanged without Wi-Fi. */
    fun bind(client: OkHttpClient): OkHttpClient {
        val network = wifi ?: return client
        return client
            .newBuilder()
            .socketFactory(network.socketFactory)
            .dns(NetworkDns(network))
            .build()
    }

    /**
     * [client] with sockets and DNS on the system's default network, looked up at each connect,
     * whatever the process is bound to: while the settings page binds the process to the HUD's
     * Wi-Fi (usually without internet), Overpass downloads must not follow it — they would fail
     * and push the Overpass backoff up to its maximum.
     */
    fun bindToDefaultNetwork(client: OkHttpClient): OkHttpClient =
        client.newBuilder()
            .socketFactory(DefaultNetworkSocketFactory())
            .dns(DefaultNetworkDns())
            .build()

    private inner class DefaultNetworkSocketFactory : SocketFactory() {
        private fun factory(): SocketFactory = connectivity.activeNetwork?.socketFactory ?: SocketFactory.getDefault()

        override fun createSocket(): Socket = factory().createSocket()

        override fun createSocket(host: String?, port: Int): Socket = factory().createSocket(host, port)

        override fun createSocket(host: String?, port: Int, localHost: InetAddress?, localPort: Int): Socket =
            factory().createSocket(host, port, localHost, localPort)

        override fun createSocket(host: InetAddress?, port: Int): Socket = factory().createSocket(host, port)

        override fun createSocket(
            address: InetAddress?,
            port: Int,
            localAddress: InetAddress?,
            localPort: Int,
        ): Socket = factory().createSocket(address, port, localAddress, localPort)
    }

    private inner class DefaultNetworkDns : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            val network = connectivity.activeNetwork ?: return Dns.SYSTEM.lookup(hostname)
            return network.getAllByName(hostname).toList()
        }
    }

    private class NetworkDns(private val network: Network) : Dns {
        override fun lookup(hostname: String): List<InetAddress> = try {
            network.getAllByName(hostname).toList()
        } catch (e: UnknownHostException) {
            Dns.SYSTEM.lookup(hostname)
        }
    }
}
