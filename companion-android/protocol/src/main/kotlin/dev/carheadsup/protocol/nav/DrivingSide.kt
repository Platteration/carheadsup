package dev.carheadsup.protocol.nav

import java.util.Locale

/**
 * Which side of the road traffic keeps to. It decides the direction of roundabouts and U-turns
 * and the default side of motorway exits, ramps and merges when the instruction does not say.
 */
public enum class DrivingSide {
    RIGHT,
    LEFT,
    ;

    public companion object {
        /** ISO 3166-1 alpha-2 codes of countries and territories that drive on the left. */
        private val LEFT_HAND_TRAFFIC: Set<String> =
            setOf(
                "AG", "AI", "AU", "BB", "BD", "BM", "BN", "BS", "BT", "BW", "CC", "CK", "CX", "CY",
                "DM", "FJ", "FK", "GB", "GD", "GG", "GY", "HK", "ID", "IE", "IM", "IN", "JE", "JM",
                "JP", "KE", "KI", "KN", "KY", "LC", "LK", "LS", "MO", "MS", "MT", "MU", "MV", "MW",
                "MY", "MZ", "NA", "NF", "NP", "NR", "NU", "NZ", "PG", "PK", "PN", "SB", "SC", "SG",
                "SH", "SR", "SZ", "TC", "TH", "TK", "TL", "TO", "TT", "TV", "TZ", "UG", "VC", "VG",
                "VI", "WS", "ZA", "ZM", "ZW",
            )

        /** Driving side of a country (ISO 3166-1 alpha-2); right-hand traffic when unknown. */
        public fun forCountry(countryCode: String?): DrivingSide =
            if (countryCode != null && countryCode.uppercase(Locale.ROOT) in LEFT_HAND_TRAFFIC) LEFT else RIGHT
    }
}
