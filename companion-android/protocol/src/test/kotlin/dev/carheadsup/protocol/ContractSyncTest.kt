package dev.carheadsup.protocol

import dev.carheadsup.protocol.auth.AuthVector
import dev.carheadsup.protocol.auth.CertFingerprint
import dev.carheadsup.protocol.auth.CertificateVector
import dev.carheadsup.protocol.auth.PairingCode
import dev.carheadsup.protocol.auth.PhoneAuth
import dev.carheadsup.protocol.auth.SHARED_AUTH_VECTORS
import dev.carheadsup.protocol.auth.SHARED_CERTIFICATE_VECTORS
import dev.carheadsup.protocol.link.HudAdvertisement
import dev.carheadsup.protocol.link.HudEndpoint
import dev.carheadsup.protocol.link.PhoneCloseCode
import dev.carheadsup.protocol.pairing.InvalidPairingVector
import dev.carheadsup.protocol.pairing.PairingPayload
import dev.carheadsup.protocol.pairing.PairingUri
import dev.carheadsup.protocol.pairing.PairingVector
import dev.carheadsup.protocol.pairing.SHARED_INVALID_PAIRING_VECTORS
import dev.carheadsup.protocol.pairing.SHARED_PAIRING_VECTORS
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.elementNames
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Guards against drift between this module and the TypeScript contract in
 * packages/core/src/types (read straight from the monorepo checkout). Skipped when the module is
 * built outside the repository.
 */
class ContractSyncTest {
    private val repoRoot: File? =
        generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
            .firstOrNull { File(it, "packages/core/src/types/protocol.ts").isFile }

    private fun source(path: String): String {
        assumeTrue(repoRoot != null, "TypeScript contract not found; skipping contract sync checks")
        return File(repoRoot, path).readText()
    }

    private fun serialNames(serializer: KSerializer<*>): List<String> =
        (0 until serializer.descriptor.elementsCount).map { serializer.descriptor.getElementName(it) }

    /** Serial names of the subclasses of a sealed type (the descriptor's "value" element). */
    private fun sealedSubclassNames(serializer: KSerializer<*>): Set<String> =
        serializer.descriptor.getElementDescriptor(1).elementNames.toSet()

