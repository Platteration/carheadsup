import { cToF, kphToMph } from '@carheadsup/core';
import type {
  DeepPartial,
  DrivingContext,
  HudConfig,
  InputAction,
  LayoutPreset,
  SimControl,
  UnitsConfig,
} from '@carheadsup/core';
import { PANEL_SIZES } from '../dev/sim-model.ts';
import type { Backdrop, PanelSize } from '../dev/sim-model.ts';
import type { DemoStatus } from './engine.ts';

/** Pure helpers for the demo page: its choices, preferences, fault switches and readout. */

// ---------------------------------------------------------------------------------------------
// Screen

/** The two panel shapes offered: a 5:3 screen and a wide bar display. */
export const DEMO_PANELS: readonly PanelSize[] = PANEL_SIZES.filter((p) => p.height === 480);

export type PanelId = '800x480' | '1280x480';

export function panelById(id: PanelId): PanelSize {
  return DEMO_PANELS.find((p) => `${p.width}x${p.height}` === id) ?? DEMO_PANELS[0]!;
}

// ---------------------------------------------------------------------------------------------
// Units and layout (applied as config changes)

export type UnitChoice = 'metric' | 'imperial';
export type LayoutChoice = Exclude<LayoutPreset, 'custom'>;

/** The units each choice sets (US conventions for imperial; the currency is left alone). */
export const UNIT_SETS: Readonly<Record<UnitChoice, Omit<UnitsConfig, 'currency'>>> = {
  metric: {
    system: 'metric',
    fuelEconomy: 'L/100km',
    temperature: 'C',
    pressure: 'kPa',
    clock: '24h',
  },
  imperial: {
    system: 'imperial',
    fuelEconomy: 'mpg-us',
    temperature: 'F',
    pressure: 'psi',
    clock: '12h',
  },
};

export const LAYOUTS: ReadonlyArray<{ value: LayoutChoice; label: string }> = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'standard', label: 'Standard' },
  { value: 'sport', label: 'Sport' },
];

// ---------------------------------------------------------------------------------------------
// Preferences remembered on this device (a convenience: everything works without them)

export interface DemoPrefs {
  panel: PanelId;
  /** Show the road behind the glass. */
  backdrop: boolean;
  units: UnitChoice;
  layout: LayoutChoice;
  shiftLight: boolean;
}

export const DEFAULT_PREFS: DemoPrefs = {
  panel: '800x480',
  backdrop: false,
  units: 'metric',
  layout: 'standard',
  shiftLight: false,
};

export const PREFS_KEY = 'carheadsup.demo';

/** Stored preferences, validated field by field (anything unexpected falls back). */
export function parsePrefs(raw: string | null): DemoPrefs {
  let stored: Partial<Record<keyof DemoPrefs, unknown>> = {};
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) stored = parsed as typeof stored;
  } catch {
    stored = {};
  }
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  return {
    panel: pick<PanelId>(stored.panel, ['800x480', '1280x480'], DEFAULT_PREFS.panel),
    backdrop: pick(stored.backdrop, [true, false], DEFAULT_PREFS.backdrop),
    units: pick<UnitChoice>(stored.units, ['metric', 'imperial'], DEFAULT_PREFS.units),
    layout: pick(
      stored.layout,
      LAYOUTS.map((l) => l.value),
      DEFAULT_PREFS.layout,
    ),
    shiftLight: pick(stored.shiftLight, [true, false], DEFAULT_PREFS.shiftLight),
  };
}

/** The config changes for the display preferences. */
export function prefsConfig(
  prefs: Pick<DemoPrefs, 'units' | 'layout' | 'shiftLight'>,
): DeepPartial<HudConfig> {
  return {
    units: { ...UNIT_SETS[prefs.units] },
    display: { layout: { preset: prefs.layout } },
    shiftLight: { enabled: prefs.shiftLight },
  };
}

// ---------------------------------------------------------------------------------------------
// Environment

/** Also the name of the road scene drawn behind the glass. */
export type LightChoice = Exclude<Backdrop, 'none'>;

/**
 * Ambient light on the windshield. Day is the simulator's overcast daylight; dusk dims the display
 * but stays above the night palette's threshold (150 lx to leave it); night is a street-lit road,
 * under the night palette (below 50 lx).
 */
export const LIGHTS: ReadonlyArray<{ value: LightChoice; label: string; lux: number }> = [
  { value: 'day', label: 'Day', lux: 20_000 },
  { value: 'dusk', label: 'Dusk', lux: 300 },
  { value: 'night', label: 'Night', lux: 20 },
];

/** The light choice closest to `lux` (on a log scale). */
export function lightFromLux(lux: number): LightChoice {
  const log = Math.log10(Math.max(1, lux));
  let best = LIGHTS[0]!;
  for (const light of LIGHTS) {
    if (Math.abs(Math.log10(light.lux) - log) < Math.abs(Math.log10(best.lux) - log)) best = light;
  }
  return best.value;
}

export const AMBIENT_MIN_C = -20;
export const AMBIENT_MAX_C = 40;

