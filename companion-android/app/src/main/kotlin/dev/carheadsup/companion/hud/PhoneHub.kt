package dev.carheadsup.companion.hud

import dev.carheadsup.protocol.PhoneToHud
import dev.carheadsup.protocol.link.LatestState
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Where every phone-side producer (notification listener, media, calls, location, road data,
 * remote buttons) publishes messages for the HUD, independently of whether a connection exists.
 *
 * State messages are remembered in [LatestState] and replayed by [HudLink] after each `welcome`,
 * so the HUD is brought up to date after a reconnect. Everything is also offered on [outgoing]
 * for a live session; events published while no session is listening are dropped (a message
 * toast from ten minutes ago is not worth showing).
 */
class PhoneHub {
    private val latest = LatestState()
    private val flow =
        MutableSharedFlow<PhoneToHud>(extraBufferCapacity = 128, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    val outgoing: SharedFlow<PhoneToHud> = flow.asSharedFlow()

    fun publish(message: PhoneToHud) {
        latest.record(message)
        flow.tryEmit(message)
    }

    /** State messages to send right after `welcome`. */
    fun replay(): List<PhoneToHud> = latest.replay()
}
