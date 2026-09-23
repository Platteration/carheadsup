# carheadsup companion (Android)

The phone half of the carheadsup HUD. It runs on the driver's Android phone and feeds the HUD with
everything the car itself cannot know:

- **Navigation** from Google Maps (turn arrow, distance, street, ETA, remaining time/distance, the
  Maps arrow icon as a fallback), parsed from Maps' ongoing guidance notification.
- **Speed limit, road name/class and speed cameras** from OpenStreetMap (Overpass API), matched
  to the phone's GPS position and heading.
- **Media**: song, artist, album and play state of whatever is playing.
- **Calls**: incoming/active/ended with caller name; accept or decline from the HUD's buttons.
- **Messages**: the *sender* only. The message text never leaves the phone; the phone reads it
  aloud instead (when both the HUD and the driver want that).
- **GPS position** (for sun-based night mode and context).
- **Trips**: the HUD's trip log (distance, time, fuel, cost) synced to the phone, plus
  maintenance reminders.
- A big-button **remote control** and the HUD's **settings app** in a WebView.

## Architecture

```
┌────────────────────────── phone ──────────────────────────┐        ┌──────── HUD ────────┐
│ NavNotificationListener ──┐                                │        │                     │
│  (Maps nav, messages,     │                                │  ws:// │ /ws/phone           │
│   caller name)            ├─► PhoneHub ─► HudLink ─────────┼────────┼─► phone link        │
│ MediaMonitor ─────────────┤   (latest    (hello, replay,   │  JSON  │   (validated,       │
│ CallMonitor ──────────────┤    state)     rate limits,     │ frames │    rate-checked)    │
│ LocationFeed ─► RoadInfo ─┘               heartbeat,       │◄───────┼── welcome, call-    │
│                 Provider (Overpass)       backoff)         │        │   action, trips …   │
│ MainActivity (Compose) ── HudApi (REST /api/*) ────────────┼────────┼─► REST API          │
│ HudSettingsActivity ── WebView ────────────────────────────┼────────┼─► /settings         │
└────────────────────────────────────────────────────────────┘        └─────────────────────┘
```

The Gradle build has two modules:

| Module | What | Builds where |
| --- | --- | --- |
| `:protocol` | Pure Kotlin/JVM: the wire protocol (mirrors `packages/core/src/types/protocol.ts`), its JSON configuration and size limits, the Google Maps notification parser, OSM speed-limit parsing, Overpass queries and road matching, message-notification extraction, trip/maintenance models and formatting, reconnect backoff, rate limiting, heartbeat and replay state. Everything testable lives here. | Any JDK 17+ machine |
| `:app` | The Android application (Kotlin, Jetpack Compose + Material 3, OkHttp, no Google Play services). Adapts Android APIs to `:protocol`. | Only with an Android SDK |

`settings.gradle.kts` includes `:app` only when an Android SDK is found (`sdk.dir` in
`local.properties`, `ANDROID_HOME` or `ANDROID_SDK_ROOT`), and the Android Gradle Plugin is only
put on the build classpath in that case, so `./gradlew :protocol:test` works on plain JDK machines
(CI, the HUD's own dev box). `-Pcarheadsup.app=false` excludes the app explicitly.

### `:app` components

| Component | Role |
| --- | --- |
| `HudConnectionService` | Foreground service (types `connectedDevice` + `location`) that owns the link, GPS, media, call and road monitoring while driving. Sticky; "Stop" in its notification. |
| `HudLink` | WebSocket client for `ws://<hud>:8080/ws/phone`. Finds the HUD by mDNS (`_carheadsup._tcp`, `HudDiscovery`) or uses the manual `host:port`; sends `hello` with the pairing token; after `welcome` replays the latest nav/road/hazards/media/call state and forwards new messages rate-limited per type (nav ≤ 4 Hz, location 1 Hz, media/road/hazards ≤ 2 Hz); pings every 5 s and reconnects when the HUD is silent for 15 s; exponential backoff (1 s → 30 s, jittered); a refused pairing (`bad-token`) waits the maximum. |
| `LocalNetwork` | Binds HUD sockets to the Wi-Fi network. The HUD usually runs an access point without internet, which Android does not use as the default network; unbound sockets would go out over mobile data and never reach it. |
| `NavNotificationListener` | Notification access: parses Google Maps' guidance (`GoogleMapsNotificationParser`), encodes the maneuver icon as a ≤ 32 KiB PNG, ends guidance 10 s after the notification disappears; extracts message senders (`MessagingNotificationExtractor`) and dialer caller names. |
| `MessageRelay` / `MessageReader` | Sends `message` (sender, app, `readingAloud`) while connected; reads the text aloud with TextToSpeech under transient, ducking audio focus. Never talks over a call. |
| `MediaMonitor` | `MediaSessionManager.getActiveSessions` (allowed for the notification listener) → `media`. |
| `CallMonitor` | `TelephonyCallback` (Android 12+) / `PhoneStateListener` + the `PHONE_STATE` broadcast for the number, contact lookup, `TelecomManager.acceptRingingCall()` / `endCall()` for the HUD's `call-action`. |
| `LocationFeed` | Platform `LocationManager` GPS at 1 Hz → `location`. |
| `RoadInfoProvider` | Overpass tiles (≈2 km) around the car, one polite request at a time, cached in memory and on disk (fresh for 7 days, used up to 90 days offline) → `road` and `hazards`. Unknown rather than stale when there is no data. |
| `TripStore` / `HudApi` | Trip log merged from `trip-completed`, `trips` and `GET /api/trips`; maintenance from `GET /api/maintenance`; units from `GET /api/config`; `POST /api/input` for the remote when the socket is down. |
| `MainActivity` | Compose UI: **Status** (connection, permission checklist, battery optimisation), **Remote** (primary / secondary / pages / blank / brightness), **Trips** (log + maintenance), **Setup** (address, pairing and API tokens, feature switches, HUD settings). |
| `HudSettingsActivity` | The HUD's `/settings` page in a WebView (the process is bound to the HUD's Wi-Fi while it is open). |

