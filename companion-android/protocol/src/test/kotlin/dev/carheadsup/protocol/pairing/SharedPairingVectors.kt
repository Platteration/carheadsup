package dev.carheadsup.protocol.pairing

/** A pairing URI and what it carries. */
internal data class PairingVector(
    val name: String,
    val uri: String,
    val canonical: Boolean,
    val payload: PairingPayload,
)

/** A text that is not a usable pairing URI, and why: "foreign", "unsupported-version" or "invalid". */
internal data class InvalidPairingVector(val name: String, val uri: String, val error: String)

/**
 * The vectors of packages/core/test/protocol/pairing-uri-vectors.json, which the HUD's tests assert too. Copied here so
 * the module is tested outside the monorepo; `ContractSyncTest` checks that the copy matches the file.
 */
internal val SHARED_PAIRING_VECTORS: List<PairingVector> =
    listOf(
        PairingVector(
            name = "a generated pairing code on the HUD's own hotspot",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=84" +
                "43&n=My%20car%20HUD",
            canonical = true,
            payload =
            PairingPayload(
                hudId = "AAECAwQFBgcICQoLDA0ODw",
                certFingerprint = "fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531",
                pairingToken = "K7fQ2mZrP4xW9sLt3HvNbC8e",
                hosts = listOf("10.42.0.1", "carheadsup.local"),
                tlsPort = 8443,
                hudName = "My car HUD",
            ),
        ),
        PairingVector(
            name = "several hosts, another port and a name that needs escaping",
            uri =
            "carheadsup://pair?v=1&id=oG_h42fNNp4ertynETiz8Q&fp=86b0ec535a321bed42214e40d472b80f52f1d" +
                "72facaab85c8db67f54be08b718&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=192.168.1.23,10.42.0.1,hud-pi.l" +
                "ocal&p=9443&n=Golf%20%26%20Co%20%C2%B7%207%20HUD",
            canonical = true,
            payload =
            PairingPayload(
                hudId = "oG_h42fNNp4ertynETiz8Q",
                certFingerprint = "86b0ec535a321bed42214e40d472b80f52f1d72facaab85c8db67f54be08b718",
                pairingToken = "K7fQ2mZrP4xW9sLt3HvNbC8e",
                hosts = listOf("192.168.1.23", "10.42.0.1", "hud-pi.local"),
                tlsPort = 9443,
                hudName = "Golf & Co · 7 HUD",
            ),
        ),
        PairingVector(
            name = "a token with every kind of character to escape, and no name",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=p%40ss%20w0rd%2F%3F%26%3D%23%25%2B%2C%3B%3A%27%21%2A%28%29" +
                "~._-Schl%C3%BCssel-%F0%9F%9A%97&h=10.42.0.1,carheadsup.local&p=8443",
            canonical = true,
            payload =
            PairingPayload(
                hudId = "AAECAwQFBgcICQoLDA0ODw",
                certFingerprint = "fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531",
                pairingToken = "p@ss w0rd/?&=#%+,;:'!*()~._-Schlüssel-🚗",
                hosts = listOf("10.42.0.1", "carheadsup.local"),
                tlsPort = 8443,
                hudName = null,
            ),
        ),
        PairingVector(
            name = "the longest token and the most hosts",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=0123456789abcdef0123456789abcdef0123456789abcdef0123456789" +
                "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01" +
                "23456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" +
                "abcdef0123456789abcdef&h=10.42.0.1,192.168.4.1,172.16.0.7,10.0.0.2,192.168.1.23,100.64.0" +
                ".5,a.b,carheadsup.local&p=8443&n=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" +
                "xxxx%20HUD",
            canonical = true,
            payload =
            PairingPayload(
                hudId = "AAECAwQFBgcICQoLDA0ODw",
                certFingerprint = "fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531",
                pairingToken =
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567" +
                    "89abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" +
                    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                hosts =
                listOf(
                    "10.42.0.1",
                    "192.168.4.1",
                    "172.16.0.7",
                    "10.0.0.2",
                    "192.168.1.23",
                    "100.64.0.5",
                    "a.b",
                    "carheadsup.local",
                ),
                tlsPort = 8443,
                hudName = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx HUD",
            ),
        ),
        PairingVector(
            name =
            "upper-case scheme and host, surrounding white space, an unknown parameter and a fragment",
            uri =
            " \tCARHEADSUP://Pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&x-later=anything&fp=fdc153eedca2b5364" +
                "dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1&p" +
                "=8443#top\r\n",
            canonical = false,
            payload =
            PairingPayload(
                hudId = "AAECAwQFBgcICQoLDA0ODw",
                certFingerprint = "fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531",
                pairingToken = "K7fQ2mZrP4xW9sLt3HvNbC8e",
                hosts = listOf("10.42.0.1"),
                tlsPort = 8443,
                hudName = null,
            ),
        ),
        PairingVector(
            name = "parameters in another order, lower-case escapes and an unescaped space",
            uri =
            "carheadsup://pair?p=8443&n=My%20car HUD&h=10.42.0.1,carheadsup.local&k=K7fQ2mZrP4xW9sLt3" +
                "HvNbC8e&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531&id=AAECAwQFB" +
                "gcICQoLDA0ODw&v=%31",
            canonical = false,
            payload =
            PairingPayload(
                hudId = "AAECAwQFBgcICQoLDA0ODw",
                certFingerprint = "fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531",
                pairingToken = "K7fQ2mZrP4xW9sLt3HvNbC8e",
                hosts = listOf("10.42.0.1", "carheadsup.local"),
                tlsPort = 8443,
                hudName = "My car HUD",
            ),
        ),
        PairingVector(
            name = "a plus sign stays a plus sign (it is not a space)",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ+2mZr&h=carheadsup.local&p=8443",
            canonical = false,
            payload =
            PairingPayload(
                hudId = "AAECAwQFBgcICQoLDA0ODw",
                certFingerprint = "fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531",
                pairingToken = "K7fQ+2mZr",
                hosts = listOf("carheadsup.local"),
                tlsPort = 8443,
                hudName = null,
            ),
        ),
    )

