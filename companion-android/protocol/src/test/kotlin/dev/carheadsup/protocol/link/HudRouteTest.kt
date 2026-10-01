package dev.carheadsup.protocol.link

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class HudRouteTest {
    private fun address(name: String, ip: String, prefix: Int) =
        InterfaceAddress(name, HudRoute.parseIpv4(ip)!!, prefix)

    /** Mobile data with a private (carrier) address, as many networks hand out. */
    private val mobile = address("rmnet_data0", "10.160.12.7", 30)

    @Test
    fun `the phone's Wi-Fi always carries the connection`() {
        assertEquals(HudRoute.WIFI, HudRoute.choose("10.42.0.1", onWifi = true, emptyList(), null))
    }

    @Test
    fun `without Wi-Fi or a local network the phone waits instead of dialling over mobile data`() {
        assertEquals(HudRoute.NONE, HudRoute.choose("10.42.0.1", false, listOf(mobile), "rmnet_data0"))
        assertEquals(HudRoute.NONE, HudRoute.choose("hud.local", false, listOf(mobile), "rmnet_data0"))
        assertEquals(HudRoute.NONE, HudRoute.choose("10.42.0.1", false, emptyList(), null))
        // A public address on an interface is not a local network.
        val public = address("rmnet_data1", "81.2.69.160", 24)
        assertEquals(HudRoute.NONE, HudRoute.choose("81.2.69.161", false, listOf(public), "rmnet_data0"))
    }

    @Test
    fun `the phone's own hotspot reaches a HUD on its subnet`() {
        val hotspot = address("swlan0", "192.168.43.1", 24)
        val interfaces = listOf(mobile, hotspot)
        assertEquals(HudRoute.LOCAL, HudRoute.choose("192.168.43.17", false, interfaces, "rmnet_data0"))
        assertEquals(HudRoute.NONE, HudRoute.choose("10.42.0.1", false, interfaces, "rmnet_data0"))
        // A name cannot be checked: try it.
        assertEquals(HudRoute.LOCAL, HudRoute.choose("hud.local", false, interfaces, "rmnet_data0"))
    }

    @Test
    fun `parses dotted-quad IPv4 addresses only`() {
        assertEquals(0x0a2a0001, HudRoute.parseIpv4("10.42.0.1"))
        assertEquals(-1, HudRoute.parseIpv4("255.255.255.255"))
        for (text in listOf("10.42.0", "10.42.0.256", "10.42.0.-1", "10.42..1", "hud.local", "::1", "1.2.3.4.5", "1.2.3.0001")) {
            assertNull(HudRoute.parseIpv4(text), text)
        }
    }

    @Test
    fun `subnets follow the prefix length`() {
        val hotspot = address("ap0", "172.20.10.1", 28)
        assertTrue(hotspot.contains(HudRoute.parseIpv4("172.20.10.14")!!))
        assertFalse(hotspot.contains(HudRoute.parseIpv4("172.20.10.17")!!))
        assertTrue(address("x", "10.0.0.1", 32).contains(HudRoute.parseIpv4("10.0.0.1")!!))
        assertFalse(address("x", "10.0.0.1", 0).contains(HudRoute.parseIpv4("10.0.0.1")!!))
        assertEquals(
            address("wlan1", "192.168.4.1", 24),
            InterfaceAddress.of("wlan1", byteArrayOf(192.toByte(), 168.toByte(), 4, 1), 24),
        )
        assertNull(InterfaceAddress.of("x", ByteArray(16), 64))
    }
}
