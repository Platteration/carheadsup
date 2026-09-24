package dev.carheadsup.companion.ui

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.provider.MediaStore
import android.util.Log
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.annotation.RequiresApi
import androidx.core.content.FileProvider
import dev.carheadsup.companion.R
import dev.carheadsup.protocol.api.ExportFile
import java.io.File
import java.io.IOException

/**
 * `window.CarheadsupAndroid` in the HUD's settings page: saves the files the page generates (the
 * trips CSV), which a WebView cannot download by itself (a `blob:` URL means nothing to the
 * system). Android 10+ writes to the public Downloads folder (MediaStore, no permission needed);
 * older versions offer the file through the share sheet. Returns "saved", "shared" or "failed"
 * to the page, which falls back to the clipboard on "failed".
 *
 * Only the HUD's own pages are ever loaded in this WebView (see [HudSettingsActivity]); the
 * page's file name and type are sanitised all the same ([ExportFile]).
 */
class FileExportBridge(private val activity: Activity) {
    /** Called by the page, on the WebView's bridge thread. */
    @JavascriptInterface
    fun saveFile(text: String, filename: String, mimeType: String): String {
        if (text.length > ExportFile.MAX_CHARS) return FAILED
        val name = ExportFile.safeName(filename)
        val type = ExportFile.safeMimeType(mimeType)
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveToDownloads(text, name, type)
                activity.runOnUiThread {
                    Toast.makeText(activity, activity.getString(R.string.export_saved, name), Toast.LENGTH_LONG).show()
                }
                SAVED
            } else {
                share(text, name, type)
                SHARED
            }
        } catch (e: IOException) {
            Log.w(TAG, "Saving $name failed", e)
            FAILED
        } catch (e: RuntimeException) {
            // SecurityException, IllegalArgumentException from the provider or the resolver.
            Log.w(TAG, "Saving $name failed", e)
            FAILED
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun saveToDownloads(text: String, name: String, type: String) {
        val resolver = activity.contentResolver
        val values =
            ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, type)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
        val uri =
            resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IOException("MediaStore refused the file")
        try {
            val stream = resolver.openOutputStream(uri) ?: throw IOException("no output stream")
            stream.use { it.write(text.toByteArray(Charsets.UTF_8)) }
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: IOException) {
            resolver.delete(uri, null, null)
            throw e
        }
    }

    /** Android 9 and older: a cache file handed to the share sheet through [FileProvider]. */
    private fun share(text: String, name: String, type: String) {
        val dir = File(activity.cacheDir, EXPORT_DIR)
        if (!dir.isDirectory && !dir.mkdirs()) throw IOException("cannot create $dir")
        val file = File(dir, name)
        file.writeText(text, Charsets.UTF_8)
        val uri = FileProvider.getUriForFile(activity, activity.packageName + AUTHORITY_SUFFIX, file)
        val send =
            Intent(Intent.ACTION_SEND)
                .setType(type)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .putExtra(Intent.EXTRA_SUBJECT, name)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        activity.runOnUiThread { activity.startActivity(Intent.createChooser(send, name)) }
    }

    companion object {
        /** The page's name for this object (`window.CarheadsupAndroid`). */
        const val JS_NAME = "CarheadsupAndroid"

        /** `<applicationId>.exports`, the FileProvider in the manifest (res/xml/export_paths.xml). */
        const val AUTHORITY_SUFFIX = ".exports"
        private const val EXPORT_DIR = "exports"
        private const val TAG = "FileExportBridge"
        private const val SAVED = "saved"
        private const val SHARED = "shared"
        private const val FAILED = "failed"
    }
}
