# HUD UI lab: Glance, Vector, Apex

An additive, offline design comparison for `Platteration/carheadsup`. It is a bench-only
prototype, **not** a replacement for the root driving HUD. No existing source file or driving
behavior is changed.

## Open the lab

The entire lab is `packages/hud-renderer/public/ui-lab.html`: a single HTML file with inline
CSS/JavaScript and SVG readouts, no dependencies, fonts, remote assets or network requests.
A browser can open the file directly; browsers with file restrictions can use a local server:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory packages/hud-renderer/public
# Open http://127.0.0.1:8000/ui-lab.html
```

On the normal repository stack (Node >=22.18):

```sh
git fetch origin
git switch design/hud-ui-lab
npm ci
npm run build
npm run sim
# Open http://localhost:8080/ui-lab.html
```

Run the build explicitly even when `dist` already exists, so Vite copies the newly added
public file. The existing static server maps `/ui-lab.html` to the file in `dist` without a
route change. No backend is used by the lab itself. `/`, `/settings` and `/dev` remain unchanged.

## Compare the directions

| Concept | Hierarchy | Proposed role | Trade-off |
| --- | --- | --- | --- |
| Glance | Large speed, limit, one maneuver | Low-clutter option | Less trip and engine context |
| Vector | Turn/street block, stable speed area, secondary arrival info | Everyday starting point | More text than Glance |
| Apex | Linear RPM strip, central speed, inferred gear, one-line navigation | Optional sport layout | Highest information density |

The starting recommendation is Vector. Glance and Apex can be selectable modes in the same
design system, not separate apps. Do not automatically shuffle the speed position between these
layouts while driving; choose the layout while parked, then adapt visibility within that layout.

All three share the same scenes and palette. The lab includes city, highway, exit, stopped call,
critical engine-temperature alert, disconnected and parked-trip samples; 1280x480 and 800x480
shapes; mph/ft and km/h/m; Ice, Phosphor and Amber accents; dimming/night preview; X/Y reflection
tests; sample playback; focus view; reset; and design-choice JSON download. The canvas remains
black. Critical red is independent of the palette.

Preferences are validated and saved only under `carheadsup.ui-lab.v1` in browser storage. Storage
failure is nonfatal. The exported JSON explicitly identifies itself as a **design proposal**,
not a server configuration. It must not be posted to the vehicle config API.

## Honest boundaries

All readings are synthetic, and the demo label stays visible in focus view. Changing the scenario
can leave an alert scene because these are editorial controls, not an alert-dismissal API. There
is no actual call action, message content, OBD connection, live frame subscription, trip storage,
ADAS sensing, hardware brightness, keystone correction or optical calibration here. The signal-loss
scene illustrates a design; it does not exercise the production feed watchdog.

The exit scene's lane arrows are hypothetical provider-supplied samples. The current repository
README says Google Maps notifications do not supply lane guidance. Gear is labelled inferred and
is not shown as a numeric gear when unavailable. A production port must retain the core's CVT and
source-availability rules.

## Integration after choosing a direction

Port the selected hierarchy into the existing Preact renderer. Reuse `HudFrame`, existing widgets,
`useHudFeed`, `ProjectionStage`, error boundaries, and the safety overlays. Keep server-side unit
conversion, context-aware visibility, non-dismissible critical alerts, and stale-data blanking.
Do not replace these paths with the standalone demo code or connect display elements directly to
OBD. The current root HUD is deliberately untouched by this change.

Before road use, validate the actual panel and mounting: mirror axis, size and margins, daylight
legibility, night dimming, ghosting, polarized-glasses visibility and sightline. Hardware and
real-car validation remain separate from a browser preview.

## Validation

The exact HTML committed in this change was exercised locally in headless Chromium with a Python
Playwright harness loading it via `set_content` (not a running repository server):

- 126 combinations: 3 concepts x 2 shapes x 7 scenes x 3 palettes; all SVG text within bounds.
- Unit conversion, zero speed, overspeed, alert-color invariance, blank disconnected values,
  locked stopped/parked speed controls, mirroring, dimming, playback cancellation and reset.
- Focus view, demo watermark, Escape focus return and design-choice JSON download.
- No horizontal shell overflow at 320, 390, 760, 1024 or 1536 pixels; no network requests,
  WebSockets or JavaScript page errors during those checks.
- Preference restore/validation with an isolated storage fake, and denied-storage fallback.

`e2e/ui-lab.spec.ts` adds matching regression checks using the project's existing Playwright test
stack. Run them with `npm run test:e2e -- ui-lab.spec.ts`. The project-native runner, full repository
build, formatting/type checks and server route have **not** been run in the authoring environment;
source cloning was blocked by its network restrictions. The locally executed checks above are
not a claim that the whole repository or physical HUD has passed validation.
