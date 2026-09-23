package dev.carheadsup.protocol

import dev.carheadsup.protocol.api.TripRecord
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Phone ⇄ HUD WebSocket protocol (`ws://<hud>:<port>/ws/phone`), mirroring
 * packages/core/src/types/protocol.ts. Every frame is a JSON object whose `t` field names the
 * message type; encode and decode through [ProtocolJson] / [PhoneWire] / [HudCodec] so the
 * discriminator, explicit nulls and the HUD's size limits are always applied.
 *
 * Nullable fields are sent as explicit `null`. The two fields the contract declares as
 * optional-but-not-nullable (`nav.maneuver`, `ping.id`) are omitted instead when null.
 */

/** Protocol version sent in `hello.v`; must match the HUD's `PROTOCOL_VERSION`. */
public const val PROTOCOL_VERSION: Int = 1

/** A turn-by-turn maneuver (core `Maneuver`). */
@Serializable
public data class Maneuver(
    val type: ManeuverType,
    /** 1-based exit number for roundabouts. */
    val roundaboutExit: Int? = null,
    /** Exit bearing relative to entry, degrees clockwise (0–360), for drawing roundabout arrows. */
    val roundaboutAngle: Double? = null,
    /** Raw instruction text from the nav source, if any (never shown while moving). */
    val instruction: String? = null,
)

/** One lane of lane guidance (core `Lane`). */
@Serializable
public data class Lane(
    /** All arrows painted on the lane. */
    val directions: List<LaneDirection>,
    /** True when this lane can be used for the upcoming maneuver. */
    val recommended: Boolean,
    /** The arrow to highlight when the lane is recommended. */
    val activeDirection: LaneDirection? = null,
)

/** A hazard as sent by the phone (core `Hazard` without `updatedAt`). */
@Serializable
public data class HazardItem(
    val id: String,
    val type: HazardType,
    /** Distance ahead along the route, metres. */
    val distanceM: Double? = null,
    /** Enforced limit for cameras, if known. */
    val speedLimitKph: Double? = null,
    /** Expected delay for traffic hazards. */
    val delaySeconds: Double? = null,
    val description: String? = null,
)

// ---------------------------------------------------------------------------------------------
// Phone → HUD

/** Every message the phone may send to the HUD. */
@Serializable
public sealed interface PhoneToHud

/** First message after connecting. The HUD answers with [HudWelcome] or [HudError]. */
@Serializable
@SerialName("hello")
public data class PhoneHello(
    val v: Int = PROTOCOL_VERSION,
    val device: String,
    val app: String,
    val appVersion: String,
    /** Must equal the HUD's `phone.pairingToken` when one is configured. */
    val token: String,
) : PhoneToHud

/** Turn-by-turn guidance state; `active = false` ends guidance. */
@Serializable
@SerialName("nav")
public data class PhoneNav(
    val active: Boolean,
    val source: String,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val maneuver: Maneuver? = null,
    val distanceM: Double? = null,
    val street: String? = null,
    val currentStreet: String? = null,
    val then: Maneuver? = null,
    val lanes: List<Lane>? = null,
    val etaEpochMs: Long? = null,
    val remainingDistanceM: Double? = null,
    val remainingSeconds: Double? = null,
    /** Base64 PNG (≤ 32 KiB) of the nav app's maneuver icon. */
    val iconPng: String? = null,
) : PhoneToHud

/** Posted speed limit and road the vehicle is on. */
@Serializable
@SerialName("road")
public data class PhoneRoad(
    /** Km/h; null when unknown. Never 0 — "no limit" is [unlimited]. */
    val speedLimitKph: Double?,
    val unlimited: Boolean = false,
    val source: RoadSource,
    val roadName: String? = null,
    val roadClass: RoadClass? = null,
) : PhoneToHud

/** Replaces the HUD's whole hazard list (send an empty list to clear it). */
@Serializable
@SerialName("hazards")
public data class PhoneHazards(val items: List<HazardItem>) : PhoneToHud

