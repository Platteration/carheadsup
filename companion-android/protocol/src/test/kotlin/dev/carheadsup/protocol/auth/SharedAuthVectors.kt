package dev.carheadsup.protocol.auth

/** One shared test vector of the phone link's authentication. */
internal data class AuthVector(
    val name: String,
    val pairingToken: String,
    val hudId: String,
    val hudNonce: String,
    val phoneNonce: String,
    val deviceId: String,
    val phoneMessage: String,
    val hudMessage: String,
    val phoneProof: String,
    val hudProof: String,
)

/**
 * The vectors of packages/core/test/protocol/phone-auth-vectors.json, which the HUD's tests
 * assert too. Copied here so the module is tested outside the monorepo; `ContractSyncTest`
 * checks that the copy matches the file.
 */
internal val SHARED_AUTH_VECTORS: List<AuthVector> =
    listOf(
        AuthVector(
            name = "a generated pairing code",
            pairingToken = "K7fQ2mZrP4xW9sLt3HvNbC8e",
            hudId = "AAECAwQFBgcICQoLDA0ODw",
            hudNonce = "EBESExQVFhcYGRobHB0eHw",
            phoneNonce = "ICEiIyQlJicoKSorLC0uLw",
            deviceId = "8PHy8_T19vf4-fr7_P3-_w",
            phoneMessage =
            "carheadsup-phone-v2|AAECAwQFBgcICQoLDA0ODw|EBESExQVFhcYGRobHB0eHw|ICEiIyQlJicoKSorLC0uLw|" +
                "8PHy8_T19vf4-fr7_P3-_w",
            hudMessage =
            "carheadsup-hud-v2|AAECAwQFBgcICQoLDA0ODw|ICEiIyQlJicoKSorLC0uLw|EBESExQVFhcYGRobHB0eHw|" +
                "8PHy8_T19vf4-fr7_P3-_w",
            phoneProof = "mm0V3w_MTQxN1Eo5QmrfJ3EpsfnnlUZYJPzZ0YPD62s",
            hudProof = "wIu7H--GvAeClpHJIEVrddKdvL1LPRWflY9h4CG8DMo",
        ),
        AuthVector(
            name = "an open HUD (empty pairing token: the proofs prove nothing)",
            pairingToken = "",
            hudId = "0F1PEGIqj-Lfw5HU0--o3A",
            hudNonce = "IWqiSHn07icsBGDXZ1jvEw",
            phoneNonce = "Ib2P4AqJWWEdZb9Tk6CBaQ",
            deviceId = "eyY6oGK7oEa4VhUVPZ4XmQ",
            phoneMessage =
            "carheadsup-phone-v2|0F1PEGIqj-Lfw5HU0--o3A|IWqiSHn07icsBGDXZ1jvEw|Ib2P4AqJWWEdZb9Tk6CBaQ|" +
                "eyY6oGK7oEa4VhUVPZ4XmQ",
            hudMessage =
            "carheadsup-hud-v2|0F1PEGIqj-Lfw5HU0--o3A|Ib2P4AqJWWEdZb9Tk6CBaQ|IWqiSHn07icsBGDXZ1jvEw|" +
                "eyY6oGK7oEa4VhUVPZ4XmQ",
            phoneProof = "GmjVM7gjJaurBUWegpVTBfMN6e8wzj88G8Km-_zCbpI",
            hudProof = "QrY9nXTMYobGQXjAdojJeAIy83xVFHAuS2tk4-BWuFY",
        ),
        AuthVector(
            name = "a non-ASCII token longer than the HMAC block (64 bytes)",
            pairingToken = "Schlüssel-🚗-" + "0123456789".repeat(7),
            hudId = "oG_h42fNNp4ertynETiz8Q",
            hudNonce = "L3HzDgiW5qck1yK4AWCY4g",
            phoneNonce = "2HNS_iFRw9ok1XZoCV6cbA",
            deviceId = "CnHkRAbj_n7IYFX1YveEzA",
            phoneMessage =
            "carheadsup-phone-v2|oG_h42fNNp4ertynETiz8Q|L3HzDgiW5qck1yK4AWCY4g|2HNS_iFRw9ok1XZoCV6cbA|" +
                "CnHkRAbj_n7IYFX1YveEzA",
            hudMessage =
            "carheadsup-hud-v2|oG_h42fNNp4ertynETiz8Q|2HNS_iFRw9ok1XZoCV6cbA|L3HzDgiW5qck1yK4AWCY4g|" +
                "CnHkRAbj_n7IYFX1YveEzA",
            phoneProof = "TS5sQckGE_X85H_tqb6wgV0kmFHPgYWMaHJxs0sCxw8",
            hudProof = "bEZKzGh9EuJja3P-XY-kOpNbbn9Q_UGZx8vt6g8h67A",
        ),
    )
