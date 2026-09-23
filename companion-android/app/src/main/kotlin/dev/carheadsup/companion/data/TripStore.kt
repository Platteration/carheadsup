package dev.carheadsup.companion.data

import android.util.Log
import androidx.core.util.AtomicFile
import dev.carheadsup.protocol.api.TripLog
import dev.carheadsup.protocol.api.TripRecord
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

/**
 * The phone's trip log: trips pushed by the HUD (`trip-completed`), answers to
 * `trips-request` and `GET /api/trips`, merged by id and stored atomically in app storage.
 */
class TripStore(file: File) {
    private val atomicFile = AtomicFile(file)
    private val mutex = Mutex()
    private val state = MutableStateFlow<List<TripRecord>>(emptyList())
    private var loaded = false

    val trips: StateFlow<List<TripRecord>> = state.asStateFlow()

    /** End time of the newest known trip, for `trips-request.since`. */
    val syncCursor: Long get() = TripLog.syncCursor(state.value)

    suspend fun load() {
        mutex.withLock { ensureLoaded() }
    }

    suspend fun merge(incoming: List<TripRecord>) {
        if (incoming.isEmpty()) return
        mutex.withLock {
            ensureLoaded()
            val merged = TripLog.merge(state.value, incoming)
            if (merged != state.value) {
                state.value = merged
                persist(merged)
            }
        }
    }

    suspend fun remove(id: String) {
        mutex.withLock {
            ensureLoaded()
            val remaining = TripLog.remove(state.value, id)
            state.value = remaining
            persist(remaining)
        }
    }

    private suspend fun ensureLoaded() {
        if (loaded) return
        val stored =
            withContext(Dispatchers.IO) {
                try {
                    TripLog.decode(atomicFile.readFully().toString(Charsets.UTF_8))
                } catch (e: IOException) {
                    emptyList()
                }
            }
        state.value = TripLog.merge(stored, state.value)
        loaded = true
    }

    private suspend fun persist(trips: List<TripRecord>) = withContext(Dispatchers.IO) {
        val stream =
            try {
                atomicFile.startWrite()
            } catch (e: IOException) {
                Log.w(TAG, "Cannot write the trip log", e)
                return@withContext
            }
        try {
            stream.write(TripLog.encode(trips).toByteArray(Charsets.UTF_8))
            atomicFile.finishWrite(stream)
        } catch (e: IOException) {
            atomicFile.failWrite(stream)
            Log.w(TAG, "Cannot write the trip log", e)
        }
    }

    private companion object {
        const val TAG = "TripStore"
    }
}
