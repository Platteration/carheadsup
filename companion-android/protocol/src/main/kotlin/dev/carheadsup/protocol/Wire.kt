package dev.carheadsup.protocol

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * The JSON configuration of the phone ⇄ HUD protocol:
 * - `t` is the class discriminator of [PhoneToHud] / [HudToPhone];
 * - nulls are written explicitly and defaults are always encoded, so every field the contract
 *   declares is present on the wire;
 * - unknown keys are ignored and unknown enum values fall back to the property's default when
 *   decoding, so a newer HUD does not break an older phone.
 */
public val ProtocolJson: Json = Json {
    classDiscriminator = "t"
    ignoreUnknownKeys = true
    explicitNulls = true
    encodeDefaults = true
    coerceInputValues = true
}

/** Outcome of decoding one HUD → phone frame. */
public sealed interface HudDecodeResult {
    public data class Message(val message: HudToPhone) : HudDecodeResult

    /** A well-formed frame of a type this app version does not know (safe to ignore). */
    public data class UnknownType(val type: String) : HudDecodeResult

    public data class Malformed(val error: String) : HudDecodeResult
}

/** Decodes frames received from the HUD. Never throws. */
public object HudCodec {
    private val knownTypes =
        setOf("welcome", "error", "call-action", "trips", "trip-completed", "maintenance-due", "pong")

    public fun decode(raw: String): HudDecodeResult {
        val element =
            try {
                ProtocolJson.parseToJsonElement(raw)
            } catch (e: SerializationException) {
                return HudDecodeResult.Malformed("invalid JSON")
            } catch (e: IllegalArgumentException) {
                return HudDecodeResult.Malformed("invalid JSON")
            }
        val obj = element as? JsonObject ?: return HudDecodeResult.Malformed("expected a JSON object")
        val type = (obj["t"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
            ?: return HudDecodeResult.Malformed("missing message type \"t\"")
        if (type !in knownTypes) return HudDecodeResult.UnknownType(type)
        return try {
            HudDecodeResult.Message(ProtocolJson.decodeFromJsonElement(HudToPhone.serializer(), obj))
        } catch (e: SerializationException) {
            HudDecodeResult.Malformed("$type: ${e.message?.lineSequence()?.firstOrNull() ?: "invalid"}")
        } catch (e: IllegalArgumentException) {
            HudDecodeResult.Malformed("$type: ${e.message?.lineSequence()?.firstOrNull() ?: "invalid"}")
        }
    }

    /** Encodes a HUD message (used by tests and fake HUDs). */
    public fun encode(message: HudToPhone): String = ProtocolJson.encodeToString(HudToPhone.serializer(), message)
}

/** Encodes phone → HUD frames, enforcing the HUD's validation limits first. */
public object PhoneWire {
    /**
     * Sanitizes [message] with [WireSanitizer] and encodes it. Returns null when the message
     * cannot be made valid (e.g. a location outside the globe or an empty sender): sending it
     * would only make the HUD answer with a `bad-message` error.
     */
    public fun encode(message: PhoneToHud): String? {
        val clean = WireSanitizer.sanitize(message) ?: return null
        val json = encodeUnchecked(clean)
        if (json.length <= WireLimits.PHONE_FRAME_CHARS) return json
        // Only a maximal icon can push a frame over the limit; the HUD falls back to its own
        // arrow when the icon is missing, so drop it rather than the whole update.
        if (clean is PhoneNav && clean.iconPng != null) {
            return encodeUnchecked(clean.copy(iconPng = null)).takeIf { it.length <= WireLimits.PHONE_FRAME_CHARS }
        }
        return null
    }

    /** Encodes without sanitizing (tests, and messages already produced by [WireSanitizer]). */
    public fun encodeUnchecked(message: PhoneToHud): String =
        ProtocolJson.encodeToString(PhoneToHud.serializer(), message)

    /** Decodes a phone frame (used by tests and fake HUDs); null when malformed. */
    public fun decodeOrNull(raw: String): PhoneToHud? = try {
        ProtocolJson.decodeFromString(PhoneToHud.serializer(), raw)
    } catch (e: SerializationException) {
        null
    } catch (e: IllegalArgumentException) {
        null
    }
}
