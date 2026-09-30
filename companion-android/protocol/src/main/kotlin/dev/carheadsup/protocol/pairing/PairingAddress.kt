package dev.carheadsup.protocol.pairing

import dev.carheadsup.protocol.link.HudEndpoint

/** Which of the HUD's addresses a scanned pairing code sets as the phone's HUD address. */
public object PairingAddress {
    /**
     * The first of [candidates] (the code's order: the HUD's IPv4 addresses, then its mDNS name)
     * that [reachable] says the phone reached just now — or, when none was reached (the phone is
     * not on the car's Wi-Fi yet), the first IPv4 address, else the first candidate: the link
     * keeps trying it. Null only for no candidates.
     */
    public fun choose(candidates: List<HudEndpoint>, reachable: (HudEndpoint) -> Boolean): HudEndpoint? =
        candidates.firstOrNull(reachable)
            ?: candidates.firstOrNull { it.host.all { c -> c.isDigit() || c == '.' } }
            ?: candidates.firstOrNull()
}
