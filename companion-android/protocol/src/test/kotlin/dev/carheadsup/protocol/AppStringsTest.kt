package dev.carheadsup.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * The app's string resources (`strings.xml` in `app/src/main/res/values…`, read from the checkout)
 * against a rule of Android's resource compiler: an apostrophe in a string must be escaped
 * (`\'`), or aapt2 fails the build with "unescaped apostrophe". The :app module only builds with
 * the Android SDK, so this catches it wherever this module's tests run. Skipped when the module
 * is built outside the repository.
 */
class AppStringsTest {
    private val resDir: File? =
        generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
            .flatMap { sequenceOf(File(it, "app/src/main/res"), File(it, "companion-android/app/src/main/res")) }
            .firstOrNull { it.isDirectory }

    /** `<string>` and plural `<item>` values, by name (items as `name[quantity]`). */
    private fun values(file: File): List<Pair<String, String>> {
        val text = file.readText()
        val strings = STRING.findAll(text).map { it.groupValues[1] to it.groupValues[2] }
        val items =
            PLURALS.findAll(text).flatMap { plural ->
                val name = plural.groupValues[1]
                ITEM.findAll(plural.groupValues[2]).map { "$name[${it.groupValues[1]}]" to it.groupValues[2] }
            }
        return (strings + items).toList()
    }

    /** A value in double quotes, where aapt2 takes apostrophes as they are. */
    private fun quoted(value: String): Boolean = value.length >= 2 && value.startsWith('"') && value.endsWith('"')

    @Test
    fun `apostrophes in the app's strings are escaped`() {
        assumeTrue(resDir != null, "app resources not found; skipping")
        val files = resDir!!.listFiles { dir -> dir.isDirectory && dir.name.startsWith("values") }.orEmpty()
            .mapNotNull { File(it, "strings.xml").takeIf(File::isFile) }
        assumeTrue(files.isNotEmpty(), "no strings.xml; skipping")
        val unescaped =
            files.flatMap { file ->
                values(file)
                    .filter { (_, value) -> !quoted(value) && UNESCAPED.containsMatchIn(value) }
                    .map { (name, _) -> "${file.parentFile.name}/${file.name}: $name" }
            }
        assertEquals(emptyList<String>(), unescaped)
    }

    private companion object {
        val STRING = Regex("<string\\s+name=\"([^\"]+)\"[^>]*>(.*?)</string>", RegexOption.DOT_MATCHES_ALL)
        val PLURALS = Regex("<plurals\\s+name=\"([^\"]+)\"[^>]*>(.*?)</plurals>", RegexOption.DOT_MATCHES_ALL)
        val ITEM = Regex("<item\\s+quantity=\"([^\"]+)\"[^>]*>(.*?)</item>", RegexOption.DOT_MATCHES_ALL)

        /** An apostrophe without an odd number of backslashes before it. */
        val UNESCAPED = Regex("(?<!\\\\)(?:\\\\\\\\)*'")
    }
}
