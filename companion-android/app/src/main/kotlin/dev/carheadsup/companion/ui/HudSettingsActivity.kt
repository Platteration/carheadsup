package dev.carheadsup.companion.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import dev.carheadsup.companion.CompanionApp
import dev.carheadsup.companion.ui.screens.startSafely
import dev.carheadsup.protocol.link.HudEndpoint

/**
 * The HUD's own settings app (`http://<hud>/settings`, served by the HUD) in a WebView, so the
 * driver can configure layouts, units, alerts and projection from the phone. Navigation stays on
 * the HUD; other links open in the browser. It is only opened for a HUD that has proven itself
 * (`HudLink.trustedEndpoint`), since it receives the API token. Files the page generates (the
 * trips CSV) are saved through [FileExportBridge].
 */
class HudSettingsActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var processBound = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val url = intent.getStringExtra(EXTRA_URL)
        if (url == null) {
            finish()
            return
        }
        val hudHost = Uri.parse(url).host
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
                webViewClient =
                    object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            if (request.url.host == hudHost) return false
                            context.startSafely(Intent(Intent.ACTION_VIEW, request.url))
                            return true
                        }
                    }
            }
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.updatePadding(left = bars.left, top = bars.top, right = bars.right, bottom = bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(webView)

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) {
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
        private const val EXTRA_URL = "url"

        fun intent(context: Context, url: String): Intent =
            Intent(context, HudSettingsActivity::class.java).putExtra(EXTRA_URL, url)
    }
}
