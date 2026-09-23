import { HAZARD_TYPES, LANE_DIRECTIONS, MANEUVER_TYPES } from '@carheadsup/core';
import type { AlertKind, LaneDirection, Maneuver } from '@carheadsup/core';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import {
  ALERT_GLYPHS,
  GLYPH_NAMES,
  Glyph,
  HAZARD_GLYPHS,
  LaneIcon,
  ManeuverIcon,
  hasGlyph,
  hasLaneDrawing,
  hasManeuverDrawing,
  roundaboutBearing,
} from '../../src/hud/icons/index.ts';

/** Every AlertKind; the type below fails to compile if the contract gains one we do not list. */
const ALERT_KINDS = [
  'coolant',
  'voltage',
  'check-engine',
  'fuel-low',
  'maintenance-due',
  'tpms',
  'ice-risk',
  'forward-collision',
  'hazard',
  'obd-link',
  'phone-link',
  'system',
] as const satisfies readonly AlertKind[];
type MissingAlertKinds = Exclude<AlertKind, (typeof ALERT_KINDS)[number]>;
const allAlertKindsListed: [MissingAlertKinds] extends [never] ? true : false = true;

/** Count drawn shapes in rendered SVG markup. */
function shapes(svg: string): number {
  return (svg.match(/<(path|polygon|circle|rect|text)\b/g) ?? []).length;
}

describe('maneuver icons', () => {
  it.each(MANEUVER_TYPES)('%s has a drawing that renders', (type) => {
    expect(hasManeuverDrawing(type)).toBe(true);
    const svg = renderToString(<ManeuverIcon maneuver={{ type, roundaboutExit: 2 }} />);
    expect(svg).toContain(`data-maneuver="${type}"`);
    expect(svg).toContain('viewBox="0 0 48 48"');
    expect(shapes(svg)).toBeGreaterThan(0);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('draws every turn distinctly and mirrors left/right', () => {
    const markup = new Set(
      MANEUVER_TYPES.filter((t) => !t.startsWith('roundabout')).map((type) =>
        renderToString(<ManeuverIcon maneuver={{ type }} />).replace(/data-maneuver="[^"]*"/, ''),
      ),
    );
    expect(markup.size).toBe(MANEUVER_TYPES.length - 2);
  });

  it('turn arrows end in a filled head', () => {
    for (const type of [
      'left',
      'right',
      'slight-left',
      'sharp-right',
      'uturn-left',
      'straight',
    ] as const) {
      expect(renderToString(<ManeuverIcon maneuver={{ type }} />)).toContain('<polygon');
    }
  });

  it('shows the roundabout exit number', () => {
    const svg = renderToString(
      <ManeuverIcon
        maneuver={{ type: 'roundabout-ccw', roundaboutExit: 3, roundaboutAngle: 270 }}
      />,
    );
    expect(svg).toMatch(/<text[^>]*>3<\/text>/);
  });

  it('omits the exit number when unknown', () => {
    const svg = renderToString(
      <ManeuverIcon maneuver={{ type: 'roundabout-cw', roundaboutAngle: 90 }} />,
    );
    expect(svg).not.toContain('<text');
  });

  it('draws a full-circle U-turn round a roundabout as two arcs', () => {
    const svg = renderToString(
      <ManeuverIcon
        maneuver={{ type: 'roundabout-ccw', roundaboutExit: 4, roundaboutAngle: 180 }}
      />,
    );
    const route = /class="hud-route"[^>]*><path d="([^"]+)"/.exec(svg)?.[1] ?? '';
    expect(route.match(/A/g)).toHaveLength(2);
  });

  it('places the exit at a different point for different angles', () => {
    const at = (angle: number) =>
      renderToString(
        <ManeuverIcon maneuver={{ type: 'roundabout-ccw', roundaboutAngle: angle }} />,
      );
    expect(at(90)).not.toBe(at(270));
    expect(at(0)).not.toBe(at(90));
  });

  it('falls back to the unknown drawing for an unrecognised type from a newer server', () => {
    const svg = renderToString(
      <ManeuverIcon maneuver={{ type: 'teleport' } as unknown as Maneuver} />,
    );
    expect(shapes(svg)).toBeGreaterThan(0);
  });
});

