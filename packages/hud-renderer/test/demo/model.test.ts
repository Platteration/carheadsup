import { DEFAULT_CONFIG, mergeConfig } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import type { DemoStatus } from '../../src/demo/engine.ts';
import {
  CLEAR_FAULTS,
  DEFAULT_PREFS,
  DEMO_PANELS,
  LIGHTS,
  OVERHEAT_C,
  activeFaults,
  faultControl,
  formatMinutes,
  lightFromLux,
  parsePrefs,
  prefsConfig,
  readout,
} from '../../src/demo/model.ts';

function status(patch: Partial<DemoStatus> = {}): DemoStatus {
  return {
    mode: 'scenario',
    throttle: 0.2,
    brake: 0,
    engineRunning: true,
    gear: 3,
    speedKph: 48.6,
    rpm: 1900,
    dtcs: [],
    lux: 20_000,
    ambientTempC: 18,
    scenarioStep: 'city',
    coolantOverrideC: null,
    voltageOverrideV: null,
    fuelLevelOverridePct: null,
    tirePressuresKpa: null,
    adas: { blindSpotLeft: false, blindSpotRight: false, collision: 'none' },
    phone: { connected: true, steppedAside: false },
    script: { step: 'city', index: 1, count: 8, elapsedS: 32.4, durationS: 55 },
    ...patch,
  };
}

describe('demo preferences', () => {
  it('fall back field by field', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
    expect(
      parsePrefs(JSON.stringify({ panel: '1280x480', units: 'imperial', layout: 'huge', x: 1 })),
    ).toEqual({ ...DEFAULT_PREFS, panel: '1280x480', units: 'imperial' });
  });

  it('turn into a valid config change', () => {
    const patch = prefsConfig({ units: 'imperial', layout: 'sport', shiftLight: true });
    const { config, errors } = mergeConfig(DEFAULT_CONFIG, patch);
    expect(errors).toEqual([]);
    expect(config.units).toMatchObject({ system: 'imperial', temperature: 'F', pressure: 'psi' });
    expect(config.display.layout.preset).toBe('sport');
    expect(config.shiftLight.enabled).toBe(true);
  });

  it('offer the 5:3 panel and the wide bar', () => {
    expect(DEMO_PANELS.map((p) => `${p.width}x${p.height}`)).toEqual(['800x480', '1280x480']);
  });
});

describe('light choices', () => {
  it('match the night-palette thresholds of the default config', () => {
    const { nightEnterLux, nightExitLux } = DEFAULT_CONFIG.display.brightness;
    const lux = Object.fromEntries(LIGHTS.map((l) => [l.value, l.lux]));
    expect(lux['night']).toBeLessThan(nightEnterLux);
    expect(lux['dusk']).toBeGreaterThan(nightExitLux);
    for (const light of LIGHTS) expect(lightFromLux(light.lux)).toBe(light.value);
    expect(lightFromLux(0)).toBe('night');
    expect(lightFromLux(100_000)).toBe('day');
  });
});

describe('fault switches', () => {
  it('toggle codes and overrides, and report what is on', () => {
    expect(faultControl('P0420', true, ['P0300'])).toEqual({ dtcs: ['P0300', 'P0420'] });
    expect(faultControl('P0300', false, ['P0300', 'P0420'])).toEqual({ dtcs: ['P0420'] });
    expect(faultControl('P0217', true, [])).toEqual({
      dtcs: ['P0217'],
      coolantOverrideC: OVERHEAT_C,
    });
    expect(OVERHEAT_C).toBeGreaterThan(DEFAULT_CONFIG.alerts.coolantCriticalC);
    expect(faultControl('battery', true, [])).toEqual({ voltageOverrideV: 11.6 });
    expect(faultControl('fuel', false, [])).toEqual({ fuelLevelOverridePct: null });
    expect([
      ...activeFaults(status({ dtcs: ['P0217', 'U0100'], fuelLevelOverridePct: 8 })),
    ]).toEqual(['P0217', 'fuel']);
    expect(CLEAR_FAULTS).toEqual({
      dtcs: [],
      coolantOverrideC: null,
      voltageOverrideV: null,
      fuelLevelOverridePct: null,
    });
  });
});

describe('the readout', () => {
  it('shows context, speed, gear and the script step', () => {
    expect(readout('city', status(), 'metric')).toEqual([
      { label: null, value: 'City' },
      { label: null, value: '49 km/h' },
      { label: 'Gear', value: '3' },
      { label: 'Script 2/8', optional: true, value: 'city 0:32/0:55' },
    ]);
    const parked = readout(
      'stopped',
      status({ engineRunning: false, speedKph: 0, gear: 1, mode: 'manual', script: null }),
      'imperial',
    );
    expect(parked.map((p) => p.value)).toEqual(['Stopped', '0 mph', 'N', 'Manual driving']);
    expect(formatMinutes(90.9)).toBe('1:30');
  });
});
