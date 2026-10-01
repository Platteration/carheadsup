# carheadsup companion (Android)

The phone half of the carheadsup HUD. It runs on the driver's Android phone and feeds the HUD with
everything the car itself cannot know:

- **Navigation** from Google Maps (turn arrow, distance, street, ETA, remaining time/distance, the
  Maps arrow icon as a fallback), parsed from Maps' ongoing guidance notification.
- **Speed limit, road name/class and speed cameras** from OpenStreetMap (Overpass API), matched
  to the phone's GPS position and heading.
- **Traffic ahead** (optional, with your own free TomTom API key): jams and slowdowns with the
  expected delay, accidents, closures, road works, weather and broken-down vehicles up to about
  10 km ahead in the direction of travel ([details](#traffic-tomtom)).
- **Media**: song, artist, album and play state of whatever is playing.
- **Calls**: incoming/active/ended with caller name; accept or decline from the HUD's buttons.
- **Messages**: the *sender* only. The message text never leaves the phone; the phone reads it
  aloud instead (when both the HUD and the driver want that).
- **GPS position** (for sun-based night mode and context).
- **Trips**: the HUD's trip log (distance, time, fuel, cost) synced to the phone, plus
  maintenance reminders.
- A big-button **remote control** and the HUD's **settings app** in a WebView.
- **Pairing by QR code**: scan the code the parked HUD shows on its own display, and the app
  knows the pairing code, the HUD's identity and certificate and its address — nothing to type,
  nothing trusted on first use ([Using it](#using-it)).

## Architecture

```
┌────────────────────────── phone ───────────────────────────┐        ┌──────── HUD ────────┐
│ NavNotificationListener ──┐                                │        │                     │
│  (Maps nav, messages,     │                                │ wss:// │ /ws/phone           │
│   caller name)            ├─► PhoneHub ─► HudLink ─────────┼────────┼─► phone link        │
│ MediaMonitor ─────────────┤   (latest    (handshake,       │  JSON  │   (validated,       │
│ CallMonitor ──────────────┤    state)     replay, rates,   │ frames │    rate-checked)    │
│ LocationFeed ─► RoadInfo ─┤               heartbeat,       │◄───────┼── welcome, call-    │
│    │  Provider (Overpass) │               backoff)         │        │   action, trips …   │
│    └─► TrafficProvider ───┘ cameras and traffic go out     │        │                     │
│        (TomTom)             as one list (HazardAggregator) │        │                     │
│ MainActivity (Compose) ── HudApi (REST /api/*) ────────────┼────────┼─► REST API          │
│ HudSettingsActivity ── WebView ────────────────────────────┼────────┼─► /settings         │
└────────────────────────────────────────────────────────────┘        └─────────────────────┘
```

The Gradle build has two modules:

| Module | What | Builds where |
| --- | --- | --- |
| `:protocol` | Pure Kotlin/JVM: the wire protocol (mirrors `packages/core/src/types/protocol.ts`), its JSON configuration and size limits, the mutual authentication (`auth`: proofs bound to the certificate, certificate fingerprints, HUD pinning, the handshake state machine, the pairing-code rule `PairingCode` the HUD shares), the trust in the HUD's TLS certificate (`tls`: the pinning decisions and the `X509TrustManager` / host name check that enforce them, tested with real TLS handshakes), the mDNS advertisement (`link.HudAdvertisement`), the Google Maps notification parser, OSM speed-limit parsing, Overpass queries and road matching, traffic incidents (`traffic`: the TomTom request and response, the corridor ahead, the selection of incidents ahead, the mapping onto HUD hazards, the request policy and daily budget) and the merging of hazard sources (`hazards`), pairing by QR code (`pairing`: the pairing URI parser, the QR decoder built on ZXing — plain, inverted and mirrored codes — and the choice of the HUD's address), message-notification extraction, trip/maintenance models and formatting, reconnect backoff, rate limiting, heartbeat and replay state, when the driving monitors run (`MonitorPolicy`) and how the HUD can be reached without Wi-Fi (`HudRoute`). Everything testable lives here. | Any JDK 17+ machine |
| `:app` | The Android application (Kotlin, Jetpack Compose + Material 3, OkHttp, CameraX, no Google Play services). Adapts Android APIs to `:protocol`. | Only with an Android SDK |

`settings.gradle.kts` includes `:app` only when an Android SDK is found (`sdk.dir` in
`local.properties`, `ANDROID_HOME` or `ANDROID_SDK_ROOT`), and the Android Gradle Plugin is only
put on the build classpath in that case, so `./gradlew :protocol:test` works on plain JDK machines
(CI, the HUD's own dev box). `-Pcarheadsup.app=false` excludes the app explicitly.

### `:app` components

| Component | Role |
| --- | --- |
| `HudConnectionService` | Foreground service (types `connectedDevice` + `location`) that owns the link, media and call monitoring, and GPS, road and traffic look-ups — those only while the HUD is connected and for two minutes after it went away (`MonitorPolicy`), so the service can stay on all day. Sticky; "Stop" in its notification; a "HUD link stopped — tap to restart" notification when Android refuses to (re)start it in the background. |
| `BootReceiver` | Starts the service after the phone starts and after an app update (`BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`) when the user left it on — with the `connectedDevice` type only: Android grants no location to a service started in the background, so GPS joins the next time the app is opened. |
| `HudLink` | WebSocket client for `wss://<hud>:8443/ws/phone`. Finds the HUD by mDNS (`_carheadsup._tcp`, `HudDiscovery`: the TLS port and certificate fingerprint from the TXT records `tls` and `fp`; once paired, only the paired HUD's advertisement) or uses the manual `host:port` (the TLS port, 8443 by default; an address saved by an earlier app on the old default port 8080 is moved to 8443 once); connects through a `HudTrustManager` of its own per attempt — exactly the pinned certificate, or on a first pairing the presented (or advertised) one — and records the certificate the handshake binds; answers the HUD's `challenge` through `HudHandshake` (see [Privacy](#privacy)) and reports *Connected* only once the `welcome` proof checks out, pinning the first verified HUD with its certificate; after that replays the latest nav/road/hazards/media/call state and forwards new messages rate-limited per type (nav ≤ 4 Hz, location 1 Hz, media/road/hazards ≤ 2 Hz); pings every 5 s and reconnects when the HUD is silent for 15 s (the `hello` and every `ping` carry the phone's clock, which a HUD without network time follows); exponential backoff (1 s → 30 s, jittered), cut short when a Wi-Fi network comes or goes; with no network to reach the HUD over (no Wi-Fi, no hotspot of its own with the HUD on its subnet: `HudRoute`) it waits for one instead of dialling over mobile data; a refused or untrusted pairing (`bad-token`, a different or unconfirmed HUD, a wrong HUD proof) or a session the same phone replaced (close 4000) waits the maximum; another certificate for the paired HUD ("HUD certificate changed — re-pair") stops it until the HUD is forgotten or *Retry now*; while another phone holds the HUD it is refused with close 1013 and backs off as usual. Restarts mDNS discovery when it finds nothing for 30 s or on *Retry now*. |
| `QrScanner` | The camera preview that scans the HUD's pairing code (Setup): CameraX's preview and image analysis bound to the screen's lifecycle (the camera closes in the background and when scanning ends); each frame's luminance plane is decoded on a background thread by `:protocol`'s `QrDecoder` (only the latest frame waits). `MainViewModel.pairWithQrCode` then stores the pairing code, pins the HUD's id and certificate from the code (replacing any earlier pin), tries the code's addresses (all at once, waiting at most 2.5 s) and sets the first one it reaches, else the first IPv4 address (`PairingAddress`), and connects. |
| `LocalNetwork` | Binds HUD sockets to the Wi-Fi network. The HUD usually runs an access point without internet, which Android does not use as the default network; unbound sockets would go out over mobile data and never reach it. Counts Wi-Fi networks coming and going (the link retries at once), and without Wi-Fi tells from the phone's interfaces whether the HUD is reachable at all (`HudRoute`). |
| `NavNotificationListener` | Notification access: parses Google Maps' guidance (`GoogleMapsNotificationParser`), encodes the maneuver icon as a ≤ 32 KiB PNG, ends guidance 10 s after the notification disappears (at once when the listener is unbound); extracts message senders (`MessagingNotificationExtractor`) and caller names from call notifications that describe the tracked call. |
| `MessageRelay` / `MessageReader` | Sends `message` (sender, app, `readingAloud`) while connected; reads the text aloud with TextToSpeech under transient, ducking audio focus (`SpeechQueue`). Pauses for navigation prompts and resumes afterwards; never talks over a call — messages wait for it to end (up to 3 min). `readingAloud` is only set for messages that will be read. |
| `MediaMonitor` | `MediaSessionManager.getActiveSessions` (allowed for the notification listener) → `media`. |
| `CallMonitor` | `TelephonyCallback` (Android 12+) / `PhoneStateListener` + the `PHONE_STATE` broadcast for the number, contact lookup, `TelecomManager.acceptRingingCall()` / `endCall()` for the HUD's `call-action`. Android does not say whether a waiting call was answered or declined, so the call that goes on is shown without a caller (unless the HUD did it), until the dialer's ongoing-call notification names it. |
| `LocationFeed` | Platform `LocationManager` GPS at 1 Hz → `location`. |
| `RoadInfoProvider` | Overpass tiles (≈2 km) around the car, one polite request at a time, cached in memory and on disk (fresh for 7 days, used up to 90 days offline) → `road`, and cameras ahead → `HazardAggregator`. Unknown rather than stale when there is no data or no usable GPS fix for 5 s; while stopped, cameras are looked for in the last direction of travel. |
| `TrafficProvider` | Optional: TomTom incidents in a corridor about 10 km ahead (over the internet, never the HUD's Wi-Fi), polled per `TrafficPolicy` within a daily budget (`TrafficBudgetStore`); on each fix the incidents ahead → `HazardAggregator`. Status (last update, incidents ahead, errors, requests today) on the Setup screen. See [Traffic](#traffic-tomtom). |
| `HazardAggregator` | (`:protocol`) Merges cameras and traffic into the one `hazards` list the HUD takes (it replaces its whole list with each message): ids unique, nearest first, at most 50; sent at once when anything but the distances changes, otherwise every 5 s. Each provider reports through its own feed (`HazardFeed`), which it closes when it stops, so a fix still being processed then cannot bring its hazards back. |
| `TripStore` / `HudApi` | Trip log merged from `trip-completed`, `trips` and `GET /api/trips`, with one sync cursor per HUD (`TripCursors`: the HUD numbers its trips, so `trips-request.sinceSeq` catches up whatever the HUD's clock did); maintenance from `GET /api/maintenance`; units from `GET /api/config`; `POST /api/input` for the remote when the socket is down. REST calls (they carry the API token) only go over HTTPS to the HUD that last proved itself (`HudLink.trusted`), through a client that accepts exactly the certificate it proved itself with. |
| `MainActivity` | Compose UI: **Status** (connection and the HUD's certificate fingerprint, "a different HUD is answering" and "HUD certificate changed — re-pair" with *Forget paired HUD*, the confirmation of a HUD without pairing code with its certificate, permission checklist, battery optimisation), **Remote** (primary / secondary / pages / blank / brightness), **Trips** (log + maintenance), **Setup** (*Scan HUD QR code*, address, pairing code and the paired HUD with its certificate, API token, feature switches, traffic with the TomTom key and its status, HUD settings). |
| `HudSettingsActivity` | The HUD's `/settings` page over HTTPS in a WebView (the process is bound to the HUD's Wi-Fi while it is open), only for a HUD that has proven itself. The WebView does not know the HUD's self-signed certificate: `onReceivedSslError` proceeds only when the certificate is the pinned one on the HUD's address, and otherwise cancels and says why. The API token is handed to the page as `?token=` (`HudEndpoint.withApiToken`): the page keeps it in its storage, removes it from the address and sends it with its own API calls, which a WebView cannot add a header to. A WebView drops the page's `blob:` downloads, so files the page generates (the trips CSV) go through `FileExportBridge` (`window.CarheadsupAndroid.saveFile`): into *Downloads* on Android 10+ (MediaStore, no permission), through the share sheet (a `FileProvider` cache file) on Android 8–9; name and type are sanitised (`ExportFile`). |

### Protocol conformance

`dev.carheadsup.protocol` mirrors the TypeScript contract exactly: sealed `PhoneToHud` /
`HudToPhone` hierarchies with `t` as the class discriminator, explicit `null`s (the
optional-but-not-nullable fields — `nav.maneuver`, `ping.id`, `hello.time`, `ping.time` and
`trips-request.sinceSeq` — are omitted instead), unknown
keys ignored and unknown enum values tolerated when decoding. `PhoneWire.encode` runs every
message through `WireSanitizer` first, which applies the HUD validator's limits (100-character
names, 44 KiB icon, 50 hazards, finite in-range numbers, no control characters…), so a single odd
notification never gets an update rejected. `ContractSyncTest` reads the TypeScript sources
(`nav.ts`, `phone.ts`, `events.ts`, `records.ts`, `protocol.ts`, `validate.ts`, `phone-auth.ts`,
`pairing.ts`, `tokens.ts`) and fails if enum values, message types, the protocol version, the size
limits, the authentication and pairing constants or the pairing-code rule drift; `PhoneAuthTest` and `PairingUriTest` assert the
shared test vectors (`packages/core/test/protocol/phone-auth-vectors.json` and
`pairing-uri-vectors.json`, which the HUD's tests assert as well, and `ContractSyncTest` checks
the module's copies against). `QrDecoderTest` decodes the very QR code the HUD's renderer draws
(`src/test/resources/pairing/hud-qr.txt`, which the renderer's tests keep equal to its output),
as drawn, mirrored as the panel shows it and inverted as its reflection shows it.

## Permissions and why

| Permission | Why |
| --- | --- |
| Notification access (special) | Google Maps guidance, message senders, the dialer's caller name, and permission to read media sessions. |
| `READ_PHONE_STATE` | Call ringing / active / ended. |
| `READ_CALL_LOG` | The incoming caller's number (Android only delivers it with this permission). |
| `ANSWER_PHONE_CALLS` | Accept / decline from the HUD (`TelecomManager`). Declining needs Android 9+. |
| `READ_CONTACTS` | Caller name for the number. |
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | GPS for the HUD, speed-limit matching, cameras and traffic ahead. Only while the foreground service runs and the HUD is connected (no background location). |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `FOREGROUND_SERVICE_LOCATION` | The foreground service that keeps the link and GPS alive with the screen off. |
| `POST_NOTIFICATIONS` (Android 13+) | The service notification, "trip logged" and maintenance reminders. |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Lets the user exempt the app from Doze so the link survives a locked phone. |
| `RECEIVE_BOOT_COMPLETED` | Restarting the connection service after the phone restarts, if it was left on. |
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE` | The HUD link (`wss://` and `https://` on the car's LAN, pinned to the HUD's certificate), Overpass and TomTom (HTTPS), binding to the HUD's Wi-Fi. |
| `CHANGE_WIFI_MULTICAST_STATE`, `CHANGE_NETWORK_STATE` | mDNS discovery; also the prerequisites Android 14 requires for the `connectedDevice` service type. |
| `CAMERA` | Scanning the HUD's pairing QR code. Asked for only when you tap *Scan HUD QR code*; declared with the camera as an optional feature, so phones without one install the app and pair by typing the code. |

`<queries>` declares the TTS service and launcher apps, so the app can use TextToSpeech and show
app names ("WhatsApp", "Spotify"). Cleartext traffic is not allowed (`network_security_config.xml`):
the HUD is reached over TLS with its pinned certificate, everything on the internet over HTTPS.
Backups are disabled (the tokens and the TomTom key are stored in app-private preferences).

On Android 13+ a sideloaded app must be allowed "restricted settings" before notification access
can be granted: *App info → ⋮ → Allow restricted settings*. The Status screen links there.

## Google Maps: what works and the limits

There is no public navigation API; the Maps notification is the only source and **its format is not
a contract**. The parser therefore classifies each piece of text by what it looks like instead of
by position, keeps all language knowledge in tables (`NavLanguages`: English and German ship; a
language is one more `NavLanguage` entry), and degrades gracefully.

Observed layout (2023–2026):

- **title**: distance to the maneuver (`300 m`, `0.2 mi`, `500 ft`, `100 yd`, `1,2 km`) — or, with
  no distance, the instruction itself (`Head north on Main St`, `Rerouting…`);
- **text**: the instruction or the street (`Turn right onto Main St`, `Main St toward Downtown`,
  `toward Downtown`), sometimes a "Then …" follow-up in the expanded text;
- **subText**: `12 min · 5.2 km · 10:42 ETA` / `12 Min. · 5,2 km · Ankunft 10:42`;
- **large icon**: the maneuver arrow;
- Android 16 "Live Update" notifications also carry the distance as the status-bar chip text.

What you get:

- Maneuver types from the instruction verbs (turn / slight / sharp / keep / merge / exit / ramp /
  fork / U-turn / roundabout with exit number / continue / arrive / ferry), resolved for left- or
  right-hand traffic (from the mobile network's country, looked up again every minute). The side
  comes from the maneuver's own words: lane guidance ("Use the right lane to turn left") only
  hints at the side of an exit that names none, and an inline follow-up ("Turn left, then keep
  right") becomes the next maneuver. When Maps only shows a street ("Main St toward X") the type
  is `unknown` and the HUD draws **Maps' own arrow icon** instead; text that is neither a known
  instruction nor a name ("Pass through the toll plaza") is never shown as the street.
- Distance, next street (and current street for "continue/head"), remaining time and distance,
  and the ETA as an absolute time (resolved in the phone's time zone; crossing midnight, the
  night the clocks go back and 12/24-hour formats handled; a clock time that disagrees with the
  remaining time by more than 20 min yields to it).
- Guidance ends on the HUD 10 s after the notification disappears (Maps briefly removes and
  re-posts it during normal guidance), and at once when notification access goes away.

Limits:

- **Format drift**: a Maps update can change wording or layout. Unknown phrasing falls back to the
  icon; unknown numbers stay empty. New wording is a table entry plus a test case in
  `GoogleMapsNotificationParserTest`.
- **Lane guidance** is only drawn inside Maps' own UI and is not in the notification — `lanes` is
  never sent.
- **Languages**: English and German instructions; other languages still get distance, ETA and the
  icon but mostly `unknown` maneuvers.
- **Android Auto**: while the phone is projecting to a car display, Maps runs its guidance in the
  projected session and the phone-side notification is typically absent or reduced, so the HUD may
  get little or no guidance. Third-party apps cannot read Android Auto's navigation state. Use
  Maps on the phone (with the HUD) rather than Android Auto projection.
- Hazards and traffic from Google Maps are not exposed; cameras come from OpenStreetMap and
  traffic, if you want it, from TomTom ([below](#traffic-tomtom)).

## Speed limits and cameras (OpenStreetMap)

`maxspeed` values are parsed in all their forms (`50`, `30 mph`, `none`, `walk`, `signals`,
country-coded implicit values such as `DE:urban`, `RU:rural`, `GB:nsl_single`, zones like
`DE:zone30`, lists `50;30` → lowest) with a table of common legal defaults; direction-specific
`maxspeed:forward/backward` apply according to the direction of travel. The way is chosen by
distance to each segment plus heading agreement (one-way roads are never matched against the
direction of travel; the previous way wins ties). Cameras come from `highway=speed_camera` nodes
and `type=enforcement` relations (speed, red-light, section control) within 1.5 km ahead.

Data quality is only as good as the local map. Overpass is a free community service: the app
sends at most one request at a time and a few per minute, backs off on errors and `Retry-After`,
and caches tiles for a week. **Speed-camera warnings are illegal while driving in some countries**
(e.g. Germany, Switzerland), so they are off until the driver turns them on in *Setup*.

## Traffic (TomTom)

Traffic is the one thing neither Google Maps' notification nor OpenStreetMap provides, so the
app can ask [TomTom's Traffic API](https://developer.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-incidents/incident-details)
for it. It is **off by default** and needs your own key.

**Setup.** Create a free account at [developer.tomtom.com](https://developer.tomtom.com/), copy
the API key it makes for you (the Traffic API is included), and in *Setup → Traffic ahead* paste
it, tap *Save* and turn on *Traffic from TomTom*. The status line below tells you what it does:
the time of the last update and how many incidents lie ahead, or why not (no GPS or no direction
of travel yet, paused while standing, TomTom unreachable, the key refused, today's budget used
up), and the requests made today.

**What the HUD shows.** Incidents ahead of the car, on its side of the road, nearest first:

| TomTom incident | On the HUD |
| --- | --- |
| Jam: queuing or stationary traffic | *Traffic jam* with the delay, e.g. "+8 min" |
| Jam: slow traffic | *Slowdown* with the delay |
| Accident · Road works | *Accident* · *Road works*, with the delay if there is one |
| Fog, rain, ice, wind, flooding | *Weather* |
| Broken-down vehicle | *Object on road* |
| Road or lane closed, dangerous conditions | *Hazard* while moving; "Road closed", "Lane closed" … when stopped |

On the highway the HUD shows traffic from 3 km (`display.trafficRevealM`), other hazards from
1 km, and the distance counts down with the car's own odometer.

**How it asks** (`dev.carheadsup.protocol.traffic`, all unit-tested):

- *Where*: one `GET /traffic/services/5/incidentDetails` for a corridor reaching 10 km ahead along
  the direction of travel and 3 km to either side (`TrafficCorridor`, about 60 km²) — not a big
  square around the car — with a `fields=` projection of only what is used, `language=en-GB` and
  `timeValidityFilter=present`.
- *Which incidents are ahead* (`TrafficIncidentFinder`): the point where traffic reaches the
  incident (the first point of its geometry, the tail of a jam) lies in the same ±35° cone around
  the heading as speed cameras and within the corridor, and the incident runs the car's way
  (within 75°), so a jam on the opposite carriageway or a crossing road does not count. Straight
  distance to that point, so a warning comes early rather than late. While the car is too slow for
  a GPS bearing (a queue, a red light), the last direction of travel is used, as for cameras.
- *When* (`TrafficPolicy`): every 2 minutes while driving, and at once after 3 km or a turn of 60°,
  but at most once a minute; at red lights and in queues it keeps asking (delays change), after
  5 minutes standing still it stops until the car moves; failures back off from 30 s to 15 min
  (and honour `Retry-After`); a refused key (HTTP 401/403) stops all requests until you save
  another key (or switch traffic off and on, or restart the app). Incidents older than 10 minutes are not shown, and without a usable GPS fix for 5 s
  they are withdrawn.
- *How much*: TomTom's free plan allows 2,500 requests a day; the app counts its requests per UTC
  day (kept across restarts) and stops at 2,000, leaving room for other uses of the key. Two
  hours of driving take about 60–90 requests.

**Privacy.** While traffic is on and you drive, the phone sends TomTom a box around and ahead of
the car (about 10 × 6 km, every couple of minutes) with your API key, over HTTPS — enough for
TomTom to follow where you drive. Turn it off and nothing goes to TomTom. The key is stored like
the pairing code (app-private, excluded from backups) and never logged.

**Limits.** The phone does not know your route: it reports what lies ahead in the direction of
travel — including a jam on the motorway you are about to leave — and can miss incidents round
a sharp bend or a turn until the next request. Updates every couple of minutes are not live
traffic. It needs mobile data.

**Another provider.** TomTom sits behind `TrafficIncidentService` (build the request for an area,
parse the answer into `TrafficIncident`s, classify HTTP statuses); the corridor, the selection,
the mapping onto HUD hazards, the policy and the budget are shared. A HERE implementation, say,
would add its request and parser and a switch to choose it.

## Building

Requirements: JDK 17+ (the build runs on JDK 21), an Android SDK with platform 36 for `:app`.

> **Status:** `:protocol` is built and tested on every change. `:app` has so far only been
> type-checked against stubs of the Android and Compose APIs — it has not been built with the
> Android Gradle Plugin or run on a phone, so expect fixes on the first real build (notification
> parsing, discovery, pairing screens, the QR scanner, the foreground service and file export in
> particular).

- **Android Studio**: open `companion-android/`, let it create `local.properties`, run the `app`
  configuration.
- **Command line**:

  ```sh
  cd companion-android
  echo "sdk.dir=$HOME/Android/Sdk" > local.properties   # or export ANDROID_HOME
  ./gradlew :app:assembleDebug                          # app/build/outputs/apk/debug/app-debug.apk
  ./gradlew :app:installDebug                           # onto a connected phone
  ```

  Release builds (`:app:assembleRelease`) are minified with R8 and need your own signing config.

- **Protocol module and tests** (no Android SDK needed):

  ```sh
  cd companion-android
  ./gradlew :protocol:test
  ```

Toolchain versions (`gradle/libs.versions.toml`) are the newest that work together on the Gradle
8.14 wrapper: AGP 8.13.2 (AGP 9 needs Gradle 9), Kotlin 2.3.21 (Kotlin 2.4 needs the R8 of AGP 9),
Compose BOM 2026.06.01 (Compose 1.11; 1.12 needs AGP 9.2), Lifecycle 2.10, Activity 1.12,
Core 1.17 (newer versions need compileSdk 36.1), CameraX 1.4.2 (a line whose AAR metadata allows
compileSdk 36) and ZXing core 3.5.4 (Maven Central, used by `:protocol`). Moving to Gradle 9 + AGP 9 lifts all of these
together.

## Using it

1. Put the HUD in phone mode (`server.host = 0.0.0.0`, `server.mdns = true`) and join the phone to
   the car's Wi-Fi.
2. **Pair by scanning** (parked): open the HUD's *Pair a phone* page — in its settings app
   *Phone → Show pairing code on the HUD*, or page to the dashboard's last page with the page
   button — then *Setup → Scan HUD QR code* and point the camera at the HUD's display (the panel,
   mirrored, or its reflection in the windshield). The app asks for the camera permission only
   now. The code holds the pairing code, the HUD's id, its certificate's fingerprint and its
   addresses ([details](../docs/protocol.md#pairing-by-qr-code)): the app stores the code, pins
   the HUD and certificate right away, sets the first address it reaches (automatic discovery
   off) and connects. A code of another app, a damaged one or one of a newer HUD is reported and
   scanning goes on. A HUD without pairing code shows none: set one in its settings first (a new
   HUD makes one itself).

   **Or by hand**: leave "Find the HUD automatically" on (or enter the HUD's address with its TLS
   port, e.g. `10.42.0.1:8443`) and enter the HUD's pairing code (`phone.pairingToken`): one word
   of printable ASCII, as the HUD takes it (`:protocol`'s `PairingCode`; a code saved by an older
   version that has spaces or accents keeps working until you change it). The
   first HUD that proves the pairing code is remembered as yours, with its certificate ("Paired
   with HUD … · certificate …" in *Setup*); compare that fingerprint with the HUD's settings
   (*Phone → Encrypted link*). A HUD without pairing code cannot prove anything: the app shows it
   as unverified, with its certificate, and connects only after you tap *This is my HUD —
   connect*.

   Either way, enter the API token if the REST API is protected (`server.apiToken`).
3. *Status*: grant the permissions, exempt the app from battery optimisation, tap *Connect to HUD*
   (after a scan the app has started the connection itself).
4. Start navigation in Google Maps on the phone.
5. Optionally, for traffic ahead, enter a TomTom API key in *Setup* ([Traffic](#traffic-tomtom)).

Leave the connection on: the app reconnects on its own when the car's Wi-Fi comes and goes, the
service survives the screen being off, and it starts again after the phone restarts (or the app
is updated). It costs little while the car is parked: GPS, the speed-limit and traffic look-ups
run only while the HUD is connected (and two minutes after, so a short drop does not restart
them), and without a Wi-Fi network the app waits for one instead of trying to reach the HUD over
mobile data. When a Wi-Fi network appears, it connects at once rather than after its backoff.
(With the HUD on the phone's own hotspot there is no Wi-Fi network: the app then looks for the
HUD on the hotspot's subnet every 30 s.) After a phone restart GPS is off until the app is opened
once — Android does not let a service started in the background use location. Some manufacturers
(Xiaomi, Huawei, Samsung "sleeping apps") kill background services aggressively or block starts
at boot — allow auto-start / exclude the app there as well.

## Privacy

- Message content is only read aloud on the phone; the `message` frame has no content field (the
  HUD rejects frames that try) and message ids are keyed hashes (HMAC with a random key that
  never leaves the phone), so they cannot be matched against guessed texts.
- **Encrypted, and pinned to the HUD's certificate** ([details](../docs/protocol.md#tls-and-the-huds-certificate)).
  Everything goes to the HUD over TLS — the WebSocket (`wss://`), REST calls and the settings
  page (`https://`); the app does not allow cleartext at all (`network_security_config.xml`). The
  HUD has a self-signed certificate, which the app pins when it pairs — from the scanned code,
  or at the first connection when you pair by hand: from then on it
  accepts exactly that certificate, and a different one — someone posing as the HUD, or a HUD
  that was reset — is a hard stop, "HUD certificate changed — re-pair", until you *Forget paired
  HUD*. Certificate authorities and host names play no part (the HUD is reached by IP address).
- **Phone and HUD verify each other** (protocol v3, [details](../docs/protocol.md#authentication)).
  The pairing code never leaves the phone: the HUD sends a `challenge`, the phone answers with an
  HMAC proof over it, and the HUD proves the code in return — both proofs bound to the
  certificate the phone was shown, so a relay with a certificate of its own cannot get through.
  The app pins the id and certificate from the HUD's QR code, or — pairing by hand — those of the
  first HUD that proves the code (per pairing code; when the mDNS advertisement names a
  certificate, it must be that one), and from then on:
  - sends nothing — no position, navigation, media, calls, messages, no REST call with the API
    token, not even its proof — to a HUD with another id or certificate ("A different HUD is
    answering" / "HUD certificate changed"; if you replaced or reset your HUD, *Forget paired
    HUD* and it pairs again);
  - sends nothing and ignores everything (call actions included) from its own HUD until the HUD's
    proof checks out;
  - with automatic discovery, only uses the paired HUD's mDNS advertisement (or one without an id).
- **Scanning trusts nothing on first use; pairing by hand does.** A scanned code comes from the
  HUD's own display, and the app pins its certificate before connecting: a device posing as the
  HUD on the Wi-Fi gets nothing, not even the phone's proof. Paired by hand, the first connection
  trusts the certificate it sees: someone who controls the car's Wi-Fi at that moment cannot get
  in without the pairing code, but receives the phone's proof and could test guesses of a weak
  code offline — use a long random one (the HUD's *Generate*), and compare the certificate the
  app shows with the HUD's settings. After that, and for anyone who only listens, there is
  nothing to read or guess from. The camera is used only while the scanner is open, and frames
  never leave the phone.
- **A HUD without pairing code is not verified.** Anyone can make the proofs then. The app shows
  such a HUD as unverified with its certificate's fingerprint, connects only after you confirm
  it, and pins both. Set a pairing code on the HUD. Use the car's own password-protected Wi-Fi
  and stop the service (notification → *Stop*) when not driving.
- Each install has a random device id (`hello.deviceId`) that tells phones apart on the HUD, so
  two phones of the same model and name are two phones.
- Nothing is sent anywhere but the HUD, except Overpass requests with the area around the car
  (tile bounding boxes, not the exact position) and, only if you turn traffic on, TomTom
  requests with a box around and ahead of the car and your API key ([Traffic](#traffic-tomtom)).
- Tokens and the TomTom key live in app-private storage; backups are disabled.
