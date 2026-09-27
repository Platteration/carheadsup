import { describe, expect, it } from 'vitest';
import type { CollisionLevel, WidgetFrame } from '@carheadsup/core';
import {
  directionalGlows,
  isApexNotice,
  readHudLayout,
  selectApexWidgets,
} from '../src/hud/apex/model.ts';

const quiet = { left: false, right: false, front: 'none' as const };
const speed: WidgetFrame = { id: 'speed', zone: 'center', value: 0, unit: 'mph', overLimit: false, overBy: null };

describe('Apex directional warnings', () => {
  it('renders no idle rails and does not invent a rear input', () => {
    expect(directionalGlows(quiet)).toEqual([]);
  });
  for (const direction of ['left', 'right'] as const) {
    it(`maps ${direction} blind-spot presence to that side only`, () => {
      expect(directionalGlows({ ...quiet, [direction]: true })).toEqual([
        { direction, severity: 'caution', label: `Vehicle in ${direction} blind spot` },
      ]);
    });
  }
  for (const direction of ['front', 'rear'] as const) {
    for (const severity of ['caution', 'warning'] as const) {
      it(`keeps ${direction} ${severity} independent of other directions`, () => {
        const result = directionalGlows({ ...quiet, [direction]: severity });
        expect(result).toHaveLength(1);
        expect(result[0]?.direction).toBe(direction);
        expect(result[0]?.severity).toBe(severity);
      });
    }
  }
  it('shows simultaneous warnings without replacing one direction with another', () => {
    const result = directionalGlows({ left: true, right: true, front: 'warning', rear: 'caution' });
    expect(result.map((g) => g.direction)).toEqual(['left', 'right', 'front', 'rear']);
  });
  it('does not reinterpret unknown input as a warning', () => {
    const invalid = 'danger' as unknown as CollisionLevel;
    expect(directionalGlows({ ...quiet, front: invalid, rear: invalid })).toEqual([]);
  });
  it('clears immediately when the supplied presentation state clears', () => {
    directionalGlows({ ...quiet, front: 'warning' });
    expect(directionalGlows(quiet)).toEqual([]);
  });
});

describe('Apex content selection', () => {
  it('keeps zero speed and display units verbatim', () => {
    const selected = selectApexWidgets([speed]);
    expect(selected.speed).toBe(speed);
    expect(selected.speed?.value).toBe(0);
    expect(selected.speed?.unit).toBe('mph');
  });
  it('never invents speed, RPM, gear, navigation or speed limits', () => {
    expect(selectApexWidgets([])).toEqual({
      speed: undefined, nav: undefined, limit: undefined, rpm: undefined, gear: undefined, notices: [],
    });
  });
  it('preserves the original widgets without mutating their configured zones', () => {
    const widgets = Object.freeze([Object.freeze({ ...speed, zone: 'left' as const })]);
    expect(selectApexWidgets(widgets).speed?.zone).toBe('left');
  });
  it('keeps inferred gear metadata', () => {
    const gear: WidgetFrame = { id: 'gear', zone: 'left', gear: '4', inferred: true };
    expect(selectApexWidgets([gear]).gear).toBe(gear);
  });
  it('hides quiet fuel, media and clock readouts', () => {
    const widgets: WidgetFrame[] = [
      { id: 'clock', zone: 'bottom', epochMs: 0, format: '24h' },
      { id: 'media', zone: 'bottom', title: 'Track', artist: null, playing: true },
    ];
    expect(selectApexWidgets(widgets).notices).toEqual([]);
  });
  it('retains coolant and voltage fault widgets', () => {
    const widgets: WidgetFrame[] = [
      { id: 'coolant', zone: 'right', value: 120, unit: '°C', status: 'critical' },
      { id: 'voltage', zone: 'right', value: 10, status: 'low' },
    ];
    expect(selectApexWidgets(widgets).notices).toEqual(widgets);
  });
  it('keeps ice risk but not ordinary outside temperature', () => {
    const w: WidgetFrame = { id: 'outsideTemp', zone: 'right', value: 2, unit: '°C', iceRisk: true };
    expect(isApexNotice(w)).toBe(true);
    expect(isApexNotice({ ...w, iceRisk: false })).toBe(false);
  });
  it('keeps low tyre pressure but not normal tyres', () => {
    const reading = { value: 220, low: false };
    const w: WidgetFrame = { id: 'tpms', zone: 'right', unit: 'kPa', fl: reading, fr: reading, rl: reading, rr: reading, anyLow: true };
    expect(isApexNotice(w)).toBe(true);
    expect(isApexNotice({ ...w, anyLow: false })).toBe(false);
  });
});

describe('Apex opt-in', () => {
  it('recognizes only the explicit supported layout', () => {
    expect(readHudLayout('?fixture=imperial-us&layout=apex')).toBe('apex');
  });
  for (const query of ['', '?layout=configured', '?layout=unknown', '?layout=APEX']) {
    it(`retains configured layout for ${JSON.stringify(query)}`, () => {
      expect(readHudLayout(query)).toBe('configured');
    });
  }
});
