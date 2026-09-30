import { z } from 'zod';
import { compileFormula } from '../obd/formula.ts';
import {
  ADC_CHANNELS,
  ADS1115_ADDRESSES,
  ADS1115_FULL_SCALES,
  CAN_MAX_BYTE_INDEX,
  MAX_CAN_BUTTON_RULES,
  MAX_SWC_WINDOWS,
  canRuleKey,
  formatVoltageRange,
  parseCanId,
  parseHexByte,
  rangesOverlap,
  valueFitsMask,
} from './buttons.ts';
import { normalizeIpAddress } from './ip.ts';
import { DRIVING_CONTEXTS } from '../types/config.ts';
import type { Ads1115FullScaleV, HudConfig, WidgetId, Zone } from '../types/config.ts';
import { INPUT_ACTIONS } from '../types/events.ts';
import { SIGNAL_IDS } from '../types/signals.ts';

/**
 * Zod schema for `HudConfig`, used both strictly (`hudConfigSchema.safeParse`) and leniently
 * (`parseConfig` walks it field by field, see `lenient.ts`). Bounds are physical-plausibility
 * limits meant to catch typos and unit mix-ups, not to second-guess unusual vehicles.
 */

/** Exact type equality (distinguishes optional/readonly/any, unlike mutual assignability). */
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/** Compile-time assertion helper: `type _ = AssertTrue<Equals<A, B>>`. */
export type AssertTrue<T extends true> = T;

/** Every widget id, in a stable order (settings UI, validation). */
export const WIDGET_IDS = [
  'speed',
  'speedLimit',
  'tachometer',
  'gear',
  'nav',
  'lanes',
  'eta',
  'hazard',
  'fuel',
  'coolant',
  'voltage',
  'tpms',
  'clock',
  'outsideTemp',
  'media',
  'boost',
  'tripSummary',
] as const satisfies readonly WidgetId[];

/** The 3×3 layout grid, row by row. */
export const LAYOUT_ZONES = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const satisfies readonly Zone[];

/** Fails to compile if a WidgetId or Zone is added to the contract but not listed above. */
export type WidgetIdsAreExhaustive = AssertTrue<Equals<(typeof WIDGET_IDS)[number], WidgetId>>;
export type LayoutZonesAreExhaustive = AssertTrue<Equals<(typeof LAYOUT_ZONES)[number], Zone>>;
export type FullScalesAreExhaustive = AssertTrue<
  Equals<(typeof ADS1115_FULL_SCALES)[number], Ads1115FullScaleV>
>;

// ---------------------------------------------------------------------------
// Cross-field rules

/**
 * A constraint between sibling fields of one config object. The strict schema reports a
 * violation against the first field; the lenient parser reverts the smallest set of `fields`
 * that restores it (see `parseLenient`) and reports it against the reverted field. Messages
 * therefore name every field involved, e.g. "minLevel must not exceed maxLevel (0.6 > 0.5)".
 */
export interface ObjectRule<T> {
  readonly fields: readonly [keyof T & string, ...(keyof T & string)[]];
  readonly holds: (value: T) => boolean;
  /** Describes the violation (called only when `holds` is false). */
  readonly message: (value: T) => string;
}

type AnyRecord = Record<string, unknown>;
const objectRules = new WeakMap<z.ZodType, readonly ObjectRule<AnyRecord>[]>();

/** Attach cross-field rules to an object schema: enforced by zod and visible to the lenient walker. */
function withRules<S extends z.ZodObject>(schema: S, rules: readonly ObjectRule<z.output<S>>[]): S {
  const refined = schema.superRefine((value, ctx) => {
    for (const rule of rules) {
      if (!rule.holds(value)) {
        ctx.addIssue({ code: 'custom', path: [rule.fields[0]], message: rule.message(value) });
      }
    }
  });
  // The rules only read the fields their object schema declares, so erasing the value type is safe.
  objectRules.set(refined, rules as unknown as readonly ObjectRule<AnyRecord>[]);
  return refined;
}

