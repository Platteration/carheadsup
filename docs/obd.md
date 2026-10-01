# OBD-II

How carheadsup talks to the car: the adapter and its protocols, which values it reads and how
often, how trouble codes are decoded and cleared, and how to add manufacturer-specific values.
The code is in [`packages/obd`](../packages/obd) (driver, poller, service, emulator) and
[`packages/core/src/obd`](../packages/core/src/obd) (PID decoders, formulas, trouble-code
database).

- [Connection](#connection)
- [Supported PIDs](#supported-pids)
- [Polling](#polling)
- [Adapters and protocols](#adapters-and-protocols)
- [Trouble codes](#trouble-codes)
- [Clearing trouble codes](#clearing-trouble-codes)
- [Custom PIDs](#custom-pids)
- [Troubleshooting](#troubleshooting)

## Connection

`ObdService` owns the link and runs a loop: open the transport → initialise the adapter →
discover the supported PIDs → poll until something fails → report the error, close, wait,
reconnect. The link state (`connecting` → `initializing` → `connected`, or `error` with a
readable reason) is shown in the settings app, on the dashboard and by `GET /api/info`. The wait
before reconnecting starts at `obd.reconnectDelayMs` (3 s) and doubles after each consecutive
failure, up to 30 s.

**Waiting for the ignition.** When the adapter answers but the vehicle does not — the HUD came up
on accessory power before the ignition, or restarted while it was off — the link is not closed:
the state shows `error` ("is the ignition on?") and the vehicle is tried again every 3 s with
`0100` alone, without resetting the adapter and without a growing delay, so data flows within
seconds of the engine control unit waking up. The protocol the vehicle spoke last time is
remembered per adapter link in `<data dir>/obd-cache.json`; with automatic search
(`obd.protocol` `0`) the search starts with it (`AT SP A<n>`), and while the vehicle is silent
it is tried alone with `AT TP <n>` (not stored in the adapter), which answers at once instead of
searching every protocol for several seconds — every fifth try is a full search, in case the
adapter now sits in another car. Measured against the emulator with a slow clone's timings
(`ATZ` 1 s, a failing search 10 s): speed arrives 0.5–1.3 s after the ECU wakes up with the
protocol remembered, 3–9 s on the very first start (it used to be 6.6–30 s).

**Reconnecting** to the same vehicle within one run of the server (the same `0100` answer) reuses
the PIDs discovered before and does not read the VIN again: after a Bluetooth drop mid-drive
data comes back without the walk through the supported-PID bitmaps (1.5 s on a K-line car).

A request whose answer begins with `SEARCHING...` or `BUS INIT: ...` — the adapter looking for
the protocol, or initialising a K-line bus that went to sleep (the 5-baud init alone takes over
2 s) — gets the search timeout instead of `obd.timeoutMs`, so it is not mistaken for a lost
answer.

Transports (`obd.transport`):

- **`serial`** — a serial device: `/dev/rfcomm0` for a Bluetooth adapter bound with `rfcomm`
  ([install guide](install-raspberry-pi.md#6-pair-the-obd-ii-adapter)), `/dev/ttyUSB0` or better
  `/dev/serial/by-id/…` for USB. `obd.baudRate` matters only for USB.
- **`tcp`** — Wi-Fi adapters, typically `192.168.0.10:35000`.
- **`simulator`** — an ELM327 emulator in front of a vehicle simulator, used by `--sim` and the
  tests. It answers like a real CAN car (including multi-frame answers, several ECUs, trouble
  codes, a VIN and a tyre-pressure module) and can inject faults. The tests also run it as an
  ISO 9141-2 K-line car (one PID per request, 200 ms round trips, a 2.5 s bus initialisation,
  multi-line answers) and as a clone that prints only the first frame of long answers.

Initialisation: `ATZ` (reset), `ATE0` (no echo), `ATL0`, `ATS0` (no spaces), `ATH1` (headers on,
so answers from several ECUs can be told apart), `ATSP<obd.protocol>`, `ATAT1` (adaptive
timing), identification (`ATI`, `AT@1`, and `STI` on STN-based adapters), then `0100` — during
which the adapter may search all protocols for up to 20 s — `ATDPN`/`ATDP` for the negotiated
protocol, and `ATRV` to see whether the adapter can measure the battery voltage. Commands are
strictly one at a time; after a timeout the driver resynchronises with the adapter before the
next command, and gives the session up if that fails.

## Supported PIDs

Service 01 PIDs the HUD decodes, the signal each fills (canonical units), its polling tier and
how long a value stays valid ([staleness](architecture.md#staleness-safety)). Only PIDs the car
reports as supported are polled.

| PID | Name | Signal | Unit | Tier | Stale after |
| --- | --- | --- | --- | --- | --- |
| `04` | Calculated engine load | `engineLoad` | % | medium | 3 s |
| `05` | Engine coolant temperature | `coolantTemp` | °C | medium | 10 s |
| `06` | Short term fuel trim — bank 1 | `shortFuelTrimB1` | % | slow | 10 s |
| `07` | Long term fuel trim — bank 1 | `longFuelTrimB1` | % | slow | 10 s |
| `08` | Short term fuel trim — bank 2 | `shortFuelTrimB2` | % | slow | 10 s |
| `09` | Long term fuel trim — bank 2 | `longFuelTrimB2` | % | slow | 10 s |
| `0A` | Fuel pressure (gauge) | `fuelPressure` | kPa | slow | 10 s |
| `0B` | Intake manifold absolute pressure | `map` | kPa | fast (medium with MAF) | 3 s |
| `0C` | Engine speed | `rpm` | rpm | fast | 2 s |
| `0D` | Vehicle speed | `speed` | km/h | fast | 2 s |
| `0E` | Timing advance | `timingAdvance` | ° | medium | 10 s |
| `0F` | Intake air temperature | `intakeAirTemp` | °C | medium | 10 s |
| `10` | Mass air flow rate | `maf` | g/s | fast | 3 s |
| `11` | Throttle position | `throttle` | % | fast | 2 s |
| `1F` | Run time since engine start | `runTime` | s | slow | 10 s |
| `21` | Distance travelled with MIL on | `distanceWithMil` | km | slow | 10 s |
| `23` | Fuel rail gauge pressure | `fuelRailPressure` | kPa | slow | 10 s |
| `2F` | Fuel tank level input | `fuelLevel` | % | very slow | 120 s |
| `31` | Distance since codes cleared | `distanceSinceClear` | km | slow | 10 s |
| `33` | Absolute barometric pressure | `baroPressure` | kPa | slow | 10 s |
| `3C` | Catalyst temperature — bank 1 sensor 1 | `catalystTempB1S1` | °C | slow | 10 s |
| `42` | Control module voltage | `controlModuleVoltage` | V | slow | 15 s |
| `43` | Absolute load value | `absoluteLoad` | % | medium | 10 s |
| `44` | Commanded air-fuel equivalence ratio | `commandedLambda` | λ | medium | 10 s |
| `45` | Relative throttle position | `relativeThrottle` | % | medium | 2 s |
| `46` | Ambient air temperature | `ambientTemp` | °C | very slow | 120 s |
| `49` | Accelerator pedal position D | `acceleratorPedal` | % | fast | 2 s |
| `52` | Ethanol fuel percentage | `ethanolPercent` | % | slow | 10 s |
| `5C` | Engine oil temperature | `oilTemp` | °C | slow | 10 s |
| `5E` | Engine fuel rate | `fuelRate` | L/h | fast | 3 s |
| `A4` | Transmission actual gear | `transmissionGear` | gear | medium | 3 s |
| `A6` | Odometer | `odometer` | km | very slow | 120 s |

Besides service 01:

| Source | Signal / data | How often |
| --- | --- | --- |
| `ATRV` (the adapter's own voltmeter on OBD pin 16) | `batteryVoltage` (V) | every 2 s |
| `0101` + services `03`, `07`, `0A` | MIL state; stored, pending and permanent trouble codes | on connect, then every `obd.dtcIntervalMs` (30 s) |
| `0902` | VIN | once per connection (3 attempts, a minute apart) |
| [custom PIDs](#custom-pids) | any signal, e.g. `tirePressureFL` … `tirePressureRR` (kPa gauge) | per PID |

What the values are used for: speed and rpm drive the speed readout, tachometer, shift light,
gear inference, driving context, odometer and trips; fuel rate, or MAF with lambda and ethanol,
or MAP with intake temperature and rpm (speed-density), give the fuel flow for economy, range
and trip fuel; coolant, voltage, fuel level, ambient temperature and tyre pressures feed the
alerts; everything appears on the parked diagnostics dashboard.

## Polling

A polling cycle starts at most every 100 ms. Each cycle requests:

- the **fast** PIDs — speed, rpm, throttle, accelerator pedal, fuel rate, and MAF (or MAP when
  the car has no MAF) — every cycle;
- up to **two more requests** for due **medium** (~1 s), **slow** (~5 s) and **very slow**
  (~10 s) PIDs, most overdue first, so a burst never delays the fast PIDs and nothing starves;
- due **custom PIDs** at their own intervals, the **battery voltage** every 2 s, trouble codes
  and the VIN as above.

On CAN a service 01 request carries up to six PIDs, so the fast tier is usually a single round
trip; legacy protocols (J1850, ISO 9141, KWP2000) carry one PID per request and are much slower.
The values of each request are published as soon as it completes, stamped with that moment (a
slow request later in the cycle must not make earlier values look fresher than they are).

**Adapters that fail multi-PID requests.** Six PIDs need an answer longer than one CAN frame,
and clones without working ISO-TP flow control cannot receive those (they print the first frame
only). The poller checks this right after discovery: if the fast batch fails twice but speed and
rpm together (a one-frame answer) work, requests are kept to answers that fit one frame (up to
three PIDs); if even that fails, it polls one PID per request. While polling, a PID that keeps
failing in multi-PID requests (three in a row, or answers with frames missing) while a request
for it alone works makes requests smaller again — 6 → 3 → 2 → 1 PIDs — once the same multi-PID
request has failed one more time (a link that merely stalled for a few seconds works again by
then, and keeps its batching). A few ECUs simply ignore
multi-PID requests and answer only the first PID; that also falls back to one PID per request.
Each step is logged as a warning and shown on the link ("Polling up to 3 PIDs per request (long
answers fail)").

**One PID per request** (legacy buses, or after falling back): a K-line round trip takes
150–250 ms, so the fast tier keeps only speed, rpm and the PID the fuel flow comes from (fuel
rate, else MAF, else MAP); throttle and pedal — only hints for gear learning while moving — join
the medium tier. Coolant is read before the other medium PIDs once its reading is 3 s old (the
overheating alert needs it fresh). Trouble codes (four requests) and the VIN are read in a cycle
of their own with only speed and rpm, and are put off while the car moves — read at the next
stop, or after 5 minutes at the latest; reading them after clearing codes is never put off. At
250 ms per request a typical 2000s K-line car then gets speed every 1.3 s and never older than
1.5 s (it used to go stale for half a second at every trouble-code read), and coolant every
4–6 s.

How many cycles per second you get depends on the car's response time and the adapter: STN-based
adapters (OBDLink) and genuine ELM327s answer quickly, many clones slowly. The developer console
and the log show what arrives.

Resilience:

- A PID that answers `NO DATA` three times in a row while others answer is backed off
  exponentially (up to a minute) instead of costing time every cycle.
- When nothing answers for three cycles — ignition off — the poller stops asking for data and
  sends one probe every 2 s, reporting "No response from the vehicle (ignition off?)" on the
  link. The HUD parks; polling resumes as soon as the car answers.
- Eight consecutive failed requests (errors, not `NO DATA`) end the session and reconnect.
- When a trouble-code read fails — a clone that cannot receive a long service 03 answer (three or
  more codes), a control unit that keeps answering "busy" — the MIL state is read on its own
  (`0101`, one frame). A lit lamp then raises *CHECK ENGINE – Lamp on – no code read* (a warning)
  while the codes already known are kept.

## Adapters and protocols

The driver works with genuine ELM327s, STN11xx/STN2xxx adapters (OBDLink) and the PIC-based
clones. Recommendations and wiring are in [hardware.md](hardware.md#obd-ii-adapter). Bluetooth LE
adapters are not supported.

`obd.protocol` is the ELM327 `AT SP` value:

| Value | Protocol |
| --- | --- |
| `0` | Automatic search (default) |
| `1` | SAE J1850 PWM (older Ford) |
| `2` | SAE J1850 VPW (older GM) |
| `3` | ISO 9141-2 |
| `4` | ISO 14230-4 KWP2000, 5-baud init |
| `5` | ISO 14230-4 KWP2000, fast init |
| `6` | ISO 15765-4 CAN, 11-bit, 500 kbit/s — most cars since about 2008 |
| `7` | ISO 15765-4 CAN, 29-bit, 500 kbit/s |
| `8` | ISO 15765-4 CAN, 11-bit, 250 kbit/s |
| `9` | ISO 15765-4 CAN, 29-bit, 250 kbit/s |
| `A` | SAE J1939 (heavy vehicles) |
| `B`, `C` | User-defined CAN (11-bit 125 / 50 kbit/s) |
| `A1` … `AC` | Try that protocol first, then search |

Automatic search can take several seconds on the first connect; fixing the protocol (`6` for
most modern cars) makes connecting faster. The negotiated protocol is shown as "ISO 15765-4 (CAN
11/500)" and similar. Clones that report their protocol wrongly are handled by looking at the
shape of the first answer.

## Trouble codes

**Reading.** On connect and every `obd.dtcIntervalMs` the HUD reads the MIL (check-engine lamp)
state and three lists: **stored** (confirmed, service 03), **pending** (seen once, not yet
confirmed, service 07) and **permanent** (service 0A, on 2010+ cars; codes the ECU only erases
itself once the fault is verified as repaired). Codes are decoded from their two bytes following
SAE J2012 (`04 20` → `P0420`).

**Decoding.** `lookupDtc(code)` (`core/src/obd/dtc-lookup.ts`, exported as
`@carheadsup/core/dtc`) returns an official-style description, a short label of at most 32
characters for the HUD, a severity and flags. The HUD shows
`P0420 – Catalytic converter efficiency`; the settings app and the parked dashboard also show the
full text, "Catalyst System Efficiency Below Threshold (Bank 1)".

The built-in database holds **4,101 generic codes**:

| Range | Codes | Module |
| --- | --- | --- |
| P0000–P0FFF | 1,346 | `dtc-db-p0.ts` — every defined P0001–P0999, the hybrid block P0A00–P0AFF and common later additions |
| P2000–P2FFF | 1,937 | `dtc-db-p2.ts` — including diesel aftertreatment, throttle and pedal sensors, turbo, transmission |
| P3400–P3FFF | 118 | `dtc-db-p2.ts` — cylinder deactivation and others |
| U0000–U0FFF | 676 | `dtc-db-network.ts` — bus faults, lost communication, software incompatibility, invalid data |
| U3000–U3FFF | 24 | `dtc-db-network.ts` — module supply, ground and ignition inputs |

Codes are included only where the wording could be verified against independent sources. Codes
that are not in the database are still described from their range — "Manufacturer-specific
powertrain code (P1xxx range)", short label "Maker-specific engine fault" — and marked as unknown
or manufacturer-specific. Manufacturer ranges are P1xxx, P30xx–P33xx, B1xxx/B2xxx, C1xxx/C2xxx
and U1xxx/U2xxx. Generic body (B0xxx) and chassis (C0xxx) codes are deliberately left to the
range description: manufacturers use the same numbers with different meanings.

**Severity** follows one rubric: *critical* — driving on risks immediate engine damage or is
unsafe (e.g. overheating, oil pressure); *warning* — drivability, limp mode or damage if ignored
(misfires, transmission, lost communication with the engine computer); *caution* — emissions or
economy (catalyst efficiency, EVAP leaks); *info* — minor. A code that is only **pending** is
shown as *info* until the ECU confirms it. While driving, check-engine alerts below *warning* are
held back until the car stops (unless `alerts.showDtcWhileDriving`). See
[architecture.md](architecture.md#alerts).

## Clearing trouble codes

The settings app (*Diagnostics → Clear codes*) and `POST /api/diagnostics/clear-dtcs` send OBD
service 04. Rules:

- **Only when parked with the engine off** (ignition on). The server checks the driving context
  and the engine state; the OBD service checks again that the latest speed and rpm (at most 5 s
  old) are zero. Otherwise the request is refused with a reason (HTTP 409). Many ECUs refuse
  service 04 with the engine running anyway.
- One clear at a time; the codes are read again right afterwards.
- The settings app asks for confirmation and explains the consequences.

What clearing does: it turns the check-engine lamp off and erases the stored and pending codes
and the freeze-frame data — and it **resets the emissions readiness monitors**. The car then
needs a complete drive cycle (often days of mixed driving) before it passes an emissions or
roadworthiness inspection again; clearing codes shortly before an inspection is pointless and
may count as tampering where you live. Permanent codes are not cleared by service 04. A fault
that has not been repaired comes back. Write the codes down (or look at the trouble-codes page)
before clearing them.

## Custom PIDs

`obd.customPids` reads manufacturer-specific values — tyre pressures, oil temperature on cars
that do not report PID `5C`, DPF load, battery state of charge … — and maps each onto a HUD
signal. The configuration format, the formula syntax and a TPMS example are in
[configuration.md](configuration.md#custom-pids-and-tpms).

How they are polled: the request is `<mode><pid>` (e.g. `22 4001`); with a `header` the driver
sets it with `AT SH` (and a receive filter), sends the request and restores the default header
afterwards — atomically, so no other request can slip in between. The formula is applied to the
data bytes of the first positive answer. A negative answer (the module exists but refuses) or an
unusable result yields no value; a PID that keeps failing is backed off like a standard one; an
invalid PID definition is disabled with a log message. A custom PID for a signal that a standard
PID also provides replaces the standard one.

Only signals the HUD knows can be targets — the `signal` must be one of the ids in the table
above, `batteryVoltage`, or the four `tirePressure*` signals.

## Troubleshooting

| Log message / symptom | Meaning |
| --- | --- |
| `The adapter did not respond to ATZ (check power and pairing)` | Nothing answers on the serial port: adapter unpowered, not paired, `/dev/rfcomm0` bound to the wrong MAC, or someone else connected to it. |
| `No response from the vehicle (ignition off?)` | The adapter answers but the car does not: ignition off, or the wrong protocol fixed in `obd.protocol`. |
| `The adapter is connected but the vehicle did not answer — is the ignition on?` | Shown while the HUD waits for the ignition; it keeps trying every 3 s and connects on its own. If it never does with the ignition on, fix `obd.protocol` or delete `obd-cache.json` from the data directory. |
| `… polling one PID per request` / `… polling up to 3 PIDs per request` | The ECU ignores multi-PID requests, or the adapter cannot receive answers longer than one CAN frame (a clone without flow control). Harmless; updates are a little slower. |
| *CHECK ENGINE – Lamp on – no code read* | The check-engine lamp is on but no confirmed code could be read: the adapter cannot receive the long trouble-code answer, a control unit keeps refusing, or the fault is in a module the generic services do not report. Read the codes with another tool. |
| Connects, then drops every few seconds | Weak Bluetooth link (move the Pi closer, avoid metal between), or a clone that cannot keep up — raise `obd.timeoutMs`. |
| Values missing on the dashboard | The car does not support those PIDs; `GET /api/diagnostics` lists `supported`. |
| No fuel economy | The car reports neither fuel rate, MAF nor MAP; diesels need the fuel-rate PID. |
| Battery voltage missing | Some clones do not implement `ATRV`; the ECU's PID `42` is used instead when the car has it. |

To talk to the adapter by hand, stop the HUD (`sudo systemctl stop carheadsup`) and use a
terminal program such as picocom (`sudo apt install picocom`):
`picocom -b 38400 --omap crlf /dev/rfcomm0`, then type `ATZ`, `ATSP0`, `0100`, `010C`.
