import { DEFAULT_CONFIG, mergeConfig, parseConfig } from '@carheadsup/core';
import type { HudConfig } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  cloneJson,
  diffConfig,
  diffValue,
  getAt,
  jsonEqual,
  leafPaths,
  omitPath,
  pathKey,
  pathWithin,
  pickPath,
  rebaseDraft,
  setAt,
} from '../../src/settings/model/diff.ts';
import { livePatch, pendingPatch } from '../../src/settings/state/useConfigEditor.ts';

function config(): HudConfig {
  return parseConfig(DEFAULT_CONFIG).config;
}

describe('jsonEqual', () => {
  it('compares structurally, ignoring key order', () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual(Number.NaN, Number.NaN)).toBe(true);
  });
});

describe('diffConfig', () => {
  it('is empty when nothing changed', () => {
    expect(diffConfig(config(), config())).toEqual({});
  });

  it('contains only the changed leaves, nested under their parents', () => {
    const base = config();
    const next = setAt(
      setAt(base, ['display', 'brightness', 'minLevel'], 0.2),
      ['units', 'system'],
      'imperial',
    );
    expect(diffConfig(base, next)).toEqual({
      display: { brightness: { minLevel: 0.2 } },
      units: { system: 'imperial' },
    });
  });

  it('replaces arrays and tuples wholesale', () => {
    const base = config();
    const corners = { ...base.display.projection.corners, tl: [0.02, 0.01] as [number, number] };
    const next = setAt(base, ['display', 'projection', 'corners'], corners);
    expect(diffConfig(base, next)).toEqual({
      display: { projection: { corners: { tl: [0.02, 0.01] } } },
    });

    const withGears = setAt(base, ['vehicle', 'gearRatiosRpmPerKph'], [120, 67, 46]);
    expect(diffConfig(base, withGears)).toEqual({
      vehicle: { gearRatiosRpmPerKph: [120, 67, 46] },
    });
    const oneGearChanged = setAt(withGears, ['vehicle', 'gearRatiosRpmPerKph', 1], 70);
    expect(diffConfig(withGears, oneGearChanged)).toEqual({
      vehicle: { gearRatiosRpmPerKph: [120, 70, 46] },
    });
  });

  it('handles null ↔ object changes as a replacement', () => {
    const base = config();
    const located = setAt(base, ['sensors', 'fallbackLocation'], { lat: 48.1, lon: 11.6 });
    expect(diffConfig(base, located)).toEqual({
      sensors: { fallbackLocation: { lat: 48.1, lon: 11.6 } },
    });
    expect(diffConfig(located, base)).toEqual({ sensors: { fallbackLocation: null } });
  });

  it('produces patches the server merges back into the edited config', () => {
    const base = config();
    let next = setAt(base, ['alerts', 'coolantHighC'], 105);
    next = setAt(next, ['phone', 'showMedia'], false);
    next = setAt(
      next,
      ['obd', 'customPids'],
      [
        {
          signal: 'oilTemp',
          mode: '22',
          pid: '1310',
          header: '7E0',
          formula: 'A-40',
          intervalMs: 2000,
        },
      ],
    );
    const merged = mergeConfig(base, diffConfig(base, next));
    expect(merged.errors).toEqual([]);
    expect(merged.config).toEqual(next);
  });

  it('does not share references with its inputs', () => {
    const base = config();
    const next = setAt(base, ['vehicle', 'gearRatiosRpmPerKph'], [100, 50]);
    const patch = diffConfig(base, next);
    patch.vehicle?.gearRatiosRpmPerKph?.push(1);
    expect(next.vehicle.gearRatiosRpmPerKph).toEqual([100, 50]);
  });
});

describe('diffValue', () => {
  it('returns undefined for equal values and a copy otherwise', () => {
    expect(diffValue(1, 1)).toBeUndefined();
    expect(diffValue({ a: { b: 1 } }, { a: { b: 1 } })).toBeUndefined();
    expect(diffValue('x', 'y')).toBe('y');
  });
});

describe('applyPatch', () => {
  it('merges objects, replaces arrays and null, skips undefined', () => {
    const base = {
      a: { b: 1, c: 2 },
      list: [1, 2, 3],
      loc: { lat: 1, lon: 2 } as { lat: number; lon: number } | null,
    };
    const out = applyPatch(base, { a: { b: 5, c: undefined }, list: [9], loc: null });
    expect(out).toEqual({ a: { b: 5, c: 2 }, list: [9], loc: null });
    expect(base.a.b).toBe(1);
  });

  it('with an undefined patch returns an equal copy', () => {
    const base = config();
    const copy = applyPatch(base, undefined);
    expect(copy).toEqual(base);
    expect(copy).not.toBe(base);
  });
});

