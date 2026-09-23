import {
  DRIVING_CONTEXTS,
  LAYOUT_PRESETS,
  LAYOUT_ZONES,
  WIDGET_IDS,
  computeShiftLight,
  displaySpeed,
  speedUnitLabel,
} from '@carheadsup/core';
import type {
  DrivingContext,
  HudFrame,
  LayoutPreset,
  ShiftLightConfig,
  UnitSystem,
  WidgetFrame,
  WidgetId,
  WidgetPlacement,
  Zone,
} from '@carheadsup/core';
import { FIXTURE_TIME, SAMPLE_FRAMES } from '../../hud/fixtures.ts';

/**
 * Layout editing and the live layout preview. The preview re-zones realistic sample widgets
 * (taken from the renderer's fixtures) according to the chosen placements, so the real `HudView`
 * shows what the driver would see in each driving context.
 */

export type BuiltinPreset = Exclude<LayoutPreset, 'custom'>;

export const BUILTIN_PRESETS: readonly BuiltinPreset[] = ['minimal', 'standard', 'sport'];

export const PRESET_INFO: Readonly<Record<LayoutPreset, { label: string; blurb: string }>> = {
  minimal: { label: 'Minimal', blurb: 'Speed, limit and guidance only' },
  standard: { label: 'Standard', blurb: 'Adds vehicle health and low-speed info' },
  sport: { label: 'Sport', blurb: 'Gear, tachometer and boost up front' },
  custom: { label: 'Custom', blurb: 'Your own placement for every widget' },
};

export const WIDGET_LABELS: Readonly<Record<WidgetId, string>> = {
  speed: 'Speed',
  speedLimit: 'Speed limit',
  tachometer: 'Tachometer',
  gear: 'Gear',
  nav: 'Turn arrow',
  lanes: 'Lane guidance',
  eta: 'ETA',
  hazard: 'Hazards & cameras',
  fuel: 'Fuel & range',
  coolant: 'Coolant (when hot)',
  voltage: 'Battery (when abnormal)',
  tpms: 'Tyre pressures',
  clock: 'Clock',
  outsideTemp: 'Outside temperature',
  media: 'Now playing',
  boost: 'Boost',
  tripSummary: 'Trip summary',
};

export const ZONE_LABELS: Readonly<Record<Zone, string>> = {
  'top-left': 'Top left',
  top: 'Top',
  'top-right': 'Top right',
  left: 'Left',
  center: 'Centre',
  right: 'Right',
  'bottom-left': 'Bottom left',
  bottom: 'Bottom',
  'bottom-right': 'Bottom right',
};

export const CONTEXT_LABELS: Readonly<Record<DrivingContext, string>> = {
  parked: 'Parked',
  stopped: 'Stopped',
  city: 'City',
  highway: 'Highway',
};

/**
 * Widgets the composer shows only in the moment (guidance active, a hazard close, a reading out
 * of range). The preview can hide them to show the everyday look.
 */
export const SITUATIONAL_WIDGETS: ReadonlySet<WidgetId> = new Set<WidgetId>([
  'nav',
  'lanes',
  'hazard',
  'coolant',
  'voltage',
  'tpms',
]);

/** A realistic sample of every widget, from the renderer fixtures (first occurrence wins). */
export const PREVIEW_WIDGETS: Readonly<Partial<Record<WidgetId, WidgetFrame>>> = (() => {
  const out: Partial<Record<WidgetId, WidgetFrame>> = {};
  for (const frame of Object.values(SAMPLE_FRAMES)) {
    for (const widget of frame.widgets) {
      if (out[widget.id] === undefined) out[widget.id] = widget;
    }
  }
  return out;
})();

/** Speeds that look plausible for each context. */
const PREVIEW_SPEED: Readonly<Record<DrivingContext, number>> = {
  parked: 0,
  stopped: 0,
  city: 42,
  highway: 112,
};
const PREVIEW_LIMIT: Readonly<Record<DrivingContext, number>> = {
  parked: 50,
  stopped: 50,
  city: 50,
  highway: 120,
};

function sampleWidget(id: WidgetId, context: DrivingContext): WidgetFrame | null {
  const sample = PREVIEW_WIDGETS[id];
  if (sample === undefined) return null;
  if (sample.id === 'speed') {
    return { ...sample, value: PREVIEW_SPEED[context], overLimit: false, overBy: null };
  }
  if (sample.id === 'speedLimit') {
    return { ...sample, value: PREVIEW_LIMIT[context], unlimited: false };
  }
  return sample;
}

export interface PreviewOptions {
  /** Include situational widgets (see {@link SITUATIONAL_WIDGETS}). */
  situational: boolean;
}

/**
 * A HUD frame showing `placements` in `context`: each placed widget (first placement per id, in
 * priority order) whose contexts include `context`, re-zoned per its placement. The parked
 * diagnostics dashboard is left out so the widget grid itself is visible.
 */
export function buildLayoutPreviewFrame(
  placements: readonly WidgetPlacement[],
  context: DrivingContext,
  options: PreviewOptions,
): HudFrame {
  const widgets: WidgetFrame[] = [];
  const seen = new Set<WidgetId>();
  for (const placement of placements) {
    if (seen.has(placement.id) || !placement.contexts.includes(context)) continue;
    seen.add(placement.id);
    if (!options.situational && SITUATIONAL_WIDGETS.has(placement.id)) continue;
    const sample = sampleWidget(placement.id, context);
    if (sample !== null) widgets.push({ ...sample, zone: placement.zone });
  }
  return {
    at: FIXTURE_TIME,
    context,
    blanked: false,
    theme: { night: false, brightness: 1 },
    widgets,
    alerts: [],
    toast: null,
    call: null,
    shiftLight: null,
    blindSpot: { left: false, right: false },
    collision: 'none',
    diagnostics: null,
    status: { obd: 'connected', phone: true, simulated: false },
  };
}

