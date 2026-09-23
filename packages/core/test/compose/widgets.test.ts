import { describe, expect, it } from 'vitest';
import { hazardLabel } from '../../src/compose/widgets.ts';
import type { HudConfig } from '../../src/types/config.ts';
import type { Hazard, Lane } from '../../src/types/nav.ts';
import {
  Harness,
  T0,
  makeConfig,
  mediaInfo,
  navInfo,
  roadInfo,
  widget,
  widgetIds,
  type SignalValues,
} from '../state/fixtures.ts';

const RATIOS = [120, 70, 48, 36, 29];

function hazard(overrides: Partial<Hazard> = {}): Hazard {
  return {
    id: 'h1',
    type: 'speed-camera',
    distanceM: 800,
    speedLimitKph: 120,
    delaySeconds: null,
    description: null,
    updatedAt: T0,
    ...overrides,
  };
}

/** Phone and OBD connected, driving steadily in town for a few seconds. */
function cityDrive(config: HudConfig = makeConfig(), values: SignalValues = {}): Harness {
  const h = new Harness(config);
  h.obdConnected(T0);
  h.phoneConnected(T0);
  h.run(T0 + 3000, { speed: 50, rpm: 2400, ...values });
  return h;
}

/** Sustained 110 km/h long enough to enter the highway context. */
function highwayDrive(config: HudConfig = makeConfig(), values: SignalValues = {}): Harness {
  const h = new Harness(config);
  h.obdConnected(T0);
  h.phoneConnected(T0);
  h.run(T0 + 12_000, { speed: 110, rpm: 2600, ...values }, 500);
  expect(h.state.context.context).toBe('highway');
  return h;
}

describe('layout and adaptive clutter', () => {
  it('keeps layout order and drops widgets without data', () => {
    const h = cityDrive(
      makeConfig({ vehicle: { transmission: 'manual', gearRatiosRpmPerKph: RATIOS } }),
      {
        fuelLevel: 60,
        ambientTemp: 17,
      },
    );
    h.send({ type: 'road/update', road: roadInfo(50), at: h.now });
    expect(widgetIds(h.frame())).toEqual([
      'speed',
      'speedLimit',
      'gear',
      'fuel',
      'outsideTemp',
      'clock',
    ]);
  });

  it('reduces clutter on the highway', () => {
    const h = highwayDrive(makeConfig(), { fuelLevel: 60, ambientTemp: 17 });
    h.send({ type: 'road/update', road: roadInfo(120), at: h.now });
    h.send({ type: 'media/update', media: mediaInfo(), at: h.now });
    expect(widgetIds(h.frame())).toEqual(['speed', 'speedLimit']);
  });

  it('honours a custom layout and zones', () => {
    const config = makeConfig({
      display: {
        layout: {
          preset: 'custom',
          widgets: [
            { id: 'clock', zone: 'top', contexts: ['city'] },
            { id: 'speed', zone: 'bottom-left', contexts: ['city', 'highway'] },
          ],
        },
      },
    });
    const h = cityDrive(config);
    expect(h.frame().widgets).toEqual([
      { id: 'clock', zone: 'top', epochMs: h.now, format: '24h' },
      { id: 'speed', zone: 'bottom-left', value: 50, unit: 'km/h', overLimit: false, overBy: null },
    ]);
  });
});

