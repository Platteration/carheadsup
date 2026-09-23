import type {
  DeepPartial,
  DrivingContext,
  HudConfig,
  LayoutPreset,
  WidgetId,
  WidgetPlacement,
  Zone,
} from '../types/config.ts';
import { defaultMaintenanceItems } from '../maintenance/maintenance.ts';
import { cloneJson, deepFreeze, deepMerge, isPlainObject } from './json.ts';
import { describeValue } from './issues.ts';
import { parseLenient } from './lenient.ts';
import { hudConfigSchema } from './schema.ts';

export {
  hudConfigSchema,
  widgetPlacementSchema,
  widgetPlacementsSchema,
  WIDGET_IDS,
  LAYOUT_ZONES,
} from './schema.ts';

// ---------------------------------------------------------------------------
// Layout presets
//
// Geometry: the projected image is small and sits low in the driver's view, so the eye rests on
// the centre. Speed owns the centre; the limit sign sits right next to it (right) so "am I over?"
// is one glance; navigation reads left-to-right as arrow (top-left) → lanes (top, above the road
// ahead) → hazards (top-right). Vehicle-health warnings live bottom-left, comfort info
// bottom/bottom-right. Shared widgets keep the same zone in every preset so switching presets
// never moves the things the driver looks for most.
//
// Adaptive clutter: highway shows the fewest widgets (speed, limit, guidance near maneuvers,
// hazards, out-of-range warnings); city adds low-glance-cost context (gear, ETA, fuel, clock,
// media); stopped adds the trip summary; parked drops driving-only widgets (the diagnostics
// dashboard is the main parked view). No zone ever holds more than two widgets in one context,
// and the conditional ones (nav, lanes, hazard, coolant, voltage, tpms) are usually hidden.
// Alerts, toasts, the call card and the shift light are drawn by the renderer outside this grid.
//
// Array order is priority order: when a zone overflows, earlier entries win.

const ALL: readonly DrivingContext[] = ['parked', 'stopped', 'city', 'highway'];
const DRIVING: readonly DrivingContext[] = ['stopped', 'city', 'highway'];
const LOW_SPEED: readonly DrivingContext[] = ['stopped', 'city'];
const NOT_HIGHWAY: readonly DrivingContext[] = ['parked', 'stopped', 'city'];
const AT_REST: readonly DrivingContext[] = ['parked', 'stopped'];

function place(id: WidgetId, zone: Zone, contexts: readonly DrivingContext[]): WidgetPlacement {
  return { id, zone, contexts: [...contexts] };
}

/** Widget placements for each built-in layout preset. */
export const LAYOUT_PRESETS: Readonly<
  Record<Exclude<LayoutPreset, 'custom'>, readonly WidgetPlacement[]>
> = deepFreeze({
  /** Calm highway driving: only what is needed to drive and navigate. */
  minimal: [
    place('speed', 'center', DRIVING),
    place('speedLimit', 'right', DRIVING),
    // Nav stays available when parked so a route set up before leaving is visible.
    place('nav', 'top-left', ALL),
    place('lanes', 'top', DRIVING),
    place('hazard', 'top-right', DRIVING),
  ],

  /** Everyday default: minimal + vehicle health + low-speed comfort info. */
  standard: [
    place('speed', 'center', DRIVING),
    place('speedLimit', 'right', DRIVING),
    place('nav', 'top-left', ALL),
    place('lanes', 'top', DRIVING),
    place('hazard', 'top-right', DRIVING),
    // Shown only when out of range (or a tyre is low), so they may appear anywhere, even on the highway.
    place('coolant', 'bottom-left', ALL),
    place('voltage', 'bottom-left', ALL),
    place('tpms', 'right', ALL),
    place('gear', 'left', LOW_SPEED),
    place('eta', 'top-left', LOW_SPEED),
    place('fuel', 'left', NOT_HIGHWAY),
    place('media', 'bottom', NOT_HIGHWAY),
    place('outsideTemp', 'bottom-right', NOT_HIGHWAY),
    place('clock', 'bottom-right', NOT_HIGHWAY),
    place('tripSummary', 'bottom', AT_REST),
  ],

  /**
   * Spirited driving / manuals: a prominent gear readout beside the speed, a tachometer bar
   * under it and boost, all kept on the highway too. Comfort info moves out of their way.
   */
  sport: [
    place('speed', 'center', DRIVING),
    place('gear', 'left', DRIVING),
    place('tachometer', 'bottom', DRIVING),
    place('speedLimit', 'right', DRIVING),
    place('nav', 'top-left', ALL),
    place('lanes', 'top', DRIVING),
    place('hazard', 'top-right', DRIVING),
    place('coolant', 'bottom-left', ALL),
    place('voltage', 'bottom-left', ALL),
    place('tpms', 'right', ALL),
    place('boost', 'bottom-right', DRIVING),
    place('eta', 'top-left', LOW_SPEED),
    place('fuel', 'top-right', NOT_HIGHWAY),
    place('clock', 'bottom-right', NOT_HIGHWAY),
    place('outsideTemp', 'top', AT_REST),
    place('media', 'bottom', AT_REST),
    // The centre is free once parked (no speed), so the trip summary can take it.
    place('tripSummary', 'center', ['parked']),
  ],
});

