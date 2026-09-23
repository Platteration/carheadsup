# Protocols and API

Everything the HUD server exposes, on one port (8080 by default):

| Endpoint | Transport | Used by |
| --- | --- | --- |
| [`/ws/phone`](#phone-websocket-wsphone) | WebSocket, JSON text frames | the Android companion |
| [`/ws/hud`](#renderer-websocket-wshud) | WebSocket, JSON text frames | the HUD page (kiosk) and the developer console |
| [`/api/*`](#rest-api) | HTTP, JSON | the settings app, the developer console, the companion, scripts |
| `/`, `/settings`, `/dev` | HTTP | the three web pages |
| [UDP `sensors.adasUdpPort`](#adas-udp-feed) | UDP, newline-delimited JSON | an optional ADAS module |
| [`_carheadsup._tcp`](#mdns-discovery) | mDNS / DNS-SD | discovery by the companion |

The message types are defined in
[`packages/core/src/types/protocol.ts`](../packages/core/src/types/protocol.ts) and
[`api.ts`](../packages/core/src/types/api.ts), and validated by
[`protocol/validate.ts`](../packages/core/src/protocol/validate.ts). The Kotlin mirror in
`companion-android/protocol` is checked against these sources by its `ContractSyncTest`.

Every WebSocket and UDP message is a JSON object whose `t` field names its type. Canonical units
throughout: km/h, m, kPa, epoch milliseconds.

## Phone WebSocket (`/ws/phone`)

**Protocol version: 1.**

### Connection

1. Open `ws://<hud>:8080/ws/phone` (find the HUD with [mDNS](#mdns-discovery) or use a
   configured address). No HTTP authentication; the session is authenticated by its first
   message.
2. Send `hello` within **5 s**. The HUD answers `welcome` — or `error` and closes the socket.
3. Right after `welcome`, the HUD sends `maintenance-due` if any service item is due.
4. From then on the phone sends state updates whenever something changes; the HUD sends call
   actions, finished trips and maintenance notices.

There is **one active phone**: a newer session that completes its `hello` replaces the older
one (closed with 4000). At most 8 connections may be waiting for their `hello` at once. The HUD
sends WebSocket pings every 10 s and drops a peer that did not answer the previous one; the
companion additionally sends `ping` messages every 5 s and reconnects when the HUD is silent for
15 s.

The HUD stamps every message with its own clock on receipt. The phone's clock is used only for
absolute times such as the ETA.

### `hello` → `welcome`

```json
{ "t": "hello", "v": 1, "device": "Pixel 9", "app": "carheadsup-companion", "appVersion": "1.0.0", "token": "4f1c09ab" }
```

| Field | Rules |
| --- | --- |
| `v` | Must be `1`; otherwise `error unsupported-version` and close 4002. |
| `device`, `app` | Up to 100 characters (shown in logs). |
| `appVersion` | Up to 64 characters. |
| `token` | Must equal `phone.pairingToken` when one is set (constant-time comparison); otherwise `error bad-token` and close 4001. Any value is accepted when no pairing token is configured. |

```json
{ "t": "welcome", "v": 1, "hudName": "My car", "hudVersion": "0.1.0", "readMessagesAloud": true }
```

`hudName` is `vehicle.name`; `readMessagesAloud` is `phone.readMessagesAloud` — the phone reads
messages aloud only when this is true (and the user wants it on the phone).

### Phone → HUD

**`nav`** — turn-by-turn state. Send it whenever anything changes; `active: false` ends guidance.

```json
{
  "t": "nav",
  "active": true,
  "source": "google-maps",
  "maneuver": { "type": "right", "instruction": "Turn right onto Rosenheimer Straße" },
  "distanceM": 350,
  "street": "Rosenheimer Straße",
  "currentStreet": "Balanstraße",
  "then": { "type": "left" },
  "lanes": null,
  "etaEpochMs": 1790190000000,
  "remainingDistanceM": 9400,
  "remainingSeconds": 1080,
  "iconPng": null
}
```

| Field | Rules and meaning |
| --- | --- |
| `source` | Required, 1–100 characters, e.g. `google-maps`. |
| `maneuver.type` | One of `depart`, `arrive`, `arrive-left`, `arrive-right`, `straight`, `slight-left`, `left`, `sharp-left`, `slight-right`, `right`, `sharp-right`, `uturn-left`, `uturn-right`, `keep-left`, `keep-right`, `merge-left`, `merge-right`, `ramp-left`, `ramp-right`, `exit-left`, `exit-right`, `fork-left`, `fork-right`, `roundabout-ccw` (right-hand traffic), `roundabout-cw` (left-hand traffic), `ferry`, `unknown`. A missing `maneuver` means `unknown`. |
| `maneuver.roundaboutExit` | 1–32, the exit number. |
| `maneuver.roundaboutAngle` | 0–360, exit bearing relative to the entry, clockwise; used to draw the arrow. |
| `maneuver.instruction` | ≤ 300 characters; shown only when the car is not moving. |
| `distanceM` | ≥ 0; distance to the maneuver. The HUD counts it down with the car's own travelled distance until the next update. |
| `street`, `currentStreet` | ≤ 100 characters. |
| `then` | A maneuver that follows right after this one, or null. |
| `lanes` | Up to 16 lanes, left to right: `{ "directions": [...], "recommended": true, "activeDirection": "slight-right" }`. Directions: `straight`, `slight-left`, `left`, `sharp-left`, `slight-right`, `right`, `sharp-right`, `uturn-left`, `uturn-right`, `merge-left`, `merge-right`. |
| `etaEpochMs`, `remainingDistanceM`, `remainingSeconds` | ≥ 0. |
| `iconPng` | Base64 PNG of the nav app's arrow, ≤ 44 KiB of base64 (a 32 KiB PNG); drawn when `maneuver.type` is `unknown`. |

A roundabout: `"maneuver": { "type": "roundabout-ccw", "roundaboutExit": 2, "roundaboutAngle": 180 }`.
Lanes for a right exit on a four-lane road:

```json
"lanes": [
  { "directions": ["straight"], "recommended": false },
  { "directions": ["straight"], "recommended": false },
  { "directions": ["straight", "slight-right"], "recommended": true, "activeDirection": "slight-right" },
  { "directions": ["slight-right"], "recommended": true, "activeDirection": "slight-right" }
]
```

**`road`** — the road under the car.

```json
{ "t": "road", "speedLimitKph": 50, "unlimited": false, "source": "osm", "roadName": "Rosenheimer Straße", "roadClass": "primary" }
```

`speedLimitKph` is > 0 and ≤ 500, or null when unknown; a road without a limit (German Autobahn)
is `"speedLimitKph": null, "unlimited": true`. `source`: `osm`, `nav`, `sign-recognition`,
`manual`. `roadClass`: `motorway`, `trunk`, `primary`, `secondary`, `tertiary`, `residential`,
`service`, `other`. The limit is shown only while the phone is connected.

**`hazards`** — the complete list of hazards ahead (replaces the previous list; send `[]` to
clear).

```json
{
  "t": "hazards",
  "items": [
    { "id": "osm-node-2512381124", "type": "speed-camera", "distanceM": 820, "speedLimitKph": 100, "delaySeconds": null, "description": null },
    { "id": "jam-17", "type": "traffic-jam", "distanceM": 3200, "speedLimitKph": null, "delaySeconds": 420, "description": null }
  ]
}
```

Up to 50 items with unique `id`s (≤ 256 characters). Types: `speed-camera`, `red-light-camera`,
`section-control`, `police`, `accident`, `road-works`, `traffic-jam`, `slowdown`,
`object-on-road`, `weather`, `school-zone`, `railway-crossing`, `other` (whose `description`, ≤ 300
characters, becomes the label). Distances are dead-reckoned like the nav distance; a hazard is
dropped when it is 50 m behind the car or not refreshed for 2 minutes.

**`media`** — now playing.

```json
{ "t": "media", "playing": true, "title": "Midnight City", "artist": "M83", "album": "Hurry Up, We're Dreaming", "app": "Spotify", "trackKey": "spotify:track:6GyFP1nfCDB8lbD2bG0Hq9" }
```

Title, artist and album ≤ 300 characters, `trackKey` ≤ 512. A change of `trackKey` (or of
title, artist and album when there is none) is a track change and shows the toast.
`"playing": false` with null title and artist means no media session.

**`call`** — the phone call state.

```json
{ "t": "call", "id": "call-1", "state": "ringing", "callerName": "Alex Weber", "number": "+49 170 1234567" }
```

`state`: `ringing`, `dialing`, `active`, `held`, `ended`. `callerName` ≤ 100 characters, `number`
≤ 40, `id` ≤ 256. The HUD answers the driver's decision with `call-action`.

**`message`** — a message notification: **sender only**.

```json
{ "t": "message", "id": "7d9c2e", "sender": "Alex Weber", "app": "Signal", "readingAloud": true }
```

The type has no content field, and a `message` carrying any key that looks like content —
`body`, `text`, `content`, `message`, `messages`, `preview`, `snippet`, `subject`, `bigText`,
`subText`, `summaryText`, compared case-insensitively — is rejected outright.

**`location`** — GPS position, about once a second (for sun-based brightness and night mode).

```json
{ "t": "location", "lat": 48.1372, "lon": 11.5756, "accuracyM": 5, "speedMps": 13.9, "bearingDeg": 92 }
```

**`input`** — the companion's remote control: `{ "t": "input", "action": "primary" }`, with the
actions `primary`, `secondary`, `next-page`, `prev-page`, `toggle-blank`, `brightness-up`,
`brightness-down` ([meaning](architecture.md#driver-input)).

**`trips-request`** — ask for trips that ended after an epoch-ms time:
`{ "t": "trips-request", "since": 1790000000000 }`. Answered with `trips` (newest first, at most
1,000; older ones through `GET /api/trips`).

**`ping`** — `{ "t": "ping", "id": 7 }` (the `id` is optional); answered with
`{ "t": "pong", "id": 7 }`.

### HUD → phone

| Message | When | Example |
| --- | --- | --- |
| `welcome` | after a valid `hello` | see above |
| `error` | a message was refused | `{ "t": "error", "code": "bad-message", "message": "nav.distanceM: expected number >= 0" }` |
| `call-action` | the driver accepted a ringing call (`accept`), or declined it or hung up a dialing or active call (`decline`) | `{ "t": "call-action", "callId": "call-1", "action": "accept" }` |
| `trip-completed` | a trip just ended | `{ "t": "trip-completed", "trip": { … } }` |
| `trips` | answer to `trips-request` | `{ "t": "trips", "trips": [ … ] }` |
| `maintenance-due` | after `welcome`, and when an item becomes due soon or overdue | `{ "t": "maintenance-due", "items": [ { "itemId": "oil", "label": "Oil & filter", "status": "due-soon", "remainingKm": 420, "remainingDays": 30 } ] }` |
| `pong` | answer to `ping` | `{ "t": "pong", "id": 7 }` |

A trip record (also returned by `GET /api/trips`):

```json
{
  "id": "trip-1790187600000",
  "startedAt": 1790187600000,
  "endedAt": 1790190720000,
  "distanceKm": 42.7,
  "durationS": 3120,
  "movingS": 2700,
  "idleS": 420,
  "fuelUsedL": 3.1,
  "avgLPer100km": 7.3,
  "maxSpeedKph": 128,
  "avgMovingSpeedKph": 56.9,
  "cost": 5.58,
  "currency": "EUR",
  "startOdometerKm": 48210.4,
  "endOdometerKm": 48253.1
}
```

`fuelUsedL`, `avgLPer100km` and `cost` are null when the car provides no usable fuel data; the
odometer fields are null when unknown.

### Validation, limits and errors

Every frame is validated strictly before it is used:

- at most 128 Ki characters per frame; text frames only;
- unknown `t` values, out-of-range numbers, non-finite numbers and unknown enum values are
  rejected; unknown fields are dropped; omitted nullable fields become null;
- names and labels ≤ 100 characters, media text and free text ≤ 300, ids ≤ 256; no control
  characters in display strings (tab and line breaks are tolerated in free text);
- icons must be base64 PNG.

An invalid message is answered with `error` (`bad-message`, naming the field and the rule) and
ignored; the session survives until 20 invalid messages in a row. Each session may send 50
messages per second (bursts of up to 100); messages over the limit are dropped, with one
`bad-message` notice per episode. The companion stays well below that (nav ≤ 4 Hz, location
1 Hz, media, road and hazards ≤ 2 Hz).

| `error.code` | Meaning |
| --- | --- |
| `bad-token` | Wrong pairing token (also sent when the token is changed while connected). |
| `bad-message` | The message failed validation, was not `hello` when it had to be, or was rate limited. |
| `unsupported-version` | `hello.v` is not the HUD's protocol version. |
| `internal` | Reserved for server faults. |

| Close code | Meaning |
| --- | --- |
| 1001 | The HUD is shutting down. |
| 1013 | Too many connections waiting for their `hello`; retry later. |
| 4000 | Replaced by a newer session from a phone. |
| 4001 | Wrong pairing token (or it changed). The companion waits its maximum back-off before retrying. |
| 4002 | Unsupported protocol version. |
| 4003 | No valid `hello` as the first message within 5 s. |
| 4004 | Too many invalid messages in a row. |

## Renderer WebSocket (`/ws/hud`)

Used by the HUD page and the developer console.

- **Access**: clients on the Pi itself are always allowed. When `server.apiToken` is set, other
  clients must pass it as `?token=<token>` or `Authorization: Bearer <token>`; otherwise the
  upgrade is refused with HTTP 401. A browser upgrade from another site is refused with 403.
  When the token changes, remote clients that no longer match are closed with code 4001.
- **On connect** the server sends a `display` message and the latest frame; afterwards every
  frame (at `server.frameRate`), and a new `display` message whenever the projection settings
  change. A client that cannot keep up (more than 1 MiB unsent) skips frames.
- **From the client**: only `input`, e.g. `{ "t": "input", "action": "next-page" }`, at most 20
  per second (bursts of 40), frames ≤ 1024 characters. Anything else is ignored.

```json
{
  "t": "display",
  "projection": {
    "mirrorX": true, "mirrorY": false, "rotation": 0, "scale": 1, "offsetX": 0, "offsetY": 0,
    "corners": { "tl": [0, 0], "tr": [1, 0], "br": [1, 1], "bl": [0, 1] },
    "showGrid": false
  },
  "simulated": false
}
```

A frame (`HudFrame` in [`types/frame.ts`](../packages/core/src/types/frame.ts)) says exactly
what to draw, already in the driver's units; abridged:

```json
{
  "t": "frame",
  "frame": {
    "at": 1778773320000,
    "context": "city",
    "blanked": false,
    "theme": { "night": false, "brightness": 0.9 },
    "widgets": [
      { "id": "speed", "zone": "center", "value": 42, "unit": "km/h", "overLimit": false, "overBy": null },
      { "id": "speedLimit", "zone": "right", "value": 50, "unlimited": false, "unit": "km/h", "style": "vienna" },
      { "id": "nav", "zone": "top-left", "maneuver": { "type": "right" }, "distance": { "value": 350, "unit": "m", "text": "350 m" },
        "street": "Rosenheimer Straße", "then": { "type": "left" }, "iconPng": null, "imminent": false, "approach": null },
      { "id": "gear", "zone": "left", "gear": "3", "inferred": true }
    ],
    "alerts": [],
    "toast": null,
    "call": null,
    "shiftLight": null,
    "blindSpot": { "left": false, "right": false },
    "collision": "none",
    "diagnostics": null,
    "status": { "obd": "connected", "phone": true, "simulated": false }
  }
}
```

The page shows nothing but a small "no signal" dot when no frame has arrived for 1 s.

## ADAS UDP feed

An external driver-assistance module reports blind-spot and forward-collision state as
newline-delimited JSON in UDP datagrams to `<HUD address>:<sensors.adasUdpPort>` (the HUD listens
on all interfaces; `null` disables it).

```json
{"t":"blind-spot","left":true,"right":false}
{"t":"collision","level":"caution","ttcSeconds":2.5}
{"t":"heartbeat"}
```

| Message | Fields |
| --- | --- |
| `blind-spot` | `left`, `right`: booleans — a vehicle in that blind spot. |
| `collision` | `level`: `none`, `caution` (alert "VEHICLE AHEAD") or `warning` (critical alert "BRAKE!"); optional `ttcSeconds` (0–600) shown as "Impact in 1.4 s". |
| `heartbeat` | Keeps the module "connected" when there is nothing to report. |

- Readings expire after **1 s** — repeat active states at 5–10 Hz.
- The module counts as connected from its first valid message until **2 s** pass without one.
- Each line ≤ 1024 characters; up to 8 lines per datagram; datagrams over 4 KiB and more than
  50 datagrams per second are dropped. Invalid lines are skipped and logged (at most every 10 s).

Examples: [hardware.md](hardware.md#optional-adas-module).

## REST API

JSON in, JSON out, under `/api/`. The client in the renderer
([`common/api.ts`](../packages/hud-renderer/src/common/api.ts)) and the companion's `HudApi` use
exactly these endpoints.

**Conventions**

- **Authentication**: requests from the Pi itself need nothing. When `server.apiToken` is set,
  everyone else sends `Authorization: Bearer <token>`, or gets `401` with
  `WWW-Authenticate: Bearer realm="carheadsup"`.
- **Cross-site protection**: `POST`, `PUT`, `PATCH` and `DELETE` from a browser page of another
  origin (`Origin` or `Sec-Fetch-Site: cross-site`) get `403`. Clients that are not browsers are
  unaffected.
- **Bodies**: `Content-Type: application/json`, at most 256 KiB (`413` above, `415` for another
  content type, `400` for malformed JSON).
- **Errors**: `{ "error": "<message>" }` with the status code. `404` for an unknown endpoint,
  `405` (with `Allow`) for a wrong method; `HEAD` works wherever `GET` does.
- Responses are `Cache-Control: no-store` and carry security headers (CSP, `nosniff`,
  `X-Frame-Options: DENY`, no referrer).

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/info` | | `ApiInfo` |
| `GET /api/config` | | `HudConfig` |
| `PUT /api/config` | `HudConfig` | `ApiConfigResult` — 200, or 422 with `errors` |
| `PATCH /api/config` | partial `HudConfig` | `ApiConfigResult` — 200, or 422 with `errors` |
| `GET /api/diagnostics` | | `ApiDiagnostics` |
| `POST /api/diagnostics/clear-dtcs` | | `{ ok, message }` — 200, or 409 when refused or failed |
| `GET /api/trips?limit=50&before=<ms>` | | `TripRecord[]`, newest first |
| `GET /api/trips.csv` | | `text/csv` download |
| `DELETE /api/trips/:id` | | `{ "ok": true }` or 404 |
| `GET /api/maintenance` | | `MaintenanceItemStatus[]` |
| `POST /api/maintenance/:itemId/done` | `{ "odometerKm"?: number }` | `MaintenanceItemStatus[]` or 404 |
| `POST /api/odometer` | `{ "odometerKm": number }` | `{ "ok": true }` |
| `POST /api/input` | `{ "action": InputAction }` | `{ "ok": true }` |
| `GET /api/sim` | | `SimStatus`, or 404 without `--sim` |
| `POST /api/sim` | `SimControl` | `SimStatus`, or 404 without `--sim` |

### Info

```sh
curl http://hud.local:8080/api/info
```

```json
{
  "name": "carheadsup",
  "version": "0.1.0",
  "simulated": false,
  "uptimeS": 5,
  "obd": { "state": "connected", "adapter": "ELM327 v1.5", "protocol": "ISO 15765-4 (CAN 11/500)", "message": null, "since": 1790190236113 },
  "phoneConnected": true
}
```

`obd.state` is `disconnected`, `connecting`, `initializing`, `connected` or `error` (with the
reason in `message`).

### Config

`GET /api/config` returns the stored configuration — including both tokens, so protect the API
with a token. It never contains runtime overrides (`--sim`, `--port`, `--host`).

`PATCH` deep-merges a partial config (objects merge; arrays and `null` replace); `PUT` replaces
the whole config (missing fields take their current values). Both validate per field
([configuration.md](configuration.md#changing-settings)), save atomically and apply the result
to the running HUD. The answer is the stored config plus the problems:

```sh
curl -X PATCH http://hud.local:8080/api/config \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"units":{"system":"imperial"},"display":{"brightness":{"minLevel":2}}}'
```

```text
{ "config": { "version": 1, "units": { "system": "imperial", … }, … },
  "errors": ["display.brightness.minLevel: expected number <= 1"] }
```

Status 422 means that at least one field was rejected — **the valid fields were still applied**;
`config` is what is now in effect. `500` means the file could not be written (nothing changed);
`503` means the HUD is still starting.

### Diagnostics

`GET /api/diagnostics` — the OBD link, the malfunction indicator, the trouble codes with
descriptions, the supported signals and the latest value of every signal (canonical units, with
the time it was received):

```json
{
  "link": { "state": "connected", "adapter": "OBDLink MX+ (STN2255)", "protocol": "ISO 15765-4 (CAN 11/500)", "message": null, "since": 1790190236113 },
  "milOn": true,
  "dtcs": [
    { "code": "P0420", "kind": "stored", "description": "Catalyst System Efficiency Below Threshold (Bank 1)", "short": "Catalytic converter efficiency", "severity": "caution" }
  ],
  "dtcsCheckedAt": 1790190236831,
  "supported": ["speed", "rpm", "coolantTemp", "fuelLevel", "batteryVoltage"],
  "signals": { "rpm": { "value": 880.25, "at": 1790190245128 }, "coolantTemp": { "value": 91, "at": 1790190244300 } },
  "vin": "WVWZZZAUZKW123456"
}
```

`POST /api/diagnostics/clear-dtcs` clears the trouble codes (OBD service 04). It is **refused
with 409 unless the car is parked with the engine off** (ignition on), and while another clear is
running:

```json
{ "ok": false, "message": "Switch the engine off (ignition on) before clearing trouble codes." }
```

See [obd.md](obd.md#clearing-trouble-codes) before using it.

### Trips

- `GET /api/trips?limit=50&before=<epoch ms>` — completed trips, newest first. `limit` 1–500
  (default 50); `before` pages backwards by `endedAt`.
- `GET /api/trips.csv` — every trip as CSV (`Content-Disposition: attachment;
  filename="carheadsup-trips.csv"`), columns `id, started_at, ended_at, distance_km, duration_s,
  moving_s, idle_s, fuel_used_l, avg_l_per_100km, max_speed_kph, avg_moving_speed_kph, cost,
  currency, start_odometer_km, end_odometer_km` — ISO 8601 UTC times, canonical units, empty
  fields for unknown values, and text that a spreadsheet would treat as a formula is escaped.
- `DELETE /api/trips/<id>` — delete one trip.

### Maintenance and odometer

- `GET /api/maintenance` — status of every item: `lastDoneAt`, `lastDoneKm`, `dueAtKm`,
  `dueAtEpochMs`, `remainingKm`, `remainingDays`, `status` (`ok`, `due-soon`, `overdue`,
  `unknown` until a service is recorded).
- `POST /api/maintenance/oil/done` with `{"odometerKm": 48210}` (optional; defaults to the
  current odometer) records a service now and returns the updated list; 404 for an unknown item,
  400 for an odometer outside 0–9,999,999.
- `POST /api/odometer` with `{"odometerKm": 48210}` sets the odometer (cars that do not report
  PID `A6`).

### Input

`POST /api/input` with `{"action": "toggle-blank"}` — the same actions as the buttons; the
companion uses it as a fallback when its socket is down. 400 for an unknown action.

### Simulator

Only with `--sim` (404 otherwise). `GET /api/sim` returns the simulator status; `POST /api/sim`
changes it and returns the new status. All fields are optional; an invalid field rejects the
request with 400 and a reason.

```sh
curl -X POST http://localhost:8080/api/sim -H 'Content-Type: application/json' \
  -d '{"mode":"manual","throttle":0.4,"dtcs":["P0420"],"phone":{"kind":"incoming-call","name":"Alex"}}'
```

```json
{ "mode": "manual", "throttle": 0.4, "brake": 0, "engineRunning": true, "gear": null, "speedKph": 0, "rpm": 880, "dtcs": ["P0420"], "lux": 20000, "ambientTempC": 18, "scenarioStep": null }
```

| Field | Values |
| --- | --- |
| `mode` | `scenario` (the scripted demo drive) or `manual` |
| `throttle`, `brake` | 0–1 (manual mode) |
| `engineRunning` | boolean |
| `gear` | 0–10 to hold a gear (0 = neutral), `null` for automatic shifting |
| `dtcs` | up to 32 codes such as `"P0420"`; replaces the injected codes |
| `coolantOverrideC`, `voltageOverrideV`, `fuelLevelOverridePct` | force a value; `null` releases it |
| `lux`, `ambientTempC` | simulated light level (0–200000) and outside temperature (−60–70) |
| `phone.kind` | `nav-start`, `nav-stop`, `incoming-call` (optional `name`), `end-call`, `next-track`, `message` (optional `sender`), `speed-camera`, `disconnect`, `connect` |
| `adas` | `blindSpotLeft`, `blindSpotRight` (booleans), `collision` (`none`, `caution`, `warning`) |
| `tirePressuresKpa` | `{ "fl", "fr", "rl", "rr" }` in kPa, or `null` to remove the tyre-pressure module |

### Pages and other paths

`GET /`, `/settings`, `/dev` serve the three pages from the built renderer; hashed assets under
`/assets/` are cached for a year, pages are revalidated. Without a build every page answers `503`
with instructions. `/ws/*` without a WebSocket upgrade answers `426`. The HUD page understands
`?preview=1` (ignore mirroring, rotation and keystone) and `?fixture=<name>` (draw a sample frame
without a server, e.g. `?fixture=city-nav&preview=1`).

## mDNS discovery

The HUD advertises itself with DNS-SD so the companion finds it without an address:

- service type **`_carheadsup._tcp`**, port `server.port`;
- instance name **"&lt;vehicle name&gt; HUD"** (e.g. "My car HUD");
- TXT records **`v=1`** (the phone protocol version) and **`path=/ws/phone`**.

The server publishes this through `avahi-publish-service` (package `avahi-utils`) while
`server.mdns` is on, and re-publishes when the vehicle name or the setting changes. Without
`avahi-utils` it logs a hint and does not advertise; the static
[`deploy/avahi/carheadsup.service`](../deploy/avahi/carheadsup.service) (named after the host)
does the same job, and the installer puts it in place in that case. To check from a Linux
machine on the same network:

```sh
avahi-browse -rt _carheadsup._tcp
```
