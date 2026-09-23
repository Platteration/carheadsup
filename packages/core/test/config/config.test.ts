import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  LAYOUT_PRESETS,
  hudConfigSchema,
  mergeConfig,
  parseConfig,
  resolveLayout,
} from '../../src/config/config.ts';
import { defaultMaintenanceItems } from '../../src/maintenance/maintenance.ts';
import type { DeepPartial, HudConfig } from '../../src/types/config.ts';

/** A mutable deep copy of the defaults. */
const defaults = (): HudConfig => JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as HudConfig;

/** Build a sparse object `{a: {b: {c: value}}}` from a dotted path. */
function at(path: string, value: unknown): Record<string, unknown> {
  return path
    .split('.')
    .reverse()
    .reduce<unknown>((acc, key) => ({ [key]: acc }), value) as Record<string, unknown>;
}

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], obj);
}

describe('DEFAULT_CONFIG', () => {
  it('passes its own strict schema', () => {
    const result = hudConfigSchema.safeParse(DEFAULT_CONFIG);
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('round-trips through parseConfig without errors', () => {
    const { config, errors } = parseConfig(DEFAULT_CONFIG);
    expect(errors).toEqual([]);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config).not.toBe(DEFAULT_CONFIG);
  });

  it('is deeply frozen so no consumer can corrupt the shared defaults', () => {
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.display.brightness.curve)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.display.brightness.curve[0])).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.maintenance.items[0])).toBe(true);
    expect(() => {
      (DEFAULT_CONFIG.vehicle as { name: string }).name = 'x';
    }).toThrow(TypeError);
  });

  it('has the documented defaults', () => {
    const c = DEFAULT_CONFIG;
    expect(c.units).toEqual({
      system: 'metric',
      fuelEconomy: 'L/100km',
      temperature: 'C',
      pressure: 'kPa',
      clock: '24h',
      currency: 'USD',
    });
    expect(c.vehicle).toMatchObject({
      name: 'My car',
      fuelType: 'gasoline',
      tankCapacityL: 50,
      displacementL: 2,
      volumetricEfficiency: 0.85,
      transmission: 'automatic',
      redlineRpm: 6500,
      idleRpm: 750,
      gearRatiosRpmPerKph: null,
      fuelPricePerL: 1.8,
      hasTpms: false,
    });
    expect(c.obd).toEqual({
      transport: 'serial',
      serialPath: '/dev/rfcomm0',
      baudRate: 38400,
      tcpHost: '192.168.0.10',
      tcpPort: 35000,
      protocol: '0',
      timeoutMs: 1000,
      reconnectDelayMs: 3000,
      dtcIntervalMs: 30000,
      customPids: [],
    });
    expect(c.display.projection.mirrorX).toBe(true);
    expect(c.display.projection.mirrorY).toBe(false);
    expect(c.display.projection.corners).toEqual({
      tl: [0, 0],
      tr: [1, 0],
      br: [1, 1],
      bl: [0, 1],
    });
    const b = c.display.brightness;
    expect(b).toMatchObject({
      mode: 'auto',
      manualLevel: 0.8,
      minLevel: 0.08,
      maxLevel: 1,
      riseTimeMs: 3000,
      fallTimeMs: 400,
      nightMode: 'sensor',
      nightEnterLux: 50,
      nightExitLux: 150,
      nightSunElevationDeg: -4,
    });
    expect(b.curve[0]?.[0]).toBeLessThanOrEqual(1);
    expect(b.curve.at(-1)?.[0]).toBeGreaterThanOrEqual(100_000);
    expect(c.display.layout.preset).toBe('standard');
    expect(c.display.context).toEqual({
      highwayEnterKph: 80,
      highwayExitKph: 65,
      highwayDwellMs: 10000,
      stationaryKph: 2,
      parkedAfterMs: 120000,
    });
    expect(c.display).toMatchObject({
      speedLimitSign: 'vienna',
      mediaToastMs: 5000,
      messageToastMs: 6000,
      highwayNavRevealM: 2000,
      laneRevealM: 800,
      hazardRevealM: 1000,
      maxAlerts: 2,
    });
    expect(c.shiftLight).toEqual({
      enabled: false,
      startRpm: 4500,
      shiftRpm: 6000,
      flashRpm: 6300,
    });
    expect(c.alerts).toEqual({
      coolantHighC: 110,
      coolantCriticalC: 118,
      coolantHysteresisC: 3,
      voltageLowRunningV: 12.2,
      voltageLowOffV: 11.9,
      voltageHighV: 15.3,
      voltageHysteresisV: 0.3,
      overspeedToleranceKph: 3,
      overspeedTolerancePct: 5,
      fuelLowPct: 12,
      tpmsLowKpa: 180,
      iceRiskC: 3,
      showDtcWhileDriving: false,
    });
    expect(c.trip).toEqual({ endAfterEngineOffMs: 300000, minDistanceKm: 0.2 });
    expect(c.phone).toEqual({
      pairingToken: '',
      showMessageSender: true,
      readMessagesAloud: true,
      showMedia: true,
    });
    expect(c.sensors).toEqual({
      lightSensor: 'none',
      gestureSensor: 'none',
      i2cBus: 1,
      lightSensorGain: 1,
      buttons: { primary: null, secondary: null, next: null },
      fallbackLocation: null,
      adasUdpPort: null,
    });
    expect(c.server).toEqual({
      port: 8080,
      host: '0.0.0.0',
      apiToken: '',
      mdns: true,
      frameRate: 15,
    });
  });

  it('ships a maintenance schedule led by oil changes', () => {
    const items = DEFAULT_CONFIG.maintenance.items;
    expect(items.length).toBeGreaterThanOrEqual(6);
    const oil = items[0];
    expect(oil).toMatchObject({
      intervalKm: 8000,
      intervalDays: 365,
      warnBeforeKm: 500,
      warnBeforeDays: 14,
    });
    for (const item of items) {
      expect(item.intervalKm !== null || item.intervalDays !== null).toBe(true);
    }
  });

  it("uses the maintenance module's default schedule (one source of truth)", () => {
    expect(DEFAULT_CONFIG.maintenance.items).toEqual(defaultMaintenanceItems());
    expect(parseConfig({}).config.maintenance.items).toEqual(defaultMaintenanceItems());
  });
});

