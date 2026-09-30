package dev.carheadsup.protocol.link

/**
 * Where the HUD lives: a host (name, IPv4 or IPv6) and the port of its TLS listener
 * (`server.tlsPort`, 8443 by default).
 *
 * The WebSocket for the phone is `wss://host:port/ws/phone`, the REST API is under
 * `https://host:port/api/` and the settings app is served at `/settings` — all with the HUD's
 * self-signed certificate, which the phone pins (see [dev.carheadsup.protocol.tls]).
 */
public data class HudEndpoint(val host: String, val port: Int = DEFAULT_PORT) {
    init {
        require(host.isNotBlank()) { "host must not be blank" }
        require(port in 1..65535) { "port must be within 1..65535" }
    }

    private val authority: String
        get() = if (':' in host) "[$host]:$port" else "$host:$port"

    public val webSocketUrl: String get() = "wss://$authority$PHONE_SOCKET_PATH"
    public val httpBaseUrl: String get() = "https://$authority"
    public val settingsUrl: String get() = "$httpBaseUrl/settings"

    /**
     * The settings app's address, handing it the HUD's API token when one is set (see
     * [withApiToken]): the page makes its own API calls, and a WebView cannot add the
     * `Authorization` header to them.
     */
    public fun settingsUrl(apiToken: String): String = withApiToken(settingsUrl, apiToken)

    /** Absolute URL of an API path such as "/api/trips". */
    public fun apiUrl(path: String): String = httpBaseUrl + if (path.startsWith('/')) path else "/$path"

    /** "host:port" as a user would type it. */
    public fun display(): String = authority

    public companion object {
        /**
         * `url` with the API token as its `token` query parameter, which the HUD's pages adopt
         * (stored on the device, then removed from the address bar). Surrounding whitespace is
         * not part of a token; an empty token leaves `url` unchanged.
         */
        public fun withApiToken(url: String, apiToken: String): String {
            val token = apiToken.trim()
            if (token.isEmpty()) return url
            val fragment = url.indexOf('#')
            val base = if (fragment < 0) url else url.substring(0, fragment)
            val hash = if (fragment < 0) "" else url.substring(fragment)
            val separator = if ('?' in base) '&' else '?'
            return "$base${separator}token=${percentEncode(token)}$hash"
        }

        /** RFC 3986 percent-encoding of everything but the unreserved characters (UTF-8). */
        private fun percentEncode(text: String): String = buildString {
            for (byte in text.toByteArray(Charsets.UTF_8)) {
                val c = byte.toInt() and 0xff
                val ch = c.toChar()
                if (ch in 'A'..'Z' || ch in 'a'..'z' || ch in '0'..'9' || ch in "-._~") {
                    append(ch)
                } else {
                    append('%').append(HEX[c shr 4]).append(HEX[c and 0x0f])
                }
            }
        }

        private const val HEX = "0123456789ABCDEF"

        /** The HUD's default TLS port (`server.tlsPort`), where the phone connects. */
        public const val DEFAULT_PORT: Int = 8443

        /**
         * The HUD's default plain HTTP port (`server.port`), where apps from before the TLS link
         * connected (and where the phone link is now refused).
         */
        public const val LEGACY_PLAIN_PORT: Int = 8080

        /**
         * A manual address saved by an app from before the TLS link: one naming the HUD's default
         * plain port ([LEGACY_PLAIN_PORT]) now names the default TLS port ([DEFAULT_PORT]), in the
         * form [display] gives. Anything else is returned unchanged — without a port the default
         * already is the TLS port, and a HUD moved to another plain port has its TLS port wherever
         * its `server.tlsPort` says, which the user has to enter.
         */
        public fun upgradeLegacyAddress(text: String): String {
            val endpoint = parse(text) ?: return text
            if (endpoint.port != LEGACY_PLAIN_PORT) return text
            return endpoint.copy(port = DEFAULT_PORT).display()
        }
        public const val PHONE_SOCKET_PATH: String = "/ws/phone"

        /** mDNS / DNS-SD service type the HUD advertises. */
        public const val SERVICE_TYPE: String = "_carheadsup._tcp"

        private val HOST_NAME =
            Regex("^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\\.?$")
        private val IPV6 = Regex("^[0-9A-Fa-f:.]+(%[A-Za-z0-9._-]+)?$")

        /**
         * Parses a manually entered address: `host`, `host:port`, `[v6]:port`, a bare IPv6
         * address, optionally with an `https://` or `wss://` scheme and a trailing path (both
         * ignored). The port is the HUD's TLS port ([DEFAULT_PORT] when left out). Returns null
         * when the text is not a usable address.
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
