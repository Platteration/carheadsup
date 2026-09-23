import { describe, expect, it } from 'vitest';
import { FIXTURE_TIME, SAMPLE_FRAME_NAMES, SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';
import { formatClockText } from '../../src/common/format.ts';
import { renderHud, textOf } from './render.ts';

const REQUIRED = [
  'city-nav',
  'highway-cruise',
  'highway-exit-lanes',
  'roundabout',
  'stopped-media',
  'incoming-call',
  'active-call',
  'overspeed',
  'check-engine',
  'engine-hot',
  'low-voltage',
  'parked-overview',
  'parked-trouble-codes',
  'parked-trip',
  'night-city',
  'blind-spot-left',
  'collision-warning',
  'sport-shift',
  'tpms-low',
  'message-toast',
  'blanked',
  'imperial-us',
];

/** Text (or markup, for styling hooks) each fixture must produce. */
const EXPECT: Record<string, { text?: string[]; markup?: string[]; absent?: string[] }> = {
  'city-nav': {
    text: ['42', 'km/h', '350', 'Rosenheimer Straße', 'ETA', '18 min · 9.4 km', 'Midnight City'],
  },
  'highway-cruise': {
    text: ['118', 'km/h'],
    absent: ['hud-w--nav', 'hud-w--fuel', 'hud-w--clock'],
  },
  'highway-exit-lanes': {
    text: ['112', '600', 'Garching-Süd', 'then'],
    markup: ['data-maneuver="exit-right"', 'data-recommended="true"', 'data-recommended="false"'],
  },
  roundabout: {
    text: ['27', '90', 'Avenue Jean Jaurès'],
    markup: [
      'hud-nav--imminent',
      'data-maneuver="roundabout-ccw"',
      '>3</text>',
      'data-approach="0.70"',
    ],
  },
  'stopped-media': { text: ['0', 'Blinding Lights', 'The Weeknd', '12.4', '25 min'] },
  'incoming-call': {
    text: ['Incoming call', 'Maria Lopez', '+1 415 555 0132', 'Decline', 'Accept'],
  },
  'active-call': { text: ['On call', '2:07', 'Mum', 'End'], absent: ['Accept'] },
  overspeed: { text: ['64', '+14'], markup: ['hud-speed--over'] },
  'check-engine': {
    text: ['CHECK ENGINE', 'P0420 – Catalytic converter efficiency'],
    markup: ['data-glyph="engine"'],
  },
  'engine-hot': {
    text: ['OVERHEATING – STOP', 'Coolant 121 °C'],
    markup: ['hud-flash', 'data-severity="critical"'],
  },
  'low-voltage': {
    text: ['CHARGING FAULT', '11.6 V, engine running'],
    markup: ['data-glyph="battery"'],
  },
  'parked-overview': {
    text: [
      'Overview',
      'Coolant',
      '91',
      '14.2',
      'VIN WVWZZZAUZKW123456',
      'OBDLink MX+',
      'SIM',
      'Oil & filter: Due soon',
    ],
    markup: ['data-mode="diagnostics"', 'data-status="warn"'],
    absent: ['hud-w--clock'],
  },
  'parked-trouble-codes': {
    text: [
      'Trouble codes',
      'MIL',
      'U0100',
      'Permanent',
      'P0301',
      'Cylinder 1 misfire',
      'P0171',
      'Pending',
    ],
  },
  'parked-trip': { text: ['Trip', '42.7', '52 min', '45 min', '7.3', '3.1', '€5.58'] },
  'parked-maintenance': {
    text: ['Brake fluid', 'Overdue', '12 days overdue', 'in 420 km · 20 days', 'No record'],
  },
  'night-city': { text: ['48', '150', 'Baker Street'], markup: ['hud--night', 'brightness(0.35)'] },
  'blind-spot-left': {
    text: ['98', 'Everlong', 'Foo Fighters'],
    markup: ['data-blindspot="left"', 'opacity:0.6'],
  },
  'collision-warning': {
    text: ['BRAKE', '47'],
    markup: ['hud-collision-border', 'data-collision="warning"'],
  },
  'collision-caution': {
    markup: ['data-collision="caution"'],
    absent: ['BRAKE', 'hud-collision-border'],
  },
  'sport-shift': {
    text: ['97', '3', '6100', 'rpm', '+0.92', 'bar'],
    markup: ['data-lit="10"', 'hud-tach--red'],
  },
  'tpms-low': {
    text: ['TYRE PRESSURE LOW', 'Rear left 168 kPa', '231', '168', 'kPa'],
    markup: ['hud-tpms__value--low', 'hud-tpms__wheel--low'],
  },
  'message-toast': {
    text: ['Alex Chen', 'WhatsApp'],
    markup: ['data-toast="message"'],
  },
  blanked: {
    markup: ['data-blanked="true"', 'data-mode="blanked"'],
    absent: ['44', 'hud-w--speed'],
  },
  'imperial-us': {
    text: [
      '43',
      'mph',
      '500',
      'ft',
      'Market St',
      'mpg',
      '286 mi',
      '°F',
      'PM',
      'SPEED',
      'LIMIT',
      '45',
    ],
    markup: ['hud-sign--mutcd'],
  },
  'speed-camera': { text: ['800', 'Speed camera', '120'], markup: ['data-hazard="speed-camera"'] },
  'traffic-jam': { text: ['900', 'Traffic jam', '+7 min'] },
  'autobahn-unlimited': {
    text: ['164'],
    markup: ['hud-sign--unlimited', 'aria-label="No speed limit"'],
  },
};

describe('SAMPLE_FRAMES', () => {
  it('contains every fixture the gallery and screenshots rely on', () => {
    for (const name of REQUIRED) expect(SAMPLE_FRAMES, name).toHaveProperty([name]);
    expect(SAMPLE_FRAME_NAMES).toEqual(Object.keys(SAMPLE_FRAMES));
  });

  it('has an expectation for every fixture', () => {
    expect(Object.keys(EXPECT).sort()).toEqual([...SAMPLE_FRAME_NAMES].sort());
  });

  it.each(SAMPLE_FRAME_NAMES)('%s renders with its key content', (name) => {
    const frame = SAMPLE_FRAMES[name]!;
    const html = renderHud(frame);
    const text = textOf(html);
    const spec = EXPECT[name] ?? {};
    for (const t of spec.text ?? []) expect(text, `${name}: "${t}"`).toContain(t);
    for (const m of spec.markup ?? []) expect(html, `${name}: ${m}`).toContain(m);
    for (const a of spec.absent ?? []) expect(html, `${name}: no ${a}`).not.toContain(a);
    expect(html).not.toMatch(/NaN|undefined|\[object Object\]/);
  });

  it('uses a fixed time so renders are reproducible', () => {
    for (const frame of Object.values(SAMPLE_FRAMES)) expect(frame.at).toBe(FIXTURE_TIME);
    expect(textOf(renderHud(SAMPLE_FRAMES['city-nav']!))).toContain(
      formatClockText(FIXTURE_TIME, '24h'),
    );
  });

  it('keeps message content off the HUD (sender only)', () => {
    const toast = SAMPLE_FRAMES['message-toast']!.toast;
    expect(toast?.kind).toBe('message');
    expect(Object.keys(toast ?? {}).sort()).toEqual(['kind', 'opacity', 'subtitle', 'title']);
  });

  it('matches the mode each situation calls for', () => {
    for (const [name, frame] of Object.entries(SAMPLE_FRAMES)) {
      if (frame.diagnostics) expect(frame.context, name).toBe('parked');
      if (name.startsWith('parked')) expect(frame.diagnostics, name).not.toBeNull();
    }
  });
});
