# Development

Everything here runs on an ordinary Linux or macOS machine; no car, Pi or phone needed.

- [Setup](#setup)
- [Everyday workflow](#everyday-workflow)
- [Tests](#tests)
- [Screenshots](#screenshots)
- [Conventions](#conventions)
- [How to add a widget](#how-to-add-a-widget)
- [How to add or fix a trouble code](#how-to-add-or-fix-a-trouble-code)
- [How to add a navigation language](#how-to-add-a-navigation-language)

## Setup

- Node.js **22.18 or newer** (Node runs the TypeScript sources directly; there is no build step
  for the server packages).
- `npm install` in the repository root installs all four workspaces.
- For the Android companion: JDK 17 or newer; the Android SDK only for building the app itself
  (see [its README](../companion-android/README.md)).

## Everyday workflow

| Command | What it does |
| --- | --- |
| `npm run sim` | Builds the web pages if they are missing, then starts the server with the simulator on port 8080, and over TLS on 8443 for the phone link and other devices' browsers (data in `$XDG_DATA_HOME/carheadsup/sim`, by default `~/.local/share/carheadsup/sim`, including the simulator HUD's own certificate `tls.pem`). Extra flags go after `--`, e.g. `npm run sim -- --port 8090 --tls-port 8444 --log-level debug`. |
| `npm run dev` | Vite development server for the web pages with hot reload on <http://localhost:5173/> (`/`, `/settings`, `/dev`). It proxies `/api` and `/ws` to the HUD server at `HUD_SERVER` (default `http://localhost:8080`), so run `npm run sim` next to it. |
| `npm run build` | Production build of the web pages into `packages/hud-renderer/dist` (what the server serves). `npm run sim` does not rebuild once `dist` exists: rebuild after changing the renderer, or use `npm run dev`. |
| `npm start` | The server without the simulator (talks to a real adapter per `config.json`). |
| `npm test` | All unit and integration tests (vitest). |
| `npm run test:e2e` | Browser end-to-end tests (Playwright), see [Tests](#tests). |
| `npm run typecheck` | `tsc` for every workspace and for `e2e/`. One package: `npx tsc -p packages/<pkg>/tsconfig.json`; the browser tests: `npx tsc -p e2e/tsconfig.json`. |
| `npm run format` / `npm run format:check` | Prettier. |

### The developer console (`/dev`)

- **Live** — the real HUD view fed by the server's frame socket, at a chosen panel size (800×480,
  1024×600, 1280×480, 1920×720) and against a chosen backdrop ("behind the glass": black, night,
  dusk, day). With `--sim`, the simulator panel drives the car: the scripted scenario or manual
  throttle and brake, engine on/off, a held gear, injected trouble codes, forced coolant, voltage
  and fuel level, light level and outside temperature, tyre pressures, phone events (navigation
  start/stop, incoming and ended call, next track, message, speed camera, traffic jam, phone
  connect and disconnect) and ADAS events (blind spots, collision levels). The input pad sends the seven
  driver actions; the event log records what changed in the frames.
- **Gallery** — every sample frame rendered by the real HUD view; works without a server
  (`/dev#gallery`). Click a thumbnail to enlarge it; arrow keys step through them.

The same controls are available as the REST call `POST /api/sim`
([protocol.md](protocol.md#simulator)), which is handy for scripting a scene.

The scripted demo drive (`packages/obd/src/sim/scenario.ts`) loops about every 5 minutes:
warm-up at a standstill (20 s), city with guidance (55 s), a red light with an incoming call
(25 s), an on-ramp (20 s), highway with speed limits 120 / 100, a speed camera and then a traffic
jam reported beyond the exit, which the route takes before reaching it (90 s), the exit (20 s), arriving with a message (30 s), then standing with the engine off and the ignition
on (40 s). As it stops, the simulated phone presses the companion app's remote "next page"
button (a real `input` message), which opens the diagnostics dashboard at once while the car is
`stopped`; it stays up through the next warm-up and closes as the car drives off. (On its own the
HUD brings the dashboard up only after 3 minutes with the engine off,
`display.context.engineOffParkedAfterMs`, so that start-stop at a red light never opens it.) The
input pad's page buttons do the same at any stop.

The simulator panel shows what the server reports (`GET /api/sim`), overrides, tyre pressures,
driver-assistance warnings and the simulated phone's link included, so a reloaded console — or
a second one — shows the current state. While a real phone is connected to a `--sim` server,
the simulated phone stays silent and the panel says so. A phone (or the Android emulator, which
reaches the host as `10.0.2.2`) connects to the TLS port: scan the HUD's pairing QR code (the
settings app's *Phone → Show pairing code on the HUD*, while the simulated car is parked) or
enter `<host>:8443` and the pairing code in the companion's *Setup*. A simulator data directory
made from scratch has a random pairing code, like a new HUD. A client of your own can use `wss://…:8443/ws/phone` with the proofs of
[protocol.md](protocol.md#authentication), or plain `ws://…:8080/ws/phone` once
`server.allowPlainPhone` is on (its proofs then bind an empty fingerprint).

From another device the console runs over HTTPS on the TLS port — `https://<host>:8443/dev`;
the plain `http://<host>:8080/dev` redirects there — after the browser's warning about the
simulator HUD's self-signed certificate; the live feed then uses `wss:`. With `server.apiToken`
set, it asks for the token (or takes it once from `https://…/dev?token=<token>`) and uses it for
the API and the live feed. To reach it over plain http from other machines while developing,
switch on `server.allowPlainRemote` (settings app: *Server → Also serve other devices over plain
http*). `npm run dev`'s proxy talks to the server from the same machine, so it is unaffected.

### Sample frames

[`packages/hud-renderer/src/hud/fixtures.ts`](../packages/hud-renderer/src/hud/fixtures.ts)
holds hand-made `HudFrame`s for every mode (`city-nav`, `highway-exit-lanes`, `incoming-call`,
`check-engine`, `parked-trouble-codes`, `night-city`, `blanked` …). They feed the gallery, the
renderer tests and the screenshots, and a contract test checks them against the core types. Any
of them can be opened full screen without a server, e.g.
`http://localhost:5173/?fixture=city-nav&preview=1` (`preview=1` ignores mirroring and keystone).

### Replaying drives

The core is pure, so a whole drive is a list of events. The `Harness` in
[`packages/core/test/state/fixtures.ts`](../packages/core/test/state/fixtures.ts) wraps
`createInitialState`, `reduce`, `deriveEffects` and `composeFrame`: feed it events with
timestamps and inspect the state, the effects and the frames. Timestamps are engine time, which
is also the wall-clock time until a `clock/sync` event says otherwise — send one to replay a
system clock that steps mid-drive
([why](architecture.md#engine-time-and-the-wall-clock)).
[`test/scenarios/drive.test.ts`](../packages/core/test/scenarios/drive.test.ts) is the example
to copy.

## Tests

```sh
npm test                                   # everything
npx vitest run packages/core               # one package
npx vitest run packages/obd/test/e2e.test.ts
npm run test:watch                         # watch mode
```

Tests live in `packages/<pkg>/test/**/*.test.ts(x)`. Files named `*.dom.test.tsx` render Preact
into happy-dom. What covers what:

- **core** — reducer, composer, alerts, contexts, brightness, sun position, fuel and gear
  estimation, trips, maintenance, config parsing, protocol validation, the pairing URI and the
  pairing page, the DTC database, and the replayed drives in `test/scenarios`.
- **obd** — the driver against scripted transports, the poller, the service's reconnect loop,
  and end-to-end tests (`e2e.test.ts`) of the real driver and poller against the ELM327 emulator
  and vehicle simulator — as a CAN car, a K-line (ISO 9141-2) car (`bus: 'iso9141'`) and a clone
  without ISO-TP flow control (`multiFrame: false`), the timing-sensitive ones on a fake clock.
- **hud-server** — the REST API, auth, static files, both WebSockets, stores, sensors (with fake
  I²C buses, fake `gpiomon` and real UDP sockets on port 0), the engine; `smoke.test.ts` runs
  the complete server with the real simulation and sockets, and `main.test.ts` spawns the CLI.
  The time zone → location table (`src/sensors/zone-locations.ts`) is generated from the tz
  database: `node packages/hud-server/src/tools/generate-zone-locations.ts [/usr/share/zoneinfo]`
  rewrites it, and a test compares it with the machine's `zone1970.tab` and `zone.tab`.
- **hud-renderer browser checks** — `test/hud/browser/*.browser.test.ts` render frames in headless
  Chromium (same lookup as the end-to-end tests below; skipped without one): alerts never
  clipped, and daylight readability (the outline of over-limit digits, the blink depth).
- **hud-renderer** — widgets, overlays, projection maths, the feed's staleness handling, the
  settings app against an in-memory mock server, the developer console.
- **companion-android** — `cd companion-android && ./gradlew :protocol:test` (JDK only). Its
  `ContractSyncTest` reads the TypeScript contract and fails when message types, enum values, the
  protocol version, the size limits or the authentication and pairing vectors drift: run it
  after changing anything in `packages/core/src/types` or `packages/core/src/protocol`. The QR
  code the renderer draws for the pairing page is kept in
  `companion-android/protocol/src/test/resources/pairing/hud-qr.txt` (a renderer test fails when
  its drawing changes; regenerate the file from `qrModules(PAIRING_URI_SAMPLE)`), and
  `QrDecoderTest` decodes it with ZXing.

Tests use temporary directories and port 0, and leave no processes behind.

**Browser end-to-end tests** live in [`e2e/`](../e2e) (Playwright, not part of `npm test`): the
kiosk page, the settings app and the developer console against a real server running the
simulator on a free port, with the renderer built into a temporary directory first — including
pairing: the settings app shows the pairing code on the parked HUD, and the QR code in a
screenshot of the (mirrored) kiosk decodes to the HUD's id, certificate, token and addresses.

```sh
npm run test:e2e                    # = npx playwright test -c e2e/playwright.config.ts
```

They need a Chromium binary: the first that exists of `$PW_CHROMIUM`,
`/opt/pw-browsers/chromium` and Playwright's own (`npx playwright install chromium`); without
one they skip themselves. `npm run typecheck` checks `e2e/` too.

The deployment kit has its own checks, which need no root and change nothing:
`deploy/check.sh` runs `bash -n` (and `shellcheck` when installed) on the scripts, the behaviour
tests in `deploy/test/` (the kiosk launcher against stub `curl` and `chromium` commands, the
installer's port detection), `systemd-analyze verify` on the units and `xmllint` on the Avahi
file.

## Screenshots

The images in `docs/screenshots/` are generated by scripts (not tests) that drive headless
Chromium with Playwright. If Playwright's own browser is not installed, point `PW_CHROMIUM` at a
Chromium binary.

```sh
node packages/hud-renderer/test/hud/capture-screenshots.ts                 # the sample frames
node packages/hud-renderer/test/hud/capture-screenshots.ts city-nav roundabout
node packages/hud-renderer/test/dev/capture-screenshot.ts                  # developer console
node packages/hud-renderer/test/settings/capture-screenshot.ts             # settings app, phone size
node e2e/capture-live-screenshots.ts                                       # live-*.png, ~5 min
```

The first three start the renderer's Vite server and show sample frames (or an in-memory mock
HUD). The last one captures the real system: it builds the renderer, starts the server with the
simulator and follows the demo drive in real time, saving `live-*.png` at its interesting moments
(city with guidance, the incoming call, the highway camera, the parked dashboard, plus the
developer console and the settings app); it takes about five minutes.

The HUD script renders sample frames at 800×480 and 1280×480 and fails when a widget is clipped by
its zone (a widget dropped whole for lack of room is only reported — that is the intended
priority behaviour). The other two accept options (`--tab=live --mock`, `--section=projection`,
`--full` …); see the comment at the top of each script.

## Conventions

[CLAUDE.md](../CLAUDE.md) is the rulebook. In short:

- **TypeScript that Node can run directly**: only erasable syntax (no `enum`, `namespace` or
  constructor parameter properties), `.ts` extensions in relative imports, `import type` for
  types, strict mode with `noUncheckedIndexedAccess`, no `any`.
- **`packages/core` is pure**: no clock, timers, randomness, I/O or `console`; time comes from
  events (monotonic engine time; the wall clock only as the `clock/sync` offset). Same input,
  same output.
- **Canonical units inside**, conversion only in `composeFrame`.
- **Never show stale data as live**: read signals through `freshValue()` / the selectors.
- **Driver distraction**: no message content, short text while moving, detail only when
  stopped or parked, critical alerts not dismissible, light on black with no large bright areas.
- The contract (`packages/core/src/types`) is shared by the server, the renderer and the
  Android app; change it deliberately and in all three.

## How to add a widget

Say, an oil-temperature widget `oilTemp`.

1. **Contract** — add `'oilTemp'` to `WidgetId` in `core/src/types/config.ts` and to
   `WIDGET_IDS` in `core/src/config/schema.ts` (a compile-time check fails until both agree);
   add an `OilTempWidget` interface to `core/src/types/frame.ts` and to the `WidgetFrame` union.
2. **Composer** — write a builder in `core/src/compose/widgets.ts` and register it in
   `BUILDERS`. Return `null` whenever the widget is irrelevant or its data is not fresh (use
   `freshSignal`), convert to display units there, and round.
3. **Layouts** — place it in the presets in `core/src/config/config.ts` if it belongs there
   (the preset tests enforce, among other things, at most two widgets per zone and context), and
   give it a label in `hud-renderer/src/settings/model/layout.ts` (`WIDGET_LABELS`) for the
   layout editor.
4. **Renderer** — a component in `hud-renderer/src/hud/widgets/`, registered in
   `widgets/index.tsx` (the `switch` is exhaustive, so the build tells you), styles in
   `widgets.css`. Size everything relative to the zone (container units), light on black.
5. **Fixtures and tests** — add it to a sample frame in `hud/fixtures.ts`, then tests for the
   builder (`core/test/compose/widgets.test.ts`) and the component
   (`hud-renderer/test/hud/widgets.test.tsx`); look at the result in the gallery.

## How to add or fix a trouble code

The database is split by range: `core/src/obd/dtc-db-p0.ts` (P0xxx), `dtc-db-p2.ts` (P2xxx and
P34xx–P3Fxx) and `dtc-db-network.ts` (U0xxx, U3xxx). An entry:

```ts
P0420: {
  description: 'Catalyst System Efficiency Below Threshold (Bank 1)',
  short: 'Catalytic converter efficiency',
  severity: 'caution',
},
```

- `description` follows the SAE J2012 generic wording. Add a code only when you can verify the
  text against independent sources — a code that is missing still gets a sensible range
  description, a wrong one misleads the driver.
- `short` is what the driver reads: at most 32 characters, plain words, no code prefix, following
  the style notes at the top of each module (bank markers, "signal low/high" …).
- `severity` follows the rubric in `dtc-ranges.ts` (critical / warning / caution / info).
- Manufacturer-specific codes (P1xxx, B1xxx …) do not belong here; they are described by range.

The tests in `packages/core/test/obd/` check key format, label length and severity values, and
pin the descriptions of well-known codes.

## How to add a navigation language

Google Maps' notification text is parsed on the phone, in the companion's `:protocol` module
([`nav/NavLanguages.kt`](../companion-android/protocol/src/main/kotlin/dev/carheadsup/protocol/nav/NavLanguages.kt)).
All language knowledge is data: one `NavLanguage` per language with the maneuver keywords
(turn, keep, exit, roundabout …, each mapped to a `ManeuverKind`), the patterns that extract the
street, the words for "then", distance units and ETA formats.

1. Capture real notifications from Maps in that language, for as many maneuver kinds as you can:
   on a phone set to that language, switch on *Setup → Debugging → Capture navigation
   notifications* in the companion, drive (or simulate a route in Maps) with guidance on, then
   *Export*. The file lands in *Downloads* (`carheadsup-nav-<time>.json`); it keeps the last 200
   notifications that differ in more than their numbers, Google Maps' only. It shows the streets
   and destination of the drive: delete what you do not want to share, and *Delete* the capture
   on the phone afterwards. (Without the app: `adb shell dumpsys notification --noredact` prints
   the same fields — `android.title`, `android.text`, `android.subText`, `android.bigText`.)
2. Each case in the file holds the notification, the phone's language, time zone and driving
   side, and in `expected` what the parser made of it — `null` for nothing. Correct `expected` to
   what Maps showed (the maneuver, the distance in metres, the street, the ETA as epoch ms) and
   give each case a `name`; drop duplicates.
3. Add a `NavLanguage` (copy `GERMAN` as a template) and list it in `NavLanguages.ALL`.
4. Put the file into `companion-android/protocol/src/test/resources/nav/` (e.g.
   `google-maps-fr.json`): `NavFixtureTest` replays every case there through the parser as the
   app runs it. Run `./gradlew :protocol:test`. Finer points (a single word, a tricky ETA) can
   still go into `GoogleMapsNotificationParserTest`.

Instructions the parser does not understand still yield the distance, the ETA and Maps' own
arrow icon, so a partial language is already useful. The companion's *Status* screen counts the
updates it understood, showed with Maps' arrow, and did not understand, and a notification it
does not understand is logged (`adb logcat -s NavNotificationListener`) with the phone's
language and the lengths of its texts — never the texts.
