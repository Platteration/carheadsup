package dev.carheadsup.protocol.link

/**
 * Where the HUD lives: a host (name, IPv4 or IPv6) and the port of its HTTP/WebSocket server.
 *
 * The WebSocket for the phone is `ws://host:port/ws/phone`, the REST API is under
 * `http://host:port/api/` and the settings app is served at `/settings`.
 */
public data class HudEndpoint(val host: String, val port: Int = DEFAULT_PORT) {
    init {
        require(host.isNotBlank()) { "host must not be blank" }
        require(port in 1..65535) { "port must be within 1..65535" }
    }

    private val authority: String
        get() = if (':' in host) "[$host]:$port" else "$host:$port"

    public val webSocketUrl: String get() = "ws://$authority$PHONE_SOCKET_PATH"
    public val httpBaseUrl: String get() = "http://$authority"
    public val settingsUrl: String get() = "$httpBaseUrl/settings"

    /** Absolute URL of an API path such as "/api/trips". */
    public fun apiUrl(path: String): String = httpBaseUrl + if (path.startsWith('/')) path else "/$path"

    /** "host:port" as a user would type it. */
    public fun display(): String = authority

    public companion object {
        public const val DEFAULT_PORT: Int = 8080
        public const val PHONE_SOCKET_PATH: String = "/ws/phone"

        /** mDNS / DNS-SD service type the HUD advertises. */
        public const val SERVICE_TYPE: String = "_carheadsup._tcp"

        private val HOST_NAME =
            Regex("^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\\.?$")
        private val IPV6 = Regex("^[0-9A-Fa-f:.]+(%[A-Za-z0-9._-]+)?$")

        /**
         * Parses a manually entered address: `host`, `host:port`, `[v6]:port`, a bare IPv6
         * address, optionally with an `http://`, `https://`, `ws://` scheme and a trailing path
         * (both ignored). Returns null when the text is not a usable address.
         */
        public fun parse(input: String): HudEndpoint? {
            var text = input.trim()
            if (text.isEmpty()) return null
            text = text.replace(Regex("^[A-Za-z][A-Za-z0-9+.-]*://"), "")
            text = text.substringBefore('/').substringBefore('?').substringBefore('#')
            if (text.isEmpty()) return null

            val host: String
            val portText: String?
            when {
                text.startsWith('[') -> {
                    val close = text.indexOf(']')
                    if (close < 0) return null
                    host = text.substring(1, close)
                    val rest = text.substring(close + 1)
                    portText =
                        when {
                            rest.isEmpty() -> null
                            rest.startsWith(':') -> rest.substring(1)
                            else -> return null
                        }
                    if (!IPV6.matches(host) || ':' !in host) return null
                }

                text.count { it == ':' } > 1 -> {
                    // Bare IPv6 address without a port.
                    if (!IPV6.matches(text)) return null
                    host = text
                    portText = null
                }

                else -> {
                    host = text.substringBefore(':')
                    portText = if (':' in text) text.substringAfter(':') else null
                    if (!HOST_NAME.matches(host)) return null
                }
            }
            val port =
                if (portText == null) {
                    DEFAULT_PORT
                } else {
                    portText.toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
                }
            return HudEndpoint(host.removeSuffix("."), port)
        }
    }
}