describe('parseConfig', () => {
  it('fills missing fields from the defaults silently', () => {
    expect(parseConfig({})).toEqual({ config: DEFAULT_CONFIG, errors: [] });
    const { config, errors } = parseConfig({ vehicle: { name: 'Golf' } });
    expect(errors).toEqual([]);
    expect(config.vehicle.name).toBe('Golf');
    expect(config.vehicle.redlineRpm).toBe(6500);
  });

  it.each([
    ['null', null, 'null'],
    ['an array', [1, 2], 'array'],
    ['a string', 'config', 'string'],
    ['a number', 42, 'number'],
    ['undefined', undefined, 'undefined'],
  ])('falls back entirely when the input is %s', (_label, input, got) => {
    const { config, errors } = parseConfig(input);
    expect(errors).toEqual([`(root): expected object, got ${got}`]);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('ignores unknown keys at every level', () => {
    const { config, errors } = parseConfig({
      bogus: 1,
      display: { bogus: 2, brightness: { bogus: 3 } },
    });
    expect(errors).toEqual([]);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect('bogus' in config).toBe(false);
  });

  it.each<[string, unknown, string]>([
    ['display.brightness.minLevel', 5, 'display.brightness.minLevel: expected number <= 1'],
    ['display.brightness.minLevel', -0.1, 'display.brightness.minLevel: expected number >= 0'],
    ['vehicle.tankCapacityL', '50', 'vehicle.tankCapacityL: expected number, got string'],
    ['server.port', 80.5, 'server.port: expected integer, got 80.5'],
    [
      'server.frameRate',
      Number.POSITIVE_INFINITY,
      'server.frameRate: expected number, got Infinity',
    ],
    ['server.frameRate', Number.NaN, 'server.frameRate: expected number, got NaN'],
    ['obd.tcpPort', null, 'obd.tcpPort: expected number, got null'],
    ['units.system', 'nautical', 'units.system: expected one of "metric", "imperial"'],
    [
      'display.projection.rotation',
      45,
      'display.projection.rotation: expected one of 0, 90, 180, 270',
    ],
    ['vehicle.name', '', 'vehicle.name: must not be empty'],
    ['vehicle.name', 'x'.repeat(61), 'vehicle.name: expected at most 60 characters'],
    ['units.currency', 'usd', 'units.currency: expected a 3-letter ISO 4217 code such as "USD"'],
    ['phone.showMedia', 'yes', 'phone.showMedia: expected boolean, got string'],
    ['display.context', 42, 'display.context: expected object, got number'],
    ['display', [], 'display: expected object, got array'],
    ['version', 2, 'version: expected 1'],
    [
      'obd.protocol',
      'D',
      'obd.protocol: expected an ELM327 protocol "0"–"C" (e.g. "0", "6", "A6")',
    ],
    ['server.host', 'bad host!', 'server.host: expected a hostname or IP address'],
    [
      'sensors.fallbackLocation',
      { lat: 100, lon: 0 },
      'sensors.fallbackLocation.lat: expected number <= 90',
    ],
    ['sensors.adasUdpPort', 70000, 'sensors.adasUdpPort: expected number <= 65535'],
    [
      'display.projection.corners.tl',
      [0],
      'display.projection.corners.tl: expected at least 2 items',
    ],
    [
      'display.projection.corners.tr',
      [1.2, 0],
      'display.projection.corners.tr[0]: expected number <= 1',
    ],
    [
      'display.brightness.curve',
      [
        [1, 0.1],
        [10, 'x'],
      ],
      'display.brightness.curve[1][1]: expected number, got string',
    ],
    ['display.brightness.curve', [], 'display.brightness.curve: must not be empty'],
    [
      'vehicle.gearRatiosRpmPerKph',
      [120, 0],
      'vehicle.gearRatiosRpmPerKph[1]: expected number > 0',
    ],
  ])('resets %s = %j to the default and reports it', (path, value, error) => {
    const { config, errors } = parseConfig(at(path, value));
    expect(errors).toEqual([error]);
    expect(get(config, path)).toEqual(get(DEFAULT_CONFIG, path));
    expect(hudConfigSchema.safeParse(config).success).toBe(true);
  });

  it('accepts null for nullable fields', () => {
    const { config, errors } = parseConfig({
      vehicle: { gearRatiosRpmPerKph: null },
      sensors: { fallbackLocation: null, adasUdpPort: null, buttons: { primary: null } },
    });
    expect(errors).toEqual([]);
    expect(config.sensors.fallbackLocation).toBeNull();
  });

  it('keeps valid siblings when one field is bad', () => {
    const { config, errors } = parseConfig({
      display: { brightness: { minLevel: 'dim', maxLevel: 0.9, riseTimeMs: 5000 } },
      vehicle: { name: 'Civic', redlineRpm: -1 },
    });
    expect(errors).toEqual([
      'vehicle.redlineRpm: expected number >= 1000',
      'display.brightness.minLevel: expected number, got string',
    ]);
    expect(config.display.brightness.minLevel).toBe(0.08);
    expect(config.display.brightness.maxLevel).toBe(0.9);
    expect(config.display.brightness.riseTimeMs).toBe(5000);
    expect(config.vehicle.name).toBe('Civic');
    expect(config.vehicle.redlineRpm).toBe(6500);
  });

  it('replaces a broken array wholesale instead of keeping half of it', () => {
    const { config, errors } = parseConfig({
      obd: {
        customPids: [
          {
            signal: 'tirePressureFL',
            mode: '22',
            pid: '2A0B',
            header: '7E0',
            formula: 'A*2',
            intervalMs: 1000,
          },
          {
            signal: 'nonsense',
            mode: '22',
            pid: '2A0C',
            header: null,
            formula: 'A',
            intervalMs: 1000,
          },
        ],
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^obd\.customPids\[1\]\.signal: expected one of "speed", "rpm", /);
    expect(config.obd.customPids).toEqual([]);
  });

  it('caps the number of errors reported for one field', () => {
    const { errors } = parseConfig({
      vehicle: { gearRatiosRpmPerKph: Array.from({ length: 12 }, () => 'x') },
    });
    expect(errors.length).toBeLessThanOrEqual(5);
    expect(errors[0]).toBe('vehicle.gearRatiosRpmPerKph[0]: expected number, got string');
  });

  describe('custom PIDs', () => {
    const pid = {
      signal: 'tirePressureFL',
      mode: '22',
      pid: '2A0B',
      header: '7E0',
      formula: '((A*256)+B)/10',
      intervalMs: 2000,
    };

    it('accepts valid hex mode/pid/header in either case', () => {
      const pids = [
        pid,
        { ...pid, signal: 'tirePressureFR', mode: '01', pid: '0d', header: null },
        { ...pid, signal: 'tirePressureRL', pid: '2a0b0c', header: '18DA10F1' },
        { ...pid, signal: 'tirePressureRR', header: 'c410f1' },
      ];
      const { config, errors } = parseConfig({ obd: { customPids: pids } });
      expect(errors).toEqual([]);
      expect(config.obd.customPids).toHaveLength(4);
    });

    it.each<[Record<string, unknown>, string]>([
      [{ mode: '2' }, 'obd.customPids[0].mode: expected a 2-digit hex mode such as "22"'],
      [{ mode: 'G2' }, 'obd.customPids[0].mode: expected a 2-digit hex mode such as "22"'],
      [
        { pid: '2A0' },
        'obd.customPids[0].pid: expected a 2-, 4- or 6-digit hex PID such as "2A0B"',
      ],
      [
        { pid: '0x2A' },
        'obd.customPids[0].pid: expected a 2-, 4- or 6-digit hex PID such as "2A0B"',
      ],
      [
        { header: '7E' },
        'obd.customPids[0].header: expected a 3-, 6- or 8-digit hex header such as "7E0"',
      ],
      [
        { header: '7E0 ' },
        'obd.customPids[0].header: expected a 3-, 6- or 8-digit hex header such as "7E0"',
      ],
      [{ formula: '' }, 'obd.customPids[0].formula: must not be empty'],
      [{ intervalMs: 10 }, 'obd.customPids[0].intervalMs: expected number >= 100'],
    ])('rejects %j', (override, error) => {
      const { config, errors } = parseConfig({ obd: { customPids: [{ ...pid, ...override }] } });
      expect(errors).toEqual([error]);
      expect(config.obd.customPids).toEqual([]);
    });

    it('rejects two PIDs feeding the same signal', () => {
      const { errors } = parseConfig({ obd: { customPids: [pid, { ...pid, pid: '2A0C' }] } });
      expect(errors).toEqual(['obd.customPids[1].signal: duplicate signal "tirePressureFL"']);
    });
  });

  describe('cross-field rules', () => {
    it.each<[string, Record<string, unknown>, string, Record<string, unknown>]>([
      [
        'minLevel <= maxLevel (both changed: first field reverted)',
        { display: { brightness: { minLevel: 0.6, maxLevel: 0.5 } } },
        'display.brightness.minLevel: minLevel must not exceed maxLevel (0.6 > 0.5)',
        { 'display.brightness.minLevel': 0.08, 'display.brightness.maxLevel': 0.5 },
      ],
      [
        'minLevel <= maxLevel (only maxLevel changed: maxLevel reverted)',
        { display: { brightness: { maxLevel: 0.05 } } },
        'display.brightness.maxLevel: minLevel must not exceed maxLevel (0.08 > 0.05)',
        { 'display.brightness.minLevel': 0.08, 'display.brightness.maxLevel': 1 },
      ],
      [
        'nightEnterLux < nightExitLux',
        { display: { brightness: { nightEnterLux: 200, nightExitLux: 100 } } },
        'display.brightness.nightEnterLux: nightEnterLux must be below nightExitLux for hysteresis (200 >= 100)',
        { 'display.brightness.nightEnterLux': 50, 'display.brightness.nightExitLux': 100 },
      ],
      [
        'highwayExitKph < highwayEnterKph',
        { display: { context: { highwayEnterKph: 70, highwayExitKph: 70 } } },
        'display.context.highwayExitKph: highwayExitKph must be below highwayEnterKph for hysteresis (70 >= 70)',
        { 'display.context.highwayEnterKph': 70, 'display.context.highwayExitKph': 65 },
      ],
      [
        'stationaryKph < highwayExitKph (repair must not break the other context rule)',
        { display: { context: { highwayEnterKph: 30, highwayExitKph: 15, stationaryKph: 15 } } },
        'display.context.stationaryKph: stationaryKph must be below highwayExitKph (15 >= 15)',
        {
          'display.context.highwayEnterKph': 30,
          'display.context.highwayExitKph': 15,
          'display.context.stationaryKph': 2,
        },
      ],
      [
        'startRpm < shiftRpm',
        { shiftLight: { startRpm: 6000 } },
        'shiftLight.startRpm: startRpm must be below shiftRpm (6000 >= 6000)',
        { 'shiftLight.startRpm': 4500, 'shiftLight.shiftRpm': 6000 },
      ],
      [
        'shiftRpm <= flashRpm',
        { shiftLight: { shiftRpm: 6500, flashRpm: 6400 } },
        'shiftLight.shiftRpm: shiftRpm must not exceed flashRpm (6500 > 6400)',
        { 'shiftLight.shiftRpm': 6000, 'shiftLight.flashRpm': 6400 },
      ],
      [
        'idleRpm < redlineRpm',
        { vehicle: { idleRpm: 2000, redlineRpm: 1500 } },
        'vehicle.idleRpm: idleRpm must be below redlineRpm (2000 >= 1500)',
        { 'vehicle.idleRpm': 750, 'vehicle.redlineRpm': 1500 },
      ],
      [
        'coolantHighC < coolantCriticalC',
        { alerts: { coolantHighC: 120 } },
        'alerts.coolantHighC: coolantHighC must be below coolantCriticalC (120 >= 118)',
        { 'alerts.coolantHighC': 110, 'alerts.coolantCriticalC': 118 },
      ],
      [
        'voltageLowRunningV < voltageHighV',
        { alerts: { voltageHighV: 12 } },
        'alerts.voltageHighV: voltageLowRunningV must be below voltageHighV (12.2 >= 12)',
        { 'alerts.voltageLowRunningV': 12.2, 'alerts.voltageHighV': 15.3 },
      ],
      [
        'voltageLowOffV < voltageHighV',
        { alerts: { voltageLowOffV: 16 } },
        'alerts.voltageLowOffV: voltageLowOffV must be below voltageHighV (16 >= 15.3)',
        { 'alerts.voltageLowOffV': 11.9 },
      ],
      [
        'distinct button GPIOs',
        { sensors: { buttons: { primary: 17, next: 17 } } },
        'sensors.buttons.primary: buttons must use distinct GPIO lines',
        { 'sensors.buttons.primary': null, 'sensors.buttons.next': 17 },
      ],
    ])('%s', (_rule, input, error, expected) => {
      const { config, errors } = parseConfig(input);
      expect(errors).toEqual([error]);
      for (const [path, value] of Object.entries(expected))
        expect(get(config, path)).toEqual(value);
      expect(hudConfigSchema.safeParse(config).success).toBe(true);
    });

    it('reverts every field of a rule when no single field restores it', () => {
      const base = defaults();
      base.display.brightness.minLevel = 0.2;
      base.display.brightness.maxLevel = 0.3;
      const { config, errors } = parseConfig(
        { display: { brightness: { minLevel: 0.5, maxLevel: 0.1 } } },
        base,
      );
      expect(errors).toEqual([
        'display.brightness.minLevel: minLevel must not exceed maxLevel (0.5 > 0.1)',
      ]);
      expect(config.display.brightness.minLevel).toBe(0.2);
      expect(config.display.brightness.maxLevel).toBe(0.3);
    });

    it('accepts shiftRpm == flashRpm and consistent custom values', () => {
      const { config, errors } = parseConfig({
        shiftLight: { enabled: true, startRpm: 5000, shiftRpm: 7000, flashRpm: 7000 },
        display: { context: { highwayEnterKph: 90, highwayExitKph: 75 } },
      });
      expect(errors).toEqual([]);
      expect(config.shiftLight.flashRpm).toBe(7000);
      expect(config.display.context.highwayExitKph).toBe(75);
    });

    it('rejects an unsorted brightness curve', () => {
      const { config, errors } = parseConfig({
        display: {
          brightness: {
            curve: [
              [10, 0.2],
              [10, 0.3],
              [5, 0.4],
            ],
          },
        },
      });
      expect(errors).toEqual([
        'display.brightness.curve[1][0]: expected points sorted by strictly increasing lux',
        'display.brightness.curve[2][0]: expected points sorted by strictly increasing lux',
      ]);
      expect(config.display.brightness.curve).toEqual(DEFAULT_CONFIG.display.brightness.curve);
    });

    it('rejects curve levels outside 0–1 and non-positive lux', () => {
      const { errors } = parseConfig({
        display: {
          brightness: {
            curve: [
              [0, 0.2],
              [10, 1.5],
            ],
          },
        },
      });
      expect(errors).toEqual([
        'display.brightness.curve[0][0]: expected number > 0',
        'display.brightness.curve[1][1]: expected number <= 1',
      ]);
    });

    it('rejects corners outside 0–1 and non-convex / mirrored quads', () => {
      const outside = parseConfig({ display: { projection: { corners: { bl: [-0.1, 1] } } } });
      expect(outside.errors).toEqual(['display.projection.corners.bl[0]: expected number >= 0']);

      const folded = parseConfig({ display: { projection: { corners: { tl: [0.9, 0.9] } } } });
      expect(folded.errors).toEqual([
        'display.projection.corners.tl: corners must form a convex quadrilateral in TL, TR, BR, BL order',
      ]);
      expect(folded.config.display.projection.corners).toEqual(
        DEFAULT_CONFIG.display.projection.corners,
      );

      const swapped = parseConfig({
        display: { projection: { corners: { tl: [1, 0], tr: [0, 0], br: [0, 1], bl: [1, 1] } } },
      });
      expect(swapped.errors).toHaveLength(1);

      const keystone = parseConfig({
        display: {
          projection: { corners: { tl: [0.05, 0], tr: [0.95, 0], br: [1, 1], bl: [0, 1] } },
        },
      });
      expect(keystone.errors).toEqual([]);
      expect(keystone.config.display.projection.corners.tl).toEqual([0.05, 0]);
    });

    it('rejects duplicate custom widget ids and duplicate contexts', () => {
      const dupId = parseConfig({
        display: {
          layout: {
            preset: 'custom',
            widgets: [
              { id: 'speed', zone: 'center', contexts: ['city'] },
              { id: 'speed', zone: 'left', contexts: ['city'] },
            ],
          },
        },
      });
      expect(dupId.errors).toEqual(['display.layout.widgets[1].id: duplicate widget "speed"']);
      expect(dupId.config.display.layout.preset).toBe('custom');
      expect(dupId.config.display.layout.widgets).toEqual(DEFAULT_CONFIG.display.layout.widgets);

      const dupCtx = parseConfig({
        display: {
          layout: { widgets: [{ id: 'speed', zone: 'center', contexts: ['city', 'city'] }] },
        },
      });
      expect(dupCtx.errors).toEqual([
        'display.layout.widgets[0].contexts[1]: duplicate context "city"',
      ]);
    });

    it('rejects bad widget ids and zones', () => {
      const { errors } = parseConfig({
        display: { layout: { widgets: [{ id: 'radar', zone: 'middle', contexts: ['city'] }] } },
      });
      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatch(/^display\.layout\.widgets\[0\]\.id: expected one of "speed"/);
      expect(errors[1]).toMatch(/^display\.layout\.widgets\[0\]\.zone: expected one of "top-left"/);
    });

    it('rejects increasing gear ratios', () => {
      const { config, errors } = parseConfig({ vehicle: { gearRatiosRpmPerKph: [120, 70, 75] } });
      expect(errors).toEqual([
        'vehicle.gearRatiosRpmPerKph[2]: expected ratios to decrease from 1st gear upwards',
      ]);
      expect(config.vehicle.gearRatiosRpmPerKph).toBeNull();
      expect(
        parseConfig({ vehicle: { gearRatiosRpmPerKph: [120, 70, 45, 33, 26, 21] } }).errors,
      ).toEqual([]);
    });

    it('validates maintenance items', () => {
      const item = {
        id: 'timing-belt',
        label: 'Timing belt',
        intervalKm: 120000,
        intervalDays: null,
        warnBeforeKm: 2000,
        warnBeforeDays: 0,
      };
      expect(parseConfig({ maintenance: { items: [item] } }).errors).toEqual([]);
      expect(
        parseConfig({ maintenance: { items: [{ ...item, intervalKm: null }] } }).errors,
      ).toEqual([
        'maintenance.items[0].intervalKm: at least one of intervalKm and intervalDays is required',
      ]);
      expect(parseConfig({ maintenance: { items: [item, item] } }).errors).toEqual([
        'maintenance.items[1].id: duplicate item id "timing-belt"',
      ]);
    });

    it('the strict schema reports cross-field violations too', () => {
      const bad = defaults();
      bad.display.brightness.minLevel = 0.9;
      bad.display.brightness.maxLevel = 0.5;
      const result = hudConfigSchema.safeParse(bad);
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual([
        'display.brightness.minLevel',
      ]);
    });
  });

  describe('base', () => {
    it('falls back to a custom base instead of the defaults', () => {
      const base = defaults();
      base.vehicle.name = 'Miata';
      base.display.brightness.minLevel = 0.2;
      const { config, errors } = parseConfig(
        { vehicle: { name: 7 }, display: { brightness: { minLevel: 2 } } },
        base,
      );
      expect(errors).toEqual([
        'vehicle.name: expected string, got number',
        'display.brightness.minLevel: expected number <= 1',
      ]);
      expect(config.vehicle.name).toBe('Miata');
      expect(config.display.brightness.minLevel).toBe(0.2);
    });

    it('repairs an invalid base from the defaults without reporting its problems', () => {
      const base = defaults();
      (base.vehicle as { name: unknown }).name = 42;
      const { config, errors } = parseConfig({}, base);
      expect(errors).toEqual([]);
      expect(config.vehicle.name).toBe('My car');
    });
  });

  it('returns fresh objects that share nothing with the input or base', () => {
    const input = defaults();
    const { config } = parseConfig(input);
    config.display.brightness.curve[0]![1] = 0.5;
    config.maintenance.items.pop();
    expect(input.display.brightness.curve[0]![1]).toBe(0.08);
    expect(input.maintenance.items).toHaveLength(DEFAULT_CONFIG.maintenance.items.length);

    const fromDefaults = parseConfig({}).config;
    expect(Object.isFrozen(fromDefaults.display)).toBe(false);
    fromDefaults.display.layout.widgets.pop();
    expect(DEFAULT_CONFIG.display.layout.widgets).toHaveLength(LAYOUT_PRESETS.standard.length);
  });

  it('is immune to prototype pollution from JSON input', () => {
    const input: unknown = JSON.parse(
      '{"__proto__": {"polluted": true}, "display": {"__proto__": {"polluted": true}, "maxAlerts": 3}}',
    );
    const { config, errors } = parseConfig(input);
    expect(errors).toEqual([]);
    expect(config.display.maxAlerts).toBe(3);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect((config as unknown as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('mergeConfig', () => {
  it('merges nested objects and keeps untouched siblings', () => {
    const { config, errors } = mergeConfig(DEFAULT_CONFIG, {
      display: { brightness: { mode: 'manual', manualLevel: 0.4 } },
      units: { system: 'imperial' },
    });
    expect(errors).toEqual([]);
    expect(config.display.brightness.mode).toBe('manual');
    expect(config.display.brightness.manualLevel).toBe(0.4);
    expect(config.display.brightness.curve).toEqual(DEFAULT_CONFIG.display.brightness.curve);
    expect(config.units.system).toBe('imperial');
    expect(config.units.currency).toBe('USD');
  });

  it('replaces arrays and tuples wholesale', () => {
    const base = mergeConfig(DEFAULT_CONFIG, {
      display: {
        layout: {
          preset: 'custom',
          widgets: [{ id: 'speed', zone: 'center', contexts: ['city'] }],
        },
      },
    }).config;
    const { config, errors } = mergeConfig(base, {
      display: {
        brightness: {
          curve: [
            [5, 0.1],
            [50_000, 0.9],
          ],
        },
        projection: { corners: { tl: [0.1, 0] } },
        layout: { widgets: [{ id: 'nav', zone: 'left', contexts: ['highway'] }] },
      },
    });
    expect(errors).toEqual([]);
    expect(config.display.brightness.curve).toEqual([
      [5, 0.1],
      [50_000, 0.9],
    ]);
    expect(config.display.projection.corners.tl).toEqual([0.1, 0]);
    expect(config.display.projection.corners.tr).toEqual([1, 0]);
    expect(config.display.layout.widgets).toEqual([
      { id: 'nav', zone: 'left', contexts: ['highway'] },
    ]);
    expect(config.display.layout.preset).toBe('custom');
  });

  it('sets and clears nullable values', () => {
    const set = mergeConfig(DEFAULT_CONFIG, {
      sensors: { fallbackLocation: { lat: 48.1, lon: 11.6 } },
    });
    expect(set.errors).toEqual([]);
    expect(set.config.sensors.fallbackLocation).toEqual({ lat: 48.1, lon: 11.6 });
    const cleared = mergeConfig(set.config, { sensors: { fallbackLocation: null } });
    expect(cleared.errors).toEqual([]);
    expect(cleared.config.sensors.fallbackLocation).toBeNull();
  });

  it('rejects a partial object where the base value is null', () => {
    const patch = { sensors: { fallbackLocation: { lat: 48.1 } } } as DeepPartial<HudConfig>;
    const { config, errors } = mergeConfig(DEFAULT_CONFIG, patch);
    expect(errors).toEqual(['sensors.fallbackLocation.lon: required']);
    expect(config.sensors.fallbackLocation).toBeNull();
  });

  it('leaves fields alone for undefined patch values', () => {
    const { config, errors } = mergeConfig(DEFAULT_CONFIG, {
      vehicle: { name: undefined, redlineRpm: 7000 },
    });
    expect(errors).toEqual([]);
    expect(config.vehicle.name).toBe('My car');
    expect(config.vehicle.redlineRpm).toBe(7000);
  });

  it('keeps the current value of rejected fields', () => {
    const base = mergeConfig(DEFAULT_CONFIG, { display: { maxAlerts: 3 } }).config;
    const { config, errors } = mergeConfig(base, {
      display: { maxAlerts: 9, mediaToastMs: 4000 },
    });
    expect(errors).toEqual(['display.maxAlerts: expected number <= 5']);
    expect(config.display.maxAlerts).toBe(3);
    expect(config.display.mediaToastMs).toBe(4000);
  });

  it('applies cross-field rules against the merged result', () => {
    const { config, errors } = mergeConfig(DEFAULT_CONFIG, {
      display: { brightness: { maxLevel: 0.05 } },
    });
    expect(errors).toEqual([
      'display.brightness.maxLevel: minLevel must not exceed maxLevel (0.08 > 0.05)',
    ]);
    expect(config.display.brightness.maxLevel).toBe(1);
    expect(config.display.brightness.minLevel).toBe(0.08);
  });

  it('does not mutate the base or the patch', () => {
    const base = defaults();
    const snapshot = JSON.stringify(base);
    const patch = { display: { brightness: { curve: [[3, 0.3]] as Array<[number, number]> } } };
    const { config } = mergeConfig(base, patch);
    config.display.brightness.curve[0]![1] = 0.9;
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(patch.display.brightness.curve[0]![1]).toBe(0.3);
  });

  it('is a no-op for an empty patch', () => {
    expect(mergeConfig(DEFAULT_CONFIG, {})).toEqual({ config: DEFAULT_CONFIG, errors: [] });
  });

  it('rejects a non-object patch and keeps the base', () => {
    const { config, errors } = mergeConfig(
      DEFAULT_CONFIG,
      null as unknown as DeepPartial<HudConfig>,
    );
    expect(errors).toEqual(['(root): expected object, got null']);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('ignores prototype-polluting keys in the patch', () => {
    const patch = JSON.parse(
      '{"__proto__": {"polluted": true}, "vehicle": {"__proto__": {"x": 1}}}',
    ) as DeepPartial<HudConfig>;
    const { config, errors } = mergeConfig(DEFAULT_CONFIG, patch);
    expect(errors).toEqual([]);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('resolveLayout', () => {
  it('returns the preset placements for built-in presets', () => {
    for (const preset of ['minimal', 'standard', 'sport'] as const) {
      const config = mergeConfig(DEFAULT_CONFIG, { display: { layout: { preset } } }).config;
      expect(resolveLayout(config)).toBe(LAYOUT_PRESETS[preset]);
    }
  });

  it('returns the configured widgets for the custom preset', () => {
    const widgets = [
      { id: 'speed' as const, zone: 'center' as const, contexts: ['city' as const] },
    ];
    const config = mergeConfig(DEFAULT_CONFIG, {
      display: { layout: { preset: 'custom', widgets } },
    }).config;
    expect(resolveLayout(config)).toEqual(widgets);
  });

  it('ignores the widget list unless the preset is custom', () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      display: { layout: { preset: 'minimal', widgets: [] } },
    }).config;
    expect(resolveLayout(config)).toBe(LAYOUT_PRESETS.minimal);
  });
});
