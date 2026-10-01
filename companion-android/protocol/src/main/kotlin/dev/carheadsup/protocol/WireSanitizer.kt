package dev.carheadsup.protocol

import dev.carheadsup.protocol.auth.PhoneAuth

/**
 * Size limits the HUD enforces on phone messages (core `PROTOCOL_LIMITS`). Lengths are in UTF-16
 * code units, which is what both JavaScript and Kotlin `String.length` count.
 */
public object WireLimits {
    public const val PHONE_FRAME_CHARS: Int = 128 * 1024
    public const val NAME: Int = 100
    public const val MEDIA_TEXT: Int = 300
    public const val ID: Int = 256
    public const val TRACK_KEY: Int = 512
    public const val TEXT: Int = 300
    public const val VERSION: Int = 64
    public const val PHONE_NUMBER: Int = 40

    /** Base64 of a ≤ 32 KiB PNG. */
    public const val ICON_PNG_BASE64: Int = 44 * 1024

    /** Raw PNG byte budget for maneuver icons. */
    public const val ICON_PNG_BYTES: Int = 32 * 1024
    public const val LANES: Int = 16
    public const val LANE_DIRECTIONS: Int = 11
    public const val HAZARDS: Int = 50

    public const val MAX_NAV_DISTANCE_M: Double = 10_000_000.0
    public const val MAX_REMAINING_DISTANCE_M: Double = 100_000_000.0
    public const val MAX_REMAINING_SECONDS: Double = 10_000_000.0
    public const val MAX_HAZARD_DISTANCE_M: Double = 1_000_000.0
    public const val MAX_DELAY_SECONDS: Double = 86_400.0
    public const val MAX_SPEED_LIMIT_KPH: Double = 500.0
    public const val MAX_ACCURACY_M: Double = 100_000.0
    public const val MAX_SPEED_MPS: Double = 200.0
    public const val MAX_EPOCH_MS: Long = 8_640_000_000_000_000L

    /** JavaScript's `Number.MAX_SAFE_INTEGER` (2^53 − 1): the largest `trips-request.sinceSeq`. */
    public const val MAX_SAFE_INTEGER: Long = 9_007_199_254_740_991L
    public const val MAX_ROUNDABOUT_EXIT: Int = 32
}

/**
 * Makes phone messages conform to the HUD's validator (packages/core/src/protocol/validate.ts)
 * so a single odd notification can never get a whole update rejected:
 * - display strings lose control characters, collapse whitespace and are truncated to their cap
 *   (with an ellipsis, never splitting a surrogate pair);
 * - optional numbers that are non-finite or out of range become null; bearings are wrapped;
 * - lists are capped (nearest hazards first) and hazard ids de-duplicated;
 * - an icon that is not a base64 PNG within budget is dropped.
 *
 * Returns null when a required field cannot be salvaged (empty id/sender/source, position off
 * the globe, a `hello` whose identity, nonce or proof is malformed).
 */
public object WireSanitizer {
    private val CONTROL = Regex("[\\u0000-\\u001f\\u007f]")
    private val CONTROL_EXCEPT_WHITESPACE = Regex("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]")
    private val WHITESPACE_RUN = Regex("\\s+")
    private const val PNG_BASE64_PREFIX = "iVBORw0KGgo"
    private val BASE64 = Regex("^[A-Za-z0-9+/]*={0,2}$")

    public fun sanitize(message: PhoneToHud): PhoneToHud? = when (message) {
        is PhoneHello -> hello(message)
        is PhoneNav -> nav(message)
        is PhoneRoad -> road(message)
        is PhoneHazards -> PhoneHazards(hazards(message.items))
        is PhoneMedia -> media(message)
        is PhoneCall -> call(message)
        is PhoneMessage -> textMessage(message)
        is PhoneLocation -> location(message)
        is PhoneInput -> message
        is PhoneTripsRequest ->
            PhoneTripsRequest(
                message.since.coerceIn(0L, WireLimits.MAX_EPOCH_MS),
                message.sinceSeq?.coerceIn(0L, WireLimits.MAX_SAFE_INTEGER),
            )
        is PhonePing -> message.copy(time = epochOrNull(message.time))
    }