/** Cross-field rules attached to an object schema (empty for plain schemas). */
export function rulesOf(schema: z.ZodType): readonly ObjectRule<AnyRecord>[] {
  return objectRules.get(schema) ?? [];
}

// ---------------------------------------------------------------------------
// Building blocks

const num = (min: number, max: number) => z.number().min(min).max(max);
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const text = (min: number, max: number) => z.string().min(min).max(max);
const bool = z.boolean();

const hostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.:%[\]-]+$/, 'expected a hostname or IP address');

/** Array-level refinement: `key(item)` must be unique; duplicates are reported at their index. */
function uniqueBy<T>(key: (item: T) => unknown, field: string | null, what: string) {
  return (items: readonly T[], ctx: z.core.$RefinementCtx<T[]>) => {
    const seen = new Set<unknown>();
    items.forEach((item, index) => {
      const k = key(item);
      if (seen.has(k)) {
        ctx.addIssue({
          code: 'custom',
          path: field === null ? [index] : [index, field],
          message: `duplicate ${what} ${JSON.stringify(k)}`,
        });
      }
      seen.add(k);
    });
  };
}

// ---------------------------------------------------------------------------
// Sections

const unitsSchema = z.object({
  system: z.enum(['metric', 'imperial']),
  fuelEconomy: z.enum(['L/100km', 'km/L', 'mpg-us', 'mpg-uk']),
  temperature: z.enum(['C', 'F']),
  pressure: z.enum(['kPa', 'psi', 'bar']),
  clock: z.enum(['12h', '24h']),
  currency: z.string().regex(/^[A-Z]{3}$/, 'expected a 3-letter ISO 4217 code such as "USD"'),
});

/** Overall ratios fall strictly from 1st gear upwards (fewer rpm per km/h in higher gears). */
const gearRatiosSchema = z
  .array(z.number().gt(0).max(1000))
  .min(1)
  .max(12)
  .superRefine((ratios, ctx) => {
    for (let i = 1; i < ratios.length; i++) {
      const prev = ratios[i - 1];
      const cur = ratios[i];
      if (prev !== undefined && cur !== undefined && cur >= prev) {
        ctx.addIssue({
          code: 'custom',
          path: [i],
          message: 'expected ratios to decrease from 1st gear upwards',
        });
      }
    }
  });

const vehicleSchema = withRules(
  z.object({
    name: text(1, 60),
    fuelType: z.enum(['gasoline', 'diesel', 'e85', 'lpg']),
    tankCapacityL: num(1, 500),
    displacementL: num(0.05, 20),
    volumetricEfficiency: num(0.2, 1),
    transmission: z.enum(['manual', 'automatic', 'dct', 'cvt']),
    redlineRpm: int(1000, 25_000),
    idleRpm: int(200, 3000),
    gearRatiosRpmPerKph: gearRatiosSchema.nullable(),
    fuelPricePerL: num(0, 1_000_000),
    hasTpms: bool,
  }),
  [
    {
      fields: ['idleRpm', 'redlineRpm'],
      message: (v) => `idleRpm must be below redlineRpm (${v.idleRpm} >= ${v.redlineRpm})`,
      holds: (v) => v.idleRpm < v.redlineRpm,
    },
  ],
);

