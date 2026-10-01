package dev.carheadsup.companion.data

import android.util.Log
import dev.carheadsup.protocol.nav.NavCaptureCase
import dev.carheadsup.protocol.nav.NavCaptureLog
import java.io.File
import java.io.IOException

/**
 * The capture of Google Maps' navigation notifications (Setup → "Capture navigation
 * notifications", off by default): the newest [NavCaptureLog.MAX_CASES] distinct ones in an
 * app-private JSON Lines file, exported as a parser test case file (see [NavCaptureLog]). Only
 * Maps' notifications ever reach it. Call from one thread (the notification listener's worker,
 * or the IO dispatcher for [export] and [clear]); the methods are synchronised all the same.
 */
class NavCaptureStore(private val file: File) {
    /** The shape of the last case kept: Maps re-posts every second with only the numbers changed. */
    private var lastShape: String? = null
    private var lines: Int? = null

    /** Keep [case] unless it only repeats the last one with other numbers. */
    @Synchronized
    fun record(case: NavCaptureCase) {
        val shape = NavCaptureLog.shape(case.notification)
        if (shape == lastShape) return
        lastShape = shape
        try {
            val count = lines ?: countLines()
            file.appendText(NavCaptureLog.encodeLine(case) + "\n", Charsets.UTF_8)
            lines = count + 1
            // Trim now and then rather than rewriting the file on every post.
            if (count + 1 > NavCaptureLog.MAX_CASES * 2) {
                val kept = NavCaptureLog.decodeLines(file.readText(Charsets.UTF_8)).takeLast(NavCaptureLog.MAX_CASES)
                file.writeText(kept.joinToString("") { NavCaptureLog.encodeLine(it) + "\n" }, Charsets.UTF_8)
                lines = kept.size
            }
        } catch (e: IOException) {
            Log.w(TAG, "Cannot write the navigation capture", e)
        }
    }

    /** The newest captured cases, as a test case file; null when there are none. */
    @Synchronized
    fun export(): String? {
        val cases =
            try {
                if (!file.isFile) return null
                NavCaptureLog.decodeLines(file.readText(Charsets.UTF_8)).takeLast(NavCaptureLog.MAX_CASES)
            } catch (e: IOException) {
                Log.w(TAG, "Cannot read the navigation capture", e)
                return null
            }
        return if (cases.isEmpty()) null else NavCaptureLog.export(cases)
    }

    /** Forget everything captured (also when the capture is switched off). */
    @Synchronized
    fun clear() {
        if (file.exists() && !file.delete()) Log.w(TAG, "Cannot delete the navigation capture")
        lastShape = null
        lines = 0
    }

    private fun countLines(): Int = if (file.isFile) file.useLines { it.count() } else 0

    private companion object {
        const val TAG = "NavCaptureStore"
    }
}
