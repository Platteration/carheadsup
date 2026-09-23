# carheadsup — windshield heads-up display

Software for a DIY automotive HUD: a small Linux computer (Raspberry Pi class) drives a bright
display whose image reflects off the windshield. It reads the car over OBD-II (ELM327 adapter),
gets navigation / media / calls / messages from an Android companion app, and shows a minimal,
context-aware overlay.

## Layout

| Path | What | Runtime |
| --- | --- | --- |
| `packages/core` | Pure domain logic + all shared types (the contract). No I/O. | browser + node |
| `packages/obd` | ELM327 driver, transports (serial/TCP), PID poller, ELM327 emulator + vehicle sim | node |
| `packages/hud-server` | On-car service: wires OBD, phone link, sensors → reducer → frames; REST + WebSocket; persistence | node |
| `packages/hud-renderer` | Preact UI: projected HUD (`/`), settings app (`/settings`), dev console (`/dev`) | browser |
| `companion-android` | Kotlin companion app; `:protocol` is pure-JVM and testable without the Android SDK | android |
| `docs`, `deploy` | Architecture, hardware, install guides; systemd/kiosk scripts | — |

Data flow: inputs (OBD samples, phone messages, sensors, buttons, clock ticks) → `HudEvent` →
`reduce(state, event, config)` → `composeFrame(state, config)` → `HudFrame` → renderer. The reducer and
composer are pure, so whole drives can be replayed in tests.

## Commands

- Typecheck one package: `npx tsc -p packages/<pkg>/tsconfig.json` (all: `npm run typecheck`)
- Test one package: `npx vitest run packages/<pkg>` (all: `npm test`)
- Run the HUD against the simulator: `npm run sim` then open `http://localhost:8080/dev`
- Renderer dev server with HMR: `npm run dev` (proxies `/api` and `/ws` to the server on :8080)
- Android protocol module: `cd companion-android && ./gradlew :protocol:test`

## TypeScript conventions

- Node runs `.ts` directly (type stripping, Node ≥ 22.18) — there is no build step for node packages.
  So only **erasable syntax**: no `enum`, no `namespace`, no constructor parameter properties
  (`constructor(private x)`), no `import x = require()`. Use `as const` objects and unions instead.
- Relative imports include the `.ts` extension (`import { x } from './x.ts'`). Type-only imports use
  `import type`. Cross-package imports use the package name (`@carheadsup/core`).
- Strict mode with `noUncheckedIndexedAccess`; no `any` (use `unknown` and narrow).
- Tests live in `packages/<pkg>/test/**/*.test.ts` and use vitest.
- Keep dependencies minimal; prefer the ones already in the package manifests.

## Domain rules

- **Canonical units everywhere inside the system**: km/h, km, m, °C, kPa, V, L, L/h, g/s, epoch ms.
  Convert to the driver's units only in `composeFrame` (see `core/src/units.ts`).
- **`packages/core` is pure**: no `Date.now()`, `Math.random()`, timers, network, filesystem, or
  `console`. Time always comes from event timestamps (`event.at` / `state.now`). Same input ⇒ same output.
- **Never show stale data as live.** Use `freshValue()` from `core/src/staleness.ts`; a missing value
  is better than a frozen one. The renderer blanks the HUD if frames stop arriving.
- **Driver-distraction rules**: message *content* never reaches the HUD (sender only; the phone reads
  it aloud). Keep text short and glanceable while moving; detail belongs to stopped/parked contexts.
  Critical alerts are not dismissible. Black pixels are transparent on the windshield, so the UI is
  light-on-black with no large bright areas.
- Clearing trouble codes (OBD service 04) is only allowed when parked with the engine off.