const HEX_MODE = /^[0-9A-Fa-f]{2}$/;
const HEX_PID = /^(?:[0-9A-Fa-f]{2}){1,3}$/;
/** ELM327 `AT SH`: 3 digits (11-bit CAN), 6 digits (legacy / 29-bit), or 8 digits (29-bit, ELM ≥ 2.1). */
const HEX_HEADER = /^(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
/** ELM327 `AT SP`: protocol 0 (auto) … C, optionally with an "A" (auto-fallback) before or after. */
const ELM_PROTOCOL = /^(?:[0-9A-Ca-c]|[Aa][0-9A-Ca-c]|[0-9A-Ca-c][Aa])$/;

/** A custom-PID formula must compile, so a typo is rejected up front, not skipped at runtime. */
const formulaSchema = text(1, 200).superRefine((formula, ctx) => {
  if (formula === '') return; // already reported by the length check
  try {
    compileFormula(formula);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.addIssue({ code: 'custom', message: message.charAt(0).toLowerCase() + message.slice(1) });
  }
});

const customPidSchema = z.object({
  signal: z.enum(SIGNAL_IDS),
  mode: z.string().regex(HEX_MODE, 'expected a 2-digit hex mode such as "22"'),
  pid: z.string().regex(HEX_PID, 'expected a 2-, 4- or 6-digit hex PID such as "2A0B"'),
  header: z
    .string()
    .regex(HEX_HEADER, 'expected a 3-, 6- or 8-digit hex header such as "7E0"')
    .nullable(),
  formula: formulaSchema,
  intervalMs: int(100, 3_600_000),
});

const obdSchema = z.object({
  transport: z.enum(['serial', 'tcp', 'simulator']),
  serialPath: text(1, 256),
  baudRate: int(1200, 4_000_000),
  tcpHost: hostSchema,
  tcpPort: int(1, 65_535),
  protocol: z
    .string()
    .regex(ELM_PROTOCOL, 'expected an ELM327 protocol "0"–"C" (e.g. "0", "6", "A6")'),
  timeoutMs: int(50, 30_000),
  reconnectDelayMs: int(100, 600_000),
  dtcIntervalMs: int(1000, 3_600_000),
  customPids: z
    .array(customPidSchema)
    .max(64)
    .superRefine(uniqueBy((p) => p.signal, 'signal', 'signal')),
});

const cornerSchema = z.tuple([num(0, 1), num(0, 1)]);

/**
 * The corner quad must stay convex with the identity's orientation (TL → TR → BR → BL clockwise
 * on screen); otherwise the keystone homography folds or mirrors the image.
 */
function isConvexClockwise(c: Record<'tl' | 'tr' | 'br' | 'bl', readonly [number, number]>) {
  const pts = [c.tl, c.tr, c.br, c.bl];
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const d = pts[(i + 2) % 4];
    if (a === undefined || b === undefined || d === undefined) return false;
    const cross = (b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]);
    if (!(cross > 1e-6)) return false;
  }
  return true;
}

const projectionSchema = z.object({
  mirrorX: bool,
  mirrorY: bool,
  rotation: z.literal([0, 90, 180, 270]),
  scale: num(0.5, 1.5),
  offsetX: num(-0.5, 0.5),
  offsetY: num(-0.5, 0.5),
  corners: withRules(
    z.object({ tl: cornerSchema, tr: cornerSchema, br: cornerSchema, bl: cornerSchema }),
    [
      {
        fields: ['tl', 'tr', 'br', 'bl'],
        message: () => 'corners must form a convex quadrilateral in TL, TR, BR, BL order',
        holds: isConvexClockwise,
      },
    ],
  ),
  showGrid: bool,
});

const curveSchema = z
  .array(z.tuple([z.number().gt(0).max(200_000), num(0, 1)]))
  .min(1)
  .max(32)
  .superRefine((curve, ctx) => {
    for (let i = 1; i < curve.length; i++) {
      const prev = curve[i - 1];
      const cur = curve[i];
      if (prev !== undefined && cur !== undefined && cur[0] <= prev[0]) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 0],
          message: 'expected points sorted by strictly increasing lux',
        });
      }
    }
  });

