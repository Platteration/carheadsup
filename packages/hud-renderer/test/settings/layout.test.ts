import { LAYOUT_PRESETS, WIDGET_IDS, widgetPlacementsSchema } from '@carheadsup/core';
import type { WidgetPlacement } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_WIDGETS,
  SITUATIONAL_WIDGETS,
  buildLayoutPreviewFrame,
  buildShiftPreviewFrame,
  crowdedZones,
  customFromPreset,
  defaultZoneFor,
  editorRows,
  moveWidget,
  setWidgetContext,
  setWidgetZone,
} from '../../src/settings/model/layout.ts';
import { sweepRpm } from '../../src/settings/sections/shift-light.tsx';

describe('preview widgets', () => {
  it('has a sample for every widget id', () => {
    for (const id of WIDGET_IDS) expect(PREVIEW_WIDGETS[id]?.id).toBe(id);
  });
});

describe('buildLayoutPreviewFrame', () => {
  const standard = LAYOUT_PRESETS.standard;

  it('shows the widgets placed in the chosen context, re-zoned per placement, in priority order', () => {
    const frame = buildLayoutPreviewFrame(standard, 'city', { situational: true });
    const expected = standard.filter((p) => p.contexts.includes('city'));
    expect(frame.widgets.map((w) => w.id)).toEqual(expected.map((p) => p.id));
    expect(frame.widgets.map((w) => w.zone)).toEqual(expected.map((p) => p.zone));
    expect(frame.context).toBe('city');
    expect(frame.diagnostics).toBeNull();
  });

  it('shows less on the highway (adaptive clutter) and can hide situational widgets', () => {
    const highway = buildLayoutPreviewFrame(standard, 'highway', { situational: false });
    expect(highway.widgets.map((w) => w.id)).toEqual(['speed', 'speedLimit']);
    const everyday = buildLayoutPreviewFrame(standard, 'city', { situational: false });
    expect(everyday.widgets.some((w) => SITUATIONAL_WIDGETS.has(w.id))).toBe(false);
  });

  it('uses the placement zone, not the sample’s', () => {
    const custom: WidgetPlacement[] = [{ id: 'speed', zone: 'bottom-left', contexts: ['city'] }];
    const frame = buildLayoutPreviewFrame(custom, 'city', { situational: true });
    expect(frame.widgets).toHaveLength(1);
    expect(frame.widgets[0]).toMatchObject({ id: 'speed', zone: 'bottom-left' });
  });

  it('matches speeds to the context and ignores duplicate placements', () => {
    const placements: WidgetPlacement[] = [
      { id: 'speed', zone: 'center', contexts: ['highway', 'stopped'] },
      { id: 'speed', zone: 'top', contexts: ['highway'] },
    ];
    const highway = buildLayoutPreviewFrame(placements, 'highway', { situational: true });
    expect(highway.widgets).toHaveLength(1);
    expect(highway.widgets[0]).toMatchObject({ zone: 'center', value: 112 });
    const stopped = buildLayoutPreviewFrame(placements, 'stopped', { situational: true });
    expect(stopped.widgets[0]).toMatchObject({ value: 0, overLimit: false });
  });

  it('draws an empty grid for an empty layout', () => {
    expect(buildLayoutPreviewFrame([], 'parked', { situational: true }).widgets).toEqual([]);
  });
});

describe('buildShiftPreviewFrame', () => {
  const shift = { enabled: false, startRpm: 4500, shiftRpm: 6000, flashRpm: 6300 };

  it('computes the bar with the core rules even when the light is disabled', () => {
    expect(buildShiftPreviewFrame(3000, shift, 6500).shiftLight).toBeNull();
    expect(buildShiftPreviewFrame(5250, shift, 6500).shiftLight).toEqual({
      level: 0.5,
      flash: false,
    });
    expect(buildShiftPreviewFrame(6400, shift, 6500).shiftLight).toEqual({ level: 1, flash: true });
  });

  it('clamps the tachometer fraction and follows the unit system', () => {
    const frame = buildShiftPreviewFrame(7000, shift, 6500, 'imperial');
    expect(frame.widgets.find((w) => w.id === 'tachometer')).toMatchObject({
      fraction: 1,
      rpm: 7000,
    });
    expect(frame.widgets.find((w) => w.id === 'speed')).toMatchObject({ unit: 'mph', value: 60 });
    expect(
      buildShiftPreviewFrame(100, shift, 0).widgets.find((w) => w.id === 'tachometer'),
    ).toMatchObject({ fraction: 0 });
  });
});

