package dev.carheadsup.protocol.link

/** How the phone can reach the HUD (see [HudRoute.choose]). */
public enum class HudRoute {
    /** Over the Wi-Fi network the phone is on: connections are bound to it. */
    WIFI,

    /**
     * Over a local network that is not the default one — the phone's own hotspot that the HUD
     * joined, USB tethering, Ethernet: unbound connections reach it through its local route.
     */
    LOCAL,

    /**
     * Nothing local: a connection would go out over mobile data to the HUD's private address,
     * where it can never arrive, and keep the radio awake. Wait for a network instead.
     */
    NONE,
    ;

    public companion object {
        /**
         * The route to the HUD at [host]: [WIFI] when the phone is on a Wi-Fi network
         * ([onWifi]); otherwise [LOCAL] when one of the phone's IPv4 [interfaces] — not the
         * default network's ([defaultInterface], mobile data), with a private address — has [host]
         * in its subnet (or exists at all, for a host name that cannot be checked); else [NONE].
         */
        public fun choose(
            host: String,
            onWifi: Boolean,
            interfaces: List<InterfaceAddress>,
            defaultInterface: String?,
        ): HudRoute {
            if (onWifi) return WIFI
            val local = interfaces.filter { it.name != defaultInterface && isPrivate(it.address) }
            if (local.isEmpty()) return NONE
            val target = parseIpv4(host) ?: return LOCAL
            return if (local.any { it.contains(target) }) LOCAL else NONE
        }

        /** `a.b.c.d` as a 32-bit number, or null when [text] is not a dotted-quad IPv4 address. */
        public fun parseIpv4(text: String): Int? {
            val parts = text.split('.')
            if (parts.size != 4) return null
            var value = 0
            for (part in parts) {
                if (part.isEmpty() || part.length > 3 || !part.all { it in '0'..'9' }) return null
                val octet = part.toInt()
                if (octet > 255) return null
                value = (value shl 8) or octet
            }
            return value
        }

        /** 10/8, 172.16/12 or 192.168/16 (RFC 1918): where a HUD's own network lives. */
        private fun isPrivate(address: Int): Boolean {
            val a = address ushr 24
            val b = (address ushr 16) and 0xff
            return a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168)
        }
    }
}

/** An IPv4 address of one of the phone's network interfaces, with its prefix length. */
public data class InterfaceAddress(val name: String, val address: Int, val prefixLength: Int) {
    /** Whether [target] lies in this address's subnet. */
    public fun contains(target: Int): Boolean {
        if (prefixLength !in 1..32) return false
        val mask = if (prefixLength == 32) -1 else ((1 shl prefixLength) - 1) shl (32 - prefixLength)
        return (address and mask) == (target and mask)
    }

    public companion object {
        /** From the raw bytes of an `Inet4Address`; null for anything that is not 4 bytes. */
        public fun of(name: String, bytes: ByteArray, prefixLength: Int): InterfaceAddress? {
            if (bytes.size != 4) return null
            val address = bytes.fold(0) { acc, byte -> (acc shl 8) or (byte.toInt() and 0xff) }
            return InterfaceAddress(name, address, prefixLength)
        }
    }
}
