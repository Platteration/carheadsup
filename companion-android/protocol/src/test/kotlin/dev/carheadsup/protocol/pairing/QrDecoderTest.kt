package dev.carheadsup.protocol.pairing

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.util.Random

class QrDecoderTest {
    /** A QR code's modules (true = dark), without a quiet zone. */
    private class Modules(val rows: List<BooleanArray>) {
        val size: Int get() = rows.size

        fun mirrored(): Modules = Modules(rows.map { it.reversedArray() })

        /** Turned a quarter clockwise (a phone held sideways). */
        fun rotated(): Modules = Modules(List(size) { y -> BooleanArray(size) { x -> rows[size - 1 - x][y] } })
    }

    /** A camera frame: [width] × [height] luminance with [rowStride] bytes per row. */
    private class Frame(val bytes: ByteArray, val width: Int, val height: Int, val rowStride: Int)

    private fun zxingModules(text: String): Modules {
        val hints = mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 0)
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints)
        return Modules(List(matrix.height) { y -> BooleanArray(matrix.width) { x -> matrix[x, y] } })
    }

    /** The code the HUD's renderer draws (packages/hud-renderer), and the text it holds. */
    private fun hudModules(): Pair<String, Modules> {
        val lines =
            checkNotNull(javaClass.getResource("/pairing/hud-qr.txt")).readText().lines().filter { it.isNotEmpty() }
        return lines.first() to Modules(lines.drop(1).map { row -> BooleanArray(row.length) { row[it] == '#' } })
    }

    /**
     * The code drawn [scale] pixels per module with a light quiet zone of four modules, in the
     * middle of a mid-grey [frameWidth] × [frameHeight] frame, rows padded to [rowStride].
     */
    private fun frame(
        modules: Modules,
        scale: Int = 4,
        inverted: Boolean = false,
        frameWidth: Int = 640,
        frameHeight: Int = 480,
        rowStride: Int = frameWidth,
    ): Frame {
        val quiet = 4
        val side = (modules.size + 2 * quiet) * scale
        require(side <= frameWidth && side <= frameHeight)
        val bytes = ByteArray(rowStride * frameHeight) { 0x80.toByte() }
        val left = (frameWidth - side) / 2
        val top = (frameHeight - side) / 2
        for (py in 0 until side) {
            for (px in 0 until side) {
                val x = px / scale - quiet
                val y = py / scale - quiet
                val dark = y in 0 until modules.size && x in 0 until modules.size && modules.rows[y][x]
                val black = dark != inverted
                bytes[(top + py) * rowStride + left + px] = if (black) 0x10 else 0xF0.toByte()
            }
        }
        return Frame(bytes, frameWidth, frameHeight, rowStride)
    }

    private fun decode(frame: Frame): String? =
        QrDecoder().decode(frame.bytes, frame.width, frame.height, frame.rowStride)

    @Test
    fun `reads the pairing code the HUD draws, as the panel shows it (mirrored) and as drawn`() {
        val (uri, modules) = hudModules()
        assertEquals(57, modules.size)
        assertEquals(uri, decode(frame(modules)))
        assertEquals(uri, decode(frame(modules.mirrored())))
        assertEquals(PairingScan.Valid::class, PairingUri.parse(decode(frame(modules.mirrored()))!!)::class)
    }

    @Test
    fun `reads a code seen light on dark (its reflection on the windshield), mirrored or not`() {
        val (uri, modules) = hudModules()
        assertEquals(uri, decode(frame(modules, inverted = true)))
        assertEquals(uri, decode(frame(modules.mirrored(), inverted = true)))
    }

    @Test
    fun `reads every shared vector, turned and at a small scale`() {
        for (vector in SHARED_PAIRING_VECTORS) {
            val modules = zxingModules(vector.uri)
            val scale = if (modules.size > 90) 3 else 4
            val big = frame(modules, scale = scale, frameWidth = 1280, frameHeight = 720)
            assertEquals(vector.uri, decode(big), vector.name)
            val turned = frame(modules.rotated().mirrored(), scale = scale, frameWidth = 1280, frameHeight = 720)
            assertEquals(vector.uri, decode(turned), vector.name)
        }
    }

    @Test
    fun `honours the row stride of camera frames, with or without padding on the last row`() {
        val (uri, modules) = hudModules()
        val padded = frame(modules, rowStride = 704)
        assertEquals(uri, decode(padded))
        val trimmed = padded.bytes.copyOf(padded.rowStride * (padded.height - 1) + padded.width)
        assertEquals(uri, QrDecoder().decode(trimmed, padded.width, padded.height, padded.rowStride))
    }

    @Test
    fun `finds nothing in a frame without a code`() {
        val random = Random(42)
        val noise = ByteArray(640 * 480).also(random::nextBytes)
        val decoder = QrDecoder()
        assertNull(decoder.decode(noise, 640, 480))
        assertNull(decoder.decode(ByteArray(320 * 240) { 0x80.toByte() }, 320, 240))
        // The same decoder goes on to read the next frame.
        val (uri, modules) = hudModules()
        val code = frame(modules)
        assertEquals(uri, decoder.decode(code.bytes, code.width, code.height))
    }

    @Test
    fun `refuses a frame description that does not fit its bytes`() {
        val decoder = QrDecoder()
        assertThrows<IllegalArgumentException> { decoder.decode(ByteArray(10), 0, 10) }
        assertThrows<IllegalArgumentException> { decoder.decode(ByteArray(100), 10, 10, rowStride = 5) }
        assertThrows<IllegalArgumentException> { decoder.decode(ByteArray(99), 10, 10) }
    }
}
