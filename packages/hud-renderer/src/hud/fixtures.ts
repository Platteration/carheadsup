import type {
  AlertFrame,
  ClockWidget,
  DiagnosticGauge,
  DiagnosticsFrame,
  DiagnosticsMaintenanceItem,
  DisplayDistance,
  DistanceUnitLabel,
  EtaWidget,
  FuelWidget,
  GearWidget,
  HudFrame,
  Lane,
  MediaWidget,
  NavWidget,
  OutsideTempWidget,
  SpeedLimitWidget,
  SpeedUnitLabel,
  SpeedWidget,
  TripSummaryWidget,
} from '@carheadsup/core';

/**
 * Sample frames for tests, the dev-console gallery and screenshots. They follow the zones of the
 * built-in layout presets (see `core/src/config/config.ts`) and contain what `composeFrame` would
 * emit in each situation: values already in display units and rounded.
 */

/** Fixed instant for every fixture (a Thursday afternoon), so renders are reproducible. */
export const FIXTURE_TIME = Date.UTC(2026, 4, 14, 15, 42, 0);

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function frame(parts: Partial<HudFrame> & Pick<HudFrame, 'context' | 'widgets'>): HudFrame {
  return {
    at: FIXTURE_TIME,
    blanked: false,
    theme: { night: false, brightness: 0.9 },
    alerts: [],
    toast: null,
    call: null,
    shiftLight: null,
    blindSpot: { left: false, right: false },
    collision: 'none',
    diagnostics: null,
    status: { obd: 'connected', phone: true, simulated: false },
    ...parts,
  };
}

function distance(value: number, unit: DistanceUnitLabel): DisplayDistance {
  return { value, unit, text: `${value} ${unit}` };
}

function speed(
  value: number,
  overBy: number | null = null,
  unit: SpeedUnitLabel = 'km/h',
): SpeedWidget {
  return { id: 'speed', zone: 'center', value, unit, overLimit: overBy !== null, overBy };
}

function limit(value: number | null, extra: Partial<SpeedLimitWidget> = {}): SpeedLimitWidget {
  return {
    id: 'speedLimit',
    zone: 'right',
    value,
    unlimited: false,
    unit: 'km/h',
    style: 'vienna',
    ...extra,
  };
}

function gear(value: string, inferred = true): GearWidget {
  return { id: 'gear', zone: 'left', gear: value, inferred };
}

function fuel(extra: Partial<FuelWidget> = {}): FuelWidget {
  return {
    id: 'fuel',
    zone: 'left',
    instant: 6.8,
    average: 7.4,
    unit: 'L/100km',
    range: 412,
    rangeUnit: 'km',
    levelPct: 58,
    low: false,
    ...extra,
  };
}

function clock(format: ClockWidget['format'] = '24h'): ClockWidget {
  return { id: 'clock', zone: 'bottom-right', epochMs: FIXTURE_TIME, format };
}

function outside(value: number, extra: Partial<OutsideTempWidget> = {}): OutsideTempWidget {
  return { id: 'outsideTemp', zone: 'bottom-right', value, unit: '°C', iceRisk: false, ...extra };
}

function media(title: string, artist: string, playing = true): MediaWidget {
  return { id: 'media', zone: 'bottom', title, artist, playing };
}

function eta(
  minutes: number,
  remaining: DisplayDistance,
  format: EtaWidget['clock'] = '24h',
): EtaWidget {
  return {
    id: 'eta',
    zone: 'top-left',
    etaEpochMs: FIXTURE_TIME + minutes * MIN,
    clock: format,
    remainingMinutes: minutes,
    remainingDistance: remaining,
  };
}

function nav(extra: Partial<NavWidget> & Pick<NavWidget, 'maneuver'>): NavWidget {
  return {
    id: 'nav',
    zone: 'top-left',
    distance: null,
    street: null,
    then: null,
    iconPng: null,
    imminent: false,
    approach: null,
    ...extra,
  };
}

function alert(
  extra: Partial<AlertFrame> & Pick<AlertFrame, 'key' | 'kind' | 'title'>,
): AlertFrame {
  return { severity: 'caution', detail: null, code: null, dismissible: true, ...extra };
}