const brightnessSchema = withRules(
  z.object({
    mode: z.enum(['auto', 'manual']),
    manualLevel: num(0, 1),
    minLevel: num(0, 1),
    maxLevel: num(0, 1),
    curve: curveSchema,
    riseTimeMs: int(0, 600_000),
    fallTimeMs: int(0, 600_000),
    nightMode: z.enum(['sensor', 'sun', 'always', 'never']),
    nightEnterLux: num(0, 100_000),
    nightExitLux: num(0, 100_000),
    nightSunElevationDeg: num(-18, 10),
  }),
  [
    {
      fields: ['minLevel', 'maxLevel'],
      message: (v) => `minLevel must not exceed maxLevel (${v.minLevel} > ${v.maxLevel})`,
      holds: (v) => v.minLevel <= v.maxLevel,
    },
    {
      fields: ['nightEnterLux', 'nightExitLux'],
      message: (v) =>
        `nightEnterLux must be below nightExitLux for hysteresis (${v.nightEnterLux} >= ${v.nightExitLux})`,
      holds: (v) => v.nightEnterLux < v.nightExitLux,
    },
  ],
);

/** One placement; also used to validate the built-in presets. */
export const widgetPlacementSchema = z.object({
  id: z.enum(WIDGET_IDS),
  zone: z.enum(LAYOUT_ZONES),
  contexts: z
    .array(z.enum(DRIVING_CONTEXTS))
    .max(DRIVING_CONTEXTS.length)
    .superRefine(uniqueBy((c) => c, null, 'context')),
});

/** A full widget list: each widget id at most once. */
export const widgetPlacementsSchema = z
  .array(widgetPlacementSchema)
  .max(WIDGET_IDS.length)
  .superRefine(uniqueBy((w) => w.id, 'id', 'widget'));

const layoutSchema = z.object({
  preset: z.enum(['minimal', 'standard', 'sport', 'custom']),
  widgets: widgetPlacementsSchema,
});

const contextSchema = withRules(
  z.object({
    highwayEnterKph: num(20, 250),
    highwayExitKph: num(10, 250),
    highwayDwellMs: int(0, 600_000),
    stationaryKph: num(0.5, 20),
    parkedAfterMs: int(0, 86_400_000),
    engineOffParkedAfterMs: int(0, 86_400_000),
  }),
  [
    {
      fields: ['highwayExitKph', 'highwayEnterKph'],
      message: (v) =>
        `highwayExitKph must be below highwayEnterKph for hysteresis (${v.highwayExitKph} >= ${v.highwayEnterKph})`,
      holds: (v) => v.highwayExitKph < v.highwayEnterKph,
    },
    {
      fields: ['stationaryKph', 'highwayExitKph'],
      message: (v) =>
        `stationaryKph must be below highwayExitKph (${v.stationaryKph} >= ${v.highwayExitKph})`,
      holds: (v) => v.stationaryKph < v.highwayExitKph,
    },
  ],
);

const displaySchema = z.object({
  projection: projectionSchema,
  brightness: brightnessSchema,
  layout: layoutSchema,
  context: contextSchema,
  speedLimitSign: z.enum(['vienna', 'mutcd']),
  mediaToastMs: int(0, 60_000),
  messageToastMs: int(0, 60_000),
  highwayNavRevealM: num(0, 50_000),
  laneRevealM: num(0, 10_000),
  hazardRevealM: num(0, 50_000),
  trafficRevealM: num(0, 50_000),
  maxAlerts: int(1, 5),
});

const shiftLightSchema = withRules(
  z.object({
    enabled: bool,
    startRpm: int(500, 25_000),
    shiftRpm: int(500, 25_000),
    flashRpm: int(500, 25_000),
  }),
  [
    {
      fields: ['startRpm', 'shiftRpm'],
      message: (v) => `startRpm must be below shiftRpm (${v.startRpm} >= ${v.shiftRpm})`,
      holds: (v) => v.startRpm < v.shiftRpm,
    },
    {
      fields: ['shiftRpm', 'flashRpm'],
      message: (v) => `shiftRpm must not exceed flashRpm (${v.shiftRpm} > ${v.flashRpm})`,
      holds: (v) => v.shiftRpm <= v.flashRpm,
    },
  ],
);

