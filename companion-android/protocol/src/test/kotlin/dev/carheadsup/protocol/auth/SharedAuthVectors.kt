package dev.carheadsup.protocol.auth

/** One shared test vector of the phone link's authentication. */
internal data class AuthVector(
    val name: String,
    val pairingToken: String,
    val hudId: String,
    val hudNonce: String,
    val phoneNonce: String,
    val deviceId: String,
    val certFingerprint: String,
    val phoneMessage: String,
    val hudMessage: String,
    val phoneProof: String,
    val hudProof: String,
)

/** A certificate made by the HUD's generator, with its fingerprint and the short form people compare. */
internal data class CertificateVector(
    val name: String,
    /** The certificate's DER bytes, base64. */
    val der: String,
    val fingerprint: String,
    val short: String,
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
            certFingerprint = "fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531",
            phoneMessage =
            "carheadsup-phone-v3|AAECAwQFBgcICQoLDA0ODw|EBESExQVFhcYGRobHB0eHw|ICEiIyQlJicoKSorLC0uLw|" +
                "8PHy8_T19vf4-fr7_P3-_w|fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531",
            hudMessage =
            "carheadsup-hud-v3|AAECAwQFBgcICQoLDA0ODw|ICEiIyQlJicoKSorLC0uLw|EBESExQVFhcYGRobHB0eHw|" +
                "8PHy8_T19vf4-fr7_P3-_w|fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531",
            phoneProof = "llVyYellZIIYR5tEC9APzsA-YTGRKi45irjLwiuenwc",
            hudProof = "VGcXTWHc-snsk4-LN_Foi-sePPjY8kR6nMQSCQdhUHs",
        ),
        AuthVector(
            name = "the same session through a relay with a certificate of its own",
            pairingToken = "K7fQ2mZrP4xW9sLt3HvNbC8e",
            hudId = "AAECAwQFBgcICQoLDA0ODw",
            hudNonce = "EBESExQVFhcYGRobHB0eHw",
            phoneNonce = "ICEiIyQlJicoKSorLC0uLw",
            deviceId = "8PHy8_T19vf4-fr7_P3-_w",
            certFingerprint = "86b0ec535a321bed42214e40d472b80f52f1d72facaab85c8db67f54be08b718",
            phoneMessage =
            "carheadsup-phone-v3|AAECAwQFBgcICQoLDA0ODw|EBESExQVFhcYGRobHB0eHw|ICEiIyQlJicoKSorLC0uLw|" +
                "8PHy8_T19vf4-fr7_P3-_w|86b0ec535a321bed42214e40d472b80f52f1d72facaab85c8db67f54be08b718",
            hudMessage =
            "carheadsup-hud-v3|AAECAwQFBgcICQoLDA0ODw|ICEiIyQlJicoKSorLC0uLw|EBESExQVFhcYGRobHB0eHw|" +
                "8PHy8_T19vf4-fr7_P3-_w|86b0ec535a321bed42214e40d472b80f52f1d72facaab85c8db67f54be08b718",
            phoneProof = "Sf21v5UaVEOd7xgDErliULuQKjFZkPTooY5XYuB-OUw",
            hudProof = "NvPZB1Sd-34KCRis0al7SjNaHODYQRuziiRIS17jrDw",
        ),
        AuthVector(
            name = "an open HUD (empty pairing token: the proofs prove nothing)",
            pairingToken = "",
            hudId = "0F1PEGIqj-Lfw5HU0--o3A",
            hudNonce = "IWqiSHn07icsBGDXZ1jvEw",
            phoneNonce = "Ib2P4AqJWWEdZb9Tk6CBaQ",
            deviceId = "eyY6oGK7oEa4VhUVPZ4XmQ",
            certFingerprint = "fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531",
            phoneMessage =
            "carheadsup-phone-v3|0F1PEGIqj-Lfw5HU0--o3A|IWqiSHn07icsBGDXZ1jvEw|Ib2P4AqJWWEdZb9Tk6CBaQ|" +
                "eyY6oGK7oEa4VhUVPZ4XmQ|fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531",
            hudMessage =
            "carheadsup-hud-v3|0F1PEGIqj-Lfw5HU0--o3A|Ib2P4AqJWWEdZb9Tk6CBaQ|IWqiSHn07icsBGDXZ1jvEw|" +
                "eyY6oGK7oEa4VhUVPZ4XmQ|fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531",
            phoneProof = "o_RzVM_3IAYzd_ybnAO5ZnX4WVX6HYEHzrbIMgnwRc0",
            hudProof = "kujbQYBqObm2BtWxsxtacYRwPoVSroANzJADEEimTXE",
        ),
        AuthVector(
            name = "a non-ASCII token longer than the HMAC block (64 bytes)",
            pairingToken = "Schlüssel-🚗-" + "0123456789".repeat(7),
            hudId = "oG_h42fNNp4ertynETiz8Q",
            hudNonce = "L3HzDgiW5qck1yK4AWCY4g",
            phoneNonce = "2HNS_iFRw9ok1XZoCV6cbA",
            deviceId = "CnHkRAbj_n7IYFX1YveEzA",
            certFingerprint = "86b0ec535a321bed42214e40d472b80f52f1d72facaab85c8db67f54be08b718",
            phoneMessage =
            "carheadsup-phone-v3|oG_h42fNNp4ertynETiz8Q|L3HzDgiW5qck1yK4AWCY4g|2HNS_iFRw9ok1XZoCV6cbA|" +
                "CnHkRAbj_n7IYFX1YveEzA|86b0ec535a321bed42214e40d472b80f52f1d72facaab85c8db67f54be08b718",
            hudMessage =
            "carheadsup-hud-v3|oG_h42fNNp4ertynETiz8Q|2HNS_iFRw9ok1XZoCV6cbA|L3HzDgiW5qck1yK4AWCY4g|" +
                "CnHkRAbj_n7IYFX1YveEzA|86b0ec535a321bed42214e40d472b80f52f1d72facaab85c8db67f54be08b718",
            phoneProof = "Vv0tAzOLf_4fn_hux53Kcs5XZOBRfxZTGUIYVoeKjYM",
            hudProof = "IzrlvLzkC4Is8iYqOZKUYOnirM3zKDHPzV1uxpr62PU",
        ),
        AuthVector(
            name = "a plain ws:// session (server.allowPlainPhone: nothing bound)",
            pairingToken = "K7fQ2mZrP4xW9sLt3HvNbC8e",
            hudId = "AAECAwQFBgcICQoLDA0ODw",
            hudNonce = "EBESExQVFhcYGRobHB0eHw",
            phoneNonce = "ICEiIyQlJicoKSorLC0uLw",
            deviceId = "8PHy8_T19vf4-fr7_P3-_w",
            certFingerprint = "",
            phoneMessage =
            "carheadsup-phone-v3|AAECAwQFBgcICQoLDA0ODw|EBESExQVFhcYGRobHB0eHw|ICEiIyQlJicoKSorLC0uLw|" +
                "8PHy8_T19vf4-fr7_P3-_w|",
            hudMessage =
            "carheadsup-hud-v3|AAECAwQFBgcICQoLDA0ODw|ICEiIyQlJicoKSorLC0uLw|EBESExQVFhcYGRobHB0eHw|" +
                "8PHy8_T19vf4-fr7_P3-_w|",
            phoneProof = "mr2c5hZ4aKI51ftiIOscGyL3o71Tv2hTRLDS2YXPFRE",
            hudProof = "xaodW99tyLl6WoUioMkqvPtSqd6kaKVX2cDWO1xc9zM",
        ),
    )

