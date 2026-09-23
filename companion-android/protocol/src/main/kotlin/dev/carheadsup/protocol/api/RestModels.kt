package dev.carheadsup.protocol.api

import dev.carheadsup.protocol.InputAction
import dev.carheadsup.protocol.MaintenanceStatusKind
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Models of the HUD's REST API (packages/core/src/types/api.ts, records.ts, config.ts). Only
 * the endpoints the phone uses are modelled; unknown fields are ignored when decoding so newer
 * HUD versions stay compatible.
 */

/** A completed trip, persisted on the HUD and synced to the phone (core `TripRecord`). */
@Serializable
public data class TripRecord(
    val id: String,
    val startedAt: Long,
    val endedAt: Long,
    val distanceKm: Double,
    /** Wall-clock duration from start to last movement/engine activity. */
    val durationS: Double,
    val movingS: Double,
    val idleS: Double,
    /** Null when the vehicle provides no usable fuel-rate data. */
    val fuelUsedL: Double? = null,
    val avgLPer100km: Double? = null,
    val maxSpeedKph: Double,
    /** Average over moving time. */
    val avgMovingSpeedKph: Double,
    /** fuelUsedL × fuel price, null when fuel is unknown. */
    val cost: Double? = null,
    val currency: String,
    val startOdometerKm: Double? = null,
    val endOdometerKm: Double? = null,
)

/** One maintenance item's status (core `MaintenanceItemStatus`, `GET /api/maintenance`). */
@Serializable
public data class MaintenanceItemStatus(
    val itemId: String,
    val label: String,
    val lastDoneAt: Long? = null,
    val lastDoneKm: Double? = null,
    val dueAtKm: Double? = null,
    val dueAtEpochMs: Long? = null,
    val remainingKm: Double? = null,
    val remainingDays: Double? = null,
    val status: MaintenanceStatusKind = MaintenanceStatusKind.UNKNOWN,
)

/** `GET /api/info` (only the fields the phone shows). */
@Serializable
public data class ApiInfo(
    val name: String,
    val version: String,
    val simulated: Boolean = false,
    val uptimeS: Double = 0.0,
    val phoneConnected: Boolean = false,
)

/** Speed/distance unit system of the HUD (core `UnitSystem`). */
@Serializable
public enum class UnitSystem {
    @SerialName("metric")
    METRIC,

    @SerialName("imperial")
    IMPERIAL,
}

/** Core `FuelEconomyUnit`. */
@Serializable
public enum class FuelEconomyUnit {
    @SerialName("L/100km")
    L_PER_100KM,

    @SerialName("km/L")
    KM_PER_L,

    @SerialName("mpg-us")
    MPG_US,

    @SerialName("mpg-uk")
    MPG_UK,
}

/** The driver's display units, the subset of core `UnitsConfig` the phone needs. */
@Serializable
public data class DisplayUnits(
    val system: UnitSystem = UnitSystem.METRIC,
    val fuelEconomy: FuelEconomyUnit = FuelEconomyUnit.L_PER_100KM,
    /** ISO 4217 code for trip cost, e.g. "USD". */
    val currency: String = "EUR",
)

/**
 * `GET /api/config` decoded leniently: the phone only needs the units, so everything else in
 * `HudConfig` is ignored.
 */
@Serializable
public data class ApiConfigUnitsView(val units: DisplayUnits = DisplayUnits())

/** `{ "error": "…" }` body of failed REST calls (core `ApiError`). */
@Serializable
public data class ApiError(val error: String)

/** `POST /api/input` body. */
@Serializable
public data class ApiInputRequest(val action: InputAction)