describe('roundaboutBearing', () => {
  it('prefers the explicit angle, normalised to 0–360', () => {
    expect(
      roundaboutBearing({ type: 'roundabout-ccw', roundaboutAngle: 270, roundaboutExit: 1 }, false),
    ).toBe(270);
    expect(roundaboutBearing({ type: 'roundabout-ccw', roundaboutAngle: -90 }, false)).toBe(270);
    expect(roundaboutBearing({ type: 'roundabout-ccw', roundaboutAngle: 450 }, false)).toBe(90);
  });

  it('derives a four-arm bearing from the exit number in the driving direction', () => {
    const ccw = [1, 2, 3, 4, 5].map((n) =>
      roundaboutBearing({ type: 'roundabout-ccw', roundaboutExit: n }, false),
    );
    expect(ccw).toEqual([90, 0, 270, 180, 90]);
    const cw = [1, 2, 3].map((n) =>
      roundaboutBearing({ type: 'roundabout-cw', roundaboutExit: n }, true),
    );
    expect(cw).toEqual([270, 0, 90]);
  });

  it('defaults to straight on', () => {
    expect(roundaboutBearing({ type: 'roundabout-ccw' }, false)).toBe(0);
    expect(
      roundaboutBearing(
        { type: 'roundabout-ccw', roundaboutExit: 0, roundaboutAngle: Number.NaN },
        false,
      ),
    ).toBe(0);
  });
});

describe('lane icons', () => {
  it.each(LANE_DIRECTIONS)('%s has a drawing that renders', (direction) => {
    expect(hasLaneDrawing(direction)).toBe(true);
    const svg = renderToString(<LaneIcon lane={{ directions: [direction], recommended: true }} />);
    expect(svg).toContain(`data-directions="${direction}"`);
    expect(svg).toContain('<polygon');
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('draws one branch per painted arrow and highlights the active one', () => {
    const directions: LaneDirection[] = ['left', 'straight', 'right'];
    const svg = renderToString(
      <LaneIcon lane={{ directions, recommended: true, activeDirection: 'right' }} />,
    );
    expect(svg.match(/class="hud-lane__dir[ "]/g)).toHaveLength(3);
    expect(svg.match(/hud-lane__dir--active/g)).toHaveLength(1);
    expect(svg.match(/opacity="0.4"/g)).toHaveLength(2);
  });

  it('draws a lone recommended arrow at full strength without an explicit active direction', () => {
    const svg = renderToString(
      <LaneIcon lane={{ directions: ['slight-right'], recommended: true }} />,
    );
    expect(svg).toContain('hud-lane__dir--active');
    expect(svg).not.toContain('opacity=');
  });

  it('does not dim individual arrows of a lane that is not recommended', () => {
    const svg = renderToString(
      <LaneIcon lane={{ directions: ['straight', 'left'], recommended: false }} />,
    );
    expect(svg).not.toContain('opacity=');
  });

  it('de-duplicates repeated directions and survives an empty list', () => {
    const dup = renderToString(
      <LaneIcon lane={{ directions: ['straight', 'straight'], recommended: false }} />,
    );
    expect(dup.match(/class="hud-lane__dir/g)).toHaveLength(1);
    const empty = renderToString(<LaneIcon lane={{ directions: [], recommended: false }} />);
    expect(empty.match(/class="hud-lane__dir/g)).toHaveLength(1);
  });
});

describe('glyphs', () => {
  it.each(GLYPH_NAMES)('%s renders', (name) => {
    const svg = renderToString(<Glyph name={name} />);
    expect(svg).toContain(`data-glyph="${name}"`);
    expect(shapes(svg)).toBeGreaterThan(0);
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('every hazard type has an icon', () => {
    for (const type of HAZARD_TYPES) {
      expect(hasGlyph(HAZARD_GLYPHS[type]), type).toBe(true);
    }
  });

  it('every alert kind has an icon', () => {
    expect(allAlertKindsListed).toBe(true);
    for (const kind of ALERT_KINDS) {
      expect(hasGlyph(ALERT_GLYPHS[kind]), kind).toBe(true);
    }
    expect(Object.keys(ALERT_GLYPHS).sort()).toEqual([...ALERT_KINDS].sort());
  });

  it('includes the alert icons named in the design brief', () => {
    for (const name of [
      'engine',
      'thermometer',
      'battery',
      'fuel',
      'tyre',
      'snowflake',
      'wrench',
      'link',
      'collision',
    ] as const) {
      expect(GLYPH_NAMES).toContain(name);
    }
  });

  it('is decorative unless titled', () => {
    expect(renderToString(<Glyph name="fuel" />)).toContain('aria-hidden="true"');
    const titled = renderToString(<Glyph name="snowflake" title="Ice risk" />);
    expect(titled).toContain('aria-label="Ice risk"');
    expect(titled).toContain('role="img"');
  });

  it('rejects names it does not know', () => {
    expect(hasGlyph('toString')).toBe(false);
    expect(hasGlyph('nope')).toBe(false);
  });
});
