package dev.carheadsup.protocol.traffic

import dev.carheadsup.protocol.osm.BoundingBox

/**
 * A traffic-incident service the phone polls for what lies ahead. [TomTomTraffic] is the one
 * implemented; another (HERE's Traffic API `incidents`, say) plugs in by building its request for
 * an area and parsing its answer into [TrafficIncident]s. Everything else is shared: the corridor
 * the request covers ([TrafficCorridor]), the selection of incidents ahead
 * ([TrafficIncidentFinder]), the mapping onto HUD hazards ([TrafficHazards]), the request policy
 * and the daily budget ([TrafficPolicy]).
 */
public interface TrafficIncidentService {
    /** Name for logs and the status line ("TomTom"). */
    public val name: String

    /** The HTTP GET for the incidents in [area]. The URL may carry [apiKey]: never log it. */
    public fun request(area: BoundingBox, apiKey: String): TrafficRequest

    /**
     * The incidents in a successful (2xx) response body, de-duplicated by id. Tolerant: an
     * incident without a usable position is skipped, missing details stay unknown.
     *
     * @throws TrafficParseException when the body is not a response of this service at all.
     */
    public fun parse(body: String): List<TrafficIncident>

    /** What an HTTP status code means for the request policy. */
    public fun classify(httpStatus: Int): TrafficHttpOutcome = TrafficHttpOutcome.of(httpStatus)
}

/** An HTTP GET to a traffic service. Its [url] may contain the API key, so it is never printed. */
public class TrafficRequest(public val url: String, public val headers: Map<String, String> = emptyMap()) {
    override fun toString(): String = "TrafficRequest(${url.substringBefore('?')})"
}

/** The meaning of an HTTP status for the request policy. */
public enum class TrafficHttpOutcome {
    OK,

    /** 401/403: the key is wrong, revoked or not enabled for this API. Retrying will not help. */
    BAD_KEY,

    /** 429: too many requests; back off (honouring `Retry-After`). */
    RATE_LIMITED,

    /** 408 and 5xx: the service is unavailable for now; back off. */
    UNAVAILABLE,

    /** Any other status: the request itself is wrong (a bug, or the API changed); back off. */
    REJECTED,
    ;

    public companion object {
        public fun of(httpStatus: Int): TrafficHttpOutcome = when {
            httpStatus in 200..299 -> OK
            httpStatus == 401 || httpStatus == 403 -> BAD_KEY
            httpStatus == 429 -> RATE_LIMITED
            httpStatus == 408 || httpStatus >= 500 -> UNAVAILABLE
            else -> REJECTED
        }
    }
}

/** A response body that is not what the service sends. */
public class TrafficParseException(message: String) : Exception(message)
