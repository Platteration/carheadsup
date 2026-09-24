package dev.carheadsup.companion.hud

import dev.carheadsup.protocol.InputAction
import dev.carheadsup.protocol.ProtocolJson
import dev.carheadsup.protocol.api.ApiConfigUnitsView
import dev.carheadsup.protocol.api.ApiError
import dev.carheadsup.protocol.api.ApiInfo
import dev.carheadsup.protocol.api.ApiInputRequest
import dev.carheadsup.protocol.api.DisplayUnits
import dev.carheadsup.protocol.api.MaintenanceItemStatus
import dev.carheadsup.protocol.api.TripLog
import dev.carheadsup.protocol.api.TripRecord
import dev.carheadsup.protocol.link.HudEndpoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.URLEncoder
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** A failed REST call; [status] is the HTTP status when the HUD answered. */
class HudApiException(message: String, val status: Int? = null, cause: Throwable? = null) : IOException(message, cause)

/**
 * Client for the HUD's REST API (packages/core/src/types/api.ts). Requests go to the current
 * endpoint over the HUD's Wi-Fi and carry `Authorization: Bearer <apiToken>` when one is set;
 * [endpoint] only yields a HUD that has proven itself on the phone link.
 */
class HudApi(
    private val client: () -> OkHttpClient,
    private val endpoint: () -> HudEndpoint?,
    private val apiToken: () -> String,
) {
    /** `GET /api/trips?limit=…` — newest first. Malformed entries are skipped. */
    suspend fun trips(limit: Int = 200): List<TripRecord> = TripLog.decode(get("/api/trips?limit=$limit"))

    /** `GET /api/maintenance`. */
    suspend fun maintenance(): List<MaintenanceItemStatus> =
        decode(get("/api/maintenance"), ListSerializer(MaintenanceItemStatus.serializer()))

    /** The driver's units from `GET /api/config`. */
    suspend fun units(): DisplayUnits = decode(get("/api/config"), ApiConfigUnitsView.serializer()).units

    /** `GET /api/info`. */
    suspend fun info(): ApiInfo = decode(get("/api/info"), ApiInfo.serializer())

    /** `POST /api/input` — the remote buttons when no WebSocket session is up. */
    suspend fun sendInput(action: InputAction) {
        val body = ProtocolJson.encodeToString(
            ApiInputRequest.serializer(),
            ApiInputRequest(action),
        ).toRequestBody(JSON)
        execute(request("/api/input").post(body).build())
    }

    /** `DELETE /api/trips/:id`. */
    suspend fun deleteTrip(id: String) {
        execute(request("/api/trips/" + URLEncoder.encode(id, "UTF-8")).delete().build())
    }

    private suspend fun get(path: String): String = execute(request(path).get().build())

    private fun request(path: String): Request.Builder {
        val target = endpoint() ?: throw HudApiException("Not connected to your HUD yet (it must prove itself first)")
        val builder = Request.Builder().url(target.apiUrl(path)).header("Accept", "application/json")
        val token = apiToken().trim()
        if (token.isNotEmpty()) builder.header("Authorization", "Bearer $token")
        return builder
    }

    /** Runs [request] and reads the body on the IO dispatcher (safe to call from the main thread). */
    private suspend fun execute(request: Request): String = withContext(Dispatchers.IO) {
        val response =
            try {
                client().newCall(request).await()
            } catch (e: IOException) {
                throw HudApiException(e.message ?: "HUD unreachable", cause = e)
            }
        readBody(response)
    }

    private fun readBody(response: Response): String = response.use {
        val text = it.body.string()
        if (!it.isSuccessful) {
            val error =
                try {
                    ProtocolJson.decodeFromString(ApiError.serializer(), text).error
                } catch (e: SerializationException) {
                    it.message.ifBlank { "HTTP ${it.code}" }
                } catch (e: IllegalArgumentException) {
                    it.message.ifBlank { "HTTP ${it.code}" }
                }
            throw HudApiException(error, it.code)
        }
        text
    }

    private fun <T> decode(body: String, serializer: KSerializer<T>): T = try {
        ProtocolJson.decodeFromString(serializer, body)
    } catch (e: SerializationException) {
        throw HudApiException("Unexpected answer from the HUD", cause = e)
    } catch (e: IllegalArgumentException) {
        throw HudApiException("Unexpected answer from the HUD", cause = e)
    }

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}

/** Suspends until the call completes; cancelling the coroutine cancels the call. */
suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(
        object : Callback {
            override fun onResponse(call: Call, response: Response) {
                continuation.resume(response) { _, value, _ -> value.close() }
            }

            override fun onFailure(call: Call, e: IOException) {
                if (!continuation.isCancelled) continuation.resumeWithException(e)
            }
        },
    )
}