const alertsSchema = withRules(
  z.object({
    coolantHighC: num(60, 150),
    coolantCriticalC: num(60, 160),
    coolantHysteresisC: num(0, 20),
    voltageLowRunningV: num(6, 32),
    voltageLowOffV: num(6, 32),
    voltageHighV: num(6, 32),
    voltageHysteresisV: num(0, 3),
    overspeedToleranceKph: num(0, 50),
    overspeedTolerancePct: num(0, 50),
    fuelLowPct: num(0, 100),
    tpmsLowKpa: num(0, 1000),
    iceRiskC: num(-30, 15),
    showDtcWhileDriving: bool,
  }),
  [
    {
      fields: ['coolantHighC', 'coolantCriticalC'],
      message: (v) =>
        `coolantHighC must be below coolantCriticalC (${v.coolantHighC} >= ${v.coolantCriticalC})`,
      holds: (v) => v.coolantHighC < v.coolantCriticalC,
    },
    {
      fields: ['voltageLowRunningV', 'voltageHighV'],
      holds: (v) => v.voltageLowRunningV < v.voltageHighV,
      message: (v) =>
        `voltageLowRunningV must be below voltageHighV (${v.voltageLowRunningV} >= ${v.voltageHighV})`,
    },
    {
      fields: ['voltageLowOffV', 'voltageHighV'],
      holds: (v) => v.voltageLowOffV < v.voltageHighV,
      message: (v) =>
        `voltageLowOffV must be below voltageHighV (${v.voltageLowOffV} >= ${v.voltageHighV})`,
    },
  ],
);

const maintenanceItemSchema = withRules(
  z.object({
    id: z
      .string()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
        'expected an id of letters, digits, ".", "-" or "_" (up to 64 characters)',
      ),
    label: text(1, 60),
    intervalKm: z.number().gt(0).max(1_000_000).nullable(),
    intervalDays: int(1, 36_500).nullable(),
    warnBeforeKm: num(0, 1_000_000),
    warnBeforeDays: int(0, 36_500),
  }),
  [
    {
      fields: ['intervalKm', 'intervalDays'],
      message: () => 'at least one of intervalKm and intervalDays is required',
      holds: (v) => v.intervalKm !== null || v.intervalDays !== null,
    },
  ],
);

const maintenanceSchema = z.object({
  items: z
    .array(maintenanceItemSchema)
    .max(50)
    .superRefine(uniqueBy((i) => i.id, 'id', 'item id')),
});

const tripSchema = z.object({
  endAfterEngineOffMs: int(0, 86_400_000),
  minDistanceKm: num(0, 100),
});

/**
 * `server.apiToken` travels in `Authorization` headers and `?token=` URLs, which carry only
 * printable ASCII (a non-ASCII token cannot be sent by a browser's fetch or the companion's HTTP
 * client, so saving one would lock every other device out). Spaces inside are fine; a token of
 * spaces only is not a token.
 */
const apiTokenSchema = text(0, 256)
  .regex(/^[\x20-\x7e]*$/, 'use letters, digits and symbols (printable ASCII) only')
  .refine((token) => token === '' || token.trim() !== '', 'a token cannot be only spaces');

const phoneSchema = z.object({
  pairingToken: text(0, 256),
  showMessageSender: bool,
  readMessagesAloud: bool,
  showMedia: bool,
});

const gpioSchema = int(0, 1023).nullable();

/** Most addresses `sensors.adasAllowedSenders` may list. */
export const MAX_ADAS_ALLOWED_SENDERS = 32;

/**
 * One IP address literal (see `normalizeIpAddress`): no host names, which would need a DNS the
 * HUD cannot trust, and no prefixes, ports or zone indices. Duplicates are compared canonically,
 * so `::ffff:10.42.0.50` repeats `10.42.0.50`.
 */