/** The effective widget placements for a config (preset or custom). */
export function resolveLayout(config: HudConfig): readonly WidgetPlacement[] {
  const { preset, widgets } = config.display.layout;
  return preset === 'custom' ? widgets : LAYOUT_PRESETS[preset];
}

// ---------------------------------------------------------------------------
// Defaults

/** Sensible defaults for a typical petrol car with a windshield-reflected display. */
export const DEFAULT_CONFIG: HudConfig = deepFreeze<HudConfig>({
  version: 1,
  units: {
    system: 'metric',
    fuelEconomy: 'L/100km',
    temperature: 'C',
    pressure: 'kPa',
    clock: '24h',
    currency: 'USD',
  },
  vehicle: {
    name: 'My car',
    fuelType: 'gasoline',
    tankCapacityL: 50,
    displacementL: 2.0,
    volumetricEfficiency: 0.85,
    transmission: 'automatic',
    redlineRpm: 6500,
    idleRpm: 750,
    gearRatiosRpmPerKph: null,
    fuelPricePerL: 1.8,
    hasTpms: false,
  },
  obd: {
    transport: 'serial',
    serialPath: '/dev/rfcomm0',
    baudRate: 38_400,
    tcpHost: '192.168.0.10',
    tcpPort: 35_000,
    protocol: '0',
    timeoutMs: 1000,
    reconnectDelayMs: 3000,
    dtcIntervalMs: 30_000,
    customPids: [],
  },
  display: {
    projection: {
      // The windshield reflection mirrors the image left-to-right.
      mirrorX: true,
      mirrorY: false,
      rotation: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      corners: { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] },
      showGrid: false,
    },
    brightness: {
      mode: 'auto',
      manualLevel: 0.8,
      minLevel: 0.08,
      maxLevel: 1,
      // Roughly log-linear from a dark country road (~1 lux) through street lighting (~10–100),
      // overcast daylight (~1 000–10 000) to direct sun on the windshield (~100 000 lux).
      curve: [
        [1, 0.08],
        [10, 0.15],
        [100, 0.3],
        [1000, 0.55],
        [10_000, 0.85],
        [100_000, 1],
      ],
      riseTimeMs: 3000,
      fallTimeMs: 400,
      nightMode: 'sensor',
      nightEnterLux: 50,
      nightExitLux: 150,
      // Between sunset and the end of civil twilight (−6°).
      nightSunElevationDeg: -4,
    },
    layout: {
      preset: 'standard',
      // Starting point when the driver switches to 'custom'.
      widgets: cloneJson([...LAYOUT_PRESETS.standard]),
    },
    context: {
      highwayEnterKph: 80,
      highwayExitKph: 65,
      highwayDwellMs: 10_000,
      stationaryKph: 2,
      parkedAfterMs: 120_000,
      engineOffParkedAfterMs: 30_000,
    },
    speedLimitSign: 'vienna',
    mediaToastMs: 5000,
    messageToastMs: 6000,
    highwayNavRevealM: 2000,
    laneRevealM: 800,
    hazardRevealM: 1000,
    maxAlerts: 2,
  },
  shiftLight: {
    enabled: false,
    startRpm: 4500,
    shiftRpm: 6000,
    flashRpm: 6300,
  },
  alerts: {
    coolantHighC: 110,
    coolantCriticalC: 118,
    coolantHysteresisC: 3,
    voltageLowRunningV: 12.2,
    voltageLowOffV: 11.9,
    voltageHighV: 15.3,
    voltageHysteresisV: 0.3,
    overspeedToleranceKph: 3,
    overspeedTolerancePct: 5,
    fuelLowPct: 12,
    tpmsLowKpa: 180,
    iceRiskC: 3,
    showDtcWhileDriving: false,
  },
  maintenance: { items: defaultMaintenanceItems() },
  trip: {
    endAfterEngineOffMs: 300_000,
    minDistanceKm: 0.2,
  },
  phone: {
    pairingToken: '',
    showMessageSender: true,
    readMessagesAloud: true,
    showMedia: true,
  },
  sensors: {
    lightSensor: 'none',
    gestureSensor: 'none',
    i2cBus: 1,
    lightSensorGain: 1,
    buttons: { primary: null, secondary: null, next: null },
    fallbackLocation: null,
    adasUdpPort: null,
  },
  server: {
    port: 8080,
    host: '0.0.0.0',
    apiToken: '',
    mdns: true,
    frameRate: 15,
  },
});

