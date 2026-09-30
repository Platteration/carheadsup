# Safety and legal notes

A head-up display exists to keep your eyes on the road. A badly designed or badly installed one
does the opposite. This page describes what carheadsup does to limit distraction, what it cannot
do, and the legal questions you have to answer for your own car and country.

## How the HUD limits distraction

**Glanceable content.** The speed is the largest element, in the centre, where the eye rests.
Everything else is short: alert titles have at most 24 characters, trouble-code labels at most
32, hazard labels at most 24. The navigation app's full instruction text is withheld while the
car moves. Hazards are labelled by the HUD itself ("Speed camera", "Accident" …); the phone's
description of a hazard of type `other` becomes its label, cut to 24 characters, only while the
car is stopped or parked — while it moves the label is just "Hazard". The image is light on black — black is transparent on
the glass — without large bright areas, dims with the ambient light and switches to a night
palette. While the HUD page is not loaded (the server starting or down), the kiosk keeps the
screen black instead of showing the browser's error page.

**Adaptive clutter.** What is shown depends on the driving context
([details](architecture.md#driving-contexts-and-adaptive-clutter)): the highway view shows the
least; navigation appears on the highway only within 2 km of the next maneuver, lane arrows
within 800 m, hazards within 1 km (traffic jams and other traffic hazards on the highway within
3 km, where the end of a queue needs the earlier warning); health readouts (coolant, voltage, tyres) appear only when
something is wrong. The detailed diagnostics dashboard appears only when parked, never while the
car is known to be moving, and a brief OBD dropout at speed does not bring it up (the moving
context is held for 30 s).

**No message content, ever.** For a message the HUD shows who sent it and nothing else. The phone
protocol has no field for the text, and the HUD rejects any message that tries to carry one
(`body`, `text`, `preview` …). The phone reads the message aloud instead, and never over a call.
The sender toast can be switched off (`phone.showMessageSender`).

**Alert discipline.**

- Four severities: info, caution, warning, critical. At most two banners at a time
  (`display.maxAlerts`), most severe first — except that every critical alert gets its banner.
- While moving, service reminders, the OBD-link notice and minor check-engine codes wait until
  you stop.
- Faults must persist before they are raised (a charging fault for a minute, other voltage
  faults for 10 s), and threshold alerts clear with hysteresis, so a sensor hovering at a limit
  does not flash on and off.
- Critical alerts ("OVERHEATING – STOP", "BRAKE!") cannot be dismissed and break through even when
  you have blanked the HUD; a dismissed alert returns if it gets worse.

**Staleness blanking.** A frozen value is worse than none. Every value expires (speed and rpm after
2 s without an update), and a widget without fresh data disappears. If the HUD page stops
receiving frames for one second it blanks everything but a small "no signal" dot. Blind-spot and
collision warnings expire after one second.

**Hands-free control.** Calls are accepted or declined with a swipe or a button; nothing needs to be
touched on the phone. The HUD itself has no touch interaction. Change settings only when parked.

**Safe actions only when safe.** Clearing trouble codes is refused unless the car is parked with
the engine off.

## What it is not

- **Not a safety system.** The blind-spot and collision warnings only show what an external
  module reports; the HUD detects nothing. Never rely on it instead of mirrors and your own eyes.
- **Speed limits and cameras may be wrong or missing.** They come from OpenStreetMap via the phone,
  and only while the phone is connected. Road signs always take precedence.
- **Traffic information may be late, wrong or missing.** Jams, accidents and closures come from
  TomTom via the phone, only if the driver turned that on with an own API key, and only while the
  phone has mobile data; the phone asks every couple of minutes, so a fresh accident can be
  missing. The phone does not know the route: it reports incidents ahead in the direction of
  travel, including on a road the route is about to leave, and misses those round a sharp turn.
- **The displayed speed is the car's OBD speed**, which can differ from the speedometer (cars'
  speedometers usually read a little high).
- **Navigation depends on Google Maps' notification**, which can change without notice.
- The engine and battery alerts depend on what the car reports and on thresholds you configure.
  They do not replace the car's own warning lamps.

## Legal notes

This is not legal advice. Laws differ between countries, states and over time; check the rules
that apply to you before installing or using the HUD.

- **Placement and the windshield.** Many places restrict objects in the windshield area and in the
  driver's field of view, and films or stickers on the windshield (often with a specific zone
  that must stay clear). A reflective film or combiner glass may need to be positioned — or may
  not be allowed at all — accordingly. Never mount anything on or over an airbag, and make sure
  nothing can come loose in a crash.
- **Screens in view of the driver.** Some jurisdictions allow only certain content (navigation,
  vehicle information) on displays visible to the driver while driving. carheadsup shows only
  driving-related information and no video.
- **Speed-camera warnings.** Using devices or apps that warn of speed cameras while driving is
  **illegal in some countries — for example Germany and Switzerland** — and restricted in others
  (France, for example, only permits generic "danger zone" warnings). The companion app sends
  cameras from OpenStreetMap only after the driver turns on *Setup → Speed camera warnings* — do
  that only where it is legal. (An install that saved its settings before this default changed
  may still have them on; check the switch.) To remove every hazard from the HUD regardless of
  the phone, use a custom
  layout without the `hazard` widget ([configuration](configuration.md#custom-layouts)). Radar
  detectors are a separate matter; carheadsup is not one.
- **Phones.** Laws on handling a phone while driving apply unchanged. Set up the companion before
  you drive.
- **Clearing trouble codes before an inspection** resets the readiness monitors; an emissions or
  roadworthiness test can then fail or flag the car until a full drive cycle has completed, and
  clearing codes to hide a fault can count as tampering. Repair the fault instead
  ([obd.md](obd.md#clearing-trouble-codes)).
- **Modifications.** Wiring into the car's electrical system, and leaving an adapter in the OBD
  port, are your responsibility; they may affect warranty or insurance, and a permanently powered
  device can drain the battery ([hardware.md](hardware.md#power)).
- **Privacy.** Trips, positions derived from them and the configuration stay on the HUD and the
  phone. The phone contacts OpenStreetMap's Overpass service with the area around the car to look
  up speed limits and cameras, and — only if the driver turns traffic on — TomTom with the area
  around and ahead of the car and the driver's API key, which tells TomTom where the car is
  driving; nothing else leaves the car.

## Disclaimer

carheadsup is a do-it-yourself project provided as is, without warranty of any kind. It is not
an approved automotive product and has not been tested on every vehicle. You install and use it
at your own risk; the authors accept no liability for damage, injury, fines or other
consequences arising from its use. You remain responsible for driving safely and lawfully.
