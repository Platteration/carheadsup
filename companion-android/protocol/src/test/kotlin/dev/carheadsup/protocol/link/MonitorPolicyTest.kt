package dev.carheadsup.protocol.link

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class MonitorPolicyTest {
    @Test
    fun `nothing runs before the HUD has been connected`() {
        val policy = MonitorPolicy()
        assertFalse(policy.shouldRun(0))
        policy.onLink(false, 1_000)
        assertFalse(policy.shouldRun(1_000))
        assertNull(policy.stopsAt())
    }

    @Test
    fun `runs while connected and for the hold after a disconnect`() {
        val policy = MonitorPolicy(holdMs = 120_000)
        policy.onLink(true, 10_000)
        assertTrue(policy.shouldRun(10_000))
        assertTrue(policy.shouldRun(9_000_000))
        assertNull(policy.stopsAt())
        policy.onLink(false, 50_000)
        assertEquals(170_000L, policy.stopsAt())
        assertTrue(policy.shouldRun(169_999))
        assertFalse(policy.shouldRun(170_000))
        // Repeated "not connected" reports (waiting, retrying) do not extend the hold.
        policy.onLink(false, 160_000)
        assertEquals(170_000L, policy.stopsAt())
        assertFalse(policy.shouldRun(200_000))
    }

    @Test
    fun `a reconnect within the hold keeps everything running`() {
        val policy = MonitorPolicy(holdMs = 120_000)
        policy.onLink(true, 0)
        policy.onLink(false, 1_000)
        policy.onLink(true, 30_000)
        assertNull(policy.stopsAt())
        assertTrue(policy.shouldRun(500_000))
    }

    @Test
    fun `a clock that reads before the disconnect does not count as within the hold`() {
        val policy = MonitorPolicy(holdMs = 120_000)
        policy.onLink(true, 0)
        policy.onLink(false, 50_000)
        assertFalse(policy.shouldRun(49_999))
    }

    @Test
    fun `the hold cannot be negative`() {
        assertThrows(IllegalArgumentException::class.java) { MonitorPolicy(holdMs = -1) }
        val none = MonitorPolicy(holdMs = 0)
        none.onLink(true, 0)
        none.onLink(false, 5)
        assertFalse(none.shouldRun(5))
    }
}
