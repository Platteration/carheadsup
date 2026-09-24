package dev.carheadsup.protocol.api

/**
 * Checks for files the HUD's settings page asks the app to save (the trips CSV, through the
 * WebView bridge): the page supplies the name and type, so neither may point anywhere else or
 * pose as something other than text.
 */
public object ExportFile {
    /** Largest file saved (UTF-16 characters); a trip log of thousands of trips is far smaller. */
    public const val MAX_CHARS: Int = 16 * 1024 * 1024

    public const val MAX_NAME_CHARS: Int = 100
    public const val FALLBACK_NAME: String = "carheadsup-export.txt"

    private val UNSAFE = Regex("[^A-Za-z0-9._-]")
    private val TYPES = setOf("text/csv", "text/plain")

    /**
     * [requested] reduced to letters, digits, `.`, `-` and `_` (anything else becomes `_`), without
     * leading dots, at most [MAX_NAME_CHARS] long with its extension kept; [FALLBACK_NAME] when
     * nothing is left.
     */
    public fun safeName(requested: String): String {
        val cleaned = requested.replace(UNSAFE, "_").trimStart('.')
        if (cleaned.isEmpty()) return FALLBACK_NAME
        if (cleaned.length <= MAX_NAME_CHARS) return cleaned
        val extension = cleaned.substringAfterLast('.', "").takeIf { it.length in 1..10 }?.let { ".$it" } ?: ""
        return cleaned.take(MAX_NAME_CHARS - extension.length) + extension
    }

    /** The media type without parameters when it is `text/csv` or `text/plain`, else `text/plain`. */
    public fun safeMimeType(requested: String): String =
        requested.substringBefore(';').trim().lowercase().takeIf { it in TYPES } ?: "text/plain"
}
