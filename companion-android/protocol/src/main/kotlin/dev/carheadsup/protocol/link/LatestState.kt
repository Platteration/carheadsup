package dev.carheadsup.protocol.link

import dev.carheadsup.protocol.CallState
import dev.carheadsup.protocol.PhoneCall
import dev.carheadsup.protocol.PhoneHazards
import dev.carheadsup.protocol.PhoneMedia
import dev.carheadsup.protocol.PhoneNav
import dev.carheadsup.protocol.PhoneRoad
import dev.carheadsup.protocol.PhoneToHud

/**
 * Remembers the latest version of every *state* message (nav, road, hazards, media, call) so a
 * fresh HUD session can be brought up to date right after `welcome`: the HUD forgets phone data
 * shortly after a disconnect, and nothing else would resend guidance until Google Maps next
 * updates its notification.
 *
 * Events (message notifications, inputs, pings) and the 1 Hz location stream are not replayed.
 * Thread-safe: producers record from several threads while the connection replays.
 */
public class LatestState {
    private var nav: PhoneNav? = null
    private var road: PhoneRoad? = null
    private var hazards: PhoneHazards? = null
    private var media: PhoneMedia? = null
    private var call: PhoneCall? = null

    /** Remember [message] if it is a state message; returns true when it was recorded. */
    @Synchronized
    public fun record(message: PhoneToHud): Boolean {
        when (message) {
            is PhoneNav -> nav = message
            is PhoneRoad -> road = message
            is PhoneHazards -> hazards = message
            is PhoneMedia -> media = message
            is PhoneCall -> call = message
            else -> return false
        }
        return true
    }

    /**
     * Messages that restore the HUD's view of the phone, in a stable order. An inactive nav is
     * included (it clears guidance the HUD may still hold from before the disconnect); an ended
     * call is not.
     */
    @Synchronized
    public fun replay(): List<PhoneToHud> =
        listOfNotNull(nav, road, hazards, media, call?.takeIf { it.state != CallState.ENDED })

    /** Latest nav state, if any. */
    @Synchronized
    public fun latestNav(): PhoneNav? = nav

    @Synchronized
    public fun clear() {
        nav = null
        road = null
        hazards = null
        media = null
        call = null
    }
}
