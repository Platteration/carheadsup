import { INPUT_ACTIONS } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { parsePrefs } from '../../src/dev/App.tsx';
import { fixtureTitle } from '../../src/dev/Gallery.tsx';
import {
  GEAR_CHOICES,
  INPUT_BUTTONS,
  LUX_MAX,
  LUX_MIN,
  PANEL_SIZES,
  QUICK_DTCS,
  checkDtcEntry,
  describeLux,
  isEditableTarget,
  luxFromSlider,
  sanitizeTyre,
  sliderFromLux,
  toggleDtc,
} from '../../src/dev/sim-model.ts';

describe('logarithmic lux slider', () => {
  it('spans 1 to 100 000 lx over the slider', () => {
    expect(luxFromSlider(0)).toBe(LUX_MIN);
    expect(luxFromSlider(1)).toBe(LUX_MAX);
    expect(luxFromSlider(0.2)).toBe(10);
    expect(luxFromSlider(0.6)).toBe(1000);
    expect(luxFromSlider(0.5)).toBe(320);
  });

  it('clamps and survives garbage', () => {
    expect(luxFromSlider(-1)).toBe(1);
    expect(luxFromSlider(2)).toBe(100_000);
    expect(luxFromSlider(Number.NaN)).toBe(1);
  });

  it('inverts', () => {
    for (const lux of [1, 10, 250, 12_000, 100_000]) {
      expect(luxFromSlider(sliderFromLux(lux))).toBeCloseTo(lux, -1);
    }
    expect(sliderFromLux(0)).toBe(0);
    expect(sliderFromLux(1e9)).toBe(1);
    expect(sliderFromLux(Number.NaN)).toBe(0);
  });

  it('describes light levels with a familiar scene', () => {
    expect(describeLux(2)).toBe('2 lx · dark road');
    expect(describeLux(50)).toBe('50 lx · street lights');
    expect(describeLux(1500)).toBe('1.5 k lx · overcast');
    expect(describeLux(12_000)).toBe('12 k lx · daylight');
    expect(describeLux(100_000)).toBe('100 k lx · direct sun');
  });
});

describe('trouble codes', () => {
  it('offers the five quick codes, all valid', () => {
    expect(QUICK_DTCS).toEqual(['P0420', 'P0300', 'P0217', 'P0562', 'U0100']);
    for (const code of QUICK_DTCS) expect(checkDtcEntry(code).ok).toBe(true);
  });

  it('toggles codes without duplicates', () => {
    expect(toggleDtc([], 'p0420', true)).toEqual(['P0420']);
    expect(toggleDtc(['P0420'], 'P0420', true)).toEqual(['P0420']);
    expect(toggleDtc(['P0420', 'P0300'], ' p0420 ', false)).toEqual(['P0300']);
    expect(toggleDtc(['P0300'], 'U0100', false)).toEqual(['P0300']);
  });

  it('validates typed codes and names them', () => {
    expect(checkDtcEntry(' p0301 ')).toEqual({
      ok: true,
      code: 'P0301',
      label: expect.stringMatching(/^P0301 – .+/) as string,
    });
    expect(checkDtcEntry('')).toEqual({ ok: false, error: 'Type a code such as P0301' });
    expect(checkDtcEntry('X1234').ok).toBe(false);
    expect(checkDtcEntry('P042').ok).toBe(false);
  });
});

describe('controls', () => {
  it('offers auto, neutral and six gears', () => {
    expect(GEAR_CHOICES.map((g) => g.value)).toEqual([null, 0, 1, 2, 3, 4, 5, 6]);
  });

  it('has a button for every driver input', () => {
    expect(INPUT_BUTTONS.map((b) => b.action).sort()).toEqual([...INPUT_ACTIONS].sort());
  });

  it('lists the four panel sizes', () => {
    expect(PANEL_SIZES.map((p) => `${p.width}x${p.height}`)).toEqual([
      '800x480',
      '1024x600',
      '1280x480',
      '1920x720',
    ]);
  });

  it('keeps tyre pressures plausible', () => {
    expect(sanitizeTyre(231.4, 230)).toBe(231);
    expect(sanitizeTyre(-5, 230)).toBe(230);
    expect(sanitizeTyre(900, 230)).toBe(230);
    expect(sanitizeTyre(Number.NaN, 220)).toBe(220);
  });

  it('only treats real elements that take keys as editable', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });
});

describe('preferences', () => {
  it('falls back field by field', () => {
    expect(parsePrefs(null)).toEqual({ tab: 'live', panel: 0, backdrop: 'night' });
    expect(parsePrefs('{"tab":"gallery","panel":3,"backdrop":"day"}')).toEqual({
      tab: 'gallery',
      panel: 3,
      backdrop: 'day',
    });
    expect(parsePrefs('{"tab":"x","panel":9,"backdrop":"fog"}')).toEqual({
      tab: 'live',
      panel: 0,
      backdrop: 'night',
    });
    expect(parsePrefs('{"panel":1.5}')).toMatchObject({ panel: 0 });
    expect(parsePrefs('not json')).toEqual({ tab: 'live', panel: 0, backdrop: 'night' });
    expect(parsePrefs('[1,2]')).toEqual({ tab: 'live', panel: 0, backdrop: 'night' });
  });

  it('lets the URL hash pick the tab', () => {
    expect(parsePrefs('{"tab":"live"}', '#gallery').tab).toBe('gallery');
    expect(parsePrefs('{"tab":"gallery"}', '#live').tab).toBe('live');
    expect(parsePrefs('{"tab":"gallery"}', '#other').tab).toBe('gallery');
  });
});

describe('small formatters', () => {
  it('titles fixtures', () => {
    expect(fixtureTitle('highway-exit-lanes')).toBe('Highway exit lanes');
    expect(fixtureTitle('blanked')).toBe('Blanked');
  });
});
