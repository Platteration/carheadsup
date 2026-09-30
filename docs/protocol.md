# Protocols and API

Everything the HUD server exposes. The pages, the REST API and the WebSockets are served twice:
plainly on `server.port` (8080 by default) and over TLS on `server.tlsPort` (8443 by default),
with the HUD's self-signed certificate ([TLS](#tls-and-the-huds-certificate)). The phone link
`/ws/phone` is served over TLS only — on the plain port just with `server.allowPlainPhone`.

| Endpoint | Transport | Used by |
| --- | --- | --- |
| [`/ws/phone`](#phone-websocket-wsphone) | WebSocket over TLS (`wss://`, port 8443), JSON text frames | the Android companion |
| [`/ws/hud`](#renderer-websocket-wshud) | WebSocket, JSON text frames (`ws://` or `wss://`) | the HUD page (kiosk) and the developer console |
| [`/api/*`](#rest-api) | HTTP or HTTPS, JSON | the settings app, the developer console, the companion (HTTPS), scripts |
| `/`, `/settings`, `/dev` | HTTP (HTTPS for the companion's settings page) | the three web pages |
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

**Protocol version: 3** — over TLS, with both proofs bound to the HUD's certificate. Version 2
(the same messages over plain `ws://`, proofs not bound to a certificate) and version 1 (which
sent the pairing token in clear text and did not authenticate the HUD) are gone.

### Connection

1. Open `wss://<hud>:8443/ws/phone` — the TLS port comes from [mDNS](#mdns-discovery) (TXT
   `tls`) or a configured address. The HUD presents its self-signed certificate, which the
   phone accepts by its pin ([TLS](#tls-and-the-huds-certificate)). No HTTP authentication:
   phone and HUD [authenticate each other](#authentication) in the first three messages, bound
   to that certificate.
2. The HUD sends `challenge` at once: its identity and a fresh nonce.
3. The phone answers with `hello` within **5 s**, proving that it knows the pairing token. The
   HUD answers `welcome`, proving the same in return — or `error` and closes the socket.
4. The phone checks the HUD's proof; until then it sends nothing else and ignores whatever the
   HUD sends. Right after `welcome`, the HUD sends `maintenance-due` if any service item is due.
5. From then on the phone sends state updates whenever something changes; the HUD sends call
   actions, finished trips and maintenance notices.

On the plain port, `ws://<hud>:8080/ws/phone` is refused with `403` and the text "The phone
link needs TLS: connect to wss://<this HUD>:8443/ws/phone" — unless `server.allowPlainPhone` is
on (for development and custom clients; the companion always uses TLS). A plain session binds
nothing: its proofs cover an empty fingerprint, so a phone's TLS proof is no use there either.
Switching the option off closes plain sessions (4005).

There is **one active phone**. A newer session from the *same* phone (same `hello.deviceId`, a
random id per app install — not the device name, which two phones of one model share) replaces
the older one (closed with 4000) without a disconnect in between. Another phone is refused while
one is connected (`hello` answered with close 1013 "another phone is connected"), so two paired
phones in one car never take the HUD from each other in turns; the connected phone keeps the HUD
until it goes away (a vanished phone is dropped by the heartbeat below). When a *different*
phone does come up (another `deviceId`), the HUD first drops what the previous one provided
(route, road, hazards, media, call).

At most 8 connections may wait for their `hello` at once, and at most 2 from one address. A new
connection is always accepted: beyond those limits the oldest waiting one is closed (1013), so
idle connections cannot lock the paired phone out. The HUD sends WebSocket pings every 10 s and
drops a peer that did not answer the previous one; the companion additionally sends `ping`
messages every 5 s and reconnects when the HUD is silent for 15 s. A phone that stops reading
(more than 1 MiB of unsent messages) is closed with 1008.

The HUD stamps every message with its own clock on receipt. The phone's clock is used only for
absolute times such as the ETA.

### `challenge` → `hello` → `welcome`

```json
{ "t": "challenge", "v": 3, "hudId": "AAECAwQFBgcICQoLDA0ODw", "nonce": "EBESExQVFhcYGRobHB0eHw" }
```

`hudId` is the HUD's identity: 16 random bytes as 22 base64url characters, made on the first
start and kept in `<data dir>/hud-id` (a corrupt file is replaced by a new id, and paired phones
then report "a different HUD"). It is also advertised over [mDNS](#mdns-discovery). `nonce` is 16
fresh random bytes (22 base64url characters) per connection.

```json
{
  "t": "hello", "v": 3, "device": "Pixel 9", "deviceId": "8PHy8_T19vf4-fr7_P3-_w",
  "app": "carheadsup-companion", "appVersion": "1.0.0",
  "nonce": "ICEiIyQlJicoKSorLC0uLw", "proof": "llVyYellZIIYR5tEC9APzsA-YTGRKi45irjLwiuenwc"
}
```

| Field | Rules |
| --- | --- |
| `v` | Must be `3`; otherwise `error unsupported-version` and close 4002 (also for a version-1 or version-2 `hello`). |
| `device`, `app` | Up to 100 characters (shown in logs and as the phone's name). |
| `deviceId` | The phone's identity: exactly 22 base64url characters (`A–Z a–z 0–9 - _`), random per app install. |
| `appVersion` | Up to 64 characters. |
| `nonce` | Exactly 22 base64url characters: 16 fresh random bytes per connection. |
| `proof` | Exactly 43 base64url characters; must be the phone proof below for `phone.pairingToken` and this connection's certificate (compared in constant time), otherwise `error bad-token` and close 4001. |

```json
{
  "t": "welcome", "v": 3, "hudName": "My car", "hudVersion": "0.1.0", "readMessagesAloud": true,
  "hudId": "AAECAwQFBgcICQoLDA0ODw", "proof": "VGcXTWHc-snsk4-LN_Foi-sePPjY8kR6nMQSCQdhUHs"
}
```

`hudName` is `vehicle.name`; `readMessagesAloud` is `phone.readMessagesAloud` — the phone reads
messages aloud only when this is true (and the user wants it on the phone). `hudId` repeats the
challenge's; `proof` is the HUD proof below. (The examples are the first
[test vector](#authentication): pairing token `K7fQ2mZrP4xW9sLt3HvNbC8e`, over a connection
whose certificate has the fingerprint `fdc153ee…bfdd4531`.)

### Authentication

The pairing token (`phone.pairingToken`) never travels. Each side proves that it knows it with an
HMAC over the other side's fresh nonce and the certificate of the connection:

```
MAC(message)  = base64url( HMAC-SHA256( key = UTF-8 bytes of the pairing token,
                                        data = UTF-8 bytes of message ) )      (no padding: 43 characters)
phone proof   = MAC( "carheadsup-phone-v3|" + hudId + "|" + hudNonce + "|" + phoneNonce + "|" + deviceId + "|" + certFingerprint )
HUD proof     = MAC( "carheadsup-hud-v3|"   + hudId + "|" + phoneNonce + "|" + hudNonce + "|" + deviceId + "|" + certFingerprint )
```

`hudNonce` is `challenge.nonce`, `phoneNonce` is `hello.nonce`. `certFingerprint` is the
[fingerprint](#tls-and-the-huds-certificate) of the TLS certificate of this connection — as the
phone saw it, and as the HUD knows its own (empty on a plain `ws://` session). The fixed formats
(base64url, lowercase hex) keep the joined fields unambiguous, the two prefixes keep one side's
proof from passing as the other's, and each nonce makes the other side's proof unusable on any
other connection.

The fingerprint is the **channel binding**: a relay between phone and HUD has to terminate the
phone's TLS with a certificate of its own (it does not have the HUD's key). The phone's proof
then names the relay's certificate, and the HUD, which checks it against its own, refuses it —
whether the relay forwards it live or replays a recorded handshake. Nor can the relay produce
the HUD's proof for the phone. Shared test vectors — including an empty token, a non-ASCII token
longer than the 64-byte HMAC block, the same session through a relay, a plain session, and real
certificates made by the HUD's generator with their fingerprints and short forms — are in
[`packages/core/test/protocol/phone-auth-vectors.json`](../packages/core/test/protocol/phone-auth-vectors.json);
the HUD's and the companion's tests both assert them.

**The companion app** (details in its [README](../companion-android/README.md#privacy)):

- connects over TLS only and, once paired, accepts exactly the pinned certificate; any other is a
  hard stop ("HUD certificate changed — re-pair", [below](#tls-and-the-huds-certificate));
- pins the `hudId` and the certificate of the first HUD that proves the pairing token (per
  token: entering another token starts a new pairing), and afterwards answers only that HUD's
  `challenge`. For any other `hudId` it sends nothing at all — not even its proof, with which a
  rogue HUD could test token guesses offline — and shows "a different HUD is answering", with a
  way to forget the old HUD;
- checks the `welcome` proof before it counts as connected: before that it sends no location,
  navigation, media, call or message data, makes no REST calls (they carry the API token), and
  ignores `call-action` and everything else the HUD sends;
- with automatic discovery, connects only to the paired HUD's advertisement (TXT `id`), or to
  one without an id (the [static Avahi file](#mdns-discovery)), whose certificate and
  `challenge` are checked; pairing for the first time, it requires the certificate the
  advertisement names (TXT `fp`), if it names one.

**Without a pairing token** the HUD is *open*: both proofs are computed with the empty key, which
anyone can do, so they prove nothing. The HUD accepts only proofs made with the empty key — a
phone that holds a token is refused (`bad-token`) rather than silently trusting an open HUD. The
companion shows such a HUD as unverified, with its certificate's short fingerprint to compare
with the settings app, and connects only after the user confirms it, then pins its `hudId` and
certificate. Set a pairing token.

When `phone.pairingToken` changes, the HUD checks the connected phone's proof against the new
token and disconnects it (`bad-token`, 4001) unless it still matches — also when the token is
removed.

What remains: the first pairing is trust on first use. Someone who controls the car's Wi-Fi at
that moment can pose as the HUD with a certificate of their own; they cannot complete the
handshake without the pairing token, and the phone pins nothing, but they receive the phone's
proof and can test guesses of the pairing token offline. Use a long random token (the settings
app's *Generate* makes 24 characters, about 139 bits) and compare the fingerprints. After the
first pairing, and for anyone who only listens, there is nothing to guess from: the session is
encrypted. See the [security model](architecture.md#security-model).

### TLS and the HUD's certificate

The HUD makes its TLS identity itself on the first start (with `node:crypto` and a small DER
encoder, `hud-server/src/tls/`; no openssl command needed) and keeps it in `<data dir>/tls.pem`,
mode `0600`: an ECDSA P-256 private key (PKCS#8) followed by a self-signed X.509 v3 certificate —

| Field | Value |
| --- | --- |
| Subject, issuer | `O=carheadsup, CN=carheadsup HUD (<host name>)` |
| subjectAltName | `DNS:<host name>`, `DNS:<host name>.local`, `DNS:localhost`, `IP:127.0.0.1`, `IP:::1` |
| Validity | From a day before it was made (a Pi without a real-time clock may run behind) to `99991231235959Z`, RFC 5280's "no well-defined expiration": the phone pins the certificate, so an expiry could only break a working pairing |
| Extensions | basicConstraints `CA:FALSE` (critical), keyUsage `digitalSignature` (critical), extKeyUsage `serverAuth`, subjectKeyIdentifier |
| Signature | ECDSA with SHA-256; 16-byte random serial number |

It is never renewed. A corrupt file (no key, no certificate, or a certificate for another key)
is moved to `tls.pem.corrupt` (mode `0600`: it may hold a key) and replaced — paired phones then report "HUD certificate changed"
until they are paired again; an unreadable one is left alone and a temporary certificate is used
for that run. To replace it deliberately, delete `tls.pem` (or put a key and certificate of your
own in it, PEM) and restart; then *Forget paired HUD* in the companion and pair again. The
listener speaks TLS 1.2 and 1.3; a client has 10 s to finish its handshake.

The certificate's **fingerprint** is the SHA-256 of its DER encoding in lowercase hex (64
digits). People compare its **short form**: the first 20 hex digits in upper case, in groups of
four — `FDC1 53EE DCA2 B536 4DD7`. The HUD shows it in the settings app (Phone), in
[`GET /api/info`](#info) (`tls.fingerprint`), in its log at start ("Phone link: TLS on …,
certificate SHA-256 …") and in its mDNS advertisement (TXT `fp`); on the Pi,
`sudo openssl x509 -in /var/lib/carheadsup/tls.pem -noout -fingerprint -sha256` prints it with
colons. The companion shows the certificate it sees when it asks to confirm an open HUD, while
connected (Status) and next to the paired HUD (Setup).

**How the companion trusts it** (`HudTrustManager` in `companion-android/protocol`): the HUD is
reached by IP address and has no certificate authority behind it, so neither authorities nor
host names nor dates are checked — the certificate itself is. Once paired, exactly the pinned
certificate is accepted, on the WebSocket, for REST calls and in the settings page's WebView
(which proceeds past its certificate warning only for the pinned certificate on the HUD's
address). Any other certificate for the paired HUD ends the connection before anything is sent
and stops the app from trying again: "HUD certificate changed — re-pair" (forget the HUD to pair
anew). Pairing for the first time, the certificate the connection presents is accepted if the
mDNS advertisement names it or names none, and bound into the handshake; it is pinned only if
the HUD then proves the pairing token (or, for an open HUD, the user confirms it).

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
clear). A phone with several sources sends them merged in one list: the companion app combines
speed cameras from OpenStreetMap and traffic incidents from TomTom (its `HazardAggregator`), so
that one source's update never wipes the other's.

```json
{
  "t": "hazards",
  "items": [
    { "id": "osm-node-2512381124", "type": "speed-camera", "distanceM": 820, "speedLimitKph": 100, "delaySeconds": null, "description": null },
    { "id": "tomtom-4819f7d0a15db3d9b0c3cd9203be7ba5", "type": "traffic-jam", "distanceM": 3200, "speedLimitKph": null, "delaySeconds": 420, "description": "Stationary traffic" },
    { "id": "tomtom-7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d", "type": "other", "distanceM": 5400, "speedLimitKph": null, "delaySeconds": null, "description": "Road closed" }
  ]
}
```

| Field | Rules and meaning |
| --- | --- |
| `id` | Required, unique in the list, ≤ 256 characters. Stable from one message to the next (the companion uses `osm-node-…` / `osm-relation-…` for cameras and `tomtom-…` for incidents). |
| `type` | `speed-camera`, `red-light-camera`, `section-control`, `police`, `accident`, `road-works`, `traffic-jam`, `slowdown`, `object-on-road`, `weather`, `school-zone`, `railway-crossing`, `other`. |
| `distanceM` | Straight-line or road distance ahead, 0–1,000,000 m; for traffic, to where traffic reaches the incident (the tail of a jam). `null` when unknown (never shown). |
| `speedLimitKph` | The enforced limit of a camera, or `null`. |
| `delaySeconds` | The expected delay of a traffic hazard, 0–86400 s, or `null`. The HUD shows it in whole minutes ("+8 min"; from 100 minutes in hours, "+2 h"); under half a minute it is left out. |
| `description` | ≤ 300 characters; see below. |

Up to 50 items. The HUD labels each type itself ("Speed camera", "Traffic jam" …); only for
`other` does the `description` become the label, cut to 24 characters, and only while the car is
stopped or parked — while it moves an `other` hazard is labelled "Hazard". Other types'
descriptions are never shown. The companion maps traffic incidents as follows (TomTom's
`iconCategory` and `magnitudeOfDelay`):

| Incident | `type` | `description` |
| --- | --- | --- |
| Jam, queuing or stationary traffic (moderate or major delay; unknown magnitude with ≥ 5 min delay) | `traffic-jam` | "Queuing traffic", "Stationary traffic", "Traffic jam" |
| Jam, slow traffic (minor delay, or unknown with less delay) | `slowdown` | "Slow traffic" |
| Accident | `accident` | "Accident" |
| Road works | `road-works` | "Road works" |
| Fog, rain, ice, wind, flooding | `weather` | "Fog", "Heavy rain", "Ice", "Strong wind", "Flooding" |
| Broken-down vehicle | `object-on-road` | "Broken-down vehicle" |
| Road closed, lane closed | `other` | "Road closed", "Lane closed" |
| Dangerous conditions, unknown | `other` | TomTom's event text, else "Dangerous conditions" / "Traffic incident" |

The HUD shows the nearest hazard within `display.hazardRevealM` (1 km); on the highway, traffic
hazards — `traffic-jam`, `slowdown`, `accident`, `road-works` and anything with a delay — from
`display.trafficRevealM` (3 km) ([configuration](configuration.md#display-other)). Distances are
dead-reckoned like the nav distance; a hazard is dropped when it is 50 m behind the car or not
refreshed for 2 minutes, so a phone re-sends the list (with fresh distances) at least that often.

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
`brightness-down` ([meaning](architecture.md#driver-input): e.g. at a stop, `next-page` opens the
diagnostics dashboard and `secondary` closes it).

**`trips-request`** — ask for trips that ended after an epoch-ms time:
`{ "t": "trips-request", "since": 1790000000000 }`. Answered with `trips` (newest first, at most
1,000; older ones through `GET /api/trips`). Up to 3 requests in a row are answered, then one per
5 s; the excess ones get `error bad-message` ("Too many trip requests").

**`ping`** — `{ "t": "ping", "id": 7 }` (the `id` is optional); answered with
`{ "t": "pong", "id": 7 }`.

### HUD → phone

| Message | When | Example |
| --- | --- | --- |
| `challenge` | at once, on every connection | see above |
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
| `bad-token` | The `hello` proof does not match the pairing token (also sent when the token is changed or removed while connected). |
| `bad-message` | The message failed validation, was not `hello` when it had to be, or was rate limited (messages, or `trips-request`). |
| `unsupported-version` | `hello.v` is not the HUD's protocol version. |
| `internal` | Reserved for server faults. |

| Close code | Meaning |
| --- | --- |
| 1001 | The HUD is shutting down. |
| 1008 | The phone did not read what the HUD sent (more than 1 MiB unsent). |
| 1013 | Try again later: another phone is connected, or this connection waited for its `hello` while too many others did (the oldest waiting one is closed). |
| 4000 | Replaced by a newer session from the same phone (same `deviceId`). The companion waits its maximum back-off before reconnecting. |
| 4001 | Wrong pairing token proof (or the token changed). The companion waits its maximum back-off before retrying. |
| 4002 | Unsupported protocol version. |
| 4003 | No valid `hello` as the first message within 5 s. |
| 4004 | Too many invalid messages in a row. |
| 4005 | A plain (`ws://`) session while plain sessions are no longer allowed (`server.allowPlainPhone` switched off). |

## Renderer WebSocket (`/ws/hud`)

Used by the HUD page and the developer console, on either port (the pages use `wss:` when they
were loaded over HTTPS).

- **Access**: clients on the Pi itself are always allowed. When `server.apiToken` is set, other
  clients must pass it as `?token=<token>` or `Authorization: Bearer <token>`; otherwise the
  upgrade is refused with HTTP 401. Browsers cannot set headers on a WebSocket, so the
  developer console opened from another device sends the API token it has stored (entered when
  it asks, or once as `/dev?token=<token>`) as `?token=`. A browser upgrade from another site,
  or to a host name that is not the HUD's (see [REST conventions](#rest-api)), is refused with
  403. When the token changes, remote clients that no longer match are closed with code 4001.
- **On connect** the server sends a `display` message and the latest frame; afterwards every
  frame (at `server.frameRate`), and a new `display` message whenever the projection settings
  or `hardwareBrightness` change. A client that cannot keep up (more than 1 MiB unsent) skips
  frames. Clients on other devices are limited to 4 per address and 16 in total (the upgrade is
  refused with 503 beyond that); the Pi's own display is never limited.
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
  "simulated": false,
  "hardwareBrightness": true
}
```

`hardwareBrightness` is true while the server drives the display's Linux backlight from the
frames' `theme.brightness`; the HUD page then draws at full brightness instead of dimming the
content with a CSS filter as well (which would give about b × b^2.2 instead of b). It changes —
and a new `display` message is sent — when the backlight device appears after start-up (the
server looks for it again every 10 s) or stops working. Pages that are not lit by that
backlight, such as the developer console's preview or `?preview=1`, keep dimming. A server that
does not send the field is treated as `false`.

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

The page shows nothing but a small "no signal" dot when the frame time has not advanced for 1 s
(two frame intervals at a `server.frameRate` below 2, at most 2.5 s). The first frame after
connecting is shown only once a newer one follows, so a server's cached last frame is never
taken for live.

Points a renderer of its own must know (the full contract is `types/frame.ts`):

- `at` is the HUD's engine time: epoch ms that start at the system clock and then only count
  elapsed time, so they never step when network time corrects the clock
  ([details](architecture.md#engine-time-and-the-wall-clock)). Use it to tell that frames keep
  coming, not as the time of day; the clock widget carries the wall-clock time.
- `widgets` holds only what is to be drawn now, most important first within a zone; a widget
  whose data is stale or irrelevant is simply absent.
- The nav widget's `iconPng` is non-null only when `maneuver.type` is `unknown`: draw the phone's
  icon then, and the HUD's own arrow for every known maneuver. `maneuver.instruction` is null
  while the car moves.
- `diagnostics` is non-null in the `parked` context, and in the `stopped` context once the
  driver opened the dashboard with `next-page` / `prev-page` (until `secondary` or driving off
  closes it); it replaces the widget grid with the full-screen dashboard (`DiagnosticsFrame`): `page` (`overview`, then `engine`, `fuel`,
  `electrical` — each only while it has live data — then `trouble-codes`, `trip`,
  `maintenance`), `pageIndex` / `pageCount` and `title`; `gauges` (signal, label, value in
  display units or null, unit, decimals, min, max, `status` `ok` / `warn` / `crit` /
  `unknown`); `dtcs` with `milOn`; `trip` (`DiagnosticsTrip`: the trip in progress, or the last
  completed one with `completed: true`; distance, duration, moving time, economy, fuel, cost);
  `maintenance` (`DiagnosticsMaintenanceItem`: status, remaining distance and days, due date —
  on the overview only the items due soon or overdue); and `vehicle` (VIN, adapter, protocol).

## ADAS UDP feed

An external driver-assistance module reports blind-spot and forward-collision state as
newline-delimited JSON in UDP datagrams to `<HUD address>:<sensors.adasUdpPort>` (the HUD listens
on all IPv4 interfaces; `null` disables it), from an address listed in
`sensors.adasAllowedSenders`.

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
- Datagrams from an address not in `sensors.adasAllowedSenders` are dropped unread and never
  connect the module; they are counted and logged at most every 10 s. An empty list accepts any
  sender (the HUD logs a warning when the feed starts that way). IPv4-mapped IPv6 addresses
  (`::ffff:10.42.0.50`) count as their IPv4 address.
- Each line ≤ 1024 characters; up to 8 lines per datagram; datagrams over 4 KiB are dropped, and
  so is anything beyond 50 datagrams per second from one sender — each sender address has its
  own budget (the HUD tracks up to 64 senders, forgetting the one silent longest). Invalid lines
  are skipped and logged (at most every 10 s).

**Trust**: the feed has no authentication; the only check is the sender's address. Give the
module a static address and set `sensors.adasAllowedSenders` to it: datagrams from any other
device on the network are then ignored, and a flood from one of them no longer drowns the module,
which keeps its own datagram budget. With the list empty, any device that can reach the port — a
passenger's phone on the HUD's Wi-Fi, for instance — can show blind-spot markers or a critical
"BRAKE!" that cannot be dismissed, or hide a real warning.

A source address is not proof of identity: a device on the same network can forge the module's
address and would then be heard, and share its budget. Against that, put the module on a link of
its own (a separate interface or VLAN), and keep the port off unless you use a module. A firewall
rule in front of the port also spares the HUD the work of dropping a flood itself, and can match
the module's MAC address (`ether saddr`) as well as its IP address — e.g. with nftables
(`sudo apt install nftables`), where 10.42.0.50 is the module's address:

```sh
sudo nft add table inet carheadsup
sudo nft add chain inet carheadsup input '{ type filter hook input priority 0; }'
sudo nft add rule inet carheadsup input udp dport 5005 ip saddr != 10.42.0.50 drop
```

To keep the rule across reboots, put it in `/etc/nftables.conf` and `sudo systemctl enable
nftables`.

Examples: [hardware.md](hardware.md#optional-adas-module).

## REST API

JSON in, JSON out, under `/api/`, on both ports. The client in the renderer
([`common/api.ts`](../packages/hud-renderer/src/common/api.ts)) and the companion's `HudApi` use
exactly these endpoints; the companion over HTTPS on the TLS port, pinned to the HUD's
certificate.

**Conventions**

- **Authentication**: requests from the Pi itself need nothing. When `server.apiToken` is set,
  everyone else sends `Authorization: Bearer <token>`, or gets `401` with
  `WWW-Authenticate: Bearer realm="carheadsup"`.
- **Cross-site protection**: `POST`, `PUT`, `PATCH` and `DELETE` from a browser page of another
  origin (`Origin` or `Sec-Fetch-Site: cross-site`) get `403`. Clients that are not browsers are
  unaffected.
- **Host names**: every request (pages included) and WebSocket upgrade must name the HUD in its
  `Host` header — an IP address, `localhost`, the machine's host name, `<hostname>.local`, or a
  name allowed with `--allowed-hosts` — or it gets `403`. This stops DNS rebinding, where a web
  page makes its own name resolve to the HUD and would otherwise count as same-origin. A request
  without a `Host` header (not a browser) is allowed.
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
  "phoneConnected": true,
  "tls": { "port": 8443, "fingerprint": "fdc153eedca2b5364dd71c13e90afd8d47ff4c28be52f39bb2666a72bfdd4531" }
}
```

`obd.state` is `disconnected`, `connecting`, `initializing`, `connected` or `error` (with the
reason in `message`). `tls` is the phone link's TLS listener — its port and its certificate's
[fingerprint](#tls-and-the-huds-certificate) — or `null` when it is off (`server.tlsPort` null)
or could not start (the log says why).

### Config

`GET /api/config` returns the stored configuration — including both tokens, so protect the API
with a token. It never contains runtime overrides (`--sim`, `--port`, `--tls-port`, `--host`).

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
`503` means the HUD is still starting, or that `config.json` could not be loaded at start-up
(unreadable, or not valid JSON): saving is refused until it is fixed and the HUD restarted, so
the file is never replaced by the defaults (nothing changed).

`server.apiToken` must be printable ASCII (letters, digits, symbols and spaces, not only
spaces): it travels in `Authorization` headers and `?token=` addresses, which carry nothing else,
so any other token would lock every other device out. The pairing token never travels (phone and
HUD [prove it to each other](#authentication)) and may be any text up to 256 characters.

### Diagnostics

`GET /api/diagnostics` — the OBD link, the malfunction indicator, the trouble codes with
descriptions, the supported signals and the latest value of every signal (canonical units, with
the time it was received). Every time is the HUD's wall-clock epoch ms, and `now` is the HUD's
time of the answer on the same clock, so a sample's age is `now − at` whatever the client's own
clock says:

```json
{
  "now": 1790190245400,
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

- `GET /api/trips?limit=50&before=<epoch ms>` — completed trips, newest first (by `startedAt`).
  `limit` 1–500 (default 50); `before` returns only trips that *started* before that time: to
  page backwards, pass the `startedAt` of the oldest trip you have (its `endedAt` would return
  that trip again).
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
{
  "mode": "manual", "throttle": 0.4, "brake": 0, "engineRunning": true, "gear": null,
  "speedKph": 0, "rpm": 880, "dtcs": ["P0420"], "lux": 20000, "ambientTempC": 18,
  "scenarioStep": null,
  "coolantOverrideC": null, "voltageOverrideV": null, "fuelLevelOverridePct": null,
  "tirePressuresKpa": { "fl": 235, "fr": 235, "rl": 230, "rr": 230 },
  "adas": { "blindSpotLeft": false, "blindSpotRight": false, "collision": "none" },
  "phone": { "connected": true, "steppedAside": false }
}
```

The status reports everything the controls below set — the overrides, the tyre pressures as set
(cold; the reported ones rise as the tyres warm up), the ADAS warnings and the simulated phone's
link — so a developer console shows the simulator's state after a reload, or after another
console changed it. `phone.steppedAside` is true while a real phone is connected to `/ws/phone`:
the simulated phone is then silent (no messages, no link changes) until the real one goes.

| Field | Values |
| --- | --- |
| `mode` | `scenario` (the scripted demo drive) or `manual` |
| `throttle`, `brake` | 0–1 (manual mode) |
| `engineRunning` | boolean |
| `gear` | 0–10 to hold a gear (0 = neutral), `null` for automatic shifting |
| `dtcs` | up to 32 codes such as `"P0420"`; replaces the injected codes, and the HUD reads the codes again at once (instead of at the next `obd.dtcIntervalMs`), so the change shows within a moment |
| `coolantOverrideC`, `voltageOverrideV`, `fuelLevelOverridePct` | force a value; `null` releases it |
| `lux`, `ambientTempC` | simulated light level (0–200000) and outside temperature (−60–70) |
| `phone.kind` | `nav-start`, `nav-stop`, `incoming-call` (optional `name`), `end-call`, `next-track`, `message` (optional `sender`), `speed-camera` (700 m ahead), `traffic-jam` (900 m ahead, +7 min), `disconnect`, `connect` |
| `adas` | `blindSpotLeft`, `blindSpotRight` (booleans), `collision` (`none`, `caution`, `warning`) |
| `tirePressuresKpa` | `{ "fl", "fr", "rl", "rr" }` in kPa, or `null` to remove the tyre-pressure module |

### Pages and other paths

`GET /`, `/settings`, `/dev` serve the three pages from the built renderer, on both ports; hashed assets under
`/assets/` are cached for a year, pages are revalidated. Without a build every page answers `503`
with instructions. `/ws/*` without a WebSocket upgrade answers `426`. The HUD page understands
`?preview=1` (ignore mirroring, rotation and keystone) and `?fixture=<name>` (draw a sample frame
without a server, e.g. `?fixture=city-nav&preview=1`).

## mDNS discovery

The HUD advertises itself with DNS-SD so the companion finds it without an address:

- service type **`_carheadsup._tcp`**, port `server.port` (plain HTTP);
- instance name **"&lt;vehicle name&gt; HUD"** (e.g. "My car HUD");
- TXT records **`v=3`** (the phone protocol version), **`path=/ws/phone`**, **`id=<HUD id>`**
  (the `hudId` of the [`challenge`](#challenge--hello--welcome)) and, while the TLS listener
  runs, **`tls=<port>`** (the port the phone connects to, `wss://`) and **`fp=<fingerprint>`**
  (its certificate's [SHA-256](#tls-and-the-huds-certificate), 64 hex digits). A paired
  companion uses only the advertisement with its HUD's id; one pairing for the first time
  requires the certificate named by `fp`. None of it is a proof: the certificate pin, the
  `challenge` and the `welcome` proof decide. Without `tls` the companion tries 8443.

The server publishes this through `avahi-publish-service` (package `avahi-utils`) while
`server.mdns` is on, and re-publishes when the vehicle name or the setting changes. Without
`avahi-utils` it logs a hint and does not advertise; the static
[`deploy/avahi/carheadsup.service`](../deploy/avahi/carheadsup.service) (named after the host)
does the same job, and the installer puts it in place in that case (with `server.port` and
`server.tlsPort` filled in). That file cannot know the HUD's id or certificate, so it has no `id`
or `fp` record: the companion then learns both at the first pairing and pins them just the same.
To check from a Linux machine on the same network:

```sh
avahi-browse -rt _carheadsup._tcp
```
