package dev.carheadsup.companion.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.http.SslError
import android.os.Bundle
import android.util.TypedValue
import android.view.View
import android.webkit.ServiceWorkerController
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import dev.carheadsup.companion.CompanionApp
import dev.carheadsup.companion.R
import dev.carheadsup.companion.ui.screens.startSafely
import dev.carheadsup.protocol.auth.CertFingerprint
import dev.carheadsup.protocol.tls.HudTrustManager
import org.json.JSONObject

/** The HUD's settings app in a WebView whose networking is disabled. Page/assets and every
 * REST call use native pinned TLS before credentials or content can cross the connection.
 * CA-valid substitute certificates receive the same rejection as self-signed substitutes. */
class HudSettingsActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var transport: PinnedSettingsTransport

    /** The HUD presented another certificate: the page was replaced by the explanation. */
    private var refused = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val url = intent.getStringExtra(EXTRA_URL)
        val pinned = intent.getStringExtra(EXTRA_CERTIFICATE)?.takeIf(CertFingerprint::isValid)
        if (url == null || pinned == null) {
            finish()
            return
        }
        val graph = (application as CompanionApp).graph
        val trust = HudTrustManager(pinnedFingerprint = pinned)
        try {
            transport = PinnedSettingsTransport(
                url, graph.settingsClient(trust), trust,
                readToken = { graph.settings.value.apiToken },
                writeToken = { token -> graph.settingsStore.update { it.copy(apiToken = token) } },
                reply = { id, response ->
                    runOnUiThread {
                        if (!refused && !isFinishing && !isDestroyed && ::webView.isInitialized) {
                            webView.evaluateJavascript(
                                "window.__carheadsupSettingsReply?.($id, ${JSONObject.quote(response)})", null,
                            )
                        }
                    }
                },
                refused = { presented -> runOnUiThread { showRefusal(presented, pinned) } },
            )
        } catch (_: IllegalArgumentException) {
            finish()
            return
        }
        webView =
            WebView(this).apply {
                setBackgroundColor(Color.BLACK)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.blockNetworkLoads = true
                settings.cacheMode = WebSettings.LOAD_NO_CACHE
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                // A previously cached page or service worker must not bypass pinned transport.
                clearCache(true)
                ServiceWorkerController.getInstance().serviceWorkerWebSettings.blockNetworkLoads = true
                addJavascriptInterface(transport, PinnedSettingsTransport.JS_NAME)
                // A WebView drops the page's blob: downloads; the page hands files to this instead.
                addJavascriptInterface(FileExportBridge(this@HudSettingsActivity), FileExportBridge.JS_NAME)
                webViewClient = PinnedWebViewClient()
                // No remembered decision may enable the WebView's independent TLS stack.
                clearSslPreferences()
            }
        applyInsets(webView)
        setContentView(webView)

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (!refused && ::webView.isInitialized && webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            },
        )

        // The credential is obtained by the narrow native bridge, never put in a URL or history.
        // Always fetch a fresh pinned page; restored WebView state could contain untrusted cache.
        webView.loadUrl(transport.pageUrl)
    }

    private inner class PinnedWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (transport.onOrigin(request.url.toString())) return false
            if (request.isForMainFrame && request.hasGesture()) {
                view.context.startSafely(Intent(Intent.ACTION_VIEW, request.url))
            }
            return true
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse =
            transport.resource(request.url.toString(), request.method)

        // No WebView request may independently trust a CA-valid or self-signed certificate.
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
        }
    }

    /** Replaces the page with why it was not opened. */
    private fun showRefusal(presented: String?, pinned: String) {
        if (refused || isFinishing || isDestroyed) return
        refused = true
        transport.close()
        webView.removeJavascriptInterface(PinnedSettingsTransport.JS_NAME)
        webView.removeJavascriptInterface(FileExportBridge.JS_NAME)
        webView.stopLoading()
        val message =
            if (presented == null) {
                getString(R.string.hud_settings_certificate_unreadable)
            } else {
                getString(
                    R.string.hud_settings_certificate_changed,
                    CertFingerprint.short(presented),
                    CertFingerprint.short(pinned),
                )
            }
        val text =
            TextView(this).apply {
                setText(message)
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.BLACK)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            }
        applyInsets(text, margin = (24 * resources.displayMetrics.density).toInt())
        setContentView(text)
    }

    /** Keeps [view]'s content clear of the system bars and the keyboard, plus [margin] pixels. */
    private fun applyInsets(view: View, margin: Int = 0) {
        ViewCompat.setOnApplyWindowInsetsListener(view) { target, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            target.updatePadding(
                left = bars.left + margin,
                top = bars.top + margin,
                right = bars.right + margin,
                bottom = bars.bottom + margin,
            )
            WindowInsetsCompat.CONSUMED
        }
    }

    override fun onDestroy() {
        if (::transport.isInitialized) transport.close()
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_URL = "url"
        private const val EXTRA_CERTIFICATE = "certificate"

        fun intent(context: Context, url: String, certFingerprint: String): Intent =
            Intent(context, HudSettingsActivity::class.java)
                .putExtra(EXTRA_URL, url)
                .putExtra(EXTRA_CERTIFICATE, certFingerprint)
    }
}