describe('speed and limit', () => {
  it('never shows an unknown speed as zero', () => {
    const h = new Harness();
    h.obdConnected(T0);
    h.samples(T0 + 100, { rpm: 800 });
    h.run(T0 + 3000, { speed: 30, rpm: 1500 });
    expect(widget(h.frame(), 'speed')?.value).toBe(30);
    h.idle(h.now + 2001, 2001);
    expect(widget(h.frame(), 'speed')).toBeUndefined();
  });

  it('turns red above the limit plus tolerance', () => {
    const h = cityDrive();
    h.send({ type: 'road/update', road: roadInfo(50), at: h.now });
    h.samples(h.now + 100, { speed: 53, rpm: 2400 }); // tolerance max(3 km/h, 5 %) = 3
    expect(widget(h.frame(), 'speed')).toMatchObject({ value: 53, overLimit: false, overBy: null });
    h.samples(h.now + 100, { speed: 64, rpm: 2400 });
    expect(widget(h.frame(), 'speed')).toMatchObject({ value: 64, overLimit: true, overBy: 14 });
    // At 100 km/h the percentage tolerance (5 km/h) is the larger one.
    h.send({ type: 'road/update', road: roadInfo(100), at: h.now });
    h.samples(h.now + 100, { speed: 105, rpm: 2400 });
    expect(widget(h.frame(), 'speed')?.overLimit).toBe(false);
    h.samples(h.now + 100, { speed: 106, rpm: 2400 });
    expect(widget(h.frame(), 'speed')).toMatchObject({ overLimit: true, overBy: 6 });
  });

  it('shows the limit only while the phone is connected', () => {
    const h = cityDrive();
    h.send({ type: 'road/update', road: roadInfo(30), at: h.now });
    expect(widget(h.frame(), 'speedLimit')).toEqual({
      id: 'speedLimit',
      zone: 'right',
      value: 30,
      unlimited: false,
      unit: 'km/h',
      style: 'vienna',
    });
    expect(widget(h.frame(), 'speed')?.overLimit).toBe(true);
    h.send({ type: 'phone/link', connected: false, at: h.now + 10 });
    h.samples(h.now + 100, { speed: 50, rpm: 2400 });
    expect(widget(h.frame(), 'speedLimit')).toBeUndefined();
    expect(widget(h.frame(), 'speed')?.overLimit).toBe(false);
  });

  it('shows an unlimited road without ever flagging overspeed', () => {
    const h = highwayDrive(makeConfig(), { speed: 180 });
    h.send({ type: 'road/update', road: roadInfo(null, { unlimited: true }), at: h.now });
    expect(widget(h.frame(), 'speedLimit')).toMatchObject({ value: null, unlimited: true });
    expect(widget(h.frame(), 'speed')?.overLimit).toBe(false);
  });

  it('hides an unknown limit', () => {
    const h = cityDrive();
    h.send({ type: 'road/update', road: roadInfo(null), at: h.now });
    expect(widget(h.frame(), 'speedLimit')).toBeUndefined();
  });

  it('converts to mph with a MUTCD sign', () => {
    const config = makeConfig({
      units: { system: 'imperial' },
      display: { speedLimitSign: 'mutcd' },
    });
    const h = cityDrive(config, { speed: 72 });
    h.send({ type: 'road/update', road: roadInfo(72.42), at: h.now }); // 45 mph
    expect(widget(h.frame(), 'speed')).toMatchObject({ value: 45, unit: 'mph' });
    expect(widget(h.frame(), 'speedLimit')).toMatchObject({
      value: 45,
      unit: 'mph',
      style: 'mutcd',
    });
  });
});