/** The certificates of the same file (`certificates`). */
internal val SHARED_CERTIFICATE_VECTORS: List<CertificateVector> =
    listOf(
        CertificateVector(
            name = "the test HUD (companion-android/protocol/src/test/resources/tls/hud.pem)",
            der =
            "MIICLDCCAdKgAwIBAgIQGX4OZYUHvgLsVwf6/7vwrDAKBggqhkjOPQQDAjBAMRMwEQYDVQQKDApjYXJoZWFkc3VwMSkwJwYD" +
                "VQQDDCBjYXJoZWFkc3VwIEhVRCAoY2FyaGVhZHN1cC10ZXN0KTAgFw0yNjAxMDEwMDAwMDBaGA85OTk5MTIzMTIzNTk1OVow" +
                "QDETMBEGA1UECgwKY2FyaGVhZHN1cDEpMCcGA1UEAwwgY2FyaGVhZHN1cCBIVUQgKGNhcmhlYWRzdXAtdGVzdCkwWTATBgcq" +
                "hkjOPQIBBggqhkjOPQMBBwNCAAQsP1uyMszYQZkRbQZ3AQ/P3EOW6p3SyA7uQ/lOBXbjdo4dgzQf2yBI/4tXVwXP1MpxO7KW" +
                "jCqK3aLITe0fYBGGo4GrMIGoMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMB0G" +
                "A1UdDgQWBBQf77fztbDpGoE0sdzlnpw0ggP7zjBUBgNVHREETTBLgg9jYXJoZWFkc3VwLXRlc3SCFWNhcmhlYWRzdXAtdGVz" +
                "dC5sb2NhbIIJbG9jYWxob3N0hwR/AAABhxAAAAAAAAAAAAAAAAAAAAABMAoGCCqGSM49BAMCA0gAMEUCIQD2wIoxBmww+cv+" +
                "HMyg5asWrQh78OyE3M9WJvSR2S/D8wIgedesiWGUr9bnpoMh7OskSTeEk6Ts8PcpBO/6O8IU4EY=",
            fingerprint = "fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531",
            short = "FDC1 53EE DCA2 B536 4DD7",
        ),
        CertificateVector(
            name = "a relay (companion-android/protocol/src/test/resources/tls/relay.pem)",
            der =
            "MIICBDCCAaqgAwIBAgIQdGeQ2WqFw1Ctj74lYaakmTAKBggqhkjOPQQDAjA2MRMwEQYDVQQKDApjYXJoZWFkc3VwMR8wHQYD" +
                "VQQDDBZjYXJoZWFkc3VwIEhVRCAocmVsYXkpMCAXDTI2MDEwMTAwMDAwMFoYDzk5OTkxMjMxMjM1OTU5WjA2MRMwEQYDVQQK" +
                "DApjYXJoZWFkc3VwMR8wHQYDVQQDDBZjYXJoZWFkc3VwIEhVRCAocmVsYXkpMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE" +
                "bhRFpxcr95D+sR/hxGEwjEJzoJQiaUw9gVcz7RCrm0gqGy0prN7rZQ5VY6bRkIZmpffH6mjfnZGV20f1KvPpmKOBlzCBlDAM" +
                "BgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAdBgNVHQ4EFgQUGjsgDwcZoX7iXmkh" +
                "4hC0Q3kzdN0wQAYDVR0RBDkwN4IFcmVsYXmCC3JlbGF5LmxvY2Fsgglsb2NhbGhvc3SHBH8AAAGHEAAAAAAAAAAAAAAAAAAA" +
                "AAEwCgYIKoZIzj0EAwIDSAAwRQIhAObfdtP4uAe0mlOG2lfK+mfLS/XY/jvuQbd6qBXcf8OmAiB/MjDd2QbNTJFVcKNw4AlI" +
                "QXsTS4L0T+Hkxx/JaBRNug==",
            fingerprint = "86b0ec535a321bed42214e40d472b80f52f1d72facaab85c8db67f54be08b718",
            short = "86B0 EC53 5A32 1BED 4221",
        ),
    )
