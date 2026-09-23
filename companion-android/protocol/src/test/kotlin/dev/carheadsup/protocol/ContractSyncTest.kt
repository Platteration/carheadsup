package dev.carheadsup.protocol

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.elementNames
import org.junit.jupiter.api.Assertions.assertEquals
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
        assertEquals(limit("token"), WireLimits.TOKEN)
        assertEquals(limit("version"), WireLimits.VERSION)
        assertEquals(limit("phoneNumber"), WireLimits.PHONE_NUMBER)
        assertEquals(limit("iconPngBase64"), WireLimits.ICON_PNG_BASE64)
        assertEquals(limit("lanes"), WireLimits.LANES)
        assertEquals(limit("laneDirections"), WireLimits.LANE_DIRECTIONS)
        assertEquals(limit("hazards"), WireLimits.HAZARDS)
    }
}