function gauge(
  signal: DiagnosticGauge['signal'],
  label: string,
  value: number | null,
  unit: string,
  range: [number, number],
  status: DiagnosticGauge['status'] = 'ok',
  decimals = 0,
): DiagnosticGauge {
  return { signal, label, value, unit, decimals, min: range[0], max: range[1], status };
}

/** A dashboard service item; `remainingKm` is negative when overdue by distance. */
function service(
  itemId: string,
  label: string,
  status: DiagnosticsMaintenanceItem['status'],
  remainingKm: number | null,
  remainingDays: number | null,
): DiagnosticsMaintenanceItem {
  return {
    itemId,
    label,
    status,
    remaining:
      remainingKm === null
        ? null
        : { value: remainingKm, unit: 'km', text: `${Math.abs(remainingKm)} km` },
    remainingDays,
    dueAtEpochMs: remainingDays === null ? null : FIXTURE_TIME + remainingDays * DAY,
  };
}

const VEHICLE: DiagnosticsFrame['vehicle'] = {
  vin: 'WVWZZZAUZKW123456',
  adapter: 'OBDLink MX+ (STN2255)',
  protocol: 'ISO 15765-4 (CAN 11/500)',
};

function diagnostics(
  extra: Partial<DiagnosticsFrame> & Pick<DiagnosticsFrame, 'page' | 'pageIndex' | 'title'>,
): DiagnosticsFrame {
  return {
    pageCount: 7,
    gauges: [],
    dtcs: [],
    milOn: false,
    trip: null,
    maintenance: [],
    vehicle: VEHICLE,
    ...extra,
  };
}

const TRIP_WIDGET: TripSummaryWidget = {
  id: 'tripSummary',
  zone: 'bottom',
  distance: distance(42.7, 'km'),
  durationS: 3120,
  averageEconomy: 7.3,
  economyUnit: 'L/100km',
  fuelUsed: 3.1,
  fuelUnit: 'L',
  cost: 5.58,
  currency: 'EUR',
};

const EXIT_LANES: Lane[] = [
  { directions: ['straight'], recommended: false },
  { directions: ['straight'], recommended: false },
  { directions: ['straight', 'slight-right'], recommended: true, activeDirection: 'slight-right' },
  { directions: ['slight-right'], recommended: true, activeDirection: 'slight-right' },
];