    /**
     * A single-line display label: control characters become spaces, whitespace runs collapse,
     * and text over [max] UTF-16 units is cut and ends with "…".
     */
    public fun label(value: String, max: Int): String =
        truncate(value.replace(CONTROL, " ").replace(WHITESPACE_RUN, " ").trim(), max)

    /** Free text (tabs and line breaks allowed), truncated to [max]. */
    public fun freeText(value: String, max: Int): String =
        truncate(value.replace(CONTROL_EXCEPT_WHITESPACE, "").trim(), max)

    /** Cuts [value] to at most [max] UTF-16 units, ending in "…", without splitting a surrogate pair. */
    public fun truncate(value: String, max: Int): String {
        if (value.length <= max) return value
        if (max <= 0) return ""
        var end = max - 1
        if (end > 0 && Character.isHighSurrogate(value[end - 1])) end--
        return value.substring(0, end).trimEnd() + "…"
    }

    /** True when [value] is a base64 PNG the HUD accepts as `iconPng`. */
    public fun isValidIconPng(value: String): Boolean = value.length <= WireLimits.ICON_PNG_BASE64 &&
        value.length % 4 == 0 &&
        value.startsWith(PNG_BASE64_PREFIX) &&
        BASE64.matches(value)

    private fun optionalLabel(value: String?, max: Int): String? = value?.let { label(it, max) }?.ifEmpty { null }

    private fun inRange(value: Double?, min: Double, max: Double): Double? =
        value?.takeIf { it.isFinite() && it >= min && it <= max }

    private fun positiveLimit(value: Double?): Double? =
        value?.takeIf { it.isFinite() && it > 0.0 && it <= WireLimits.MAX_SPEED_LIMIT_KPH }

    /** Wraps a bearing into [0, 360); null when not finite. */
    public fun normalizeBearing(value: Double?): Double? {
        if (value == null || !value.isFinite()) return null
        val wrapped = value % 360.0
        return if (wrapped < 0) wrapped + 360.0 else wrapped
    }

    private fun hello(m: PhoneHello): PhoneHello? {
        // Nothing to salvage: the proof covers the id and the nonce.
        if (!PhoneAuth.isValidId(m.deviceId) || !PhoneAuth.isValidId(m.nonce) || !PhoneAuth.isValidProof(m.proof)) {
            return null
        }
        return m.copy(
            device = label(m.device, WireLimits.NAME),
            app = label(m.app, WireLimits.NAME),
            appVersion = label(m.appVersion, WireLimits.VERSION),
            time = epochOrNull(m.time),
        )
    }

    /** An epoch-ms reading the HUD accepts (`time` of hello and ping), else null (left out). */
    private fun epochOrNull(value: Long?): Long? = value?.takeIf { it in 0L..WireLimits.MAX_EPOCH_MS }

    private fun maneuver(m: Maneuver): Maneuver = m.copy(
        roundaboutExit = m.roundaboutExit?.takeIf { it in 1..WireLimits.MAX_ROUNDABOUT_EXIT },
        roundaboutAngle = m.roundaboutAngle?.let { if (it in 0.0..360.0) it else normalizeBearing(it) },
        instruction = m.instruction?.let { freeText(it, WireLimits.TEXT) }?.ifEmpty { null },
    )

    private fun lanes(lanes: List<Lane>): List<Lane> = lanes.take(WireLimits.LANES).map { lane ->
        lane.copy(directions = lane.directions.distinct().take(WireLimits.LANE_DIRECTIONS))
    }

