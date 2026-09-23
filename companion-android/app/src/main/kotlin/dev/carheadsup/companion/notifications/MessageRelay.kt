package dev.carheadsup.companion.notifications

import dev.carheadsup.companion.data.CompanionSettings
import dev.carheadsup.companion.hud.LinkStatus
import dev.carheadsup.companion.hud.PhoneHub
import dev.carheadsup.companion.speech.MessageReader
import dev.carheadsup.protocol.messaging.IncomingMessage
import dev.carheadsup.protocol.messaging.RecentMessageIds
import kotlinx.coroutines.flow.StateFlow

/**
 * Announces incoming messages while the phone is connected to the HUD: the sender goes to the
 * HUD (content never does), and the content is read aloud on the phone when both the HUD
 * (`welcome.readMessagesAloud`) and the driver (app setting) want that.
 *
 * Nothing happens while disconnected, so the phone does not start reading messages aloud at home.
 */
class MessageRelay(
    private val hub: PhoneHub,
    private val linkStatus: StateFlow<LinkStatus>,
    private val settings: StateFlow<CompanionSettings>,
    private val reader: () -> MessageReader,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val recent = RecentMessageIds()

    fun onIncoming(message: IncomingMessage) {
        val connected = linkStatus.value as? LinkStatus.Connected ?: return
        if (!recent.firstSeen(message.id, clock())) return
        val text = message.spokenText?.takeIf { connected.readMessagesAloud && settings.value.readMessagesAloud }
        hub.publish(message.toPhoneMessage(readingAloud = text != null))
        if (text != null) reader().speak(message.id, message.sender, text)
    }
}