const adasAllowedSendersSchema = z
  .array(
    z
      .string()
      .refine(
        (text) => normalizeIpAddress(text) !== null,
        'expected an IPv4 or IPv6 address such as 10.42.0.50',
      ),
  )
  .max(MAX_ADAS_ALLOWED_SENDERS)
  .superRefine(uniqueBy((address) => normalizeIpAddress(address) ?? address, null, 'address'));

const inputActionSchema = z.enum(INPUT_ACTIONS);

/**
 * A Linux network interface name (at most 15 characters). Commas and colons are excluded because
 * the name is passed to candump as `<ifname>,<filter>…`; a leading "-" would read as an option.
 */
const CAN_INTERFACE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,14}$/;
const HEX_BYTE = /^[0-9A-Fa-f]{2}$/;

const canIdSchema = z
  .string()
  .refine(
    (id) => parseCanId(id) !== null,
    'expected 3 hex digits for an 11-bit id (up to 7FF) or 8 for a 29-bit id (up to 1FFFFFFF)',
  );

const canButtonRuleSchema = withRules(
  z.object({
    id: canIdSchema,
    byte: int(0, CAN_MAX_BYTE_INDEX),
    mask: z
      .string()
      .regex(HEX_BYTE, 'expected 2 hex digits such as "0F"')
      .refine((mask) => parseHexByte(mask) !== 0, 'a mask of 00 would match every frame'),
    value: z.string().regex(HEX_BYTE, 'expected 2 hex digits such as "01"'),
    action: inputActionSchema,
    longPressAction: inputActionSchema.nullable(),
  }),
  [
    {
      fields: ['value', 'mask'],
      message: (r) =>
        `value ${r.value} sets bits outside mask ${r.mask}, so the rule could never match`,
      holds: (r) => {
        const value = parseHexByte(r.value);
        const mask = parseHexByte(r.mask);
        // A 00 mask is reported by its own check.
        return value === null || mask === null || mask === 0 || valueFitsMask(value, mask);
      },
    },
  ],
);

const canButtonsSchema = z.object({
  interface: z
    .string()
    .regex(CAN_INTERFACE, 'expected a network interface name such as "can0"')
    .nullable(),
  releaseTimeoutMs: int(50, 10_000).nullable(),
  rules: z
    .array(canButtonRuleSchema)
    .max(MAX_CAN_BUTTON_RULES)
    .superRefine(uniqueBy(canRuleKey, null, 'rule')),
});

/** Voltages the ADS1115 can be set up to measure (its widest range is ±6.144 V). */
const voltsSchema = num(0, ADS1115_FULL_SCALES[0]);

const lowBelowHigh = {
  fields: ['minV', 'maxV'],
  message: (v: { minV: number; maxV: number }) =>
    `minV must be below maxV (${v.minV} >= ${v.maxV})`,
  holds: (v: { minV: number; maxV: number }) => v.minV < v.maxV,
} as const;

const voltageRangeSchema = withRules(z.object({ minV: voltsSchema, maxV: voltsSchema }), [
  lowBelowHigh,
]);

const swcWindowSchema = withRules(
  z.object({
    minV: voltsSchema,
    maxV: voltsSchema,
    action: inputActionSchema,
    longPressAction: inputActionSchema.nullable(),
  }),
  [lowBelowHigh],
);

/** Button windows must not overlap: one voltage identifies one button. */
const swcWindowsSchema = z
  .array(swcWindowSchema)
  .max(MAX_SWC_WINDOWS)
  .superRefine((windows, ctx) => {
    windows.forEach((window, index) => {
      const other = windows.findIndex((w, i) => i < index && rangesOverlap(w, window));
      if (other >= 0) {
        ctx.addIssue({
          code: 'custom',
          path: [index],
          message: `overlaps window ${other + 1} (${formatVoltageRange(windows[other] ?? window)})`,
        });
      }
    });
  });

