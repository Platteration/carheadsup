package dev.carheadsup.companion.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.http.SslCertificate
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.View
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import dev.carheadsup.companion.CompanionApp
import dev.carheadsup.companion.R
import dev.carheadsup.companion.ui.screens.startSafely
import dev.carheadsup.protocol.auth.CertFingerprint
import dev.carheadsup.protocol.link.HudEndpoint
import dev.carheadsup.protocol.tls.CertificateDecision
import dev.carheadsup.protocol.tls.CertificatePolicy
import java.security.cert.CertificateException

/**
 * The HUD's own settings app (`https://<hud>:<tls port>/settings`, served by the HUD) in a
 * WebView, so the driver can configure layouts, units, alerts and projection from the phone.
 * Navigation stays on the HUD; other links open in the browser. It is only opened for a HUD that
 * has proven itself (`HudLink.trusted`), since it receives the API token, and only over that
 * HUD's certificate: the WebView does not know the HUD's self-signed certificate, and
 * [onReceivedSslError][PinnedWebViewClient.onReceivedSslError] lets a page through only when the
 * certificate is the pinned one — anything else is cancelled and explained. Files the page
 * generates (the trips CSV) are saved through [FileExportBridge].
 */
class HudSettingsActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var processBound = false

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
        val hudHost = url.toUri().host
        // WebView cannot be bound per request; route the process over the HUD's Wi-Fi while open.
        processBound = (application as CompanionApp).graph.localNetwork.bindProcess()
        webView =
            WebView(this).apply {
                setBackgroundColor(Color.BLACK)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                // A WebView drops the page's blob: downloads; the page hands files to this instead.
                addJavascriptInterface(FileExportBridge(this@HudSettingsActivity), FileExportBridge.JS_NAME)
                webViewClient = PinnedWebViewClient(hudHost, pinned)
                // Decisions to proceed are remembered per host: start from none, so only this
                // HUD's pinned certificate is ever let through.
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

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            // The page makes its own API calls, which a WebView cannot add a header to: it takes the
            // token from `?token=`, keeps it in its storage (DOM storage is on above) and removes it
            // from the address.
            val token = (application as CompanionApp).graph.settings.value.apiToken
            webView.loadUrl(HudEndpoint.withApiToken(url, token))
        }
    }

    /**
     * Lets the HUD's self-signed certificate through when — and only when — it is the pinned one
     * ([pinned], the certificate the HUD proved itself with on the phone link) on the HUD's own
     * host. Host names are not checked otherwise: the HUD is reached by IP address.
     */
    private inner class PinnedWebViewClient(private val hudHost: String?, private val pinned: String) :
        WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (request.url.host == hudHost) return false
            view.context.startSafely(Intent(Intent.ACTION_VIEW, request.url))
            return true
        }

        // Proceeds only for the pinned certificate (never for any other error or host).
        @SuppressLint("WebViewClientOnReceivedSslError")
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            val presented = error.certificate?.let { derOf(it) }?.let { CertFingerprint.of(it) }
            val onHud = error.url?.toUri()?.host == hudHost
            val decision = presented?.let { CertificatePolicy.decide(it, pinned, advertised = null) }
            if (onHud && decision is CertificateDecision.Trusted) {
                handler.proceed()
                return
            }
            handler.cancel()
            Log.w(TAG, "Refused the certificate of ${error.url} (${presented ?: "unreadable"}); pinned $pinned")
            showRefusal(presented, pinned)
        }
    }

    /** Replaces the page with why it was not opened. */
    private fun showRefusal(presented: String?, pinned: String) {
        if (refused || isFinishing || isDestroyed) return
        refused = true
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

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::webView.isInitialized) webView.saveState(outState)
    }

    override fun onDestroy() {
        if (::webView.isInitialized) webView.destroy()
        if (processBound) (application as CompanionApp).graph.localNetwork.unbindProcess()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "HudSettings"
        private const val EXTRA_URL = "url"
        private const val EXTRA_CERTIFICATE = "certificate"

        /** The key under which [SslCertificate.saveState] keeps the DER encoding (API 26–28). */
        private const val SAVED_X509 = "x509-certificate"

        fun intent(context: Context, url: String, certFingerprint: String): Intent =
            Intent(context, HudSettingsActivity::class.java)
                .putExtra(EXTRA_URL, url)
                .putExtra(EXTRA_CERTIFICATE, certFingerprint)

        /** The DER encoding of a certificate the WebView reports, or null when it cannot be read. */
        private fun derOf(certificate: SslCertificate): ByteArray? = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                certificate.x509Certificate?.encoded
            } else {
                SslCertificate.saveState(certificate)?.getByteArray(SAVED_X509)
            }
        } catch (e: CertificateException) {
            null
        }
    }
}
