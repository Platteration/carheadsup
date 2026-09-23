import { describe, expect, it } from 'vitest';
import { LAYOUT_PRESETS, WIDGET_IDS, widgetPlacementsSchema } from '../../src/config/config.ts';
import { DRIVING_CONTEXTS } from '../../src/types/config.ts';
import type { DrivingContext, WidgetId, WidgetPlacement, Zone } from '../../src/types/config.ts';

const PRESETS = Object.entries(LAYOUT_PRESETS) as Array<[string, readonly WidgetPlacement[]]>;

const visibleIn = (preset: readonly WidgetPlacement[], context: DrivingContext): WidgetId[] =>
  preset.filter((w) => w.contexts.includes(context)).map((w) => w.id);

const find = (preset: readonly WidgetPlacement[], id: WidgetId): WidgetPlacement | undefined =>
  preset.find((w) => w.id === id);

describe('LAYOUT_PRESETS', () => {
  it('defines exactly the built-in presets', () => {
    expect(Object.keys(LAYOUT_PRESETS).sort()).toEqual(['minimal', 'sport', 'standard']);
  });

  it.each(PRESETS)(
    '%s passes the widget-list schema (unique ids, valid zones/contexts)',
    (_n, preset) => {
      const result = widgetPlacementsSchema.safeParse(preset);
      expect(result.error?.issues ?? []).toEqual([]);
      expect(new Set(preset.map((w) => w.id)).size).toBe(preset.length);
    },
  );

  it.each(PRESETS)(
    '%s never stacks more than two widgets in one zone per context',
    (_n, preset) => {
      for (const context of DRIVING_CONTEXTS) {
        const perZone = new Map<Zone, WidgetId[]>();
        for (const w of preset.filter((p) => p.contexts.includes(context))) {
          perZone.set(w.zone, [...(perZone.get(w.zone) ?? []), w.id]);
        }
        for (const [zone, ids] of perZone) {
          expect(ids.length, `${context}/${zone}: ${ids.join(', ')}`).toBeLessThanOrEqual(2);
        }
      }
    },
  );

  it.each(PRESETS)('%s keeps the essentials where the driver expects them', (_n, preset) => {
    expect(find(preset, 'speed')).toMatchObject({ zone: 'center' });
    expect(find(preset, 'speedLimit')).toMatchObject({ zone: 'right' });
    expect(['top-left', 'left']).toContain(find(preset, 'nav')?.zone);
    expect(find(preset, 'lanes')).toMatchObject({ zone: 'top' });
    for (const id of ['speed', 'speedLimit', 'nav', 'lanes', 'hazard'] as const) {
      for (const context of ['stopped', 'city', 'highway'] as const) {
        expect(find(preset, id)?.contexts, `${id} in ${context}`).toContain(context);
      }
    }
    // Speed is meaningless (and the dashboard owns the screen) once parked.
    expect(find(preset, 'speed')?.contexts).not.toContain('parked');
  });

  it.each(PRESETS)('%s shows the fewest widgets on the highway', (_n, preset) => {
    const highway = visibleIn(preset, 'highway').length;
    expect(highway).toBeLessThanOrEqual(visibleIn(preset, 'city').length);
    expect(visibleIn(preset, 'city').length).toBeLessThanOrEqual(
      visibleIn(preset, 'stopped').length,
    );
  });

  it('shares zones across presets so switching never moves common widgets', () => {
    const zoneById = new Map<WidgetId, Set<Zone>>();
    for (const [, preset] of PRESETS) {
      for (const w of preset) zoneById.set(w.id, (zoneById.get(w.id) ?? new Set()).add(w.zone));
    }
    for (const id of [
      'speed',
      'speedLimit',
      'nav',
      'lanes',
      'hazard',
      'coolant',
      'voltage',
      'tpms',
      'eta',
    ] as const) {
      expect(zoneById.get(id)?.size ?? 0, id).toBeLessThanOrEqual(1);
    }
  });

  it('minimal holds only the calm-driving essentials', () => {
    expect(LAYOUT_PRESETS.minimal.map((w) => w.id).sort()).toEqual(
      ['hazard', 'lanes', 'nav', 'speed', 'speedLimit'].sort(),
    );
  });

  it('standard adds vehicle health and low-speed comfort info with adaptive clutter', () => {
    const std = LAYOUT_PRESETS.standard;
    expect(std.map((w) => w.id).sort()).toEqual(
      [
        'speed',
        'speedLimit',
        'nav',
        'lanes',
        'hazard',
        'gear',
        'eta',
        'fuel',
        'coolant',
        'voltage',
        'tpms',
        'clock',
        'outsideTemp',
        'media',
        'tripSummary',
      ].sort(),
    );
    const highway = visibleIn(std, 'highway');
    expect(highway.length).toBeLessThan(visibleIn(std, 'city').length);
    for (const id of ['fuel', 'eta', 'clock', 'media', 'gear', 'tripSummary'] as const) {
      expect(highway, id).not.toContain(id);
    }
    for (const id of ['fuel', 'eta', 'clock', 'media'] as const) {
      expect(find(std, id)?.contexts).toEqual(expect.arrayContaining(['stopped', 'city']));
    }
    expect([...(find(std, 'tripSummary')?.contexts ?? [])].sort()).toEqual(['parked', 'stopped']);
    // Out-of-range warnings must be able to appear in every context.
    for (const id of ['coolant', 'voltage', 'tpms'] as const) {
      expect([...(find(std, id)?.contexts ?? [])].sort()).toEqual([...DRIVING_CONTEXTS].sort());
    }
    // Stopped is the richest driving context.
    expect(visibleIn(std, 'stopped').length).toBe(
      Math.max(...DRIVING_CONTEXTS.map((c) => visibleIn(std, c).length)),
    );
  });

  it('sport adds tachometer, boost and a prominent gear, kept on the highway', () => {
    const sport = LAYOUT_PRESETS.sport;
    for (const id of ['tachometer', 'boost', 'gear'] as const) {
      expect(find(sport, id)?.contexts, id).toEqual(expect.arrayContaining(['city', 'highway']));
    }
    // Prominent: right beside the speed, not stacked with anything else while driving.
    const gear = find(sport, 'gear');
    expect(gear?.zone).toBe('left');
    for (const context of ['city', 'highway'] as const) {
      const sharing = sport.filter((w) => w.zone === gear?.zone && w.contexts.includes(context));
      expect(sharing.map((w) => w.id)).toEqual(['gear']);
    }
    expect(sport.map((w) => w.id).sort()).toEqual([...WIDGET_IDS].sort());
  });

  it('lists placements in priority order (speed first)', () => {
    for (const [, preset] of PRESETS) expect(preset[0]?.id).toBe('speed');
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(LAYOUT_PRESETS)).toBe(true);
    expect(Object.isFrozen(LAYOUT_PRESETS.standard)).toBe(true);
    expect(Object.isFrozen(LAYOUT_PRESETS.standard[0])).toBe(true);
    expect(Object.isFrozen(LAYOUT_PRESETS.standard[0]?.contexts)).toBe(true);
  });
});