const swcButtonsSchema = withRules(
  z.object({
    enabled: bool,
    address: z.literal(ADS1115_ADDRESSES, {
      error: 'expected an ADS1115 address: 0x48–0x4B (72–75)',
    }),
    channel: z.literal(ADC_CHANNELS),
    fullScaleV: z.literal(ADS1115_FULL_SCALES),
    idle: voltageRangeSchema,
    windows: swcWindowsSchema,
  }),
  [
    {
      fields: ['idle', 'fullScaleV'],
      message: (v) =>
        `the idle range (${formatVoltageRange(v.idle)}) must lie within the ±${v.fullScaleV} V input range`,
      holds: (v) => v.idle.maxV <= v.fullScaleV,
    },
    {
      fields: ['windows', 'fullScaleV'],
      message: (v) => {
        const index = v.windows.findIndex((w) => w.maxV > v.fullScaleV);
        const window = v.windows[index];
        return `window ${index + 1}${window ? ` (${formatVoltageRange(window)})` : ''} must lie within the ±${v.fullScaleV} V input range`;
      },
      holds: (v) => v.windows.every((w) => w.maxV <= v.fullScaleV),
    },
    {
      fields: ['windows', 'idle'],
      message: (v) => {
        const index = v.windows.findIndex((w) => rangesOverlap(w, v.idle));
        const window = v.windows[index];
        return `window ${index + 1}${window ? ` (${formatVoltageRange(window)})` : ''} overlaps the idle range (${formatVoltageRange(v.idle)})`;
      },
      holds: (v) => v.windows.every((w) => !rangesOverlap(w, v.idle)),
    },
  ],
);

const sensorsSchema = z.object({
  lightSensor: z.enum(['none', 'bh1750', 'veml7700', 'tsl2591']),
  gestureSensor: z.enum(['none', 'apds9960']),
  i2cBus: int(0, 255),
  lightSensorGain: z.number().gt(0).max(1000),
  buttons: withRules(z.object({ primary: gpioSchema, secondary: gpioSchema, next: gpioSchema }), [
    {
      fields: ['primary', 'secondary', 'next'],
      message: () => 'buttons must use distinct GPIO lines',
      holds: (v) => {
        const used = [v.primary, v.secondary, v.next].filter((p) => p !== null);
        return new Set(used).size === used.length;
      },
    },
  ]),
  canButtons: canButtonsSchema,
  swcButtons: swcButtonsSchema,
  fallbackLocation: z.object({ lat: num(-90, 90), lon: num(-180, 180) }).nullable(),
  adasUdpPort: int(1, 65_535).nullable(),
  adasAllowedSenders: adasAllowedSendersSchema,
});

const serverSchema = withRules(
  z.object({
    port: int(1, 65_535),
    tlsPort: int(1, 65_535).nullable(),
    allowPlainPhone: bool,
    allowPlainRemote: bool,
    host: hostSchema,
    apiToken: apiTokenSchema,
    mdns: bool,
    frameRate: int(1, 60),
  }),
  [
    {
      fields: ['tlsPort', 'port'],
      message: (v) => `the TLS port must differ from the HTTP port (${v.port})`,
      holds: (v) => v.tlsPort !== v.port,
    },
  ],
);

/** Strict schema for a complete `HudConfig`, including cross-field rules. */
export const hudConfigSchema = z.object({
  version: z.literal(1),
  units: unitsSchema,
  vehicle: vehicleSchema,
  obd: obdSchema,
  display: displaySchema,
  shiftLight: shiftLightSchema,
  alerts: alertsSchema,
  maintenance: maintenanceSchema,
  trip: tripSchema,
  phone: phoneSchema,
  sensors: sensorsSchema,
  server: serverSchema,
});

/** Fails to compile if the schema drifts from the `HudConfig` contract. */
export type HudConfigSchemaMatchesContract = AssertTrue<
  Equals<z.infer<typeof hudConfigSchema>, HudConfig>
>;
