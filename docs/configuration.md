# Configuration

All settings live in one JSON file, `config.json` — `/etc/carheadsup/config.json` on an installed
Pi, `<data dir>/config.json` otherwise. The contract is `HudConfig` in
[`packages/core/src/types/config.ts`](../packages/core/src/types/config.ts); the defaults are
`DEFAULT_CONFIG` in [`packages/core/src/config/config.ts`](../packages/core/src/config/config.ts);
the allowed ranges are in [`schema.ts`](../packages/core/src/config/schema.ts).

- [Changing settings](#changing-settings)
- Options: [units](#units) · [vehicle](#vehicle) · [obd](#obd) ·
  [display.projection](#displayprojection) · [display.brightness](#displaybrightness) ·
  [display.layout](#displaylayout) · [display.context](#displaycontext) ·
  [display (other)](#display-other) · [shiftLight](#shiftlight) · [alerts](#alerts) ·
  [maintenance](#maintenance) · [trip](#trip) · [phone](#phone) · [sensors](#sensors) ·
  [server](#server)
- [Layouts](#layouts)
- [Custom PIDs and TPMS](#custom-pids-and-tpms)
- [Command line and environment](#command-line-and-environment)

## Changing settings

- **Settings app** (`/settings`, also opened by the companion app; from a laptop or phone
  browser at `https://<HUD address>:8443/settings` — see [Remote HTTPS](#remote-https)): every
  option below except the brightness curve (`display.brightness.curve`, by hand or through the
  API), with validation as you type. Changes apply to the running HUD immediately.
- **REST API**: `PATCH /api/config` with a partial config (deep-merged), or `PUT /api/config`
  with a whole one — a lenient replace, not a reset: fields missing from the body keep their
  current values. See [protocol.md](protocol.md#config).
- **By hand**: stop the service, edit the file, **check that it is still valid JSON**, start it
  again (the server rewrites the file when the settings app saves). On the Pi:
  `sudo python3 -m json.tool /etc/carheadsup/config.json >/dev/null && echo "valid JSON"`.

Validation is **lenient and per field**. A value that is missing takes its default; a value of
the wrong type or out of range keeps its previous (or default) value and is reported, e.g.
`display.brightness.minLevel: expected number <= 1` — in the server log when loading the file, in
the API response (`422` with an `errors` list) when saving. Unknown keys are ignored. A file that
had to be corrected on load is saved in normalised form, with your original kept as
`config.json.bak`. A broken config never stops the HUD from starting. Arrays (curves, layouts,
custom PIDs, maintenance items) are validated and replaced as a whole.

**A syntax error is not per field.** A file that is not valid JSON at all — a missing comma or
quote, a trailing comma, a comment — cannot be read, so the HUD runs with *every* setting at its
default (projection, vehicle, layout …), except that it **fails closed**: the API token and the
pairing code become random values nobody knows, so other devices and the phone are locked out
(the HUD's own display keeps working) rather than let in without a token. The file is left
exactly as it is, and saving settings is refused (`503`) until it is fixed. The server logs
`… is not valid JSON (<where>) … Fix it and restart the HUD`. To recover: stop the service, fix
`config.json`, check it and start the service. The same holds for a file that cannot be read
at all (wrong owner or permissions, a disk error).

A token field that is invalid on its own (an API token with characters no client can send, or
one longer than 256 characters) also becomes a random token instead of none, logged as an
error; set a new one in the settings app on the HUD itself or in the file.

One exception: a pairing code in the file that breaks today's [rule](#phone) — spaces,
accents, emoji, which older versions allowed — is **kept as it is**, so phones paired with it
keep connecting, and logged as a warning
(`phone.pairingToken in … breaks the pairing-code rule …`). It stays while other settings
change, but the HUD's pairing page cannot show it as a QR code, the companion app's *Pairing
code* field does not take it (so no phone can pair with it anew) and the settings app suggests
a new one. Once replaced in the settings app (or through the API), it cannot be set there
again. The file does not say which version wrote it, so such a code typed into `config.json` by
hand is kept and logged the same way — set a new code that keeps the rule instead.

Cross-field rules are enforced too: `minLevel ≤ maxLevel`, `nightEnterLux < nightExitLux`,
`highwayExitKph < highwayEnterKph`, `stationaryKph < highwayExitKph`, `startRpm < shiftRpm ≤
flashRpm`, `coolantHighC < coolantCriticalC`, both low-voltage thresholds below `voltageHighV`,
`idleRpm < redlineRpm`, the keystone corners forming a convex quadrilateral, distinct button GPIO
lines, a CAN button rule's value within its mask, steering-wheel ladder windows that overlap
neither each other nor the idle range and lie within the ADC's input range. When a change breaks
one, the changed field is reverted.

Units inside the config are always canonical — km/h, km, m, °C, kPa, V, litres, milliseconds —
whatever `units` says about the display.

## Options

### units

How values are **displayed**; nothing else depends on them.

| Option | Default | Values | Notes |
| --- | --- | --- | --- |
| `units.system` | `"metric"` | `metric`, `imperial` | Speed and distance: km/h, km, m — or mph, mi, ft. |
| `units.fuelEconomy` | `"L/100km"` | `L/100km`, `km/L`, `mpg-us`, `mpg-uk` | Economy readouts and trip averages. |
| `units.temperature` | `"C"` | `C`, `F` | |
| `units.pressure` | `"kPa"` | `kPa`, `psi`, `bar` | Tyres and boost. |
| `units.clock` | `"24h"` | `12h`, `24h` | Clock and ETA. |
| `units.currency` | `"USD"` | ISO 4217 code | For trip cost, e.g. `EUR`, `GBP`. |

### vehicle

| Option | Default | Range | Notes |
| --- | --- | --- | --- |
| `vehicle.name` | `"My car"` | 1–60 chars | Shown to the phone and used as the mDNS name ("My car HUD"). |
| `vehicle.fuelType` | `"gasoline"` | `gasoline`, `diesel`, `e85`, `lpg` | Selects the air–fuel ratio and fuel density for fuel estimation. **Diesel economy needs the fuel-rate PID `5E`**; without it there is no economy, range or trip fuel. |
| `vehicle.tankCapacityL` | `50` | 1–500 | Usable tank volume; range = remaining litres ÷ recent average consumption. |
| `vehicle.displacementL` | `2.0` | 0.05–20 | Only for the speed-density estimate (cars without MAF and fuel-rate PIDs). |
| `vehicle.volumetricEfficiency` | `0.85` | 0.2–1 | Speed-density estimate: raise it if the estimated consumption reads low compared with the pump. |
| `vehicle.transmission` | `"automatic"` | `manual`, `automatic`, `dct`, `cvt` | Tunes gear inference (torque-converter slip, neutral detection); `cvt` hides the gear. |
| `vehicle.redlineRpm` | `6500` | 1000–25000 | Tachometer scale. |
| `vehicle.idleRpm` | `750` | 200–3000 | Idle samples are ignored when learning gear ratios. |
| `vehicle.gearRatiosRpmPerKph` | `null` | 1–12 decreasing numbers | `null` = learn automatically while driving (stored in `state.json`). Or enter engine rpm per km/h for each gear, 1st first: rpm ÷ speed while cruising steadily in that gear, or gear ratio × final drive × 1000 ÷ (60 × tyre circumference in m). |
| `vehicle.fuelPricePerL` | `1.8` | ≥ 0 | Per litre, in `units.currency`; trip cost = fuel used × price. |
| `vehicle.hasTpms` | `false` | | Enables the tyre-pressure widget and alert; needs [custom PIDs](#custom-pids-and-tpms). |

Gear display: when the car reports its gear (PID `A4`) that is shown; otherwise the gear is
inferred from the rpm/speed ratio against the configured or learned ratios, and marked as
inferred. Learning needs a few minutes of steady driving in each gear, and learned gears are
numbered only once there is an anchor: a launch from standstill (1st) on a manual, and on an
automatic — which may never hold 1st long enough to learn it — the gear after the first upshift
following a launch (2nd), seen twice. An automatic's anchor is saved with the ratios
(`state.json`), so gears show right after the next start. Until there is an anchor, and for any
gear above a gap in the learned ladder (a gear never driven steadily), the gear shows as unknown
rather than as a wrong number. Changing `vehicle.transmission` forgets the learned ratios and
their anchor. A new inferred gear shows once it has held for two samples and 300 ms (three and
600 ms on automatics); on a slow bus (one PID per request, samples a second or more apart) one
sample suffices when its speed and rpm were read together, it matches the gear closely and the
gear is one up or down from the last one shown.

### obd

| Option | Default | Range | Notes |
| --- | --- | --- | --- |
| `obd.transport` | `"serial"` | `serial`, `tcp`, `simulator` | Bluetooth (via rfcomm) and USB adapters are `serial`, Wi-Fi adapters `tcp`. `simulator` runs the built-in emulator (as `--sim` does). |
| `obd.serialPath` | `"/dev/rfcomm0"` | | Serial device, e.g. `/dev/rfcomm0` (Bluetooth), `/dev/serial/by-id/usb-…` (USB). |
| `obd.baudRate` | `38400` | 1200–4000000 | Ignored over Bluetooth; USB adapters: see their manual (38400 and 115200 are common). |
| `obd.tcpHost` | `"192.168.0.10"` | host or IP | Wi-Fi adapters. |
| `obd.tcpPort` | `35000` | 1–65535 | Wi-Fi adapters. |
| `obd.protocol` | `"0"` | `"0"`–`"C"`, `"A1"`–`"AC"` | ELM327 `AT SP` value. `0` searches automatically (slow on the first connect); `6` = CAN 11-bit 500 kbit/s, the protocol of most cars since 2008. `A6` = try 6 first, then search. |
| `obd.timeoutMs` | `1000` | 50–30000 | Per-command answer timeout. Raise it for slow clones. |
| `obd.reconnectDelayMs` | `3000` | 100–600000 | Delay before reconnecting after a failure; doubles after each consecutive failure, never more than 30 s — so values above `30000` act as `30000`. |
| `obd.dtcIntervalMs` | `30000` | 1000–3600000 | How often trouble codes are read (also right after connecting). |
| `obd.customPids` | `[]` | up to 64 | Manufacturer-specific PIDs, see [below](#custom-pids-and-tpms). |

Changing the transport, device, host, port, baud rate or protocol reconnects the adapter; the
timeout, DTC interval and custom PIDs apply without reconnecting. More in [obd.md](obd.md).

### display.projection

Fitting the image to the windshield. Easiest in the settings app's *Projection* section with the
calibration grid on.

| Option | Default | Range | Notes |
| --- | --- | --- | --- |
| `display.projection.mirrorX` | `true` | | Mirror left–right: needed for a windshield reflection. |
| `display.projection.mirrorY` | `false` | | Mirror top–bottom (some combiner or mirror arrangements). |
| `display.projection.rotation` | `0` | `0`, `90`, `180`, `270` | Panel mounted sideways or upside down (e.g. portrait bar displays); the layout uses the rotated size. |
| `display.projection.scale` | `1` | 0.5–1.5 | Size of the content. |
| `display.projection.offsetX` | `0` | −0.5–0.5 | Horizontal shift, as a fraction of the image width. |
| `display.projection.offsetY` | `0` | −0.5–0.5 | Vertical shift, as a fraction of the image height. |
| `display.projection.corners` | identity | each 0–1 | Keystone: where the content's corners `tl`, `tr`, `br`, `bl` land, as `[x, y]` fractions of the screen. Identity is `tl [0,0]`, `tr [1,0]`, `br [1,1]`, `bl [0,1]`. Must stay a convex quadrilateral in that order. |
| `display.projection.showGrid` | `false` | | Draw a calibration grid instead of the HUD — only while the car stands still, with blind-spot bars, collision cues and alerts still drawn on top. The HUD switches it off (and saves that) as soon as the car moves. |

Projection changes reach the HUD page at once (the `display` message), without reloading.

### display.brightness

| Option | Default | Range | Notes |
| --- | --- | --- | --- |
| `display.brightness.mode` | `"auto"` | `auto`, `manual` | |
| `display.brightness.manualLevel` | `0.8` | 0–1 | Level in `manual` mode. |
| `display.brightness.minLevel` | `0.08` | 0–1 | Floor of the automatic level. |
| `display.brightness.maxLevel` | `1` | 0–1 | Ceiling of the automatic level. |
| `display.brightness.curve` | see below | 1–32 points | `[lux, level]` pairs with strictly increasing lux; interpolated on log₁₀(lux). Not in the settings app: edit it by hand or with `PATCH /api/config`. |
| `display.brightness.riseTimeMs` | `3000` | 0–600000 | Smoothing time constant when getting brighter (slow: no flicker under trees). |
| `display.brightness.fallTimeMs` | `400` | 0–600000 | Time constant when getting darker (fast: tunnels). |
| `display.brightness.nightMode` | `"sensor"` | `sensor`, `sun`, `always`, `never` | Source of the night palette. `sensor` falls back to the sun when there is no light reading. |
| `display.brightness.nightEnterLux` | `50` | 0–100000 | `sensor`: night below this… |
| `display.brightness.nightExitLux` | `150` | 0–100000 | …and day again above this (hysteresis). |
| `display.brightness.nightSunElevationDeg` | `-4` | −18–10 | `sun`: night while the sun is below this elevation (degrees). |

The default curve runs from a dark road to direct sun on the windshield:

```json
"curve": [[1, 0.08], [10, 0.15], [100, 0.3], [1000, 0.55], [10000, 0.85], [100000, 1]]
```

In `auto` mode the level follows the light sensor through the curve, clamped to
`minLevel`–`maxLevel` and smoothed. Without a fresh reading it follows the sun instead (day:
80 % of `maxLevel`, night: twice `minLevel`), using the phone's last GPS position or
`sensors.fallbackLocation`; with neither it keeps the last level. The driver's
brightness-up/down input trims the result by ±0.1 per step (at most ±0.5), and the final value
never drops below 0.05. It is applied to the display's Linux backlight device when it has one
(through a 2.2 gamma; the page is then drawn at full brightness, so the content is not dimmed
twice), and otherwise as a CSS brightness on the page.

### display.layout

| Option | Default | Notes |
| --- | --- | --- |
| `display.layout.preset` | `"standard"` | `minimal`, `standard`, `sport` or `custom`. |
| `display.layout.widgets` | the `standard` placements | Used only when `preset` is `custom`. |

See [Layouts](#layouts).

### display.context

The thresholds of the [driving contexts](architecture.md#driving-contexts-and-adaptive-clutter).

| Option | Default | Range | Notes |
| --- | --- | --- | --- |
| `display.context.highwayEnterKph` | `80` | 20–250 | Enter `highway` at or above this speed… |
| `display.context.highwayDwellMs` | `10000` | 0–600000 | …held for this long. |
| `display.context.highwayExitKph` | `65` | 10–250 | Leave `highway` below this. |
| `display.context.stationaryKph` | `2` | 0.5–20 | Below this the car counts as stopped. |
| `display.context.parkedAfterMs` | `120000` | 0–86400000 | Standing completely still with the engine running this long ⇒ `parked`. |
| `display.context.engineOffParkedAfterMs` | `180000` | 0–86400000 | Standing completely still with the engine off this long ⇒ `parked`. Long enough that automatic start-stop does not open the dashboard at red lights (they often last 45–120 s); switching the ignition off is caught much sooner, because the ECU stops answering (`parked` 10 s after the last speed reading). The trade-off: with the ignition still on and the engine off (accessory mode), clearing trouble codes, which needs `parked`, waits this long — the dashboard itself opens at once with the next-page button while stopped (see below). Creeping along with the engine off (a hybrid in a jam) restarts the timer. |

While `stopped`, the driver can open the full diagnostics dashboard at once with `next-page` /
`prev-page` (a button, the kiosk's arrow keys or the companion app's remote); further presses flip
its pages, `secondary` closes it, and it closes by itself as soon as the car moves — it is never
shown while moving. When `parked` it shows anyway.

### display (other)

| Option | Default | Range | Notes |
| --- | --- | --- | --- |
| `display.speedLimitSign` | `"vienna"` | `vienna`, `mutcd` | Red-ring sign (most of the world) or the US/Canada rectangle. |
| `display.mediaToastMs` | `5000` | 0–60000 | How long song and artist show after a track change (0 = never). |
| `display.messageToastMs` | `6000` | 0–60000 | How long a message sender shows. |
| `display.highwayNavRevealM` | `2000` | 0–50000 | On the highway, navigation appears only this close to the next maneuver. |
| `display.laneRevealM` | `800` | 0–10000 | Lane guidance appears this close to the maneuver. |
| `display.hazardRevealM` | `1000` | 0–50000 | Hazards appear this close. |
| `display.trafficRevealM` | `3000` | 0–50000 | On the highway, traffic hazards — jams, slowdowns, accidents, road works and anything the phone gives a delay — appear this close instead (never later than `hazardRevealM`): at 130 km/h, 1 km is under 30 s to the end of a jam. Traffic comes from the companion's optional TomTom look-up ([companion README](../companion-android/README.md#traffic-tomtom)). |
| `display.maxAlerts` | `2` | 1–5 | Most alert banners on screen at once. Critical alerts are always shown, however many there are; the others fill the room left. |

### shiftLight

A bar along the top that fills from `startRpm` to `shiftRpm` and flashes from `flashRpm`. Once
flashing, it keeps flashing until the engine speed drops below `flashRpm` minus 2 % (at least
100 rpm), so an engine held at the flash point does not flicker it.

| Option | Default | Range | Notes |
| --- | --- | --- | --- |
| `shiftLight.enabled` | `false` | | |
| `shiftLight.startRpm` | `4500` | 500–25000 | Bar starts filling. |
| `shiftLight.shiftRpm` | `6000` | 500–25000 | Bar full: your shift point. |
| `shiftLight.flashRpm` | `6300` | 500–25000 | Flashing. |

### alerts

| Option | Default | Range | Notes |
| --- | --- | --- | --- |
| `alerts.coolantHighC` | `110` | 60–150 | "ENGINE HOT" warning from here. Normal operating temperature is about 85–105 °C. The coolant readout follows the alert (its hysteresis included), so it does not flicker at the threshold. |
| `alerts.coolantCriticalC` | `118` | 60–160 | "OVERHEATING – STOP", critical, cannot be dismissed. |
| `alerts.coolantHysteresisC` | `3` | 0–20 | Clears this far below the threshold. |
| `alerts.voltageLowRunningV` | `12.2` | 6–32 | Engine running at or below this for 60 s ⇒ "CHARGING FAULT" (a healthy alternator gives 13.5–14.7 V). |
| `alerts.voltageLowOffV` | `11.9` | 6–32 | Engine off at or below this for 10 s ⇒ "BATTERY LOW". |
| `alerts.voltageHighV` | `15.3` | 6–32 | At or above this for 10 s ⇒ "OVERVOLTAGE". The voltage readout shows only while one of these alerts is up, so cranking dips never show. |
| `alerts.voltageHysteresisV` | `0.3` | 0–3 | |
| `alerts.overspeedToleranceKph` | `3` | 0–50 | The speed turns red above limit + max(this, limit × pct/100)… |
| `alerts.overspeedTolerancePct` | `5` | 0–50 | …e.g. 50 km/h → red above 53, 120 km/h → above 126. |
| `alerts.fuelLowPct` | `12` | 0–100 | "FUEL LOW" (caution) at or below this tank level; clears 2 points above. At half this level, or 30 km of range left, it escalates to "FUEL VERY LOW" (warning), which comes back even if the driver dismissed the caution. |
| `alerts.tpmsLowKpa` | `180` | 0–1000 | Tyre (gauge) pressure below which "TYRE PRESSURE LOW" warns (it clears 7 kPa above; the tyre readout uses the same limit). Below 75 % of this — a puncture — it turns into "TYRE PRESSURE CRITICAL", critical and not dismissible. Sensor faults do not: see [TPMS sensor faults](#custom-pids-and-tpms). |
| `alerts.iceRiskC` | `3` | −30–15 | Outside temperature at or below which "ICE RISK" shows for 10 s. |
| `alerts.showDtcWhileDriving` | `false` | | Show informational and caution check-engine alerts while moving (warnings and worse always show). |

Voltage comes from the adapter's own measurement at the OBD port (`AT RV`), or the ECU's
supply-voltage PID `42` when the adapter has none.

### maintenance

`maintenance.items` is a list of service items (up to 50); each is due after a distance, a time,
or whichever comes first. Defaults:

| `id` | `label` | `intervalKm` | `intervalDays` | `warnBeforeKm` | `warnBeforeDays` |
| --- | --- | --- | --- | --- | --- |
| `oil` | Oil & filter | 8000 | 365 | 500 | 14 |
| `tyre-rotation` | Tyre rotation | 10000 | — | 500 | 14 |
| `air-filter` | Air filter | 20000 | 730 | 1000 | 30 |
| `brake-fluid` | Brake fluid | — | 730 | 0 | 30 |
| `cabin-filter` | Cabin filter | 15000 | 365 | 1000 | 30 |
| `coolant` | Coolant | 100000 | 1825 | 2000 | 30 |

| Field | Range | Notes |
| --- | --- | --- |
| `id` | letters, digits, `.`, `-`, `_`; unique | Service records are kept per id. |
| `label` | 1–60 chars | Shown in alerts and on the dashboard. |
| `intervalKm` | > 0 or `null` | At least one of `intervalKm` and `intervalDays` is required. |
| `intervalDays` | 1–36500 or `null` | |
| `warnBeforeKm` / `warnBeforeDays` | ≥ 0 | "SERVICE DUE" (info) this early; "SERVICE OVERDUE" (caution) once past. |

An item stays *unknown* until its last service is recorded: in the settings app (*Maintenance* →
mark done, with the odometer) or `POST /api/maintenance/<id>/done`. The odometer comes from the car
(PID `A6`, on newer cars) or is carried forward by the HUD from the speed; set it once in the
settings app (`POST /api/odometer`) if your car does not report it. Due items are also pushed to
the phone.

### trip

| Option | Default | Range | Notes |
| --- | --- | --- | --- |
| `trip.endAfterEngineOffMs` | `300000` | 0–86400000 | A trip ends after the engine has been off (or the OBD link down) this long, so a fuel stop does not split it. Its end time is the last activity. A HUD that loses power seconds after the ignition (the usual installation) saves the trip in progress and closes it at the next start when it was off longer than this — the trip then appears in the log and on the phone — or continues it after a shorter break. |
| `trip.minDistanceKm` | `0.2` | 0–100 | Shorter trips are discarded (moving the car in the driveway). |

### phone

| Option | Default | Notes |
| --- | --- | --- |
| `phone.pairingToken` | `""`, but random in a new `config.json` | Shared secret phone and HUD prove to each other when the phone connects (it is never sent; [details](protocol.md#authentication)). The phone gets it by scanning the HUD's pairing QR code (parked: the dashboard's last page, or *Phone → Show pairing code on the HUD*; [details](protocol.md#pairing-by-qr-code)) or by typing it in. When the server creates `config.json`, it sets a random one (24 letters and digits, about 139 bits), so a new HUD is never open; an existing file is never given one. Use a long random one (the settings app's *Generate*). At most 256 characters of printable ASCII without spaces — letters, digits and symbols, one word (`!` to `~`) — the rule the settings app, the pairing QR code and the companion app's *Pairing code* field share; every generated code keeps it. A code in `config.json` that breaks it (older versions allowed spaces and accents) is kept ([see above](#changing-settings)). Empty = the HUD is open: any phone on the network may connect, and the phone cannot verify the HUD (it asks the user to confirm it); the pairing page then says so instead of showing a code. Changing or removing it disconnects a phone paired with the old one. |
| `phone.showMessageSender` | `true` | Show who sent a message (the content is never shown). |
| `phone.readMessagesAloud` | `true` | Ask the phone to read messages aloud (sent in `welcome`). |
| `phone.showMedia` | `true` | Song and artist toast on track change. |

### sensors

| Option | Default | Range | Notes |
| --- | --- | --- | --- |
| `sensors.lightSensor` | `"none"` | `none`, `bh1750`, `veml7700`, `tsl2591` | I²C ambient light sensor. |
| `sensors.gestureSensor` | `"none"` | `none`, `apds9960` | I²C gesture sensor. |
| `sensors.i2cBus` | `1` | 0–255 | `/dev/i2c-<n>`; 1 is the 40-pin header. |
| `sensors.lightSensorGain` | `1` | > 0 – 1000 | Multiplies the lux reading, to compensate for tinted glass or a cover. |
| `sensors.buttons.primary` | `null` | GPIO 0–1023 | BCM number of the accept / OK button (hold = blank). |
| `sensors.buttons.secondary` | `null` | | Decline / dismiss button. |
| `sensors.buttons.next` | `null` | | Next dashboard page button; while stopped it opens the dashboard. |
| `sensors.canButtons.interface` | `null` | interface name, e.g. `"can0"` | SocketCAN interface to read [steering-wheel buttons](hardware.md#steering-wheel-buttons) from, with can-utils' `candump`; `null` = off. The HUD never transmits, and the interface **must be up in listen-only mode** (`sudo ip link set can0 up type can bitrate 500000 listen-only on`, [at boot](hardware.md#can-bus-an-mcp2515-can-hat)) so that its controller does not acknowledge or error-flag the car's frames either; the HUD checks with `ip -details link show` and logs a warning when it is not. |
| `sensors.canButtons.releaseTimeoutMs` | `500` | 50–10000, or `null` | A held button counts as released once no frame with its id has arrived for this long — for cars that send the button frame only while a button is held. Keep it well above the frame's repeat interval. `null` = only a frame with another value releases a button, for cars that send a frame only when something changes. |
| `sensors.canButtons.rules` | `[]` | ≤ 32 rules | One rule per button, below. A rule's button is held while `(data[byte] & mask) == value` in the frames with its id; only the press acts, once (30 ms debounce), however many frames repeat it. No two rules may have the same id, byte, mask and value. |
| `…rules[].id` | | 3 or 8 hex digits | The frame's CAN id as `candump` prints it: 3 digits for an 11-bit id (up to `7FF`), 8 for a 29-bit id (up to `1FFFFFFF`). `5C1` and `000005C1` are different frames. |
| `…rules[].byte` | | 0–63 | Data byte to test, 0 = the first (above 7 only in CAN FD frames). A shorter frame is ignored. |
| `…rules[].mask` | | 2 hex digits, not `00` | The bits of that byte that belong to the button, e.g. `"0F"`; `"FF"` = the whole byte. |
| `…rules[].value` | | 2 hex digits | What those bits read while the button is held, e.g. `"01"`; no bits outside the mask. |
| `…rules[].action` | | an [input action](architecture.md#driver-input) | `primary`, `secondary`, `next-page`, `prev-page`, `toggle-blank`, `brightness-up` or `brightness-down`. |
| `…rules[].longPressAction` | | an input action or `null` | Held longer than 0.8 s: this action instead, once, while still held. A short press then acts on release. |
| `sensors.swcButtons.enabled` | `false` | | Read a steering-wheel [resistor ladder](hardware.md#resistor-ladder-an-ads1115-on-the-button-wire) through an ADS1115 ADC on `sensors.i2cBus`, 50 times a second. |
| `sensors.swcButtons.address` | `72` | 72–75 | I²C address 0x48–0x4B (JSON has no hex numbers: 72 = 0x48, 73 = 0x49, 74 = 0x4A, 75 = 0x4B), set by the ADDR pin: GND, VDD, SDA, SCL. |
| `sensors.swcButtons.channel` | `0` | 0–3 | Input A0–A3, measured against GND. |
| `sensors.swcButtons.fullScaleV` | `4.096` | `6.144`, `4.096`, `2.048`, `1.024`, `0.512`, `0.256` | Input range in ± volts (programmable gain 2/3, 1, 2, 4, 8, 16). ±4.096 V for a ladder pulled up to 3.3 V. The idle range and every window must lie within it. |
| `sensors.swcButtons.idle` | `{ "minV": 3, "maxV": 3.6 }` | 0–6.144 V, `minV < maxV` | The voltage with no button pressed. |
| `sensors.swcButtons.windows` | `[]` | ≤ 16 | One per button: `{ "minV", "maxV", "action", "longPressAction" }` — volts (`minV < maxV`, ends included) and actions as for the CAN rules. Windows must not overlap each other or the idle range; leave gaps. A button counts once three readings in a row (60 ms) fall into its window, and is released by three readings anywhere else. A button already held when the HUD starts is ignored until released. To find the voltages, see [calibrating](hardware.md#resistor-ladder-an-ads1115-on-the-button-wire). |
| `sensors.fallbackLocation` | `null` | `{ "lat": …, "lon": … }` | Location for sun-based brightness and night mode when the phone has not sent one. |
| `sensors.adasUdpPort` | `null` | 1–65535 | UDP port for an [ADAS module](protocol.md#adas-udp-feed); `null` = off. Which devices may send to it: `adasAllowedSenders`, below. |
| `sensors.adasAllowedSenders` | `[]` | ≤ 32 IPv4 / IPv6 addresses | The addresses the ADAS feed accepts datagrams from, e.g. `["10.42.0.50"]` — give the module a fixed address first. The feed listens on IPv4 only, so list the module's IPv4 address (IPv6 entries are valid but match nothing today). Addresses only: no host names, prefixes (`/24`), ports or `%zone` suffixes; each address once. Compared in canonical form, so `::ffff:10.42.0.50` is `10.42.0.50` and IPv6 case and zero-compression do not matter. Datagrams from anyone else are dropped and counted in a log warning (at most every 10 s). **Empty = any device on the car's network**, which can then raise or hide collision warnings; the HUD logs a warning when the feed starts that way and the settings app shows one. A change applies at once without reopening the port; removing an address that is sending ends its link immediately. Filtering by source address keeps out other devices on the Wi-Fi, not an attacker who forges the module's address — see the [trust note](protocol.md#adas-udp-feed). |

Sensor changes apply without a restart; only the sources whose settings changed are restarted —
new CAN button actions or ladder windows apply without restarting `candump` or re-initialising the
ADC. Wiring: [hardware.md](hardware.md#sensors-buttons-and-wiring).

Steering-wheel buttons, for example — three buttons in the low four bits of byte 0 of CAN frame
`5C1`, and a four-button ladder on input A0 of an ADS1115 at 0x48:

```json
{
  "sensors": {
    "canButtons": {
      "interface": "can0",
      "releaseTimeoutMs": 500,
      "rules": [
        { "id": "5C1", "byte": 0, "mask": "0F", "value": "01", "action": "next-page", "longPressAction": null },
        { "id": "5C1", "byte": 0, "mask": "0F", "value": "02", "action": "prev-page", "longPressAction": null },
        { "id": "5C1", "byte": 0, "mask": "0F", "value": "03", "action": "primary", "longPressAction": "toggle-blank" }
      ]
    },
    "swcButtons": {
      "enabled": true,
      "address": 72,
      "channel": 0,
      "fullScaleV": 4.096,
      "idle": { "minV": 3.0, "maxV": 3.6 },
      "windows": [
        { "minV": 0.0, "maxV": 0.2, "action": "next-page", "longPressAction": null },
        { "minV": 0.45, "maxV": 0.7, "action": "prev-page", "longPressAction": null },
        { "minV": 0.95, "maxV": 1.15, "action": "primary", "longPressAction": "toggle-blank" },
        { "minV": 1.5, "maxV": 1.8, "action": "secondary", "longPressAction": null }
      ]
    }
  }
}
```

The simplest way to use the steering wheel needs neither: with the phone paired to the car over
Bluetooth, its call and media buttons already reach the phone, and the HUD follows the phone's
call and media state ([more](hardware.md#steering-wheel-buttons)).

### server

| Option | Default | Range | Notes |
| --- | --- | --- | --- |
| `server.port` | `8080` | 1–65535 | Plain HTTP and WebSocket port: the kiosk and anything else on the Pi itself. Other devices are sent to `server.tlsPort` while TLS is on (see [`server.allowPlainRemote`](#remote-https)). Takes effect after a restart. On the Pi, move the kiosk with it (`CARHEADSUP_KIOSK_URL`, [install guide](install-raspberry-pi.md#the-units)) — the kiosk stays black until then — and use 1024 or above: the service has no privilege to listen below that, so it would fail to start. |
| `server.tlsPort` | `8443` | 1–65535, not `server.port`, or `null` | HTTPS and secure WebSocket port with the HUD's self-signed certificate (`<data dir>/tls.pem`, made on the first start): the companion app's link, encrypted and pinned to that certificate ([details](protocol.md#tls-and-the-huds-certificate)), and where browsers on other devices use the settings app and the developer console; it serves the same pages and API as `server.port`. `null` switches TLS off — and with it the phone link, unless `server.allowPlainPhone` is on; other devices then use `server.port`, unencrypted (the API token and settings cross the Wi-Fi in clear text; the HUD logs a warning). Takes effect after a restart; 1024 or above on the Pi. A TLS port that cannot be opened (taken by another service) is logged and left out; the HUD keeps running without the phone, and other devices' browsers are refused until it is fixed. A config file from before this setting whose `server.port` is 8443 keeps that port and gets 8444 here. |
| `server.allowPlainPhone` | `false` | | Also serve the phone link (`/ws/phone`) on `server.port`, unencrypted, with nothing bound to a certificate — for development and custom clients only; the companion app always uses TLS. Off: a plain phone connection is refused (`403`); switching it off closes plain sessions at once. |
| `server.allowPlainRemote` | `false` | | Also serve the pages, the API and the display socket to other devices on `server.port`, unencrypted — for development only. Off (while TLS is on): other devices' page requests on the plain port are redirected to HTTPS on `server.tlsPort`, their API requests and `/ws/hud` upgrades refused (`403`) without their token being looked at ([details](#remote-https)). The Pi itself always uses the plain port; `/ws/phone` follows `server.allowPlainPhone`. Applies at once; switching it off closes other devices' plain display sockets (4005). |
| `server.host` | `"0.0.0.0"` | | Bind address. `0.0.0.0` lets the phone connect over Wi-Fi; `127.0.0.1` keeps the HUD to itself. Restart required. An address the kiosk cannot reach leaves it black. With a single network address (say `10.42.0.1`), point the kiosk at it (`CARHEADSUP_KIOSK_URL=http://10.42.0.1:8080/`; `localhost` no longer reaches the HUD): it connects from that address to that address, which the HUD knows as itself ([Remote HTTPS](#remote-https)). |
| `server.apiToken` | `""` | ≤ 256 printable ASCII chars | Bearer token required from every client except the Pi itself. Empty = open to the car's network. Letters, digits, symbols and spaces only (not spaces alone): it travels in HTTP headers and `?token=` addresses, which carry nothing else. |
| `server.mdns` | `true` | | Advertise `_carheadsup._tcp` so the companion finds the HUD. |
| `server.frameRate` | `15` | 1–60 | Frames per second pushed to the HUD page. Keep it at 2 or more: at 2 fps and above the page blanks after 1 s without a frame, and slower rates make the HUD slow to notice a stalled server. Lower (10) on a Pi Zero 2 W. |

#### Remote HTTPS

The plain port carries everything in clear text — the API token, the config, the HUD's frames — to
anyone listening on the car's Wi-Fi. So while TLS is on, it serves only the Pi itself (the kiosk
browser, `curl` on the Pi): clients over loopback, or connected from the very address they reached
the HUD at — on a HUD that listens on one network address, the kiosk reaches it there. No other
device can open such a connection (its handshake would need the Pi to answer itself). A laptop or
phone browser on the Wi-Fi uses the same pages over HTTPS:

| Request from another device on `server.port` | Answer |
| --- | --- |
| `GET`/`HEAD` of a page or file (`/settings`, `/dev?x=1`, `/assets/…`) | `307` to `https://<same host>:<server.tlsPort><same path and query>` — the host from the `Host` header once it passed the [host check](architecture.md#security-model) (an IP address, bracketed IPv6 or DNS name, else the address the browser reached the HUD at: never another site). A `token` query parameter is dropped: it has crossed the Wi-Fi in clear text already, and is neither handed on nor echoed back. Not cached, so a config change applies at once. |
| `/api/*` (any method), `/ws/*` without an upgrade, other methods on pages | `403` with `{ "error": "HTTPS required: use https://<host>:8443/api/… — …" }`; the request's token is never looked at and its body never read |
| WebSocket upgrade of `/ws/hud` | `403` with the same JSON error, naming `wss://<host>:8443/ws/hud` |
| WebSocket upgrade of `/ws/phone` | as before: refused unless `server.allowPlainPhone` |

Open `https://<HUD address>:8443/settings` (or `/dev`) directly — or the plain address, which
redirects. The browser warns about the self-signed certificate once per device: compare the
fingerprint it shows (certificate details, SHA-256) with the one the settings app shows under
Phone (*Certificate fingerprint*) on a device that already has access, or on the HUD's *Pair a
phone* page, before accepting it. Browsers keep the token they were given (`?token=` or entered
when asked) per origin, so enter it once more on the HTTPS address. The companion app's settings
page always used HTTPS.

When the TLS listener could not start (its port taken), other devices are refused (`403`, "the
HUD's TLS listener is not running") rather than served in clear text; the Pi's own display keeps
working. With `server.tlsPort` null, plain http is the only way in and serves everyone as before
— with the token and settings readable by anyone on the Wi-Fi, so keep the hotspot on WPA2 with a
strong passphrase and prefer leaving TLS on. `server.allowPlainRemote` restores plain access for
development (e.g. `npm run sim` opened from another machine) and makes the HUD log a warning.

## Layouts

The projected image is divided into a 3×3 grid of zones: `top-left`, `top`, `top-right`, `left`,
`center`, `right`, `bottom-left`, `bottom`, `bottom-right`. A layout lists widgets with their zone
and the driving contexts in which they may appear. Within a zone, **earlier entries have
priority** when space runs out.

Widgets:

| Widget | Shows | Appears only when |
| --- | --- | --- |
| `speed` | Speed; red when over the limit | speed data is fresh |
| `speedLimit` | Limit sign (or "no limit") | the phone is connected and knows the limit |
| `tachometer` | RPM bar | the engine runs |
| `gear` | Gear (reported or inferred) | the gear is known (never for CVTs) |
| `nav` | Turn arrow, distance, street, "then" | guidance is active (on the highway: within `highwayNavRevealM`) |
| `lanes` | Lane arrows | the source sends lanes, within `laneRevealM` |
| `eta` | Arrival time, remaining time and distance | guidance is active |
| `hazard` | Nearest hazard, its distance, a camera's limit or the traffic delay ("+8 min") | a hazard is within `hazardRevealM` (traffic on the highway: `trafficRevealM`) |
| `fuel` | Instant and average economy, range, level | any of them is known |
| `coolant` | Coolant temperature | at or above `alerts.coolantHighC` |
| `voltage` | Supply voltage | outside the alert thresholds |
| `tpms` | Four tyre pressures | `vehicle.hasTpms`; while moving only when a tyre is low |
| `clock` | Time | always |
| `outsideTemp` | Outside temperature, ice-risk mark | the car reports it (PID `46`) |
| `media` | Song and artist | something is playing on the connected phone |
| `boost` | Manifold pressure relative to the atmosphere | the car reports MAP (PID `0B`) |
| `tripSummary` | Trip distance, time, economy, fuel, cost | a trip is in progress |

When parked — or stopped, once the driver opened it ([display.context](#displaycontext)) — the
HUD page shows the full-screen diagnostics dashboard instead of the widget grid, so the `parked`
column below matters only for the frame data (e.g. in the developer console).
Alerts, toasts, the call card, the shift light and the blind-spot / collision overlays are drawn
outside the grid by every layout.

### Presets

**minimal** — calm highway driving: only what is needed to drive and navigate.

| Widget | Zone | parked | stopped | city | highway |
| --- | --- | :-: | :-: | :-: | :-: |
| `speed` | center |  | ✓ | ✓ | ✓ |
| `speedLimit` | right |  | ✓ | ✓ | ✓ |
| `nav` | top-left | ✓ | ✓ | ✓ | ✓ |
| `lanes` | top |  | ✓ | ✓ | ✓ |
| `hazard` | top-right |  | ✓ | ✓ | ✓ |

**standard** (default) — minimal plus vehicle health and low-speed comfort information.

| Widget | Zone | parked | stopped | city | highway |
| --- | --- | :-: | :-: | :-: | :-: |
| `speed` | center |  | ✓ | ✓ | ✓ |
| `speedLimit` | right |  | ✓ | ✓ | ✓ |
| `nav` | top-left | ✓ | ✓ | ✓ | ✓ |
| `lanes` | top |  | ✓ | ✓ | ✓ |
| `hazard` | top-right |  | ✓ | ✓ | ✓ |
| `coolant` | bottom-left | ✓ | ✓ | ✓ | ✓ |
| `voltage` | bottom-left | ✓ | ✓ | ✓ | ✓ |
| `tpms` | right | ✓ | ✓ | ✓ | ✓ |
| `gear` | left |  | ✓ | ✓ |  |
| `eta` | top-left |  | ✓ | ✓ |  |
| `fuel` | left | ✓ | ✓ | ✓ |  |
| `media` | bottom | ✓ | ✓ | ✓ |  |
| `outsideTemp` | bottom-right | ✓ | ✓ | ✓ |  |
| `clock` | bottom-right | ✓ | ✓ | ✓ |  |
| `tripSummary` | bottom | ✓ | ✓ |  |  |

**sport** — a prominent gear, a tachometer and boost, kept on the highway too; comfort
information moves out of the way.

| Widget | Zone | parked | stopped | city | highway |
| --- | --- | :-: | :-: | :-: | :-: |
| `speed` | center |  | ✓ | ✓ | ✓ |
| `gear` | left |  | ✓ | ✓ | ✓ |
| `tachometer` | bottom |  | ✓ | ✓ | ✓ |
| `speedLimit` | right |  | ✓ | ✓ | ✓ |
| `nav` | top-left | ✓ | ✓ | ✓ | ✓ |
| `lanes` | top |  | ✓ | ✓ | ✓ |
| `hazard` | top-right |  | ✓ | ✓ | ✓ |
| `coolant` | bottom-left | ✓ | ✓ | ✓ | ✓ |
| `voltage` | bottom-left | ✓ | ✓ | ✓ | ✓ |
| `tpms` | right | ✓ | ✓ | ✓ | ✓ |
| `boost` | bottom-right |  | ✓ | ✓ | ✓ |
| `eta` | top-left |  | ✓ | ✓ |  |
| `fuel` | top-right | ✓ | ✓ | ✓ |  |
| `clock` | bottom-right | ✓ | ✓ | ✓ |  |
| `outsideTemp` | top | ✓ | ✓ |  |  |
| `media` | bottom | ✓ | ✓ |  |  |
| `tripSummary` | center | ✓ |  |  |  |

Pair `sport` with `shiftLight.enabled = true`.

### Custom layouts

Set `display.layout.preset` to `"custom"` and edit `display.layout.widgets` — in the settings
app's *Layout* section (it starts from the standard preset and warns about crowded zones) or by
hand:

```json
"layout": {
  "preset": "custom",
  "widgets": [
    { "id": "speed", "zone": "center", "contexts": ["stopped", "city", "highway"] },
    { "id": "speedLimit", "zone": "right", "contexts": ["stopped", "city", "highway"] },
    { "id": "nav", "zone": "top-left", "contexts": ["parked", "stopped", "city", "highway"] },
    { "id": "coolant", "zone": "bottom-left", "contexts": ["stopped", "city", "highway"] },
    { "id": "clock", "zone": "bottom-right", "contexts": ["stopped", "city"] }
  ]
}
```

Each widget may appear once, each context once per widget; a widget left out is never shown.
Keep at most two widgets per zone in any one context, and remember that most widgets only appear
when relevant, so a busy-looking list is usually a calm screen.

## Custom PIDs and TPMS

`obd.customPids` polls manufacturer-specific values — most usefully tyre pressures, which
standard OBD-II does not cover — and maps each onto one of the HUD's signals.

| Field | Notes |
| --- | --- |
| `signal` | Target signal, one of the [signal ids](obd.md#supported-pids) (e.g. `tirePressureFL`). Unique within the list. A custom PID for a standard signal replaces the standard PID. |
| `mode` | Service as 2 hex digits, e.g. `"22"` (read data by identifier) or `"21"`. |
| `pid` | PID / data identifier as 2, 4 or 6 hex digits, e.g. `"2A0B"`. |
| `header` | CAN request header (`AT SH`) of the module that holds the value, 3, 6 or 8 hex digits (e.g. `"750"`, `"7C6"`), or `null` for the default (broadcast) header. |
| `formula` | Torque-style formula over the response bytes, giving the value in the signal's canonical unit (tyres: kPa gauge). |
| `intervalMs` | Poll interval, 100–3600000. |

**Formulas**: `A`, `B`, `C` … `Z` are the data bytes after the echoed service and PID (`A` is
the first); `{A:7}` is bit 7 of `A` (0 = least significant); operators `+ - * / %` and
parentheses; functions `min`, `max`, `abs`, `round`, `floor`, `ceil`. Examples: `((A*256)+B)/10`,
`A-40`, `(A*256+B)*0.6895` (0.1 psi → kPa), `{B:0}`. Formulas are parsed by a small dedicated
parser — never evaluated as JavaScript.

**TPMS example** — the simulator's tyre-pressure module (request header `7C6`, one data
identifier per wheel, 16-bit value in 0.1 kPa). `--sim` adds exactly these:

```json
"vehicle": { "hasTpms": true },
"obd": {
  "customPids": [
    { "signal": "tirePressureFL", "mode": "22", "pid": "4001", "header": "7C6", "formula": "((A*256)+B)/10", "intervalMs": 10000 },
    { "signal": "tirePressureFR", "mode": "22", "pid": "4002", "header": "7C6", "formula": "((A*256)+B)/10", "intervalMs": 10000 },
    { "signal": "tirePressureRL", "mode": "22", "pid": "4003", "header": "7C6", "formula": "((A*256)+B)/10", "intervalMs": 10000 },
    { "signal": "tirePressureRR", "mode": "22", "pid": "4004", "header": "7C6", "formula": "((A*256)+B)/10", "intervalMs": 10000 }
  ]
}
```

For a real car, take the module header, identifiers and scaling from a PID list for your exact
model (Torque / Car Scanner PID packs and owner forums are the usual sources) and convert the
result to kPa gauge in the formula: psi × 6.895, bar × 100, and subtract the atmospheric
pressure (about 101 kPa) from absolute values. Tyre pressures change slowly, so poll every 10–30
seconds to leave the adapter's time for the fast PIDs. A PID that keeps getting no answer is
polled less and less often (back-off up to a minute).

**TPMS sensor faults.** Receivers commonly report 0 (or `FF`) for a sensor that is missing, has
a flat battery or has not woken up yet — winter wheels without sensors, or the first minutes
before driving off. So:

- a pressure outside −20…700 kPa (e.g. −101 kPa: an absolute-pressure formula on a fault 0, or
  9999 kPa) is no reading at all, like any [impossible value](architecture.md#staleness-safety);
- every tyre at 5 kPa or less at once, or a tyre that has read exactly 0 ever since the HUD
  started, raises a dismissible caution, "TPMS UNAVAILABLE" (naming the wheel), instead of a
  tyre-pressure alert, and its readout stays empty;
- a tyre that read a pressure and then loses it is a puncture: "TYRE PRESSURE CRITICAL".

A real flat tyre that reads exactly 0 from the moment the HUD starts therefore shows as
"TPMS UNAVAILABLE" for that wheel — still a tyre caution naming it, not silence.

## Command line and environment

`node packages/hud-server/src/main.ts [options]` (`npm start` runs it without options,
`npm run sim` with `--sim`):

| Flag | Environment variable | Default | Meaning |
| --- | --- | --- | --- |
| `--sim` | `CARHEADSUP_SIM=1` | off | Run against the built-in vehicle, phone, light-sensor and ADAS simulator. Forces `obd.transport = simulator`, adds the simulated tyre-pressure PIDs and `hasTpms`, without saving that to the config. |
| `--config <file>` | `CARHEADSUP_CONFIG` | `<data dir>/config.json` | Config file (created with defaults and a random pairing code if missing). |
| `--data-dir <dir>` | `CARHEADSUP_DATA_DIR` | `$XDG_DATA_HOME/carheadsup` or `~/.local/share/carheadsup`; with `--sim` its `sim` subdirectory | State, trips, the HUD's identity and TLS certificate, and (by default) the config. |
| `--port <n>` | `CARHEADSUP_PORT` | `server.port` | Override the port (`0` = any free port). Not saved. |
| `--tls-port <n\|off>` | `CARHEADSUP_TLS_PORT` | `server.tlsPort` | Override the TLS port of the phone link and of other devices' browsers (`0` = any free port, `off` = no TLS listener). Not saved. |
| `--host <addr>` | `CARHEADSUP_HOST` | `server.host` | Override the bind address. Not saved. |
| `--renderer-dir <dir>` | `CARHEADSUP_RENDERER_DIR` | `packages/hud-renderer/dist` | Built web pages to serve. |
| `--backlight <dir\|auto\|off>` | `CARHEADSUP_BACKLIGHT` | `auto` | Backlight device (e.g. `/sys/class/backlight/rpi_backlight`), `auto` = the first writable device, `off` = never touch it (the page is dimmed instead). A device that is missing or not writable at start-up is looked for again every 10 s. |
| `--allowed-hosts <names>` | `CARHEADSUP_ALLOWED_HOSTS` | none | Extra host names (comma-separated) under which browsers may reach the HUD: DNS names (letters, digits, hyphens, underscores; anything else stops the server with an error). IP addresses, `localhost`, the machine's host name and `<hostname>.local` always work; requests for any other name get `403` ([DNS-rebinding protection](architecture.md#security-model)). |
| `--log-level <level>` | `CARHEADSUP_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |
| `-h`, `--help` | | | Usage. |
| `-v`, `--version` | | | Version. |

Flags win over environment variables, which win over the defaults. `CARHEADSUP_SIM` accepts
`1/true/yes/on` and `0/false/no/off`. Exit status: 0 after a clean shutdown (`SIGINT`,
`SIGTERM`), 1 on a fatal error, 2 on invalid arguments. On the Pi the systemd unit passes
`--config`, `--data-dir` and `--renderer-dir`; set the others in `/etc/default/carheadsup`.

The kiosk launcher reads `CARHEADSUP_KIOSK_URL`, `CARHEADSUP_KIOSK_WAIT_S` (how often it logs a
warning while it waits for the page; it never starts the browser on a page that does not load),
`CARHEADSUP_KIOSK_SCALE` and `CARHEADSUP_KIOSK_FLAGS`
([install guide](install-raspberry-pi.md#the-units)); the renderer's development server reads
`HUD_SERVER` (where to proxy `/api` and `/ws`, default `http://localhost:8080`).