    /** String literals of `export const NAME = [ … ] as const`. */
    private fun constArray(ts: String, name: String): List<String> {
        val body = Regex(
            "export const $name(?::[^=]+)? = \\[(.*?)]",
            RegexOption.DOT_MATCHES_ALL,
        ).find(ts)!!.groupValues[1]
        return Regex("'([^']+)'").findAll(body.replace(Regex("/\\*\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")).map {
            it.groupValues[1]
        }.toList()
    }

    /** Members of a string-literal union `export type NAME = 'a' | 'b'`. */
    private fun literalUnion(ts: String, name: String): Set<String> {
        val body = Regex("export type $name =(.*?);", RegexOption.DOT_MATCHES_ALL).find(ts)!!.groupValues[1]
        return Regex("'([^']+)'").findAll(body.replace(Regex("/\\*\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")).map {
            it.groupValues[1]
        }.toSet()
    }

    @Test
    fun `nav enums match nav_ts`() {
        val nav = source("packages/core/src/types/nav.ts")
        assertEquals(constArray(nav, "MANEUVER_TYPES"), serialNames(ManeuverType.serializer()))
        assertEquals(constArray(nav, "LANE_DIRECTIONS"), serialNames(LaneDirection.serializer()))
        assertEquals(constArray(nav, "HAZARD_TYPES"), serialNames(HazardType.serializer()))
        assertEquals(literalUnion(nav, "RoadClass"), serialNames(RoadClass.serializer()).toSet())
    }

    @Test
    fun `phone, input and record enums match the contract`() {
        assertEquals(
            literalUnion(source("packages/core/src/types/phone.ts"), "CallState"),
            serialNames(CallState.serializer()).toSet(),
        )
        assertEquals(
            constArray(source("packages/core/src/types/events.ts"), "INPUT_ACTIONS"),
            serialNames(InputAction.serializer()),
        )
        assertEquals(
            literalUnion(source("packages/core/src/types/records.ts"), "MaintenanceStatusKind"),
            serialNames(MaintenanceStatusKind.serializer()).toSet(),
        )
    }

    @Test
    fun `message type names and protocol version match protocol_ts`() {
        val protocol = source("packages/core/src/types/protocol.ts")
        fun typesOf(unionName: String): Set<String> {
            val members = literalUnionOfTypes(protocol, unionName)
            return members.map { iface ->
                Regex("export interface $iface \\{\\s*t: '([^']+)'").find(protocol)!!.groupValues[1]
            }.toSet()
        }
        assertEquals(typesOf("PhoneToHud"), sealedSubclassNames(PhoneToHud.serializer()))
        assertEquals(typesOf("HudToPhone"), sealedSubclassNames(HudToPhone.serializer()))
        val version = Regex("export const PROTOCOL_VERSION = (\\d+);").find(protocol)!!.groupValues[1].toInt()
        assertEquals(version, PROTOCOL_VERSION)
        val errorCodes = Regex("code: ([^;]+);").find(protocol)!!.groupValues[1]
        assertEquals(
            Regex("'([^']+)'").findAll(errorCodes).map {
                it.groupValues[1]
            }.toSet(),
            serialNames(HudErrorCode.serializer()).toSet(),
        )
    }

    private fun literalUnionOfTypes(ts: String, name: String): List<String> {
        val body = Regex("export type $name =(.*?);", RegexOption.DOT_MATCHES_ALL).find(ts)!!.groupValues[1]
        return body.split('|').map { it.trim() }.filter { it.isNotEmpty() }
    }

    @Test
    fun `close codes match the HUD's phone channel`() {
        val channel = source("packages/hud-server/src/ws/phone-channel.ts")
        fun code(key: String): Int =
            Regex("\\b$key: (\\d+),").find(channel.substringAfter("export const PHONE_CLOSE"))!!.groupValues[1].toInt()
        assertEquals(code("replaced"), PhoneCloseCode.REPLACED)
        assertEquals(code("badToken"), PhoneCloseCode.BAD_TOKEN)
        assertEquals(code("unsupportedVersion"), PhoneCloseCode.UNSUPPORTED_VERSION)
        assertEquals(code("busy"), PhoneCloseCode.BUSY)
        assertEquals(code("backlog"), PhoneCloseCode.NOT_READING)
    }

    @Test
    fun `wire limits match the HUD validator`() {
        val validate = source("packages/core/src/protocol/validate.ts")
        fun limit(key: String): Int {
            val expr = Regex("\\b$key: ([^,]+),").find(validate)!!.groupValues[1].substringBefore("//").trim()
            return expr.replace(Regex("(?<=\\d)_(?=\\d)"), "").split('*').map { it.trim() }.fold(1) { acc, factor ->
                acc *
                    (
                        factor.toIntOrNull()
                            ?: if (factor == "LANE_DIRECTIONS.length") LaneDirection.entries.size else error(factor)
                        )
            }
        }
        assertEquals(limit("phoneFrameChars"), WireLimits.PHONE_FRAME_CHARS)
        assertEquals(limit("name"), WireLimits.NAME)
        assertEquals(limit("mediaText"), WireLimits.MEDIA_TEXT)
        assertEquals(limit("id"), WireLimits.ID)
        assertEquals(limit("trackKey"), WireLimits.TRACK_KEY)
        assertEquals(limit("text"), WireLimits.TEXT)
        assertEquals(limit("version"), WireLimits.VERSION)
        assertEquals(limit("phoneNumber"), WireLimits.PHONE_NUMBER)
        assertEquals(limit("iconPngBase64"), WireLimits.ICON_PNG_BASE64)
        assertEquals(limit("lanes"), WireLimits.LANES)
        assertEquals(limit("laneDirections"), WireLimits.LANE_DIRECTIONS)
        assertEquals(limit("hazards"), WireLimits.HAZARDS)
    }

    @Test
    fun `authentication constants match phone-auth_ts and the config schema`() {
        val auth = source("packages/core/src/protocol/phone-auth.ts")
        fun constant(key: String): String =
            Regex("\\b$key: '?([^',]+)'?,").find(auth.substringAfter("export const PHONE_AUTH"))!!.groupValues[1]
        assertEquals(constant("phoneContext"), PhoneAuth.PHONE_CONTEXT)
        assertEquals(constant("hudContext"), PhoneAuth.HUD_CONTEXT)
        assertEquals(constant("idChars").toInt(), PhoneAuth.ID_CHARS)
        assertEquals(constant("proofChars").toInt(), PhoneAuth.PROOF_CHARS)
        assertEquals(constant("fingerprintChars").toInt(), CertFingerprint.CHARS)
        assertEquals(constant("shortFingerprintChars").toInt(), CertFingerprint.SHORT_CHARS)
        assertEquals(maxPairingTokenChars(), PhoneAuth.MAX_TOKEN_CHARS)
    }

    private fun maxPairingTokenChars(): Int =
        Regex("export const MAX_PAIRING_TOKEN_CHARS = (\\d+);")
            .find(source("packages/core/src/config/tokens.ts"))!!
            .groupValues[1]
            .toInt()

    @Test
    fun `the pairing-token rule matches tokens_ts and the config schema`() {
        val tokens = source("packages/core/src/config/tokens.ts")
        assertEquals(maxPairingTokenChars(), PairingCode.MAX_CHARS)
        val range = Regex("""const PAIRING_TOKEN_TEXT = /\^\[\\x([0-9a-f]{2})-\\x([0-9a-f]{2})\]\*\$/;""").find(tokens)!!
        assertEquals(PairingCode.FIRST_CHAR.code, range.groupValues[1].toInt(16))
        assertEquals(PairingCode.LAST_CHAR.code, range.groupValues[2].toInt(16))
        // The phone says what the HUD says.
        for (token in listOf("two words", "Schlüssel")) {
            assertTrue(tokens.contains("'${PairingCode.problem(token)}'"), token)
        }
        val schema = source("packages/core/src/config/schema.ts")
        assertTrue(schema.contains("pairingToken: pairingTokenSchema,"))
        assertTrue(schema.contains("const pairingTokenSchema = text(0, MAX_PAIRING_TOKEN_CHARS)"))
        assertTrue(schema.contains("pairingTokenTextProblem(token)"))
    }

    @Test
    fun `the copied authentication vectors are the ones the HUD asserts`() {
        val file = ProtocolJson.parseToJsonElement(source("packages/core/test/protocol/phone-auth-vectors.json"))
        val vectors =
            file.jsonObject.getValue("vectors").jsonArray.map { element ->
                val v = element.jsonObject
                fun field(name: String): String = v.getValue(name).jsonPrimitive.content
                AuthVector(
                    name = field("name"),
                    pairingToken = field("pairingToken"),
                    hudId = field("hudId"),
                    hudNonce = field("hudNonce"),
                    phoneNonce = field("phoneNonce"),
                    deviceId = field("deviceId"),
                    certFingerprint = field("certFingerprint"),
                    phoneMessage = field("phoneMessage"),
                    hudMessage = field("hudMessage"),
                    phoneProof = field("phoneProof"),
                    hudProof = field("hudProof"),
                )
            }
        assertEquals(vectors, SHARED_AUTH_VECTORS)
        val certificates =
            file.jsonObject.getValue("certificates").jsonArray.map { element ->
                val c = element.jsonObject
                fun field(name: String): String = c.getValue(name).jsonPrimitive.content
                CertificateVector(field("name"), field("der"), field("fingerprint"), field("short"))
            }
        assertEquals(certificates, SHARED_CERTIFICATE_VECTORS)
    }

    @Test
    fun `pairing URI constants match pairing_ts`() {
        val pairing = source("packages/core/src/protocol/pairing.ts").substringAfter("export const PAIRING_URI")
        fun constant(key: String): String = Regex("\\b$key: '?([^',]+)'?,").find(pairing)!!.groupValues[1]
        assertEquals(constant("scheme"), PairingUri.SCHEME)
        assertEquals(constant("host"), PairingUri.HOST)
        assertEquals(constant("version").toInt(), PairingUri.VERSION)
        assertEquals(constant("maxHosts").toInt(), PairingUri.MAX_HOSTS)
        assertEquals(constant("maxHostChars").toInt(), PairingUri.MAX_HOST_CHARS)
        assertEquals("MAX_PAIRING_TOKEN_CHARS", constant("maxTokenChars"))
        assertEquals(maxPairingTokenChars(), PairingUri.MAX_TOKEN_CHARS)
        assertEquals(constant("maxNameBytes").toInt(), PairingUri.MAX_NAME_BYTES)
    }

    @Test
    fun `the copied pairing vectors are the ones the HUD asserts`() {
        val file = ProtocolJson.parseToJsonElement(source("packages/core/test/protocol/pairing-uri-vectors.json"))
        val valid =
            file.jsonObject.getValue("valid").jsonArray.map { element ->
                val v = element.jsonObject
                val p = v.getValue("payload").jsonObject
                fun field(name: String): String = p.getValue(name).jsonPrimitive.content
                PairingVector(
                    name = v.getValue("name").jsonPrimitive.content,
                    uri = v.getValue("uri").jsonPrimitive.content,
                    canonical = v.getValue("canonical").jsonPrimitive.boolean,
                    payload =
                    PairingPayload(
                        hudId = field("hudId"),
                        certFingerprint = field("certFingerprint"),
                        pairingToken = field("pairingToken"),
                        hosts = p.getValue("hosts").jsonArray.map { it.jsonPrimitive.content },
                        tlsPort = p.getValue("tlsPort").jsonPrimitive.int,
                        hudName = p.getValue("hudName").jsonPrimitive.contentOrNull,
                    ),
                )
            }
        assertEquals(valid, SHARED_PAIRING_VECTORS)
        val invalid =
            file.jsonObject.getValue("invalid").jsonArray.map { element ->
                val v = element.jsonObject
                fun field(name: String): String = v.getValue(name).jsonPrimitive.content
                InvalidPairingVector(field("name"), field("uri"), field("error"))
            }
        assertEquals(invalid, SHARED_INVALID_PAIRING_VECTORS)
    }

    @Test
    fun `mDNS records and the TLS port match the HUD's advertisement and config`() {
        val mdns = source("packages/hud-server/src/discovery/mdns.ts")
        for (record in listOf(
            HudAdvertisement.TXT_ID,
            HudAdvertisement.TXT_TLS_PORT,
            HudAdvertisement.TXT_FINGERPRINT,
        )) {
            assertTrue(mdns.contains("`$record=\${"), "mdns.ts advertises $record=")
        }
        assertTrue(mdns.contains("'${HudEndpoint.SERVICE_TYPE}'"))
        val defaults = source("packages/core/src/config/config.ts")
        val tlsPort = Regex("\\btlsPort: (\\d+),").find(defaults)!!.groupValues[1].toInt()
        assertEquals(tlsPort, HudEndpoint.DEFAULT_PORT)
        val plainPort = Regex("\\bport: (\\d+),").find(defaults)!!.groupValues[1].toInt()
        assertEquals(plainPort, HudEndpoint.LEGACY_PLAIN_PORT)
    }
}
