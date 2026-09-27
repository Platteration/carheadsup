# Apex HUD: minimal layout and directional warning glows

Apex is an opt-in layout in the real Preact renderer, not a replacement for the data pipeline.
The original configured layout and the earlier three-concept UI lab remain available.

## Run

Use the repository's supported Node version (>=22.18), then:

```sh
git fetch origin
git switch design/hud-ui-lab
npm ci
npm run build
npm run sim
```

Open `http://localhost:8080/?layout=apex` for the simulator/live feed. Add `&preview=1` only for a
non-projected desktop preview. The bare `/` retains the configured layout. The layout is chosen
at page load, not switched automatically while driving; it does not write vehicle configuration.

Deterministic existing fixtures (no sensor connection):

- `/?layout=apex&fixture=imperial-us&preview=1` — speed, maneuver and limit.
- `/?layout=apex&fixture=sport-shift&preview=1` — RPM and reported gear.
- `/?layout=apex&fixture=blind-spot-left&preview=1` — left amber glow.
- `/?layout=apex&fixture=collision-caution&preview=1` — front amber glow.
- `/?layout=apex&fixture=collision-warning&preview=1` — front red glow.
- `/?layout=apex&fixture=tpms-low&preview=1` — fault visibility.

## Information hierarchy

Fixed anchors hold speed centrally, one maneuver on the left, limit on the right, a slim RPM
strip above, and available gear below. The existing widget components retain unit formatting,
overspeed styling, navigation fallback icons and inferred-gear semantics. Missing widgets remain
missing: no fake zero speed, guessed limit, default gear or decorative RPM data. RPM must already
be enabled/available in the composed frame (for example the sport preset).

Routine media, clock, ETA, lane illustrations, boost and ordinary fuel/temperature readouts are
omitted in this layout. This is a deliberate presentation override of widget placement, not a
change to the core's adaptive visibility. Fault-bearing coolant, voltage, low fuel, low tyres,
ice-risk and navigation-hazard widgets are retained. Critical alert banners, call/toast handling,
shift lights, connection/simulation status and parked diagnostics remain available.

## Directional language

| Input | Location | Presentation |
| --- | --- | --- |
| Left blind-spot presence | Left edge | Amber glow |
| Right blind-spot presence | Right edge | Amber glow |
| Forward collision caution | Top edge | Amber glow |
| Forward collision warning | Top edge | Red glow with a slow brightness variation |
| Rear collision, explicit presentation input only | Bottom edge | Amber or red glow |
| No input / cleared input | Corresponding edge | Nothing |

Multiple directions coexist. There are no idle illuminated rails, car silhouettes, duplicate
collision cards or full-frame collision borders in Apex. Semantic amber/red colors are separate
from accent colors. Urgent glow brightness never goes to zero, and reduced-motion disables the
variation. Accessible direction/severity labels remain in the DOM without visual text panels.

**Rear sensing is not implemented.** `DirectionalGlows` can render an explicitly provided `rear`
severity, covered by unit/render tests. The current `HudFrame` has only `collision` and left/right
blind-spot fields. The live caller deliberately passes no rear severity. There is no invented rear
status, and absence of a glow is not an assertion that the surrounding area is clear. A future
rear provider needs a validated core event/state/frame contract, freshness handling, and actual
hardware integration. This change does not create or certify any sensing system.

## Preserved boundaries

All live values still flow through `useHudFeed`, `HudFrame` and `ProjectionStage`. Core unit
conversion, stale-data rules, projection calibration, brightness ownership and error boundaries
are unchanged. A null frame removes values and glows together. Apex warnings remain present in
blanked, calibration and diagnostics modes when supplied by a current frame. Forward warning
hold behavior remains in `useDrawnFrame`; no new data-dependent blink timer is introduced.

The direction mapping is in driver-view coordinates before the existing calibrated projection
transform. Do not swap semantic left/right manually to compensate for a reflection; verify the
actual optics. The new layout is opt-in and the PR remains a draft pending native/hardware checks.

## Tests

```sh
npx vitest run packages/hud-renderer/test/apex.test.ts packages/hud-renderer/test/apex-render.test.ts
npm run typecheck
npm run build
npm run test:e2e -- apex.spec.ts
```

The added render tests exercise real `HudView` components, blanking, null frames, the configured
fallback and explicit rear presentation. Browser tests target existing fixture routes at 1280x480
and 800x480, layout bounds, reduced motion, and direction placement.

### Validation performed during authoring

- 67 pure-model cases passed using Node assertions against the transpiled actual `model.ts`:
  all 36 four-channel combinations, invalid inputs, no fabricated readings, fault selection,
  inferred gear retention and URL fallback.
- Eight added/modified TypeScript files passed syntax transpilation with local TypeScript 5.8.3.
  This is **not** the repository typecheck (the repository specifies a different compiler).
- The new stylesheet passed PostCSS parsing.
- A standalone Chromium preview using the actual new mapper and stylesheet passed 32 combinations
  (16 warning on/off combinations x two shapes), layout separation, night-color invariance,
  reduced motion, signal-loss presentation, and shell widths 320/390/760/1024. No page errors or
  network requests. Its illustrative widget markup is **not** the native Preact runtime.

**Not run here:** dependency installation, full repository build/typecheck/format checks, the
repository Vitest/Preact render tests, repository Playwright suite, actual server route, Pi/Android
hardware, optical reflection or ADAS sensors. Source cloning/dependency network access was blocked
and the local Node is 22.16.0, below the repository minimum. Added native tests are committed for
execution in the normal development environment; they are not claimed to have passed.

## Before hardware use

Verify all four physical edges after mirror/rotation/keystone calibration, including concurrent
warnings. Check maximum digit widths, long streets, day/night contrast, reduced motion, no-signal
blanking and reconnection, critical alerts over ordinary content, blanked/calibration modes and
fault/call overlap. Validate actual sensor freshness and availability separately. No road-safety
claim follows from these UI tests.
