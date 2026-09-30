package dev.carheadsup.companion.ui.scan

import android.util.Log
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.carheadsup.protocol.pairing.QrDecoder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private const val TAG = "QrScanner"

/** Camera frames are analysed at about this size: large modules for ZXing, little work per frame. */
private val ANALYSIS_SIZE = Size(1280, 720)

/**
 * A live camera preview that reads QR codes. CameraX binds the back camera's preview and image
 * analysis to the composition's lifecycle owner — the camera closes while the app is in the
 * background and opens again when it returns — and everything is unbound and released when the
 * scanner leaves the composition. Frames are decoded on a background thread of their own
 * ([QrDecoder]: as seen, inverted, and mirrored — the HUD's panel shows its image mirrored);
 * only the latest frame waits, older ones are dropped. [onText] runs on the main thread, once
 * for each new text seen; [onError] when the camera cannot be started.
 *
 * The caller holds the CAMERA permission.
 */
@Composable
fun QrScanner(onText: (String) -> Unit, onError: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentOnText by rememberUpdatedState(onText)
    val currentOnError by rememberUpdatedState(onError)
    val previewView =
        remember(context) {
            PreviewView(context).apply {
                // A TextureView: composes like any other view (a SurfaceView punches through).
                implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                scaleType = PreviewView.ScaleType.FILL_CENTER
            }
        }
    AndroidView(factory = { previewView }, modifier = modifier)

    DisposableEffect(lifecycleOwner, previewView) {
        val active = AtomicBoolean(true)
        val mainExecutor = ContextCompat.getMainExecutor(context)
        val analysisExecutor = Executors.newSingleThreadExecutor()
        val preview = Preview.Builder().build()
        preview.setSurfaceProvider(previewView.surfaceProvider)
        val analysis =
            ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setResolutionSelector(
                    ResolutionSelector.Builder()
                        .setResolutionStrategy(
                            ResolutionStrategy(
                                ANALYSIS_SIZE,
                                ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER,
                            ),
                        )
                        .build(),
                )
                .build()
        analysis.setAnalyzer(
            analysisExecutor,
            FrameAnalyzer { text ->
                // Back on the main thread, unless the scanner has gone meanwhile.
                mainExecutor.execute { if (active.get()) currentOnText(text) }
            },
        )

        var provider: ProcessCameraProvider? = null
        val providerFuture = ProcessCameraProvider.getInstance(context)
        providerFuture.addListener(
            {
                if (!active.get()) return@addListener
                try {
                    val cameraProvider = providerFuture.get()
                    val camera =
                        if (cameraProvider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)) {
                            CameraSelector.DEFAULT_BACK_CAMERA
                        } else {
                            CameraSelector.DEFAULT_FRONT_CAMERA
                        }
                    cameraProvider.bindToLifecycle(lifecycleOwner, camera, preview, analysis)
                    provider = cameraProvider
                } catch (e: Exception) {
                    // No usable camera, the camera service failed, the lifecycle was destroyed …
                    Log.w(TAG, "Cannot start the camera", e)
                    currentOnError(e.message ?: e.javaClass.simpleName)
                }
            },
            mainExecutor,
        )

        onDispose {
            active.set(false)
            analysis.clearAnalyzer()
            provider?.unbind(preview, analysis)
            analysisExecutor.shutdown()
        }
    }
}

/**
 * Decodes each frame's luminance plane with one [QrDecoder] (it runs on the analysis thread
 * only) and reports each text once, until another one is seen.
 */
private class FrameAnalyzer(private val onText: (String) -> Unit) : ImageAnalysis.Analyzer {
    private val decoder = QrDecoder()
    private var buffer = ByteArray(0)
    private var lastText: String? = null

    override fun analyze(image: ImageProxy) {
        val text =
            try {
                image.use(::decode)
            } catch (e: RuntimeException) {
                // A frame whose planes do not match its size, or a decoder failure: skip the
                // frame. An exception escaping here would end the analysis thread — and the app.
                Log.w(TAG, "Skipping an unreadable frame", e)
                null
            }
        if (text != null && text != lastText) {
            lastText = text
            onText(text)
        }
    }

    /** The QR code in [image]'s luminance plane (YUV_420_888's Y plane), if any. */
    private fun decode(image: ImageProxy): String? {
        val plane = image.planes[0]
        val data = plane.buffer
        data.rewind()
        val size = data.remaining()
        if (buffer.size < size) buffer = ByteArray(size)
        data.get(buffer, 0, size)
        val pixelStride = plane.pixelStride
        if (pixelStride == 1) return decoder.decode(buffer, image.width, image.height, plane.rowStride)
        // Luminance samples spread out (not seen on a Y plane in practice): pack them first.
        val packed = ByteArray(image.width * image.height)
        for (y in 0 until image.height) {
            for (x in 0 until image.width) packed[y * image.width + x] = buffer[y * plane.rowStride + x * pixelStride]
        }
        return decoder.decode(packed, image.width, image.height)
    }
}