// ---------------------------------------------------------------------------
// Parsing

/**
 * Validate an unknown value (e.g. a JSON file) into a full HudConfig. Lenient: invalid fields
 * fall back to `base` (default: DEFAULT_CONFIG) and are reported in `errors` with a dotted
 * path, e.g. "display.brightness.minLevel: expected number <= 1", so a partially broken config
 * file never stops the HUD from starting.
 *
 *  - Validation is per field: one bad field only resets that field. Arrays and tuples are a
 *    single field (a bad entry resets the whole array; the error names the entry).
 *  - Missing fields silently take the value from `base` (older or hand-written partial files).
 *  - Unknown keys are ignored.
 *  - Cross-field rules (minLevel <= maxLevel, highwayExitKph < highwayEnterKph,
 *    startRpm < shiftRpm <= flashRpm, …) are repaired minimally: the first involved field whose
 *    `base` value restores the rule is reverted and named in the error (typically the one the
 *    user changed); if no single field suffices, all involved fields revert together.
 *  - If `base` is itself invalid, its bad fields are first repaired from DEFAULT_CONFIG.
 *
 * The returned config is a fresh, mutable object sharing no references with `input` or `base`.
 */
export function parseConfig(
  input: unknown,
  base?: HudConfig,
): { config: HudConfig; errors: string[] } {
  return parseAgainst(input, validBase(base));
}

/**
 * Deep-merge a patch into a config (plain objects merge; arrays, tuples and null replace
 * wholesale; undefined leaves a field alone), then validate like parseConfig with `base` as the
 * fallback, so rejected fields keep their current value.
 */
export function mergeConfig(
  base: HudConfig,
  patch: DeepPartial<HudConfig>,
): { config: HudConfig; errors: string[] } {
  const fallback = validBase(base);
  return parseAgainst(deepMerge(fallback, patch), fallback);
}

/** Lenient parse of `input` against a fallback that is known to be valid. */
function parseAgainst(
  input: unknown,
  fallback: HudConfig,
): { config: HudConfig; errors: string[] } {
  if (!isPlainObject(input)) {
    return {
      config: cloneJson(fallback),
      errors: [`(root): expected object, got ${describeValue(input)}`],
    };
  }
  const errors: string[] = [];
  // Safe: parseLenient only produces values accepted by the schema, whose inferred type is
  // statically asserted to equal HudConfig (see HudConfigSchemaMatchesContract).
  const config = parseLenient(hudConfigSchema, input, fallback, [], errors) as HudConfig;
  return { config, errors };
}

/** `base` itself, repaired field by field from DEFAULT_CONFIG if it is not fully valid. */
function validBase(base: HudConfig | undefined): HudConfig {
  if (base === undefined || base === DEFAULT_CONFIG) return DEFAULT_CONFIG;
  return parseLenient(hudConfigSchema, base, DEFAULT_CONFIG, [], []) as HudConfig;
}