    private fun nav(m: PhoneNav): PhoneNav? {
        val source = label(m.source, WireLimits.NAME)
        if (source.isEmpty()) return null
        return m.copy(
            source = source,
            maneuver = m.maneuver?.let(::maneuver),
            distanceM = inRange(m.distanceM, 0.0, WireLimits.MAX_NAV_DISTANCE_M),
            street = optionalLabel(m.street, WireLimits.NAME),
            currentStreet = optionalLabel(m.currentStreet, WireLimits.NAME),
            then = m.then?.let(::maneuver),
            lanes = m.lanes?.let(::lanes),
            etaEpochMs = m.etaEpochMs?.takeIf { it in 0..WireLimits.MAX_EPOCH_MS },
            remainingDistanceM = inRange(m.remainingDistanceM, 0.0, WireLimits.MAX_REMAINING_DISTANCE_M),
            remainingSeconds = inRange(m.remainingSeconds, 0.0, WireLimits.MAX_REMAINING_SECONDS),
            iconPng = m.iconPng?.takeIf(::isValidIconPng),
        )
    }

    private fun road(m: PhoneRoad): PhoneRoad {
        val limit = positiveLimit(m.speedLimitKph)
        return m.copy(
            speedLimitKph = if (m.unlimited) null else limit,
            roadName = optionalLabel(m.roadName, WireLimits.NAME),
        )
    }

    /** Valid hazards only, unique ids, nearest [WireLimits.HAZARDS] kept. */
    public fun hazards(items: List<HazardItem>): List<HazardItem> {
        val seen = HashSet<String>()
        return items
            .mapNotNull { hazard ->
                val id = label(hazard.id, WireLimits.ID)
                if (id.isEmpty() || !seen.add(id)) return@mapNotNull null
                hazard.copy(
                    id = id,
                    distanceM = inRange(hazard.distanceM, 0.0, WireLimits.MAX_HAZARD_DISTANCE_M),
                    speedLimitKph = positiveLimit(hazard.speedLimitKph),
                    delaySeconds = inRange(hazard.delaySeconds, 0.0, WireLimits.MAX_DELAY_SECONDS),
                    description = hazard.description?.let { freeText(it, WireLimits.TEXT) }?.ifEmpty { null },
                )
            }
            .sortedWith(compareBy(nullsLast()) { it.distanceM })
            .take(WireLimits.HAZARDS)
    }

    private fun media(m: PhoneMedia): PhoneMedia = m.copy(
        title = optionalLabel(m.title, WireLimits.MEDIA_TEXT),
        artist = optionalLabel(m.artist, WireLimits.MEDIA_TEXT),
        album = optionalLabel(m.album, WireLimits.MEDIA_TEXT),
        app = optionalLabel(m.app, WireLimits.NAME),
        trackKey = optionalLabel(m.trackKey, WireLimits.TRACK_KEY),
    )

    private fun call(m: PhoneCall): PhoneCall? {
        val id = label(m.id, WireLimits.ID)
        if (id.isEmpty()) return null
        return m.copy(
            id = id,
            callerName = optionalLabel(m.callerName, WireLimits.NAME),
            // Never cut a number short: a truncated number is a different number.
            number = m.number?.let { label(it, Int.MAX_VALUE) }?.takeIf {
                it.isNotEmpty() &&
                    it.length <= WireLimits.PHONE_NUMBER
            },
        )
    }

    private fun textMessage(m: PhoneMessage): PhoneMessage? {
        val id = label(m.id, WireLimits.ID)
        val sender = label(m.sender, WireLimits.NAME)
        if (id.isEmpty() || sender.isEmpty()) return null
        return m.copy(id = id, sender = sender, app = optionalLabel(m.app, WireLimits.NAME))
    }

    private fun location(m: PhoneLocation): PhoneLocation? {
        if (!m.lat.isFinite() || !m.lon.isFinite() || m.lat !in -90.0..90.0 || m.lon !in -180.0..180.0) return null
        return m.copy(
            accuracyM = inRange(m.accuracyM, 0.0, WireLimits.MAX_ACCURACY_M),
            speedMps = inRange(m.speedMps, 0.0, WireLimits.MAX_SPEED_MPS),
            bearingDeg = normalizeBearing(m.bearingDeg),
        )
    }
}
