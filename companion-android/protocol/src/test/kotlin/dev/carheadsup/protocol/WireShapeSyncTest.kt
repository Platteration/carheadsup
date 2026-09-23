package dev.carheadsup.protocol

import dev.carheadsup.protocol.api.ApiInfo
import dev.carheadsup.protocol.api.MaintenanceItemStatus
import dev.carheadsup.protocol.api.TripRecord
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Field-level drift check against the TypeScript contract (packages/core/src/types, read from the
 * monorepo checkout; skipped outside it). [ContractSyncTest] covers enums, message type names and
 * limits; this covers the members of every object on the wire:
 *
 * - what the phone sends uses exactly the contract's field names and never carries `null` where
 *   the contract does not allow one (the HUD's validator would reject the whole message);
 * - what the phone receives only reads fields the contract has, and tolerates every field the
 *   contract lets the HUD send as `null` or leave out.
 */
class WireShapeSyncTest {
    private val repoRoot: File? =
        generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
            .firstOrNull { File(it, "packages/core/src/types/protocol.ts").isFile }

    private fun source(name: String): String {
        assumeTrue(repoRoot != null, "TypeScript contract not found; skipping wire shape checks")
        return File(repoRoot, "packages/core/src/types/$name").readText()
    }

    /** One member of a TypeScript object type. */
    private data class TsField(val optional: Boolean, val nullable: Boolean, val type: String)

    /** One property of a Kotlin model. */
    private data class KtField(val nullable: Boolean, val hasDefault: Boolean)

    /** Split at [separator] where it is not nested in brackets. */
    private fun splitTopLevel(text: String, separator: Char): List<String> {
        val parts = mutableListOf<String>()
        val current = StringBuilder()
        var depth = 0
        for (c in text) {
            when (c) {
                '{', '<', '(', '[' -> depth++
                '}', '>', ')', ']' -> depth--
            }
            if (c == separator && depth == 0) {
                parts += current.toString()
                current.clear()
            } else {
                current.append(c)
            }
        }
        parts += current.toString()
        return parts
    }

    /** The text inside the brace that opens at [open], up to its matching close brace. */
    private fun braced(text: String, open: Int): String {
        var depth = 0
        for (i in open until text.length) {
            when (text[i]) {
                '{' -> depth++
                '}' -> if (--depth == 0) return text.substring(open + 1, i)
            }
        }
        error("unbalanced braces")
    }

    /** Members of an object type body (`name?: type;` …), comments removed. */
    private fun members(body: String): Map<String, TsField> {
        val clean =
            body.replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "").replace(Regex("//[^\\n]*"), "")
        return splitTopLevel(clean, ';').map { it.trim() }.filter { it.isNotEmpty() }.associate { member ->
            val match =
                Regex("^(\\w+)(\\??):\\s*(.+)$", RegexOption.DOT_MATCHES_ALL).find(member)
                    ?: error("cannot parse member: $member")
            val type = match.groupValues[3].trim()
            match.groupValues[1] to
                TsField(
                    optional = match.groupValues[2] == "?",
                    nullable = splitTopLevel(type, '|').any { it.trim() == "null" },
                    type = type,
                )
        }
    }

    /** Members of `export interface NAME { … }` in [ts]. */
    private fun tsInterface(ts: String, name: String): Map<String, TsField> {
        val header = Regex("export interface $name(?:\\s+extends[^{]+)?\\s*\\{").find(ts) ?: error("no interface $name")
        return members(braced(ts, header.range.last))
    }

    /** Members of the object type inside a field's type, e.g. `Array<{ … }>`. */
    private fun inlineObject(field: TsField): Map<String, TsField> =
        members(braced(field.type, field.type.indexOf('{')))

    private fun kotlinFields(serializer: KSerializer<*>): Map<String, KtField> {
        val descriptor = serializer.descriptor
        return (0 until descriptor.elementsCount).associate { i ->
            descriptor.getElementName(i) to
                KtField(
                    nullable = descriptor.getElementDescriptor(i).isNullable,
                    hasDefault = descriptor.isElementOptional(i),
                )
        }
    }

    /**
     * The phone encodes [serializer]: same field names as the contract, and no null where the
     * contract has none — except [omittedWhenNull] (optional fields left out instead of null).
     */
    private fun assertSends(
        serializer: KSerializer<*>,
        contract: Map<String, TsField>,
        omittedWhenNull: Set<String> = emptySet(),
    ) {
        val name = serializer.descriptor.serialName
        val ts = contract - "t"
        val kt = kotlinFields(serializer)
        assertEquals(ts.keys, kt.keys, "$name: field names")
        for ((field, k) in kt) {
            val t = ts.getValue(field)
            if (k.nullable && !t.nullable) {
                assertTrue(field in omittedWhenNull, "$name.$field: the contract does not allow null here")
                assertTrue(t.optional, "$name.$field: a required field cannot be omitted")
            }
        }
    }

    /**
     * The phone decodes [serializer]: it only reads fields the contract has, and every field the
     * HUD may omit has a default and every field it may send as null is nullable (or defaulted,
     * which `coerceInputValues` falls back to).
     */
    private fun assertReceives(serializer: KSerializer<*>, contract: Map<String, TsField>) {
        val name = serializer.descriptor.serialName
        val ts = contract - "t"
        val kt = kotlinFields(serializer)
        assertTrue(ts.keys.containsAll(kt.keys), "$name: fields the contract does not have: ${kt.keys - ts.keys}")
        for ((field, k) in kt) {
            val t = ts.getValue(field)
            if (t.optional) assertTrue(k.hasDefault, "$name.$field may be absent, so it needs a default")
            if (t.nullable) assertTrue(k.nullable || k.hasDefault, "$name.$field may be null")
        }
    }

    @Test
    fun `phone to HUD messages match protocol_ts field by field`() {
        val protocol = source("protocol.ts")
        assertSends(PhoneHello.serializer(), tsInterface(protocol, "PhoneHello"))
        assertSends(PhoneNav.serializer(), tsInterface(protocol, "PhoneNav"), omittedWhenNull = setOf("maneuver"))
        assertSends(PhoneRoad.serializer(), tsInterface(protocol, "PhoneRoad"))
        assertSends(PhoneHazards.serializer(), tsInterface(protocol, "PhoneHazards"))
        assertSends(PhoneMedia.serializer(), tsInterface(protocol, "PhoneMedia"))
        assertSends(PhoneCall.serializer(), tsInterface(protocol, "PhoneCall"))
        assertSends(PhoneMessage.serializer(), tsInterface(protocol, "PhoneMessage"))
        assertSends(PhoneLocation.serializer(), tsInterface(protocol, "PhoneLocation"))
        assertSends(PhoneInput.serializer(), tsInterface(protocol, "PhoneInput"))
        assertSends(PhoneTripsRequest.serializer(), tsInterface(protocol, "PhoneTripsRequest"))
        assertSends(PhonePing.serializer(), tsInterface(protocol, "Ping"), omittedWhenNull = setOf("id"))
    }

    @Test
    fun `fields sent as omitted rather than null really are omitted`() {
        val nav = PhoneWire.encodeUnchecked(PhoneMessages.navEnded("google-maps"))
        assertFalse("maneuver" in ProtocolJson.parseToJsonElement(nav).jsonObject)
        val ping = PhoneWire.encodeUnchecked(PhonePing())
        assertFalse("id" in ProtocolJson.parseToJsonElement(ping).jsonObject)
    }

    @Test
    fun `nested nav types match nav_ts`() {
        val nav = source("nav.ts")
        assertSends(Maneuver.serializer(), tsInterface(nav, "Maneuver"))
        assertSends(Lane.serializer(), tsInterface(nav, "Lane"))
        // PhoneHazards.items is Omit<Hazard, 'updatedAt'>.
        assertSends(HazardItem.serializer(), tsInterface(nav, "Hazard") - "updatedAt")
    }

    @Test
    fun `HUD to phone messages and records match the contract field by field`() {
        val protocol = source("protocol.ts")
        assertReceives(HudWelcome.serializer(), tsInterface(protocol, "HudWelcome"))
        assertReceives(HudError.serializer(), tsInterface(protocol, "HudError"))
        assertReceives(HudCallAction.serializer(), tsInterface(protocol, "HudCallAction"))
        assertReceives(HudTrips.serializer(), tsInterface(protocol, "HudTrips"))
        assertReceives(HudTripCompleted.serializer(), tsInterface(protocol, "HudTripCompleted"))
        val due = tsInterface(protocol, "HudMaintenanceDue")
        assertReceives(HudMaintenanceDue.serializer(), due)
        assertReceives(MaintenanceDueItem.serializer(), inlineObject(due.getValue("items")))
        assertReceives(HudPong.serializer(), tsInterface(protocol, "Pong"))

        val records = source("records.ts")
        assertReceives(TripRecord.serializer(), tsInterface(records, "TripRecord"))
        assertReceives(MaintenanceItemStatus.serializer(), tsInterface(records, "MaintenanceItemStatus"))
        assertReceives(ApiInfo.serializer(), tsInterface(source("api.ts"), "ApiInfo"))
    }
}
