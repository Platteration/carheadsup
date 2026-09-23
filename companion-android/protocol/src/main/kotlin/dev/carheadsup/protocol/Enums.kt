package dev.carheadsup.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Enumerations of the phone ⇄ HUD protocol. Wire names mirror the TypeScript contract in packages/core/src/types exactly;
 * the HUD rejects any value it does not know, so these must never drift from the contract.
 */

/** Turn-by-turn maneuver kinds (core `MANEUVER_TYPES`). */
@Serializable
public enum class ManeuverType {
    @SerialName("depart")
    DEPART,

    @SerialName("arrive")
    ARRIVE,

    @SerialName("arrive-left")
    ARRIVE_LEFT,

    @SerialName("arrive-right")
    ARRIVE_RIGHT,

    @SerialName("straight")
    STRAIGHT,

    @SerialName("slight-left")
    SLIGHT_LEFT,

    @SerialName("left")
    LEFT,

    @SerialName("sharp-left")
    SHARP_LEFT,

    @SerialName("slight-right")
    SLIGHT_RIGHT,

    @SerialName("right")
    RIGHT,

    @SerialName("sharp-right")
    SHARP_RIGHT,

    @SerialName("uturn-left")
    UTURN_LEFT,

    @SerialName("uturn-right")
    UTURN_RIGHT,

    @SerialName("keep-left")
    KEEP_LEFT,

    @SerialName("keep-right")
    KEEP_RIGHT,

    @SerialName("merge-left")
    MERGE_LEFT,

    @SerialName("merge-right")
    MERGE_RIGHT,

    @SerialName("ramp-left")
    RAMP_LEFT,

    @SerialName("ramp-right")
    RAMP_RIGHT,

    @SerialName("exit-left")
    EXIT_LEFT,

    @SerialName("exit-right")
    EXIT_RIGHT,

    @SerialName("fork-left")
    FORK_LEFT,

    @SerialName("fork-right")
    FORK_RIGHT,

    /** Counter-clockwise roundabout (right-hand traffic). */
    @SerialName("roundabout-ccw")
    ROUNDABOUT_CCW,

    /** Clockwise roundabout (left-hand traffic). */
    @SerialName("roundabout-cw")
    ROUNDABOUT_CW,

    @SerialName("ferry")
    FERRY,

    @SerialName("unknown")
    UNKNOWN,
}

/** Arrows painted on a lane (core `LANE_DIRECTIONS`). */
@Serializable
public enum class LaneDirection {
    @SerialName("straight")
    STRAIGHT,

    @SerialName("slight-left")
    SLIGHT_LEFT,

    @SerialName("left")
    LEFT,

    @SerialName("sharp-left")
    SHARP_LEFT,

    @SerialName("slight-right")
    SLIGHT_RIGHT,

    @SerialName("right")
    RIGHT,

    @SerialName("sharp-right")
    SHARP_RIGHT,

    @SerialName("uturn-left")
    UTURN_LEFT,

    @SerialName("uturn-right")
    UTURN_RIGHT,

    @SerialName("merge-left")
    MERGE_LEFT,

    @SerialName("merge-right")
    MERGE_RIGHT,
}

/** Core `HAZARD_TYPES`. */
@Serializable
public enum class HazardType {
    @SerialName("speed-camera")
    SPEED_CAMERA,

    @SerialName("red-light-camera")
    RED_LIGHT_CAMERA,

    @SerialName("section-control")
    SECTION_CONTROL,

    @SerialName("police")
    POLICE,

    @SerialName("accident")
    ACCIDENT,

    @SerialName("road-works")
    ROAD_WORKS,

    @SerialName("traffic-jam")
    TRAFFIC_JAM,

    @SerialName("slowdown")
    SLOWDOWN,

    @SerialName("object-on-road")
    OBJECT_ON_ROAD,

    @SerialName("weather")
    WEATHER,

    @SerialName("school-zone")
    SCHOOL_ZONE,

    @SerialName("railway-crossing")
    RAILWAY_CROSSING,

    @SerialName("other")
    OTHER,
}

/** Core `RoadClass`. */
@Serializable
public enum class RoadClass {
    @SerialName("motorway")
    MOTORWAY,

    @SerialName("trunk")
    TRUNK,

    @SerialName("primary")
    PRIMARY,

    @SerialName("secondary")
    SECONDARY,

    @SerialName("tertiary")
    TERTIARY,

    @SerialName("residential")
    RESIDENTIAL,

    @SerialName("service")
    SERVICE,

    @SerialName("other")
    OTHER,
}

/** Where a phone-provided speed limit came from (`PhoneRoad.source`). */
@Serializable
public enum class RoadSource {
    @SerialName("osm")
    OSM,

    @SerialName("nav")
    NAV,

    @SerialName("sign-recognition")
    SIGN_RECOGNITION,

    @SerialName("manual")
    MANUAL,
}

/** Core `CallState`. */
@Serializable
public enum class CallState {
    @SerialName("ringing")
    RINGING,

    @SerialName("dialing")
    DIALING,

    @SerialName("active")
    ACTIVE,

    @SerialName("held")
    HELD,

    @SerialName("ended")
    ENDED,
}

/** Driver inputs (core `InputAction`), sent by the companion app's remote buttons. */
@Serializable
public enum class InputAction {
    /** Accept call / acknowledge the top alert. */
    @SerialName("primary")
    PRIMARY,

    /** Decline call / dismiss the top alert or toast. */
    @SerialName("secondary")
    SECONDARY,

    /** Cycle parked-dashboard pages. */
    @SerialName("next-page")
    NEXT_PAGE,

    @SerialName("prev-page")
    PREV_PAGE,

    /** Blank / unblank the whole HUD. */
    @SerialName("toggle-blank")
    TOGGLE_BLANK,

    @SerialName("brightness-up")
    BRIGHTNESS_UP,

    @SerialName("brightness-down")
    BRIGHTNESS_DOWN,
}

/** `HudError.code`. Unknown future codes decode as [INTERNAL]. */
@Serializable
public enum class HudErrorCode {
    @SerialName("bad-token")
    BAD_TOKEN,

    @SerialName("bad-message")
    BAD_MESSAGE,

    @SerialName("unsupported-version")
    UNSUPPORTED_VERSION,

    @SerialName("internal")
    INTERNAL,
}

/** `HudCallAction.action`. */
@Serializable
public enum class CallAction {
    @SerialName("accept")
    ACCEPT,

    @SerialName("decline")
    DECLINE,
}

/** Status of a maintenance item pushed in `maintenance-due`. */
@Serializable
public enum class MaintenanceDueStatus {
    @SerialName("due-soon")
    DUE_SOON,

    @SerialName("overdue")
    OVERDUE,
}

/** Core `MaintenanceStatusKind`. Unknown future values decode as [UNKNOWN]. */
@Serializable
public enum class MaintenanceStatusKind {
    @SerialName("ok")
    OK,

    @SerialName("due-soon")
    DUE_SOON,

    @SerialName("overdue")
    OVERDUE,

    @SerialName("unknown")
    UNKNOWN,
}
