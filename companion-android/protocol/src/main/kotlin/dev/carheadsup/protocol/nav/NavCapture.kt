package dev.carheadsup.protocol.nav

import dev.carheadsup.protocol.ManeuverType
import dev.carheadsup.protocol.PhoneNav
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * One navigation notification as a parser test case: what Google Maps posted, where and when, and
 * what the parser made of it. The companion app's capture (Setup → "Capture navigation
 * notifications") records these, and its export is a JSON array of them — the format of the test
 * fixtures in `protocol/src/test/resources/nav/`, which a parameterised test replays. A capture
 * becomes a test case once someone has checked [expected] (it is the parser's answer at capture
 * time, null when it understood nothing) against what Maps showed.
 *
 * Only Google Maps' notifications are captured, never another app's (messages stay private).
 */
@Serializable
public data class NavCaptureCase(
    /** A description: what the case shows ("roundabout, second exit, German"). */
    val name: String,
    /** The phone's language and region (`Locale.toLanguageTag()`), e.g. "de-DE". */
    val locale: String,
    /** The phone's time zone (IANA), for times of arrival. */
    val zone: String,
    /** When the notification was posted, epoch ms: the parser's clock. */
    val capturedAtMs: Long,
    @EncodeDefault val drivingSide: DrivingSide = DrivingSide.RIGHT,
    val notification: CapturedNotification,
    /** What the parser should make of it (or, in a fresh capture, made of it); null: nothing. */
    @EncodeDefault val expected: ExpectedNav? = null,
) {
    /** The notification as the parser's input. */
    public fun content(): NavNotificationContent = NavNotificationContent(
        packageName = GoogleMapsNotificationParser.GOOGLE_MAPS_PACKAGE,
        title = notification.title,
        text = notification.text,
        subText = notification.subText,
        bigText = notification.bigText,
        shortCriticalText = notification.shortCriticalText,
        category = notification.category,
        isOngoing = notification.isOngoing,
    )
}

/** The text fields of a captured Maps notification (see [NavNotificationContent]). */
@Serializable
public data class CapturedNotification(
    @EncodeDefault val title: String? = null,
    @EncodeDefault val text: String? = null,
    @EncodeDefault val subText: String? = null,
    @EncodeDefault val bigText: String? = null,
    @EncodeDefault val shortCriticalText: String? = null,
    @EncodeDefault val category: String? = null,
    @EncodeDefault val isOngoing: Boolean = true,
) {
    public companion object {
        public fun of(content: NavNotificationContent): CapturedNotification = CapturedNotification(
            title = content.title,
            text = content.text,
            subText = content.subText,
            bigText = content.bigText,
            shortCriticalText = content.shortCriticalText,
            category = content.category,
            isOngoing = content.isOngoing,
        )
    }
}

/** The parts of a parsed [PhoneNav] a test case checks. */
@Serializable
public data class ExpectedNav(
    val maneuver: ManeuverType,
    @EncodeDefault val roundaboutExit: Int? = null,
    @EncodeDefault val distanceM: Double? = null,
    @EncodeDefault val street: String? = null,
    @EncodeDefault val currentStreet: String? = null,
    @EncodeDefault val then: ManeuverType? = null,
    @EncodeDefault val remainingSeconds: Double? = null,
    @EncodeDefault val remainingDistanceM: Double? = null,
    @EncodeDefault val etaEpochMs: Long? = null,
) {
    public companion object {
        public fun of(nav: PhoneNav): ExpectedNav = ExpectedNav(
            maneuver = nav.maneuver?.type ?: ManeuverType.UNKNOWN,
            roundaboutExit = nav.maneuver?.roundaboutExit,
            distanceM = nav.distanceM,
            street = nav.street,
            currentStreet = nav.currentStreet,
            then = nav.then?.type,
            remainingSeconds = nav.remainingSeconds,
            remainingDistanceM = nav.remainingDistanceM,
            etaEpochMs = nav.etaEpochMs,
        )
    }
}

/**
 * The capture's rolling log: one [NavCaptureCase] per line (JSON Lines) in the app's private
 * storage, the newest [MAX_CASES] kept. Maps re-posts its notification every second with the
 * distance counting down, so a post is only kept when it differs from the last one kept in more
 * than its numbers ([shape]): the log then holds every distinct format, not three minutes of
 * countdown. Pure: the app does the file I/O.
 */
public object NavCaptureLog {
    public const val MAX_CASES: Int = 200

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = true
    }
    private val pretty = Json(json) {
        prettyPrint = true
        prettyPrintIndent = "  "
    }
    private val NUMBER = Regex("\\d+(?:[.,]\\d+)*")

    /** What a notification looks like without its numbers: equal shapes are one case. */
    public fun shape(notification: CapturedNotification): String =
        listOf(
            notification.title,
            notification.text,
            notification.subText,
            notification.bigText,
            notification.shortCriticalText,
            notification.category,
            notification.isOngoing.toString(),
        ).joinToString("\u0000") { it?.replace(NUMBER, "#") ?: "" }

    /** A capture of [content], posted at [capturedAtMs], and the parser's [result]. */
    public fun case(
        content: NavNotificationContent,
        locale: String,
        zone: String,
        capturedAtMs: Long,
        drivingSide: DrivingSide,
        result: PhoneNav?,
    ): NavCaptureCase {
        val maneuver = result?.maneuver?.type?.name?.lowercase()?.replace('_', '-') ?: "not understood"
        return NavCaptureCase(
            name = "captured $locale: $maneuver",
            locale = locale,
            zone = zone,
            capturedAtMs = capturedAtMs,
            drivingSide = drivingSide,
            notification = CapturedNotification.of(content),
            expected = result?.let(ExpectedNav::of),
        )
    }

    public fun encodeLine(case: NavCaptureCase): String = json.encodeToString(NavCaptureCase.serializer(), case)

    /** The cases of a log file; lines that do not decode (a torn last line) are skipped. */
    public fun decodeLines(text: String): List<NavCaptureCase> = text.lineSequence()
        .filter { it.isNotBlank() }
        .mapNotNull { line ->
            try {
                json.decodeFromString(NavCaptureCase.serializer(), line)
            } catch (e: SerializationException) {
                null
            } catch (e: IllegalArgumentException) {
                null
            }
        }
        .toList()

    /** The export: the cases as a JSON array, in the format of the parser's test fixtures. */
    public fun export(cases: List<NavCaptureCase>): String =
        pretty.encodeToString(ListSerializer(NavCaptureCase.serializer()), cases) + "\n"

    /** A fixture file (or an export): its cases; throws on anything else. */
    public fun decodeFixture(text: String): List<NavCaptureCase> =
        json.decodeFromString(ListSerializer(NavCaptureCase.serializer()), text)
}