describe('engine widgets', () => {
  const sport = makeConfig({
    display: { layout: { preset: 'sport' } },
    vehicle: { transmission: 'manual', gearRatiosRpmPerKph: RATIOS },
  });

  it('shows the tachometer with the engine running', () => {
    const h = cityDrive(sport, { rpm: 3250 });
    expect(widget(h.frame(), 'tachometer')).toEqual({
      id: 'tachometer',
      zone: 'bottom',
      rpm: 3250,
      fraction: 0.5,
      redlineRpm: 6500,
    });
  });

  it('shows the inferred gear, or the reported one', () => {
    const h = cityDrive(sport);
    expect(widget(h.frame(), 'gear')).toEqual({
      id: 'gear',
      zone: 'left',
      gear: '3',
      inferred: true,
    });
    h.run(h.now + 1000, { speed: 50, rpm: 2400, transmissionGear: 4 });
    expect(widget(h.frame(), 'gear')).toMatchObject({ gear: '4', inferred: false });
  });

  it('never shows a gear for a CVT', () => {
    const h = cityDrive(
      makeConfig({
        display: { layout: { preset: 'sport' } },
        vehicle: { transmission: 'cvt', gearRatiosRpmPerKph: RATIOS },
      }),
    );
    expect(widget(h.frame(), 'gear')).toBeUndefined();
  });

  it('shows boost from MAP and baro, falling back to standard pressure', () => {
    const config = makeConfig({
      display: { layout: { preset: 'sport' } },
      units: { pressure: 'bar' },
    });
    const h = cityDrive(config, { map: 180, baroPressure: 100 });
    expect(widget(h.frame(), 'boost')).toEqual({
      id: 'boost',
      zone: 'bottom-right',
      value: 0.8,
      unit: 'bar',
      fraction: 0.692,
    });
    const noBaro = cityDrive(config, { map: 40 });
    expect(widget(noBaro.frame(), 'boost')).toMatchObject({ value: -0.61, fraction: 0.149 });
  });

  it('shows coolant only when hot', () => {
    const h = cityDrive(makeConfig(), { coolantTemp: 109 });
    expect(widget(h.frame(), 'coolant')).toBeUndefined();
    h.samples(h.now + 100, { coolantTemp: 112, speed: 50, rpm: 2400 });
    expect(widget(h.frame(), 'coolant')).toEqual({
      id: 'coolant',
      zone: 'bottom-left',
      value: 112,
      unit: '°C',
      status: 'hot',
    });
    h.samples(h.now + 100, { coolantTemp: 121, speed: 50, rpm: 2400 });
    expect(widget(h.frame(), 'coolant')).toMatchObject({ status: 'critical' });
  });

  it('shows voltage only outside the alert thresholds', () => {
    const h = cityDrive(makeConfig(), { batteryVoltage: 13.9 });
    expect(widget(h.frame(), 'voltage')).toBeUndefined();
    h.samples(h.now + 100, { batteryVoltage: 12.14, speed: 50, rpm: 2400 });
    expect(widget(h.frame(), 'voltage')).toEqual({
      id: 'voltage',
      zone: 'bottom-left',
      value: 12.1,
      status: 'low',
    });
    h.samples(h.now + 100, { batteryVoltage: 15.6, speed: 50, rpm: 2400 });
    expect(widget(h.frame(), 'voltage')).toMatchObject({ status: 'high' });
    // Engine off: 12.1 V is a normal resting voltage.
    const parked = new Harness();
    parked.samples(T0 + 100, { batteryVoltage: 12.1 });
    expect(widget(parked.frame(), 'voltage')).toBeUndefined();
    parked.samples(T0 + 200, { batteryVoltage: 11.8 });
    expect(widget(parked.frame(), 'voltage')).toMatchObject({ status: 'low' });
  });
});

