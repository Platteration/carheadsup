package dev.carheadsup.protocol.pairing

import dev.carheadsup.protocol.link.HudEndpoint
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class PairingAddressTest {
    private val home = HudEndpoint("192.168.1.23", 8443)
    private val hotspot = HudEndpoint("10.42.0.1", 8443)
    private val mdns = HudEndpoint("carheadsup.local", 8443)

    @Test
    fun `takes the first address the phone reached, in the code's order`() {
        assertEquals(hotspot, PairingAddress.choose(listOf(home, hotspot, mdns)) { it == hotspot || it == mdns })
        assertEquals(home, PairingAddress.choose(listOf(home, hotspot, mdns)) { true })
        assertEquals(mdns, PairingAddress.choose(listOf(home, hotspot, mdns)) { it == mdns })
    }

    @Test
    fun `falls back to the first IPv4 address when none was reached`() {
        assertEquals(home, PairingAddress.choose(listOf(home, hotspot, mdns)) { false })
        assertEquals(hotspot, PairingAddress.choose(listOf(mdns, hotspot)) { false })
        assertEquals(mdns, PairingAddress.choose(listOf(mdns)) { false })
        assertNull(PairingAddress.choose(emptyList()) { true })
    }
}