/**
 * A sport-layout frame at `rpm` for the shift-light preview: speed, gear, tachometer and the
 * shift bar computed by the core with `shiftLight` (forced on, so the bar shows while tuning).
 */
export function buildShiftPreviewFrame(
  rpm: number,
  shiftLight: ShiftLightConfig,
  redlineRpm: number,
  system: UnitSystem = 'metric',
): HudFrame {
  const base = buildLayoutPreviewFrame([], 'highway', { situational: false });
  const fraction = redlineRpm > 0 ? Math.min(1, Math.max(0, rpm / redlineRpm)) : 0;
  return {
    ...base,
    widgets: [
      {
        id: 'speed',
        zone: 'center',
        value: displaySpeed(97, system),
        unit: speedUnitLabel(system),
        overLimit: false,
        overBy: null,
      },
      { id: 'gear', zone: 'left', gear: '3', inferred: false },
      { id: 'tachometer', zone: 'bottom', rpm: Math.round(rpm), fraction, redlineRpm },
    ],
    shiftLight: computeShiftLight(rpm, { ...shiftLight, enabled: true }),
  };
}

// ---------------------------------------------------------------------------------------------
// Custom layout editing (all functions return new arrays)

export function clonePlacements(placements: readonly WidgetPlacement[]): WidgetPlacement[] {
  return placements.map((p) => ({ id: p.id, zone: p.zone, contexts: [...p.contexts] }));
}

/** The starting point for a custom layout: a copy of a preset. */
export function customFromPreset(preset: BuiltinPreset): WidgetPlacement[] {
  return clonePlacements(LAYOUT_PRESETS[preset]);
}

/** Where a widget goes when first added to a custom layout: its zone in a preset, else bottom. */
export function defaultZoneFor(id: WidgetId): Zone {
  for (const preset of ['standard', 'sport', 'minimal'] as const) {
    const found = LAYOUT_PRESETS[preset].find((p) => p.id === id);
    if (found) return found.zone;
  }
  return 'bottom';
}

export interface EditorRow {
  id: WidgetId;
  zone: Zone;
  contexts: readonly DrivingContext[];
  /** Index in the placement list (priority), or null when not placed. */
  index: number | null;
}

/** Every widget for the editor: placed ones in priority order, then the rest. */
export function editorRows(placements: readonly WidgetPlacement[]): EditorRow[] {
  const rows: EditorRow[] = [];
  const seen = new Set<WidgetId>();
  placements.forEach((p, index) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    rows.push({ id: p.id, zone: p.zone, contexts: p.contexts, index });
  });
  for (const id of WIDGET_IDS) {
    if (!seen.has(id)) rows.push({ id, zone: defaultZoneFor(id), contexts: [], index: null });
  }
  return rows;
}

export function setWidgetZone(
  placements: readonly WidgetPlacement[],
  id: WidgetId,
  zone: Zone,
): WidgetPlacement[] {
  const out = clonePlacements(placements);
  const found = out.find((p) => p.id === id);
  if (found) found.zone = zone;
  else out.push({ id, zone, contexts: [] });
  return out;
}

/**
 * Turn a widget on or off in one context. A widget not yet placed is appended (lowest priority)
 * at its default zone; contexts stay in canonical order.
 */
export function setWidgetContext(
  placements: readonly WidgetPlacement[],
  id: WidgetId,
  context: DrivingContext,
  enabled: boolean,
): WidgetPlacement[] {
  const out = clonePlacements(placements);
  let found = out.find((p) => p.id === id);
  if (!found) {
    if (!enabled) return out;
    found = { id, zone: defaultZoneFor(id), contexts: [] };
    out.push(found);
  }
  const set = new Set(found.contexts);
  if (enabled) set.add(context);
  else set.delete(context);
  found.contexts = DRIVING_CONTEXTS.filter((c) => set.has(c));
  return out;
}

/** Move a placed widget up (−1) or down (+1) in priority. Out-of-range moves are no-ops. */
export function moveWidget(
  placements: readonly WidgetPlacement[],
  id: WidgetId,
  delta: -1 | 1,
): WidgetPlacement[] {
  const out = clonePlacements(placements);
  const from = out.findIndex((p) => p.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= out.length) return out;
  const [item] = out.splice(from, 1);
  if (item) out.splice(to, 0, item);
  return out;
}

export interface CrowdedZone {
  context: DrivingContext;
  zone: Zone;
  ids: WidgetId[];
}

/** Zones holding more than `limit` everyday (non-situational) widgets in some context. */
export function crowdedZones(placements: readonly WidgetPlacement[], limit = 2): CrowdedZone[] {
  const out: CrowdedZone[] = [];
  for (const context of DRIVING_CONTEXTS) {
    for (const zone of LAYOUT_ZONES) {
      const seen = new Set<WidgetId>();
      const ids: WidgetId[] = [];
      for (const p of placements) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        if (p.zone === zone && p.contexts.includes(context) && !SITUATIONAL_WIDGETS.has(p.id)) {
          ids.push(p.id);
        }
      }
      if (ids.length > limit) out.push({ context, zone, ids });
    }
  }
  return out;
}