describe('navigation widgets', () => {
  const lanes: Lane[] = [
    { directions: ['straight'], recommended: false },
    { directions: ['slight-right'], recommended: true, activeDirection: 'slight-right' },
  ];

  it('dead-reckons the distance to the maneuver', () => {
    const h = cityDrive(makeConfig(), { speed: 36 }); // 10 m/s
    h.send({ type: 'nav/update', nav: navInfo({ distanceToManeuverM: 500 }), at: h.now });
    expect(widget(h.frame(), 'nav')).toEqual({
      id: 'nav',
      zone: 'top-left',
      maneuver: { type: 'right' },
      distance: { value: 500, unit: 'm', text: '500 m' },
      street: 'Main Street',
      then: null,
      iconPng: null,
      imminent: false,
      approach: null,
    });
    h.run(h.now + 10_000, { speed: 36, rpm: 1800 }); // 100 m
    expect(widget(h.frame(), 'nav')?.distance?.text).toBe('400 m');
    h.run(h.now + 25_000, { speed: 36, rpm: 1800 }); // 150 m to go
    expect(widget(h.frame(), 'nav')).toMatchObject({ imminent: true, approach: 0.5 });
    h.run(h.now + 20_000, { speed: 36, rpm: 1800 }); // overshoot
    expect(widget(h.frame(), 'nav')).toMatchObject({
      distance: { value: 0, unit: 'm', text: '0 m' },
      approach: 1,
    });
  });

  it("carries the phone's maneuver icon only when the maneuver is unknown", () => {
    const icon =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const h = cityDrive();
    h.send({
      type: 'nav/update',
      nav: navInfo({ maneuver: { type: 'left' }, iconPng: icon }),
      at: h.now,
    });
    // A known maneuver is drawn by the renderer: no image in the frame.
    expect(widget(h.frame(), 'nav')).toMatchObject({ maneuver: { type: 'left' }, iconPng: null });
    h.send({
      type: 'nav/update',
      nav: navInfo({ maneuver: { type: 'unknown' }, iconPng: icon }),
      at: h.now,
    });
    expect(widget(h.frame(), 'nav')).toMatchObject({
      maneuver: { type: 'unknown' },
      iconPng: icon,
    });
    h.send({
      type: 'nav/update',
      nav: navInfo({ maneuver: { type: 'unknown' }, iconPng: null }),
      at: h.now,
    });
    expect(widget(h.frame(), 'nav')?.iconPng).toBeNull();
  });

  it('keeps instruction text off the screen while moving', () => {
    const h = cityDrive();
    h.send({
      type: 'nav/update',
      nav: navInfo({
        maneuver: { type: 'left', instruction: 'Turn left onto Baker Street' },
        thenManeuver: { type: 'right', instruction: 'Then turn right' },
      }),
      at: h.now,
    });
    expect(widget(h.frame(), 'nav')).toMatchObject({
      maneuver: { type: 'left', instruction: null },
      then: { type: 'right', instruction: null },
    });
    h.run(h.now + 3000, { speed: 0, rpm: 800 });
    expect(h.state.context.context).toBe('stopped');
    expect(widget(h.frame(), 'nav')?.maneuver.instruction).toBe('Turn left onto Baker Street');
  });

  it('hides guidance on the highway until the maneuver comes within range', () => {
    const h = highwayDrive(makeConfig(), { speed: 108 }); // 30 m/s
    h.send({ type: 'nav/update', nav: navInfo({ distanceToManeuverM: 2600, lanes }), at: h.now });
    expect(widget(h.frame(), 'nav')).toBeUndefined();
    h.run(h.now + 21_000, { speed: 108, rpm: 2600 }, 500); // 630 m → 1970 m
    expect(widget(h.frame(), 'nav')?.distance?.text).toBe('2.0 km');
    expect(widget(h.frame(), 'lanes')).toBeUndefined();
    h.run(h.now + 40_000, { speed: 108, rpm: 2600 }, 500); // 1200 m → 770 m
    expect(widget(h.frame(), 'lanes')).toEqual({ id: 'lanes', zone: 'top', lanes });
  });

  it('hides guidance without a distance on the highway', () => {
    const h = highwayDrive();
    h.send({ type: 'nav/update', nav: navInfo({ distanceToManeuverM: null }), at: h.now });
    expect(widget(h.frame(), 'nav')).toBeUndefined();
    const city = cityDrive();
    city.send({ type: 'nav/update', nav: navInfo({ distanceToManeuverM: null }), at: city.now });
    expect(widget(city.frame(), 'nav')?.distance).toBeNull();
  });

  it('shows lanes in town only within reveal range and when present', () => {
    const h = cityDrive(makeConfig(), { speed: 36 });
    h.send({ type: 'nav/update', nav: navInfo({ distanceToManeuverM: 900, lanes }), at: h.now });
    expect(widget(h.frame(), 'lanes')).toBeUndefined();
    h.run(h.now + 11_000, { speed: 36, rpm: 1800 });
    expect(widget(h.frame(), 'lanes')?.lanes).toEqual(lanes);
    h.send({
      type: 'nav/update',
      nav: navInfo({ distanceToManeuverM: 300, lanes: [] }),
      at: h.now,
    });
    expect(widget(h.frame(), 'lanes')).toBeUndefined();
  });

  it('shows the ETA with the dead-reckoned remaining distance', () => {
    const config = makeConfig({ units: { clock: '12h' } });
    const h = cityDrive(config, { speed: 36 });
    const eta = h.now + 18 * 60_000;
    h.send({
      type: 'nav/update',
      nav: navInfo({ etaEpochMs: eta, remainingDistanceM: 9500, remainingSeconds: 1070 }),
      at: h.now,
    });
    h.run(h.now + 10_000, { speed: 36, rpm: 1800 });
    expect(widget(h.frame(), 'eta')).toEqual({
      id: 'eta',
      zone: 'top-left',
      etaEpochMs: eta,
      clock: '12h',
      remainingMinutes: 18,
      remainingDistance: { value: 9.4, unit: 'km', text: '9.4 km' },
    });
    h.send({
      type: 'nav/update',
      nav: navInfo({
        etaEpochMs: h.now + 5 * 60_000,
        remainingSeconds: null,
        remainingDistanceM: null,
      }),
      at: h.now,
    });
    expect(widget(h.frame(), 'eta')).toMatchObject({
      remainingMinutes: 5,
      remainingDistance: null,
    });
    h.send({
      type: 'nav/update',
      nav: navInfo({ etaEpochMs: null, remainingSeconds: null, remainingDistanceM: null }),
      at: h.now,
    });
    expect(widget(h.frame(), 'eta')).toBeUndefined();
  });

  it('shows the nearest hazard ahead within range', () => {
    const h = highwayDrive(makeConfig(), { speed: 108 });
    h.send({
      type: 'hazards/update',
      hazards: [
        hazard({ id: 'far', distanceM: 1500 }),
        hazard({
          id: 'jam',
          type: 'traffic-jam',
          distanceM: 900,
          speedLimitKph: null,
          delaySeconds: 400,
        }),
        hazard({ id: 'unknown', distanceM: null }),
      ],
      at: h.now,
    });
    expect(widget(h.frame(), 'hazard')).toEqual({
      id: 'hazard',
      zone: 'top-right',
      type: 'traffic-jam',
      distance: { value: 900, unit: 'm', text: '900 m' },
      speedLimit: null,
      limitStyle: 'vienna',
      delayMinutes: 7,
      label: 'Traffic jam',
    });
    h.run(h.now + 31_000, { speed: 108, rpm: 2600 }, 500); // 930 m: passed the jam
    expect(widget(h.frame(), 'hazard')).toMatchObject({
      type: 'speed-camera',
      distance: { text: '550 m' },
      speedLimit: 120,
      label: 'Speed camera',
    });
  });

  it('draws a camera limit in the driver’s sign style and speed unit', () => {
    const config = makeConfig({
      units: { system: 'imperial' },
      display: { speedLimitSign: 'mutcd' },
    });
    const h = highwayDrive(config, { speed: 110 });
    h.send({
      type: 'hazards/update',
      hazards: [hazard({ distanceM: 600, speedLimitKph: 104.6 })], // 65 mph
      at: h.now,
    });
    expect(widget(h.frame(), 'hazard')).toMatchObject({
      type: 'speed-camera',
      speedLimit: 65,
      limitStyle: 'mutcd',
    });
  });

  it('labels hazards glanceably', () => {
    expect(hazardLabel(hazard({ type: 'road-works' }))).toBe('Road works');
    expect(
      hazardLabel(hazard({ type: 'other', description: 'Stalled vehicle on the right shoulder' })),
    ).toBe('Stalled vehicle on the…');
    expect(hazardLabel(hazard({ type: 'other', description: '  ' }))).toBe('Hazard');
  });
});

