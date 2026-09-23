import { describe, expect, it } from 'vitest';
import {
  ROAD_SEGMENTS,
  ROUTE_LENGTH_M,
  ROUTE_MANEUVERS,
  ROUTE_ORIGIN,
  SCRIPTED_HAZARDS,
  THEN_WITHIN_M,
  locationAt,
  nextManeuverIndex,
  remainingSeconds,
  roadAt,
  thenManeuver,
} from '../../src/sim/route.ts';

describe('scripted route', () => {
  it('has maneuvers in route order, ending with the arrival', () => {
    const positions = ROUTE_MANEUVERS.map((m) => m.at);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(positions).size).toBe(positions.length);
    expect(ROUTE_MANEUVERS.at(-1)?.maneuver.type).toBe('arrive-right');
    expect(ROUTE_LENGTH_M).toBe(ROUTE_MANEUVERS.at(-1)?.at);
  });

  it('lines up with the distances the demo scenario drives', () => {
    // Measured from the VehicleSimulator: city 0–659 m, red light ~698 m, on-ramp to ~1116 m,
    // highway to ~3976 m, exit to ~4342 m, stop at ~4511 m.
    const at = (type: string) => ROUTE_MANEUVERS.find((m) => m.maneuver.type === type)!.at;
    expect(at('right')).toBeLessThan(659);
    expect(at('left')).toBeLessThan(659);
    expect(at('ramp-right')).toBeGreaterThan(698);
    expect(at('merge-left')).toBeLessThan(1116);
    expect(at('exit-right')).toBeGreaterThan(3976 - 50);
    expect(at('roundabout-ccw')).toBeLessThan(4342);
    expect(ROUTE_LENGTH_M).toBeLessThan(4511);
    expect(SCRIPTED_HAZARDS[0]!.at).toBeGreaterThan(1116);
    expect(SCRIPTED_HAZARDS[0]!.at).toBeLessThan(3976);
  });

  it('gives lanes before the highway exit, with recommended lanes', () => {
    const exit = ROUTE_MANEUVERS.find((m) => m.maneuver.type === 'exit-right')!;
    expect(exit.lanes?.some((l) => l.recommended && l.activeDirection === 'slight-right')).toBe(
      true,
    );
    expect(exit.lanes?.some((l) => !l.recommended)).toBe(true);
    for (const m of ROUTE_MANEUVERS) {
      for (const lane of m.lanes ?? []) {
        if (!lane.recommended) expect(lane.activeDirection ?? null).toBeNull();
        else expect(lane.directions).toContain(lane.activeDirection);
      }
    }
  });

  it('knows the road under the car (50 in town, 100/120 on the motorway)', () => {
    expect(roadAt(0)).toMatchObject({ name: 'Maple Street', speedLimitKph: 50 });
    expect(roadAt(-10).name).toBe('Maple Street');
    expect(roadAt(300)).toMatchObject({ name: 'Station Road', speedLimitKph: 50 });
    expect(roadAt(900)).toMatchObject({
      name: 'A7 North',
      speedLimitKph: 100,
      roadClass: 'motorway',
    });
    expect(roadAt(2000).speedLimitKph).toBe(120);
    expect(roadAt(SCRIPTED_HAZARDS[0]!.at).speedLimitKph).toBe(100);
    expect(roadAt(3500).speedLimitKph).toBe(120);
    expect(roadAt(4100)).toMatchObject({ speedLimitKph: 70 });
    expect(roadAt(99_999)).toBe(ROAD_SEGMENTS.at(-1));
  });

  it('finds the next maneuver and the "then" maneuver', () => {
    expect(nextManeuverIndex(0)).toBe(0);
    expect(nextManeuverIndex(170)).toBe(1); // reached → next one
    expect(nextManeuverIndex(2000)).toBe(
      ROUTE_MANEUVERS.findIndex((m) => m.maneuver.type === 'exit-right'),
    );
    expect(nextManeuverIndex(ROUTE_LENGTH_M)).toBe(ROUTE_MANEUVERS.length);
    ROUTE_MANEUVERS.forEach((m, i) => {
      const next = ROUTE_MANEUVERS[i + 1];
      const expected = next !== undefined && next.at - m.at <= THEN_WITHIN_M ? next.maneuver : null;
      expect(thenManeuver(i)).toEqual(expected);
    });
    expect(
      thenManeuver(ROUTE_MANEUVERS.findIndex((m) => m.maneuver.type === 'exit-right'))?.type,
    ).toBe('roundabout-ccw');
    expect(thenManeuver(99)).toBeNull();
  });

  it('estimates the remaining time from the speed limits, decreasing along the route', () => {
    let previous = Infinity;
    for (let p = 0; p <= ROUTE_LENGTH_M; p += 100) {
      const s = remainingSeconds(p);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeLessThanOrEqual(previous);
      previous = s;
    }
    expect(remainingSeconds(ROUTE_LENGTH_M)).toBe(0);
    expect(remainingSeconds(ROUTE_LENGTH_M + 500)).toBe(0);
    // ~4.5 km of mostly motorway: a few minutes.
    expect(remainingSeconds(0)).toBeGreaterThan(150);
    expect(remainingSeconds(0)).toBeLessThan(400);
  });

  it('moves the location continuously along the route', () => {
    expect(locationAt(0)).toMatchObject(ROUTE_ORIGIN);
    let previous = locationAt(0);
    for (let p = 50; p <= ROUTE_LENGTH_M; p += 50) {
      const here = locationAt(p);
      const dLat = (here.lat - previous.lat) * 111_320;
      const dLon = (here.lon - previous.lon) * 111_320 * Math.cos((here.lat * Math.PI) / 180);
      // 50 m of road: a straight 50 m chord, shorter where the road turns between samples.
      const chord = Math.hypot(dLat, dLon);
      expect(chord).toBeLessThanOrEqual(50.5);
      expect(chord).toBeGreaterThan(25);
      expect(here.bearingDeg).toBeGreaterThanOrEqual(0);
      expect(here.bearingDeg).toBeLessThanOrEqual(360);
      previous = here;
    }
  });
});
