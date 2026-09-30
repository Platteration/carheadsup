package dev.carheadsup.companion.notifications

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Icon
import android.util.Log
import androidx.core.graphics.createBitmap
import dev.carheadsup.protocol.WireLimits
import java.io.ByteArrayOutputStream
import java.util.Base64
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Encodes the navigation app's maneuver icon (the notification's large icon) as a base64 PNG for
 * `PhoneNav.iconPng`, which the HUD draws when it cannot name the maneuver itself.
 *
 * The icon is rendered at most [MAX_EDGE_PX] on its long edge and downscaled until the PNG fits
 * the protocol's 32 KiB budget. Google Maps re-posts the same arrow every second, so the last
 * result is cached by pixel content and re-used without compressing again. Not thread-safe:
 * confine to the listener's worker thread.
 */
internal class ManeuverIconEncoder(private val context: Context) {
    private var lastPixelsHash: Int? = null
    private var lastEncoded: String? = null

    fun encode(icon: Icon?): String? {
        if (icon == null) return null
        val drawable =
            try {
                icon.loadDrawable(context)
            } catch (e: RuntimeException) {
                Log.w(TAG, "Cannot load the maneuver icon", e)
                null
            } ?: return null

        val intrinsicWidth = drawable.intrinsicWidth.takeIf { it > 0 } ?: MAX_EDGE_PX
        val intrinsicHeight = drawable.intrinsicHeight.takeIf { it > 0 } ?: MAX_EDGE_PX
        var scale = MAX_EDGE_PX.toFloat() / max(intrinsicWidth, intrinsicHeight)
        if (scale > 1f) scale = 1f

        var first = true
        while (true) {
            val width = (intrinsicWidth * scale).roundToInt().coerceAtLeast(1)
            val height = (intrinsicHeight * scale).roundToInt().coerceAtLeast(1)
            if (max(width, height) < MIN_EDGE_PX) return null
            val bitmap = createBitmap(width, height)
            try {
                drawable.setBounds(0, 0, width, height)
                drawable.draw(Canvas(bitmap))
                if (first) {
                    val pixels = IntArray(width * height)
                    bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
                    val hash = 31 * pixels.contentHashCode() + width
                    if (hash == lastPixelsHash) return lastEncoded
                    lastPixelsHash = hash
                    lastEncoded = null
                    first = false
                }
                val bytes = ByteArrayOutputStream().use { out ->
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                    out.toByteArray()
                }
                if (bytes.size <= WireLimits.ICON_PNG_BYTES) {
                    return Base64.getEncoder().encodeToString(bytes).also { lastEncoded = it }
                }
            } finally {
                bitmap.recycle()
            }
            scale *= DOWNSCALE
        }
    }

    private companion object {
        const val TAG = "ManeuverIconEncoder"
        const val MAX_EDGE_PX = 128
        const val MIN_EDGE_PX = 16
        const val DOWNSCALE = 0.75f
    }
}