describe('sweepRpm', () => {
  it('sweeps revs up with acceleration and loops', () => {
    expect(sweepRpm(0, 800, 7000)).toBe(800);
    expect(sweepRpm(1500, 800, 7000)).toBeCloseTo(800 + 6200 * 0.25, 6);
    expect(sweepRpm(3000, 800, 7000)).toBe(800);
    expect(sweepRpm(-750, 800, 7000)).toBeCloseTo(800 + 6200 * 0.5625, 6);
  });
});

describe('custom layout editing', () => {
  it('starts from a copy of a preset', () => {
    const custom = customFromPreset('sport');
    expect(custom).toEqual(LAYOUT_PRESETS.sport);
    custom[0]!.contexts.push('parked');
    expect(LAYOUT_PRESETS.sport[0]!.contexts).not.toContain('parked');
  });

  it('lists placed widgets first in priority order, then the rest', () => {
    const rows = editorRows(customFromPreset('minimal'));
    expect(rows).toHaveLength(WIDGET_IDS.length);
    expect(rows.slice(0, 5).map((r) => r.id)).toEqual(LAYOUT_PRESETS.minimal.map((p) => p.id));
    expect(rows.slice(5).every((r) => r.index === null && r.contexts.length === 0)).toBe(true);
    expect(rows.find((r) => r.id === 'tachometer')?.zone).toBe('bottom');
  });

  it('changes zones and contexts without mutating the input', () => {
    const base = customFromPreset('minimal');
    const moved = setWidgetZone(base, 'speed', 'top');
    expect(moved.find((p) => p.id === 'speed')?.zone).toBe('top');
    expect(base.find((p) => p.id === 'speed')?.zone).toBe('center');

    const added = setWidgetContext(base, 'clock', 'city', true);
    expect(added.at(-1)).toEqual({ id: 'clock', zone: 'bottom-right', contexts: ['city'] });
    const both = setWidgetContext(added, 'clock', 'parked', true);
    expect(both.at(-1)?.contexts).toEqual(['parked', 'city']);
    const removed = setWidgetContext(both, 'clock', 'city', false);
    expect(removed.at(-1)?.contexts).toEqual(['parked']);
    expect(setWidgetContext(base, 'boost', 'city', false)).toEqual(base);
    expect(setWidgetZone(base, 'boost', 'left').at(-1)).toEqual({
      id: 'boost',
      zone: 'left',
      contexts: [],
    });
  });

  it('moves widgets in priority and ignores moves off either end', () => {
    const base = customFromPreset('minimal');
    expect(
      moveWidget(base, 'speedLimit', -1)
        .map((p) => p.id)
        .slice(0, 2),
    ).toEqual(['speedLimit', 'speed']);
    expect(moveWidget(base, 'speed', -1)).toEqual(base);
    expect(moveWidget(base, 'hazard', 1)).toEqual(base);
    expect(moveWidget(base, 'boost', 1)).toEqual(base);
  });

  it('keeps edited layouts valid for the server', () => {
    let layout = customFromPreset('standard');
    layout = setWidgetContext(layout, 'boost', 'highway', true);
    layout = setWidgetZone(layout, 'boost', 'top-right');
    layout = moveWidget(layout, 'boost', -1);
    expect(widgetPlacementsSchema.safeParse(layout).success).toBe(true);
  });

  it('flags zones crowded with everyday widgets', () => {
    expect(crowdedZones(customFromPreset('standard'))).toEqual([]);
    let layout = customFromPreset('minimal');
    layout = setWidgetContext(setWidgetZone(layout, 'clock', 'center'), 'clock', 'city', true);
    layout = setWidgetContext(setWidgetZone(layout, 'gear', 'center'), 'gear', 'city', true);
    expect(crowdedZones(layout)).toEqual([
      { context: 'city', zone: 'center', ids: ['speed', 'clock', 'gear'] },
    ]);
  });

  it('knows default zones', () => {
    expect(defaultZoneFor('boost')).toBe('bottom-right');
    expect(defaultZoneFor('speed')).toBe('center');
  });
});
