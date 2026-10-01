package dev.carheadsup.companion.data

import android.util.Log
import androidx.core.util.AtomicFile
import dev.carheadsup.protocol.PhoneTripsRequest
import dev.carheadsup.protocol.api.TripCursors
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
 * `trips-request` and `GET /api/trips`, merged by id and stored atomically in app storage —
 * and, next to it ([cursorFile]), how far it has caught up with each HUD ([TripCursors]).
 */
class TripStore(file: File, cursorFile: File) {
    private val atomicFile = AtomicFile(file)
    private val cursorAtomicFile = AtomicFile(cursorFile)
    private val mutex = Mutex()
    private val state = MutableStateFlow<List<TripRecord>>(emptyList())
    private var cursors = TripCursors()
    private var loaded = false

    val trips: StateFlow<List<TripRecord>> = state.asStateFlow()

    suspend fun load() {
        mutex.withLock { ensureLoaded() }
    }

    /** The `trips-request` that fetches what the phone is missing from the HUD [hudId]. */
    suspend fun syncRequest(hudId: String): PhoneTripsRequest = mutex.withLock {
        ensureLoaded()
        cursors.request(hudId, state.value)
    }

    /**
     * Merge trips into the log. [fromHud]: the HUD they came from in a `trips` answer or a
     * `trip-completed` push ([pushed]), which moves its sync cursor; null for `GET /api/trips`.
     */
    suspend fun merge(incoming: List<TripRecord>, fromHud: String? = null, pushed: Boolean = false) {
        if (incoming.isEmpty()) return
        mutex.withLock {
            ensureLoaded()
            val merged = TripLog.merge(state.value, incoming)
            if (merged != state.value) {
                state.value = merged
                persist(merged)
            }
            if (fromHud != null) {
                val moved = cursors.received(fromHud, incoming, pushed)
                if (moved != cursors) {
                    cursors = moved
                    write(cursorAtomicFile, moved.encode())
                }
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
        cursors =
            withContext(Dispatchers.IO) {
                try {
                    TripCursors.decode(cursorAtomicFile.readFully().toString(Charsets.UTF_8))
                } catch (e: IOException) {
                    TripCursors()
                }
            }
        loaded = true
    }

    private suspend fun persist(trips: List<TripRecord>) = write(atomicFile, TripLog.encode(trips))

    private suspend fun write(file: AtomicFile, text: String) = withContext(Dispatchers.IO) {
        val stream =
            try {
                file.startWrite()
            } catch (e: IOException) {
                Log.w(TAG, "Cannot write ${file.baseFile.name}", e)
                return@withContext
            }
        try {
            stream.write(text.toByteArray(Charsets.UTF_8))
            file.finishWrite(stream)
        } catch (e: IOException) {
            file.failWrite(stream)
            Log.w(TAG, "Cannot write ${file.baseFile.name}", e)
        }
    }

    private companion object {
        const val TAG = "TripStore"
    }
}
