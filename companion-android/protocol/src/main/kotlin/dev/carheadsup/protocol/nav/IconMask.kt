package dev.carheadsup.protocol.nav

import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Turns the navigation app's maneuver icon into a mask the HUD colours itself: white, with an
 * alpha that says where the arrow is. Its own colours are no use on a windshield — black is
 * transparent there, so a dark arrow would be invisible, and an arrow on a solid tile would
 * project as a bright square — so the HUD draws the mask in its accent colour (and night palette).
 *
 * Where the arrow is: when opaque pixels cover most of the icon ([TILE_COVERAGE]) they are a tile —
 * square, rounded or round, so its corners may well be transparent, which is why the corners
 * alone cannot tell the background — with the arrow drawn on it. The tile's colour is then the
 * median luma of the opaque pixels, and the arrow is what differs from it: alpha = opacity ×
 * luma contrast, relative to the arrow's own (the largest) and past [CONTRAST_FLOOR], so the
 * arrow is solid and its antialiased edges soft. A tile with no more contrast than
 * [MIN_TILE_CONTRAST] has no arrow. Otherwise the background is transparent and the arrow is
 * whatever is opaque, light or dark: alpha = opacity.
 */
public object IconMask {
    /** Opaque pixels covering at least this share of the icon are a tile behind the arrow. */
    public const val TILE_COVERAGE: Double = 0.5

    /** Luma contrast (relative to the arrow's) below this is the tile's shading, not arrow. */
    public const val CONTRAST_FLOOR: Double = 0.1

    /** On a tile, an arrow must differ from it by at least this much luma (0–1). */
    public const val MIN_TILE_CONTRAST: Double = 0.15

    /** A mask whose visible part covers less than this share of the icon shows nothing useful. */
    public const val MIN_VISIBLE: Double = 0.01

    /**
     * [argb] — `0xAARRGGBB`, not premultiplied, row by row, [width] × [height] — as a white mask
     * of the same size, or null when hardly anything of it would show (an empty or uniform icon:
     * the HUD then draws its own arrow).
     */
    public fun apply(argb: IntArray, width: Int, height: Int): IntArray? {
        require(width > 0 && height > 0 && argb.size == width * height) { "argb must hold width × height pixels" }
        val opaque = argb.filter { alpha(it) >= HALF }
        val tile = opaque.size >= argb.size * TILE_COVERAGE
        val background = if (tile) median(opaque.map(::luma)) else 0.0
        val peak = if (tile) opaque.maxOf { abs(luma(it) - background) } else 1.0
        if (tile && peak < MIN_TILE_CONTRAST) return null
        var visible = 0
        val mask =
            IntArray(argb.size) { i ->
                val pixel = argb[i]
                val strength = if (tile) contrast(abs(luma(pixel) - background) / peak) else 1.0
                val alpha = (alpha(pixel) * strength).roundToInt().coerceIn(0, 255)
                if (alpha >= HALF) visible++
                (alpha shl 24) or WHITE
            }
        return if (visible < argb.size * MIN_VISIBLE) null else mask
    }

    private const val HALF = 128
    private const val WHITE = 0xFFFFFF

    private fun alpha(pixel: Int): Int = pixel ushr 24

    /** Relative luma (Rec. 709 weights on the encoded values), 0–1. */
    private fun luma(pixel: Int): Double {
        val r = (pixel shr 16) and 0xff
        val g = (pixel shr 8) and 0xff
        val b = pixel and 0xff
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
    }

    private fun contrast(relative: Double): Double =
        ((relative - CONTRAST_FLOOR) / (1.0 - CONTRAST_FLOOR)).coerceIn(0.0, 1.0)

    private fun median(values: List<Double>): Double {
        val sorted = values.sorted()
        return sorted[sorted.size / 2]
    }
}
