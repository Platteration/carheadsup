package dev.carheadsup.companion.ui

import android.webkit.JavascriptInterface
import android.webkit.WebResourceResponse
import dev.carheadsup.protocol.tls.HudTrustManager
import okhttp3.Call
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.FilterInputStream
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/** All network traffic for the settings WebView uses the native leaf-pin check, including when
 * an attacker presents a CA-valid certificate. The WebView's own networking is disabled. */
class PinnedSettingsTransport(
    hudPageUrl: String,
    private val client: OkHttpClient,
    private val trust: HudTrustManager,
    private val readToken: () -> String,
    private val writeToken: (String) -> Unit,
    private val reply: (Int, String) -> Unit,
    private val refused: (String?) -> Unit,
) {
    private val origin = hudPageUrl.toHttpUrl().also {
        require(it.scheme == "https" && it.username.isEmpty() && it.password.isEmpty())
    }
    // A fresh synthetic HTTPS origin has no old cookies, cache or service-worker registrations.
    // The WebView never connects to it: resources are mapped to the paired HUD by this transport.
    val pageUrl: String = origin.newBuilder()
        .host("${UUID.randomUUID()}.settings.carheadsup.invalid").port(443)
        .removeAllQueryParameters("token").build().toString()
    private val pageOrigin = pageUrl.toHttpUrl()
    private val executor = Executors.newFixedThreadPool(2)
    private val pending = AtomicInteger()
    private val calls = ConcurrentHashMap<Int, Call>()
    private val active = ConcurrentHashMap.newKeySet<Int>()
    @Volatile private var closed = false

    fun onOrigin(url: String): Boolean = try {
        val candidate = url.toHttpUrl()
        candidate.scheme == "https" && candidate.host == pageOrigin.host && candidate.port == pageOrigin.port &&
            candidate.username.isEmpty() && candidate.password.isEmpty()
    } catch (_: IllegalArgumentException) {
        false
    }

    private fun allowedApi(url: String): HttpUrl {
        val candidate = pageOrigin.resolve(url) ?: throw IllegalArgumentException("Invalid URL")
        require(onOrigin(candidate.toString())) { "Foreign origin" }
        require(candidate.encodedPath.startsWith("/api/")) { "Not an API request" }
        return onHud(candidate)
    }

    private fun onHud(url: HttpUrl): HttpUrl = url.newBuilder().scheme(origin.scheme)
        .host(origin.host).port(origin.port).build()

    /** Page, scripts, styles and images: never fall back to WebView's CA-based network stack. */
    fun resource(url: String, method: String): WebResourceResponse {
        if (closed || method != "GET" || !onOrigin(url)) return error(403, "Forbidden")
        return try {
            val response = client.newCall(Request.Builder().url(onHud(url.toHttpUrl())).get().build()).execute()
            if (response.code in 300..399) {
                response.close()
                return error(403, "Redirects are not allowed")
            }
            val body = response.body
            val contentType = body.contentType()
            val stream = object : FilterInputStream(body.byteStream()) {
                override fun close() {
                    try { super.close() } finally { response.close() }
                }
            }
            val headers = response.headers.toMultimap().mapValues { it.value.joinToString(", ") }
                .filterKeys { !it.equals("Content-Security-Policy", ignoreCase = true) }.toMutableMap()
            // REST uses the native bridge. Block WebSockets, XHR, workers and frames that could
            // otherwise bypass resource interception; never rely on interception for POST bodies.
            headers["Content-Security-Policy"] = SETTINGS_CSP
            WebResourceResponse(
                contentType?.let { "${it.type}/${it.subtype}" } ?: "application/octet-stream",
                contentType?.charset()?.name() ?: "UTF-8",
                response.code,
                response.message.ifEmpty { "Response" },
                headers,
                stream,
            )
        } catch (_: IOException) {
            if (trust.rejection != null) refused(trust.presentedFingerprint)
            error(502, "HUD unavailable")
        }
    }

    @JavascriptInterface fun getToken(): String = readToken()

    @JavascriptInterface fun setToken(token: String) {
        if (!closed && token.length <= 256 && token.none { it == '\r' || it == '\n' }) writeToken(token.trim())
    }

    /** Narrow JSON REST bridge; no arbitrary destinations, cookies, redirects or extra headers. */
    @JavascriptInterface fun request(id: Int, url: String, method: String, body: String, token: String) {
        if (closed) return
        if (pending.incrementAndGet() > 8) {
            pending.decrementAndGet()
            reply(id, result(503, "Too many settings requests", "text/plain"))
            return
        }
        active.add(id)
        try {
            executor.execute {
                try {
                    if (closed || !active.contains(id)) return@execute
                    require(method in setOf("GET", "POST", "PUT", "PATCH", "DELETE"))
                    require(body.length <= 1_048_576 && token.length <= 256)
                    val target = allowedApi(url)
                    val builder = Request.Builder().url(target).header("Accept", "application/json, text/csv")
                    if (token.isNotEmpty()) builder.header("Authorization", "Bearer $token")
                    val data = if (method in setOf("POST", "PUT", "PATCH")) {
                        body.toRequestBody("application/json; charset=utf-8".toMediaType())
                    } else null
                    val call = client.newCall(builder.method(method, data).build())
                    calls[id] = call
                    if (closed || !active.contains(id)) call.cancel()
                    call.execute().use { response ->
                        // Redirect following is disabled on the client: credentials never cross an origin.
                        val status = if (response.isRedirect) 403 else response.code
                        val bytes = response.body.source().apply { request(MAX_RESPONSE_BYTES + 1) }.buffer
                        require(bytes.size <= MAX_RESPONSE_BYTES) { "Response too large" }
                        reply(id, result(status, bytes.readUtf8(), response.header("Content-Type") ?: "application/json"))
                    }
                } catch (_: Exception) {
                    if (trust.rejection != null) refused(trust.presentedFingerprint)
                    reply(id, result(502, "HUD request failed", "text/plain"))
                } finally {
                    calls.remove(id)
                    active.remove(id)
                    pending.decrementAndGet()
                }
            }
        } catch (_: java.util.concurrent.RejectedExecutionException) {
            active.remove(id)
            pending.decrementAndGet()
        }
    }

    @JavascriptInterface fun cancel(id: Int) {
        active.remove(id)
        calls[id]?.cancel()
    }

    fun close() {
        closed = true
        active.clear()
        calls.values.forEach { it.cancel() }
        executor.shutdownNow()
    }

    private fun result(status: Int, text: String, type: String): String = JSONObject()
        .put("status", status).put("text", text).put("type", type).toString()

    private fun error(status: Int, text: String): WebResourceResponse = WebResourceResponse(
        "text/plain", "UTF-8", status, text,
        mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(text.toByteArray(Charsets.UTF_8)),
    )

    companion object {
        const val JS_NAME = "CarheadsupSettings"
        private const val MAX_RESPONSE_BYTES = 32L * 1024 * 1024
        private const val SETTINGS_CSP = "default-src 'none'; script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; " +
            "connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; " +
            "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }
}
