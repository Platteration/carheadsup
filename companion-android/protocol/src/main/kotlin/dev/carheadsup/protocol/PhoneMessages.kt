package dev.carheadsup.protocol

/** Convenience builders for phone → HUD messages. */
public object PhoneMessages {
    /** App name sent in `hello.app`. */
    public const val APP_NAME: String = "carheadsup-companion"

    /** `nav.source` for guidance parsed from Google Maps notifications. */
    public const val SOURCE_GOOGLE_MAPS: String = "google-maps"

    public fun hello(device: String, appVersion: String, token: String): PhoneHello =
        PhoneHello(v = PROTOCOL_VERSION, device = device, app = APP_NAME, appVersion = appVersion, token = token)

    /** Ends guidance on the HUD. */
    public fun navEnded(source: String): PhoneNav = PhoneNav(active = false, source = source)

    /** Nothing playing / media session gone. */
    public fun mediaStopped(): PhoneMedia = PhoneMedia(playing = false, title = null, artist = null)

    /** Speed limit unknown (e.g. no matching road, or data unavailable). */
    public fun roadUnknown(source: RoadSource = RoadSource.OSM): PhoneRoad =
        PhoneRoad(speedLimitKph = null, unlimited = false, source = source)

    /** Clears every hazard on the HUD. */
    public fun noHazards(): PhoneHazards = PhoneHazards(emptyList())

    public fun input(action: InputAction): PhoneInput = PhoneInput(action)

    public fun tripsRequest(since: Long): PhoneTripsRequest = PhoneTripsRequest(since)

    public fun ping(id: Long): PhonePing = PhonePing(id)
}