// ---------------------------------------------------------------------------------------------
// Faults

export type FaultId = 'P0420' | 'P0300' | 'P0217' | 'battery' | 'fuel';

export interface FaultDef {
  id: FaultId;
  label: string;
  detail: string;
}

export const FAULTS: readonly FaultDef[] = [
  { id: 'P0420', label: 'P0420', detail: 'Catalyst' },
  { id: 'P0300', label: 'P0300', detail: 'Misfire' },
  { id: 'P0217', label: 'P0217', detail: 'Overheat' },
  { id: 'battery', label: 'Battery', detail: '11.6 V' },
  { id: 'fuel', label: 'Fuel', detail: '8 % left' },
];

/** Coolant temperature while overheating: above the default critical threshold (118 °C). */
export const OVERHEAT_C = 121;
export const LOW_BATTERY_V = 11.6;
export const LOW_FUEL_PCT = 8;

/** Which faults are active in the simulator. */
export function activeFaults(status: DemoStatus | null): ReadonlySet<FaultId> {
  const on = new Set<FaultId>();
  if (status === null) return on;
  for (const code of ['P0420', 'P0300', 'P0217'] as const) {
    if (status.dtcs.includes(code)) on.add(code);
  }
  if (status.voltageOverrideV !== null) on.add('battery');
  if (status.fuelLevelOverridePct !== null) on.add('fuel');
  return on;
}

/**
 * The simulator control that switches a fault on or off: a stored trouble code (P0217 also
 * drives the coolant past the critical temperature), or a voltage or fuel-level override.
 */
export function faultControl(id: FaultId, on: boolean, dtcs: readonly string[]): SimControl {
  switch (id) {
    case 'battery':
      return { voltageOverrideV: on ? LOW_BATTERY_V : null };
    case 'fuel':
      return { fuelLevelOverridePct: on ? LOW_FUEL_PCT : null };
    default: {
      const codes = dtcs.filter((code) => code !== id);
      const control: SimControl = { dtcs: on ? [...codes, id] : codes };
      if (id === 'P0217') control.coolantOverrideC = on ? OVERHEAT_C : null;
      return control;
    }
  }
}

/** Every fault off. */
export const CLEAR_FAULTS: SimControl = {
  dtcs: [],
  coolantOverrideC: null,
  voltageOverrideV: null,
  fuelLevelOverridePct: null,
};

// ---------------------------------------------------------------------------------------------
// Driver inputs

export interface DriverButton {
  action: InputAction;
  label: string;
  /** Shortcut shown on the button. */
  keys: string;
  title: string;
}

export const DRIVER_BUTTONS: readonly DriverButton[] = [
  { action: 'primary', label: 'Accept', keys: 'Enter', title: 'Accept a call or acknowledge' },
  { action: 'secondary', label: 'Dismiss', keys: 'Esc', title: 'Decline or end a call, dismiss' },
  { action: 'next-page', label: 'Dashboard', keys: '→', title: 'Open the dashboard at a stop' },
  { action: 'toggle-blank', label: 'Blank', keys: 'B', title: 'Blank or restore the display' },
  { action: 'brightness-down', label: 'Dimmer', keys: '−', title: 'Trim brightness down' },
  { action: 'brightness-up', label: 'Brighter', keys: '+', title: 'Trim brightness up' },
];

// ---------------------------------------------------------------------------------------------
// Status readout

const CONTEXT_LABELS: Readonly<Record<DrivingContext, string>> = {
  parked: 'Parked',
  stopped: 'Stopped',
  city: 'City',
  highway: 'Highway',
};

/** "0:32" */
export function formatMinutes(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatTemperature(celsius: number, units: UnitChoice): string {
  return units === 'imperial' ? `${Math.round(cToF(celsius))} °F` : `${Math.round(celsius)} °C`;
}

export interface ReadoutPart {
  /** A muted prefix, or null when the value speaks for itself. */
  label: string | null;
  /** The label may be left out where space is short. */
  optional?: boolean;
  value: string;
}

/** The one-line status under the HUD: context, speed, gear and where the script is. */
export function readout(
  context: DrivingContext | null,
  status: DemoStatus | null,
  units: UnitChoice,
): ReadoutPart[] {
  if (status === null) return [{ label: null, value: 'Starting' }];
  const speed =
    units === 'imperial'
      ? `${Math.round(kphToMph(status.speedKph))} mph`
      : `${Math.round(status.speedKph)} km/h`;
  // Like the transmission's report: neutral while standing with the engine off.
  const standing = !status.engineRunning && status.speedKph < 1;
  const gear = standing || status.gear === 0 ? 'N' : String(status.gear);
  const { script } = status;
  return [
    { label: null, value: context === null ? '–' : CONTEXT_LABELS[context] },
    { label: null, value: speed },
    { label: 'Gear', value: gear },
    script === null
      ? { label: null, value: 'Manual driving' }
      : {
          label: `Script ${script.index + 1}/${script.count}`,
          optional: true,
          value: `${script.step} ${formatMinutes(script.elapsedS)}/${formatMinutes(script.durationS)}`,
        },
  ];
}
