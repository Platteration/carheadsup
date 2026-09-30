package dev.carheadsup.protocol.pairing

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.InvertedLuminanceSource
import com.google.zxing.LuminanceSource
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

/**
 * Finds a QR code in a camera frame (ZXing): the luminance (Y) plane of a YUV_420_888 image, as
 * CameraX's image analysis delivers it — [width] × [height] pixels, [rowStride] bytes per row.
 *
 * The HUD's panel shows the pairing code mirrored (its image is meant to be read off the
 * windshield), which ZXing's QR decoder reads by itself: it retries a code that fails as the
 * mirror image. A code seen as light modules on a dark ground — its reflection on the glass,
 * with the road showing through the dark modules — is read by trying the inverted image
 * ([InvertedLuminanceSource]) when the plain one finds nothing.
 *
 * Not thread-safe: use one instance per analysis thread.
 */
public class QrDecoder {
    private val reader = QRCodeReader()
    private val hints: Map<DecodeHintType, Any> =
        mapOf(
            DecodeHintType.TRY_HARDER to true,
            DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
        )

    /**
     * The text of the QR code in the frame, or null when there is none (or none readable).
     * [luminance] holds at least `rowStride × (height − 1) + width` bytes (the last row may lack
     * its padding).
     */
    public fun decode(luminance: ByteArray, width: Int, height: Int, rowStride: Int = width): String? {
        require(width > 0 && height > 0) { "empty frame" }
        require(rowStride >= width) { "rowStride must be at least the width" }
        require(luminance.size >= rowStride.toLong() * (height - 1) + width) { "too few bytes for the frame" }
        val source = PlanarYUVLuminanceSource(luminance, rowStride, height, 0, 0, width, height, false)
        return read(source) ?: read(InvertedLuminanceSource(source))
    }

    private fun read(source: LuminanceSource): String? = try {
        reader.decode(BinaryBitmap(HybridBinarizer(source)), hints).text
    } catch (e: ReaderException) {
        null
    } finally {
        reader.reset()
    }
}