describe('rebaseDraft', () => {
  it('keeps pending edits on top of a new server config', () => {
    const oldBase = config();
    const draft = setAt(oldBase, ['units', 'system'], 'imperial');
    // The server meanwhile accepted a live projection change.
    const newBase = setAt(oldBase, ['display', 'projection', 'scale'], 0.9);
    const rebased = rebaseDraft(oldBase, newBase, draft);
    expect(rebased.units.system).toBe('imperial');
    expect(rebased.display.projection.scale).toBe(0.9);
  });

  it('leaves rejected fields edited and accepted ones equal to the new base', () => {
    const oldBase = config();
    // minLevel 0.95 > maxLevel 0.5 breaks a cross-field rule, so the server reverts one of them.
    let draft = setAt(oldBase, ['display', 'brightness', 'minLevel'], 0.95);
    draft = setAt(draft, ['display', 'brightness', 'maxLevel'], 0.5);
    const result = mergeConfig(oldBase, diffConfig(oldBase, draft));
    expect(result.errors.length).toBeGreaterThan(0);
    const rebased = rebaseDraft(oldBase, result.config, draft);
    expect(rebased).toEqual(draft);
    expect(diffConfig(result.config, rebased)).not.toEqual({});
  });
});

describe('paths', () => {
  it('formats paths like the server does', () => {
    expect(pathKey(['display', 'brightness', 'minLevel'])).toBe('display.brightness.minLevel');
    expect(pathKey(['obd', 'customPids', 0, 'pid'])).toBe('obd.customPids[0].pid');
    expect(pathKey([])).toBe('');
  });

  it('checks containment on segment boundaries', () => {
    expect(pathWithin('a.b.c', 'a.b')).toBe(true);
    expect(pathWithin('a.b[0]', 'a.b')).toBe(true);
    expect(pathWithin('a.b', 'a.b')).toBe(true);
    expect(pathWithin('a.bc', 'a.b')).toBe(false);
    expect(pathWithin('a', 'a.b')).toBe(false);
    expect(pathWithin('anything', '')).toBe(true);
  });

  it('lists leaf paths with arrays as leaves', () => {
    expect(leafPaths({ a: { b: 1, c: [1, 2] }, d: null, e: undefined })).toEqual([
      'a.b',
      'a.c',
      'd',
    ]);
    expect(leafPaths({})).toEqual([]);
  });

  it('reads and writes nested values immutably, sharing untouched branches', () => {
    const base = config();
    const next = setAt(base, ['obd', 'customPids'], [{ signal: 'oilTemp' }]);
    expect(getAt(next, ['obd', 'customPids', 0, 'signal'])).toBe('oilTemp');
    expect(getAt(next, ['obd', 'nope', 3])).toBeUndefined();
    expect(next.units).toBe(base.units);
    expect(base.obd.customPids).toEqual([]);
    expect(setAt({ list: [1, 2] }, ['list', 1], 5)).toEqual({ list: [1, 5] });
    expect(setAt(undefined, ['x', 'y'], 1)).toEqual({ x: { y: 1 } });
  });

  it('omits and picks subtrees of a patch', () => {
    const patch = {
      display: { projection: { scale: 0.9 }, maxAlerts: 3 },
      units: { system: 'imperial' },
    };
    expect(omitPath(patch, ['display', 'projection'])).toEqual({
      display: { maxAlerts: 3 },
      units: { system: 'imperial' },
    });
    expect(omitPath({ display: { projection: { scale: 1 } } }, ['display', 'projection'])).toEqual(
      {},
    );
    expect(omitPath(patch, ['missing'])).toBe(patch);
    expect(pickPath(patch, ['display', 'projection'])).toEqual({
      display: { projection: { scale: 0.9 } },
    });
    expect(pickPath(patch, ['units', 'clock'])).toBeUndefined();
  });

  it('clones deeply', () => {
    const value = { a: [{ b: 1 }] };
    const copy = cloneJson(value);
    copy.a[0]!.b = 2;
    expect(value.a[0]!.b).toBe(1);
  });
});

describe('editor patches', () => {
  it('keeps live subtrees out of the Save patch and in the live patch', () => {
    const base = config();
    let draft = setAt(base, ['display', 'projection', 'mirrorY'], true);
    draft = setAt(draft, ['display', 'maxAlerts'], 3);
    expect(pendingPatch(base, draft)).toEqual({ display: { maxAlerts: 3 } });
    expect(livePatch(base, draft, ['display', 'projection'])).toEqual({
      display: { projection: { mirrorY: true } },
    });
    expect(livePatch(base, base, ['display', 'projection'])).toBeNull();
    expect(pendingPatch(base, setAt(base, ['display', 'projection', 'scale'], 1.2))).toEqual({});
  });
});