/** Now playing; `playing = false` with nulls when nothing is playing or the session is gone. */
@Serializable
@SerialName("media")
public data class PhoneMedia(
    val playing: Boolean,
    val title: String?,
    val artist: String?,
    val album: String? = null,
    val app: String? = null,
    val trackKey: String? = null,
) : PhoneToHud

/** Phone call state. */
@Serializable
@SerialName("call")
public data class PhoneCall(val id: String, val state: CallState, val callerName: String?, val number: String?) :
    PhoneToHud

/**
 * An incoming message notification. Sender only: by design there is no field for the message
 * content (the HUD rejects messages that carry one); the phone reads content aloud instead.
 */
@Serializable
@SerialName("message")
public data class PhoneMessage(val id: String, val sender: String, val app: String?, val readingAloud: Boolean) :
    PhoneToHud

/** Phone GPS fix. */
@Serializable
@SerialName("location")
public data class PhoneLocation(
    val lat: Double,
    val lon: Double,
    val accuracyM: Double?,
    val speedMps: Double? = null,
    val bearingDeg: Double? = null,
) : PhoneToHud

/** A remote-control button pressed in the companion app. */
@Serializable
@SerialName("input")
public data class PhoneInput(val action: InputAction) : PhoneToHud

/** Ask for trips that ended after [since] (epoch ms); answered with [HudTrips]. */
@Serializable
@SerialName("trips-request")
public data class PhoneTripsRequest(val since: Long) : PhoneToHud

/** Application-level heartbeat; the HUD answers with [HudPong] carrying the same id. */
@Serializable
@SerialName("ping")
public data class PhonePing(@EncodeDefault(EncodeDefault.Mode.NEVER) val id: Long? = null) : PhoneToHud

// ---------------------------------------------------------------------------------------------
// HUD → Phone

/** Every message the HUD may send to the phone. */
@Serializable
public sealed interface HudToPhone

/** Accepted `hello`. */
@Serializable
@SerialName("welcome")
public data class HudWelcome(
    val v: Int,
    val hudName: String = "",
    val hudVersion: String = "",
    /** Whether the phone should read messages aloud (the HUD's `phone.readMessagesAloud`). */
    val readMessagesAloud: Boolean = false,
) : HudToPhone

/** A rejected hello or message. `bad-token` and `unsupported-version` close the connection. */
@Serializable
@SerialName("error")
public data class HudError(val code: HudErrorCode = HudErrorCode.INTERNAL, val message: String = "") : HudToPhone

/** The driver accepted/declined a call with the HUD's buttons or gestures. */
@Serializable
@SerialName("call-action")
public data class HudCallAction(val callId: String, val action: CallAction) : HudToPhone

/** Answer to [PhoneTripsRequest]. */
@Serializable
@SerialName("trips")
public data class HudTrips(val trips: List<TripRecord> = emptyList()) : HudToPhone

/** Pushed when a trip ends so the phone can log it. */
@Serializable
@SerialName("trip-completed")
public data class HudTripCompleted(val trip: TripRecord) : HudToPhone

/** One item of [HudMaintenanceDue]. */
@Serializable
public data class MaintenanceDueItem(
    val itemId: String,
    val label: String,
    val status: MaintenanceDueStatus,
    val remainingKm: Double? = null,
    val remainingDays: Double? = null,
)

/** Maintenance items that are due soon or overdue. */
@Serializable
@SerialName("maintenance-due")
public data class HudMaintenanceDue(val items: List<MaintenanceDueItem> = emptyList()) : HudToPhone

/** Answer to [PhonePing]. */
@Serializable
@SerialName("pong")
public data class HudPong(val id: Long? = null) : HudToPhone

/** Wire name (`t`) of a phone message, e.g. "nav". */
public val PhoneToHud.wireType: String
    get() =
        when (this) {
            is PhoneHello -> "hello"
            is PhoneNav -> "nav"
            is PhoneRoad -> "road"
            is PhoneHazards -> "hazards"
            is PhoneMedia -> "media"
            is PhoneCall -> "call"
            is PhoneMessage -> "message"
            is PhoneLocation -> "location"
            is PhoneInput -> "input"
            is PhoneTripsRequest -> "trips-request"
            is PhonePing -> "ping"
        }
