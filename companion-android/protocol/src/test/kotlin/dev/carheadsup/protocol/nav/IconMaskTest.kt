package dev.carheadsup.protocol.nav

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.math.hypot

class IconMaskTest {
    private val size = 32
    private val transparent = 0x00000000
    private val white = 0xFFFFFFFF.toInt()
    private val darkGrey = 0xFF202020.toInt()
    private val mapsGreen = 0xFF0F9D58.toInt()
    private val lightTile = 0xFFEEEEEE.toInt()

    /** An "arrow": a bar up the middle with a wider head on top (about 17 % of the icon). */
    private fun isArrow(x: Int, y: Int): Boolean = (x in 13..18 && y in 10..27) || (y in 4..9 && x in (16 - (y - 3))..(15 + (y - 3)))

    private fun icon(background: (Int, Int) -> Int, arrow: Int): IntArray =
        IntArray(size * size) { i ->
            val x = i % size
            val y = i / size
            if (isArrow(x, y)) arrow else background(x, y)
        }

    private fun alphaAt(mask: IntArray, x: Int, y: Int): Int = mask[y * size + x] ushr 24

    private fun assertArrowOnly(mask: IntArray?) {
        requireNotNull(mask)
        for (y in 0 until size) {
            for (x in 0 until size) {
                val alpha = alphaAt(mask, x, y)
                if (isArrow(x, y)) assertEquals(255, alpha, "arrow at $x,$y") else assertEquals(0, alpha, "background at $x,$y")
                assertEquals(0xFFFFFF, mask[y * size + x] and 0xFFFFFF, "white at $x,$y")
            }
        }
    }

    @Test
    fun `a dark arrow on a transparent background becomes a white one (black would not show)`() {
        assertArrowOnly(IconMask.apply(icon({ _, _ -> transparent }, darkGrey), size, size))
    }

    @Test
    fun `a white arrow on a transparent background stays as it is`() {
        assertArrowOnly(IconMask.apply(icon({ _, _ -> transparent }, white), size, size))
    }

    @Test
    fun `a white arrow on a green tile loses the tile (no bright square on the glass)`() {
        assertArrowOnly(IconMask.apply(icon({ _, _ -> mapsGreen }, white), size, size))
    }

    @Test
    fun `a round tile's transparent corners do not make the tile the arrow`() {
        val round = { x: Int, y: Int -> if (hypot(x - 15.5, y - 15.5) <= 16.0) mapsGreen else transparent }
        assertArrowOnly(IconMask.apply(icon(round, white), size, size))
    }

    @Test
    fun `a dark arrow on a light tile is found by its contrast`() {
        assertArrowOnly(IconMask.apply(icon({ _, _ -> lightTile }, darkGrey), size, size))
    }

    @Test
    fun `soft edges and faint shading keep their share`() {
        val pixels = icon({ _, _ -> transparent }, white)
        pixels[0] = 0x80FFFFFF.toInt() // a half-transparent pixel of an antialiased edge
        val mask = requireNotNull(IconMask.apply(pixels, size, size))
        assertEquals(0x80, alphaAt(mask, 0, 0))
        // On a tile, a shade barely different from it is not arrow.
        val shaded = icon({ x, _ -> if (x < 4) 0xFF119F5A.toInt() else mapsGreen }, white)
        assertArrowOnly(IconMask.apply(shaded, size, size))
    }

    @Test
    fun `an icon without an arrow gives no mask`() {
        assertNull(IconMask.apply(IntArray(size * size) { mapsGreen }, size, size))
        assertNull(IconMask.apply(IntArray(size * size) { transparent }, size, size))
        assertThrows(IllegalArgumentException::class.java) { IconMask.apply(IntArray(3), 2, 2) }
    }

    @Test
    fun `the test arrow is a small part of the icon, as a real one is`() {
        val share = (0 until size * size).count { isArrow(it % size, it / size) } / (size * size).toDouble()
        assertTrue(share in 0.1..0.3, "$share")
    }
}