describe('fuel, tyres and comfort', () => {
  it('shows fuel readings, with instant economy only while speed is fresh', () => {
    const h = cityDrive(makeConfig(), { fuelLevel: 58, maf: 10 });
    const fuel = widget(h.frame(), 'fuel');
    expect(fuel).toMatchObject({
      zone: 'left',
      unit: 'L/100km',
      levelPct: 58,
      rangeUnit: 'km',
      low: false,
    });
    expect(fuel?.instant).toBeGreaterThan(5);
    // No persisted average and less than 1 km driven: no average yet.
    expect(fuel?.average).toBeNull();
    h.run(h.now + 3000, { fuelLevel: 58 }); // speed goes stale
    expect(widget(h.frame(), 'fuel')?.instant).toBeNull();
    expect(widget(h.frame(), 'fuel')?.levelPct).toBe(58);
  });

  it('flags a low tank and converts to US units', () => {
    const config = makeConfig({ units: { system: 'imperial', fuelEconomy: 'mpg-us' } });
    const h = new Harness(config, {
      odometerKm: null,
      learnedGearRatios: null,
      avgLPer100km: 8,
      maintenanceRecords: [],
    });
    h.obdConnected(T0);
    h.run(T0 + 2000, { speed: 0, rpm: 800, fuelLevel: 10 });
    h.run(T0 + 4000, { speed: 0, rpm: 800, fuelLevel: 10 });
    const fuel = widget(h.frame(), 'fuel');
    // 5 L at 8 L/100 km = 62.5 km ≈ 39 mi; 8 L/100 km ≈ 29.4 mpg.
    expect(fuel).toMatchObject({
      unit: 'mpg-us',
      average: 29.4,
      range: 39,
      rangeUnit: 'mi',
      levelPct: 10,
      low: true,
    });
  });

  it('shows nothing without any fuel data', () => {
    const h = cityDrive();
    expect(widget(h.frame(), 'fuel')).toBeUndefined();
  });

  it('shows tyre pressures while moving only when one is low', () => {
    const config = makeConfig({ vehicle: { hasTpms: true } });
    const tyres = {
      tirePressureFL: 231,
      tirePressureFR: 229,
      tirePressureRL: 226,
      tirePressureRR: 226,
    };
    const h = cityDrive(config, tyres);
    expect(widget(h.frame(), 'tpms')).toBeUndefined();
    h.samples(h.now + 100, { ...tyres, tirePressureRL: 168, speed: 50, rpm: 2400 });
    expect(widget(h.frame(), 'tpms')).toEqual({
      id: 'tpms',
      zone: 'right',
      unit: 'kPa',
      fl: { value: 231, low: false },
      fr: { value: 229, low: false },
      rl: { value: 168, low: true },
      rr: { value: 226, low: false },
      anyLow: true,
    });
    const parked = new Harness(config);
    parked.samples(T0 + 100, { tirePressureFL: 230 });
    expect(widget(parked.frame(), 'tpms')).toMatchObject({
      fl: { value: 230, low: false },
      fr: { value: null, low: false },
      anyLow: false,
    });
  });

  it('never shows tyres for a vehicle without TPMS', () => {
    const h = new Harness();
    h.samples(T0 + 100, { tirePressureFL: 100 });
    expect(widget(h.frame(), 'tpms')).toBeUndefined();
  });

  it('always shows the clock (where the layout allows)', () => {
    const h = new Harness(makeConfig({ units: { clock: '12h' } }));
    expect(widget(h.frame(), 'clock')).toEqual({
      id: 'clock',
      zone: 'bottom-right',
      epochMs: T0,
      format: '12h',
    });
  });

  it('shows the outside temperature with the ice-risk flag', () => {
    const h = new Harness(makeConfig({ units: { temperature: 'F' } }));
    h.samples(T0 + 100, { ambientTemp: 2 });
    expect(widget(h.frame(), 'outsideTemp')).toEqual({
      id: 'outsideTemp',
      zone: 'bottom-right',
      value: 36,
      unit: '°F',
      iceRisk: true,
    });
    h.idle(T0 + 100 + 121_000, 121_000);
    expect(widget(h.frame(), 'outsideTemp')).toBeUndefined();
  });

  it('shows what is playing while the phone is connected', () => {
    const h = cityDrive();
    h.send({ type: 'media/update', media: mediaInfo(), at: h.now });
    expect(widget(h.frame(), 'media')).toEqual({
      id: 'media',
      zone: 'bottom',
      title: 'Midnight City',
      artist: 'M83',
      playing: true,
    });
    h.send({ type: 'media/update', media: mediaInfo({ playing: false }), at: h.now });
    expect(widget(h.frame(), 'media')).toBeUndefined();
    h.send({ type: 'media/update', media: mediaInfo({ title: null }), at: h.now });
    expect(widget(h.frame(), 'media')).toBeUndefined();
    h.send({ type: 'media/update', media: mediaInfo(), at: h.now });
    h.send({ type: 'phone/link', connected: false, at: h.now });
    expect(widget(h.frame(), 'media')).toBeUndefined();
  });

  it('summarises the current trip at rest, in the driver’s units', () => {
    const config = makeConfig({
      units: { system: 'imperial', fuelEconomy: 'mpg-uk', currency: 'GBP' },
    });
    const h = cityDrive(config, { speed: 90, fuelRate: 6 });
    h.run(h.now + 60_000, { speed: 90, rpm: 2400, fuelRate: 6 }, 500);
    h.run(h.now + 3000, { speed: 0, rpm: 800, fuelRate: 0.8 });
    expect(h.state.context.context).toBe('stopped');
    const trip = h.state.trip.current;
    const summary = widget(h.frame(), 'tripSummary');
    expect(summary).toMatchObject({
      zone: 'bottom',
      economyUnit: 'mpg-uk',
      fuelUnit: 'gal',
      currency: 'GBP',
      durationS: trip?.durationS,
    });
    expect(summary?.distance.unit).toBe('mi');
    expect(summary?.distance.value).toBeCloseTo((trip?.distanceKm ?? 0) / 1.609344, 1);
    expect(summary?.fuelUsed).toBeCloseTo((trip?.fuelUsedL ?? 0) / 4.54609, 2);
    expect(summary?.cost).toBe(trip?.cost);
    // Not while moving.
    h.run(h.now + 2000, { speed: 40, rpm: 2000 });
    expect(widget(h.frame(), 'tripSummary')).toBeUndefined();
  });
});
