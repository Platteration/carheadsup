package dev.carheadsup.protocol.api

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ExportFileTest {
    @Test
    fun `keeps the settings page's file names`() {
        assertEquals("trips-2026-09-24.csv", ExportFile.safeName("trips-2026-09-24.csv"))
    }

    @Test
    fun `a name from the page cannot leave the target folder or hide itself`() {
        for (name in listOf("../../shared_prefs/companion_settings.xml", "/etc/passwd", "a\\b.csv", ".hidden.csv")) {
            val safe = ExportFile.safeName(name)
            assertFalse('/' in safe || '\\' in safe || safe.startsWith('.'), safe)
        }
        assertEquals("tr_ps_.csv", ExportFile.safeName("tr\u0000ps\n.csv"))
        assertEquals(ExportFile.FALLBACK_NAME, ExportFile.safeName(""))
        assertEquals(ExportFile.FALLBACK_NAME, ExportFile.safeName("..."))
    }

    @Test
    fun `long names are cut but keep their extension`() {
        val safe = ExportFile.safeName("t".repeat(300) + ".csv")
        assertEquals(ExportFile.MAX_NAME_CHARS, safe.length)
        assertTrue(safe.endsWith(".csv"))
    }

    @Test
    fun `only plain text types are passed on`() {
        assertEquals("text/csv", ExportFile.safeMimeType("text/csv"))
        assertEquals("text/csv", ExportFile.safeMimeType(" Text/CSV; charset=utf-8"))
        assertEquals("text/plain", ExportFile.safeMimeType("application/vnd.android.package-archive"))
        assertEquals("text/plain", ExportFile.safeMimeType(""))
    }
}