### Protocol conformance

`dev.carheadsup.protocol` mirrors the TypeScript contract exactly: sealed `PhoneToHud` /
`HudToPhone` hierarchies with `t` as the class discriminator, explicit `null`s (the two
optional-but-not-nullable fields, `nav.maneuver` and `ping.id`, are omitted instead), unknown
keys ignored and unknown enum values tolerated when decoding. `PhoneWire.encode` runs every
message through `WireSanitizer` first, which applies the HUD validator's limits (100-character
names, 44 KiB icon, 50 hazards, finite in-range numbers, no control characters…), so a single odd
notification never gets an update rejected. `ContractSyncTest` reads the TypeScript sources
(`nav.ts`, `phone.ts`, `events.ts`, `records.ts`, `protocol.ts`, `validate.ts`) and fails if enum
values, message types, the protocol version or the size limits drift.

## Permissions and why

| Permission | Why |
| --- | --- |
| Notification access (special) | Google Maps guidance, message senders, the dialer's caller name, and permission to read media sessions. |
| `READ_PHONE_STATE` | Call ringing / active / ended. |
| `READ_CALL_LOG` | The incoming caller's number (Android only delivers it with this permission). |
| `ANSWER_PHONE_CALLS` | Accept / decline from the HUD (`TelecomManager`). Declining needs Android 9+. |
| `READ_CONTACTS` | Caller name for the number. |
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | GPS for the HUD, speed-limit matching and cameras ahead. Only while the foreground service runs (no background location). |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `FOREGROUND_SERVICE_LOCATION` | The foreground service that keeps the link and GPS alive with the screen off. |
| `POST_NOTIFICATIONS` (Android 13+) | The service notification, "trip logged" and maintenance reminders. |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Lets the user exempt the app from Doze so the link survives a locked phone. |
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE` | The HUD link (plain HTTP/WebSocket on the car's LAN), Overpass (HTTPS), binding to the HUD's Wi-Fi. |
| `CHANGE_WIFI_MULTICAST_STATE`, `CHANGE_NETWORK_STATE` | mDNS discovery; also the prerequisites Android 14 requires for the `connectedDevice` service type. |

`<queries>` declares the TTS service and launcher apps, so the app can use TextToSpeech and show
app names ("WhatsApp", "Spotify"). Cleartext traffic is allowed because the HUD's LAN address is
only known at runtime; everything on the internet uses HTTPS. Backups are disabled (the tokens are
stored in app-private preferences).

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
  right-hand traffic (from the mobile network's country). When Maps only shows a street
  ("Main St toward X") the type is `unknown` and the HUD draws **Maps' own arrow icon** instead.
- Distance, next street (and current street for "continue/head"), remaining time and distance,
  and the ETA as an absolute time (resolved in the phone's time zone; crossing midnight and
  12/24-hour formats handled).
- Guidance ends on the HUD 10 s after the notification disappears (Maps briefly removes and
  re-posts it during normal guidance).

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
- Hazards and traffic from Google Maps are not exposed; hazards come from OpenStreetMap.

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
(e.g. Germany, Switzerland); they have their own switch in *Setup*.

## Building

Requirements: JDK 17+ (the build runs on JDK 21), an Android SDK with platform 36 for `:app`.

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
Core 1.17 (newer versions need compileSdk 36.1). Moving to Gradle 9 + AGP 9 lifts all of these
together.

## Using it

1. Put the HUD in phone mode (`server.host = 0.0.0.0`, `server.mdns = true`) and join the phone to
   the car's Wi-Fi.
2. *Setup*: leave "Find the HUD automatically" on (or enter `host:port`), enter the pairing token
   if the HUD has one (`phone.pairingToken`) and the API token if the REST API is protected
   (`server.apiToken`).
3. *Status*: grant the permissions, exempt the app from battery optimisation, tap *Connect to HUD*.
4. Start navigation in Google Maps on the phone.

The app reconnects on its own when the car's Wi-Fi comes and goes; the service survives the
screen being off. Some manufacturers (Xiaomi, Huawei, Samsung "sleeping apps") kill background
services aggressively — allow auto-start / exclude the app there as well.

## Privacy

- Message content is only read aloud on the phone; the `message` frame has no content field (the
  HUD rejects frames that try) and message ids are one-way hashes.
- Nothing is sent anywhere but the HUD, except Overpass requests with the area around the car
  (tile bounding boxes, not the exact position).
- Tokens live in app-private storage; backups are disabled.