/** The refused texts of the same file (`invalid`). */
internal val SHARED_INVALID_PAIRING_VECTORS: List<InvalidPairingVector> =
    listOf(
        InvalidPairingVector(
            name = "a web address",
            uri = "https://example.com/pair?v=1",
            error = "foreign",
        ),
        InvalidPairingVector(
            name = "a Wi-Fi network's QR code",
            uri = "WIFI:S:My car;T:WPA;P:secret;;",
            error = "foreign",
        ),
        InvalidPairingVector(
            name = "plain text",
            uri = "hello",
            error = "foreign",
        ),
        InvalidPairingVector(
            name = "nothing at all",
            uri = "",
            error = "foreign",
        ),
        InvalidPairingVector(
            name = "another carheadsup address",
            uri = "carheadsup://pairing?v=1",
            error = "foreign",
        ),
        InvalidPairingVector(
            name = "a pairing URI of a later version",
            uri =
            "carheadsup://pair?v=2&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&h=10.42.0.1,carheadsup.local&p=8443&n=My%20car%20HUD",
            error = "unsupported-version",
        ),
        InvalidPairingVector(
            name = "no version",
            uri =
            "carheadsup://pair?id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4c28b" +
                "e52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=8443&n" +
                "=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "version 0",
            uri =
            "carheadsup://pair?v=0&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=84" +
                "43&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "no pairing token",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&h=10.42.0.1,carheadsup.local&p=8443&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "an empty pairing token",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=&h=10.42.0.1,carheadsup.local&p=8443&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a token longer than 256 characters",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
                "aaaaaaaaaaaaaaaaaaaaaaa&h=10.42.0.1,carheadsup.local&p=8443&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a HUD id of the wrong length",
            uri =
            "carheadsup://pair?v=1&id=AECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4c" +
                "28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=844" +
                "3&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "an upper-case fingerprint",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=FDC153EEDCA2B5364DD71C13E90AFD8D47FF4" +
                "C28BE52F39BB2666A72BFDD4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=84" +
                "43&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a short fingerprint",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=c153eedca2b5364dd71c13e90afd8d47ff4c2" +
                "8be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=8443" +
                "&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "port 0",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=0&" +
                "n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "port 65536",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=65" +
                "536&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a port with a leading zero",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=08" +
                "443&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "no hosts",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=&p=8443&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "an empty host between commas",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,,carheadsup.local&p=8" +
                "443&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "digits and dots that are no IPv4 address",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=999.1.1.1&p=8443&n=My%20car%20H" +
                "UD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "an IPv4 address with a leading zero",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.01&p=8443&n=My%20car%20" +
                "HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "an IPv6 address",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=fe80::1&p=8443&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a host name with an underscore",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=car_hud.local&p=8443&n=My%20car" +
                "%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "nine hosts",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.0.0.1,10.0.0.2,10.0.0.3,10.0" +
                ".0.4,10.0.0.5,10.0.0.6,10.0.0.7,10.0.0.8,10.0.0.9&p=8443&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a name longer than 63 bytes",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=84" +
                "43&n=%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%B" +
                "C%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3%BC%C3" +
                "%BC%C3%BC%C3%BC%C3%BC",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a name with a line break",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=84" +
                "43&n=My%0Acar",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "an empty name",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=84" +
                "43&n=",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a parameter twice",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=84" +
                "43&n=My%20car%20HUD&k=K7fQ2mZrP4xW9sLt3HvNbC8e",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a parameter without a value",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=84" +
                "43&n=My%20car%20HUD&n",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a trailing ampersand",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=84" +
                "43&n=My%20car%20HUD&",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a malformed escape",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=abc%G1&h=10.42.0.1,carheadsup.local&p=8443&n=My%20car%20HU" +
                "D",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a cut-off escape",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=abc%4&h=10.42.0.1,carheadsup.local&p=8443&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "escaped bytes that are not UTF-8",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=abc%FF&h=10.42.0.1,carheadsup.local&p=8443&n=My%20car%20HU" +
                "D",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "an overlong UTF-8 encoding",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=abc%C0%AF&h=10.42.0.1,carheadsup.local&p=8443&n=My%20car%2" +
                "0HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "an escaped UTF-16 surrogate",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=abc%ED%A0%80&h=10.42.0.1,carheadsup.local&p=8443&n=My%20ca" +
                "r%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a look-alike of the pairing address",
            uri =
            "carheadsup://pair.example.com?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e" +
                "90afd8d47ff4c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsu" +
                "p.local&p=8443&n=My%20car%20HUD",
            error = "foreign",
        ),
        InvalidPairingVector(
            name = "user information before the pairing address",
            uri =
            "carheadsup://user@pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d" +
                "47ff4c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local" +
                "&p=8443&n=My%20car%20HUD",
            error = "foreign",
        ),
        InvalidPairingVector(
            name = "a port on the pairing address",
            uri =
            "carheadsup://pair:8443?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d" +
                "47ff4c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local" +
                "&p=8443&n=My%20car%20HUD",
            error = "foreign",
        ),
        InvalidPairingVector(
            name = "a host label longer than 63 characters",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.local&p=8443&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a host longer than 253 characters",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
                "aaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaa" +
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&p=8443&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a host name starting with a hyphen",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=-hud.local&p=8443&n=My%20car%20" +
                "HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a host with a port",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1:8443&p=8443&n=My%20ca" +
                "r%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "an escaped slash in a host",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=evil.example%2Fpath&p=8443&n=My" +
                "%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a web address as a host",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=https%3A%2F%2Fevil.example&p=84" +
                "43&n=My%20car%20HUD",
            error = "invalid",
        ),
        InvalidPairingVector(
            name = "a name with a C1 control character",
            uri =
            "carheadsup://pair?v=1&id=AAECAwQFBgcICQoLDA0ODw&fp=fdc153eedca2b5364dd71c13e90afd8d47ff4" +
                "c28be52f39bb2666a72bfdd4531&k=K7fQ2mZrP4xW9sLt3HvNbC8e&h=10.42.0.1,carheadsup.local&p=84" +
                "43&n=My%C2%85car",
            error = "invalid",
        ),
    )