export const SAMPLE_FRAMES: Record<string, HudFrame> = {
  /** Everyday city driving with guidance: the standard layout's full low-speed set. */
  'city-nav': frame({
    context: 'city',
    widgets: [
      speed(42),
      limit(50),
      nav({
        maneuver: { type: 'right' },
        distance: distance(350, 'm'),
        street: 'Rosenheimer Straße',
        then: { type: 'left' },
      }),
      gear('3'),
      eta(18, distance(9.4, 'km')),
      fuel(),
      media('Midnight City', 'M83'),
      outside(17),
      clock(),
    ],
  }),

  /** Adaptive clutter at its most minimal: highway cruise shows speed and limit only. */
  'highway-cruise': frame({
    context: 'highway',
    theme: { night: false, brightness: 1 },
    widgets: [speed(118), limit(120)],
  }),

  /** Approaching a motorway exit: guidance, lane assist and a "then" preview. */
  'highway-exit-lanes': frame({
    context: 'highway',
    widgets: [
      speed(112),
      limit(120),
      nav({
        maneuver: { type: 'exit-right' },
        distance: distance(600, 'm'),
        street: 'Garching-Süd',
        then: { type: 'keep-left' },
      }),
      { id: 'lanes', zone: 'top', lanes: EXIT_LANES },
    ],
  }),

  /** Final approach to a roundabout, third exit (to the left, counter-clockwise traffic). */
  roundabout: frame({
    context: 'city',
    widgets: [
      speed(27),
      limit(50),
      nav({
        maneuver: { type: 'roundabout-ccw', roundaboutExit: 3, roundaboutAngle: 270 },
        distance: distance(90, 'm'),
        street: 'Avenue Jean Jaurès',
        imminent: true,
        approach: 0.7,
      }),
      gear('2'),
      eta(7, distance(2.8, 'km')),
      fuel({ instant: 9.6 }),
      clock(),
    ],
  }),

  /** Waiting at lights: now playing and the trip so far. */
  'stopped-media': frame({
    context: 'stopped',
    widgets: [
      speed(0),
      limit(50),
      fuel({ instant: null, average: 7.2, range: 398 }),
      media('Blinding Lights', 'The Weeknd'),
      outside(21),
      clock(),
      {
        ...TRIP_WIDGET,
        distance: distance(12.4, 'km'),
        durationS: 1520,
        averageEconomy: 7.2,
        fuelUsed: 0.9,
        cost: 1.62,
      },
    ],
  }),

  /** Ringing call: caller card with accept / decline hints (media gives way). */
  'incoming-call': frame({
    context: 'city',
    widgets: [speed(38), limit(50), gear('3'), fuel(), media('Midnight City', 'M83'), clock()],
    call: {
      state: 'ringing',
      name: 'Maria Lopez',
      number: '+1 415 555 0132',
      durationS: null,
      canAccept: true,
      canDecline: true,
    },
  }),

  /** Call in progress with the timer running. */
  'active-call': frame({
    context: 'city',
    widgets: [speed(45), limit(50), gear('3'), fuel(), clock()],
    call: {
      state: 'active',
      name: 'Mum',
      number: '+44 7700 900123',
      durationS: 127,
      canAccept: false,
      canDecline: true,
    },
  }),

  /** 14 over in a 50 zone: the speed turns red with a "+14" badge. */
  overspeed: frame({
    context: 'city',
    widgets: [speed(64, 14), limit(50), gear('4'), fuel({ instant: 5.9 }), outside(17), clock()],
  }),

  /** Stationary with a decoded trouble code instead of just a light. */
  'check-engine': frame({
    context: 'stopped',
    widgets: [speed(0), limit(50), fuel({ instant: null }), outside(14), clock()],
    alerts: [
      alert({
        key: 'check-engine:P0420',
        kind: 'check-engine',
        severity: 'caution',
        title: 'CHECK ENGINE',
        detail: 'P0420 – Catalytic converter efficiency',
        code: 'P0420',
      }),
    ],
  }),

  /** Critical overheating: flashing, non-dismissible alert plus the coolant reading. */
  'engine-hot': frame({
    context: 'city',
    widgets: [
      speed(36),
      limit(50),
      { id: 'coolant', zone: 'bottom-left', value: 121, unit: '°C', status: 'critical' },
      gear('3'),
      clock(),
    ],
    alerts: [
      alert({
        key: 'coolant',
        kind: 'coolant',
        severity: 'critical',
        title: 'OVERHEATING – STOP',
        detail: 'Coolant 121 °C',
        dismissible: false,
      }),
    ],
  }),

  /** Alternator not charging: warning plus the out-of-range voltage. */
  'low-voltage': frame({
    context: 'city',
    widgets: [
      speed(52),
      limit(50),
      { id: 'voltage', zone: 'bottom-left', value: 11.6, status: 'low' },
      gear('4'),
      fuel(),
      clock(),
    ],
    alerts: [
      alert({
        key: 'voltage',
        kind: 'voltage',
        severity: 'warning',
        title: 'CHARGING FAULT',
        detail: '11.6 V, engine running',
      }),
    ],
  }),

  /**
   * Parked with the engine idling after a short trip: full diagnostics dashboard, overview page
   * (the oil is still below its normal band).
   */
  'parked-overview': frame({
    context: 'parked',
    status: { obd: 'connected', phone: true, simulated: true },
    widgets: [outside(17), clock()],
    diagnostics: diagnostics({
      page: 'overview',
      pageIndex: 0,
      title: 'Overview',
      gauges: [
        gauge('coolantTemp', 'Coolant', 91, '°C', [-40, 130]),
        gauge('batteryVoltage', 'Battery', 14.2, 'V', [8, 16], 'ok', 1),
        gauge('fuelLevel', 'Fuel', 58, '%', [0, 100]),
        gauge('oilTemp', 'Oil temp', 64, '°C', [-40, 160], 'warn'),
        gauge('ambientTemp', 'Ambient', 17, '°C', [-40, 60]),
        gauge('odometer', 'Odometer', 55_790, 'km', [0, 999_999]),
      ],
      maintenance: [service('oil', 'Oil & filter', 'due-soon', 420, 20)],
    }),
  }),

  /** Parked: decoded trouble codes, most severe first. */
  'parked-trouble-codes': frame({
    context: 'parked',
    widgets: [clock()],
    diagnostics: diagnostics({
      page: 'trouble-codes',
      pageIndex: 4,
      title: 'Trouble codes',
      milOn: true,
      dtcs: [
        {
          code: 'U0100',
          kind: 'permanent',
          short: 'Engine computer offline',
          description: 'Lost Communication With ECM/PCM "A"',
          severity: 'warning',
        },
        {
          code: 'P0301',
          kind: 'stored',
          short: 'Cylinder 1 misfire',
          description: 'Cylinder 1 Misfire Detected',
          severity: 'warning',
        },
        {
          code: 'P0420',
          kind: 'stored',
          short: 'Catalytic converter efficiency',
          description: 'Catalyst System Efficiency Below Threshold (Bank 1)',
          severity: 'caution',
        },
        {
          code: 'P0171',
          kind: 'pending',
          short: 'Engine running lean (B1)',
          description: 'System Too Lean (Bank 1)',
          severity: 'caution',
        },
      ],
    }),
  }),

  /** Parked, engine off, trip not yet closed: the trip page matches the trip-summary widget. */
  'parked-trip': frame({
    context: 'parked',
    widgets: [clock(), TRIP_WIDGET],
    diagnostics: diagnostics({
      page: 'trip',
      pageIndex: 5,
      title: 'Trip',
      trip: {
        completed: false,
        distance: TRIP_WIDGET.distance,
        durationS: TRIP_WIDGET.durationS,
        movingS: 2710,
        averageEconomy: TRIP_WIDGET.averageEconomy,
        economyUnit: TRIP_WIDGET.economyUnit,
        fuelUsed: TRIP_WIDGET.fuelUsed,
        fuelUnit: TRIP_WIDGET.fuelUnit,
        cost: TRIP_WIDGET.cost,
        currency: TRIP_WIDGET.currency,
      },
    }),
  }),

  /** Parked: service schedule based on actual mileage. */
  'parked-maintenance': frame({
    context: 'parked',
    widgets: [clock()],
    diagnostics: diagnostics({
      page: 'maintenance',
      pageIndex: 6,
      title: 'Maintenance',
      maintenance: [
        service('brake-fluid', 'Brake fluid', 'overdue', null, -12),
        service('oil', 'Oil & filter', 'due-soon', 420, 20),
        service('tyre-rotation', 'Tyre rotation', 'ok', 6210, null),
        service('air-filter', 'Air filter', 'ok', 12_420, 410),
        service('cabin-filter', 'Cabin filter', 'unknown', null, null),
        service('coolant', 'Coolant', 'unknown', null, null),
      ],
    }),
  }),

  /** Night palette at low brightness on an unlit street, turn coming up. */
  'night-city': frame({
    context: 'city',
    theme: { night: true, brightness: 0.35 },
    widgets: [
      speed(48),
      limit(50),
      nav({
        maneuver: { type: 'left' },
        distance: distance(150, 'm'),
        street: 'Baker Street',
        imminent: true,
        approach: 0.5,
      }),
      gear('3'),
      fuel({ instant: 7.9 }),
      outside(9),
      clock(),
    ],
  }),

  /** A car alongside on the left while a song toast fades out. */
  'blind-spot-left': frame({
    context: 'highway',
    widgets: [speed(98), limit(100)],
    blindSpot: { left: true, right: false },
    toast: { kind: 'media', title: 'Everlong', subtitle: 'Foo Fighters', opacity: 0.6 },
  }),

  /** Imminent forward collision: flashing red frame and BRAKE. */
  'collision-warning': frame({
    context: 'city',
    widgets: [speed(47), limit(50), gear('3'), fuel(), clock()],
    collision: 'warning',
  }),

  /** Closing fast on the car ahead: amber chevrons. */
  'collision-caution': frame({
    context: 'city',
    widgets: [speed(58), limit(60), gear('4'), fuel(), clock()],
    collision: 'caution',
  }),

  /** Sport layout near the shift point: shift light, reported gear, tachometer and boost. */
  'sport-shift': frame({
    context: 'highway',
    widgets: [
      speed(97),
      gear('3', false),
      { id: 'tachometer', zone: 'bottom', rpm: 6100, fraction: 0.938, redlineRpm: 6500 },
      limit(100),
      { id: 'boost', zone: 'bottom-right', value: 0.92, unit: 'bar', fraction: 0.738 },
    ],
    shiftLight: { level: 0.85, flash: false },
  }),

  /** Slow leak on the rear left tyre. */
  'tpms-low': frame({
    context: 'city',
    widgets: [
      speed(58),
      limit(60),
      {
        id: 'tpms',
        zone: 'right',
        unit: 'kPa',
        fl: { value: 231, low: false },
        fr: { value: 229, low: false },
        rl: { value: 168, low: true },
        rr: { value: 226, low: false },
        anyLow: true,
      },
      gear('4'),
      fuel(),
      clock(),
    ],
    alerts: [
      alert({
        key: 'tpms',
        kind: 'tpms',
        severity: 'warning',
        title: 'TYRE PRESSURE LOW',
        detail: 'Rear left 168 kPa',
      }),
    ],
  }),

  /** New message: sender and app only — the phone reads it aloud, and the toast says so. */
  'message-toast': frame({
    context: 'city',
    widgets: [
      speed(33),
      limit(30),
      gear('2'),
      fuel({ instant: 8.4 }),
      media('Midnight City', 'M83'),
      clock(),
    ],
    toast: {
      kind: 'message',
      title: 'Alex Chen',
      subtitle: 'WhatsApp · reading aloud',
      opacity: 1,
    },
  }),

  /** Driver blanked the display: nothing but a tiny marker (the composer withholds widgets). */
  blanked: frame({
    context: 'city',
    blanked: true,
    widgets: [],
  }),

  /** US units: mph, MUTCD sign, mpg, miles and feet, 12-hour clock. */
  'imperial-us': frame({
    context: 'city',
    widgets: [
      speed(43, null, 'mph'),
      limit(45, { unit: 'mph', style: 'mutcd' }),
      nav({
        maneuver: { type: 'right' },
        distance: distance(500, 'ft'),
        street: 'Market St',
        then: { type: 'slight-left' },
        imminent: true,
        approach: 0.49,
      }),
      gear('4'),
      eta(24, distance(11, 'mi'), '12h'),
      fuel({
        instant: 27.4,
        average: 29.1,
        unit: 'mpg-us',
        range: 286,
        rangeUnit: 'mi',
        levelPct: 64,
      }),
      outside(72, { unit: '°F' }),
      clock('12h'),
    ],
  }),

  /** Fixed speed camera ahead with its enforced limit. */
  'speed-camera': frame({
    context: 'highway',
    widgets: [
      speed(118),
      limit(120),
      {
        id: 'hazard',
        zone: 'top-right',
        type: 'speed-camera',
        distance: distance(800, 'm'),
        speedLimit: 120,
        limitStyle: 'vienna',
        delayMinutes: null,
        label: 'Speed camera',
      },
    ],
  }),

  /**
   * A traffic jam ahead on the highway (the companion's TomTom look-up) with the expected delay,
   * shown from 3 km (`display.trafficRevealM`).
   */
  'traffic-jam': frame({
    context: 'highway',
    widgets: [
      speed(118),
      limit(120),
      {
        id: 'hazard',
        zone: 'top-right',
        type: 'traffic-jam',
        distance: distance(2.4, 'km'),
        speedLimit: null,
        limitStyle: 'vienna',
        delayMinutes: 8,
        label: 'Traffic jam',
      },
    ],
  }),

  /** German Autobahn without a limit: the end-of-restrictions sign. */
  'autobahn-unlimited': frame({
    context: 'highway',
    widgets: [speed(164), limit(null, { unlimited: true })],
  }),
};

/** Fixture names in a stable, curated order (for galleries and screenshot runs). */
export const SAMPLE_FRAME_NAMES: readonly string[] = Object.keys(SAMPLE_FRAMES);
