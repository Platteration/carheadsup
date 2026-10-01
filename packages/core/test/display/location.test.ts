import { describe, expect, it } from 'vitest';
import {
  nextLastLocation,
  parseGeoPoint,
  roundLocation,
  sameGeoPoint,
} from '../../src/display/location.ts';

describe('parseGeoPoint', () => {
  it('takes finite points within range and nothing else', () => {
    expect(parseGeoPoint({ lat: 52.5, lon: 13.4, at: 1 })).toEqual({ lat: 52.5, lon: 13.4 });
    expect(parseGeoPoint({ lat: -90, lon: 180 })).toEqual({ lat: -90, lon: 180 });
    for (const bad of [
      null,
      'Berlin',
      { lat: 91, lon: 0 },
      { lat: 0, lon: -181 },
      { lat: Number.NaN, lon: 0 },
      { lat: '52', lon: 13 },
      { lat: 52 },
    ]) {
      expect(parseGeoPoint(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('roundLocation', () => {
  it('rounds to 0.1° without binary noise or negative zero', () => {
    expect(roundLocation({ lat: 21.3069, lon: -157.8583 })).toEqual({ lat: 21.3, lon: -157.9 });
    expect(roundLocation({ lat: 0.29999, lon: -0.04 })).toEqual({ lat: 0.3, lon: 0 });
    expect(Object.is(roundLocation({ lat: -0.01, lon: 0 }).lat, -0)).toBe(false);
  });
});

describe('nextLastLocation', () => {
  it('starts from the rounded first fix', () => {
    expect(nextLastLocation(null, { lat: 52.449, lon: 13.41 })).toEqual({ lat: 52.4, lon: 13.4 });
  });

  it('keeps the remembered point (same object) while fixes jitter across a rounding boundary', () => {
    const kept = { lat: 52.4, lon: 13.4 };
    for (const point of [
      { lat: 52.45001, lon: 13.4 },
      { lat: 52.44999, lon: 13.45001 },
      { lat: 52.474, lon: 13.474 },
      { lat: 52.326, lon: 13.326 },
    ]) {
      expect(nextLastLocation(kept, point), JSON.stringify(point)).toBe(kept);
    }
  });

  it('moves on, rounded, once a fix is clearly in another cell', () => {
    const kept = { lat: 52.4, lon: 13.4 };
    expect(nextLastLocation(kept, { lat: 52.476, lon: 13.4 })).toEqual({ lat: 52.5, lon: 13.4 });
    expect(nextLastLocation(kept, { lat: 52.4, lon: 13.3 })).toEqual({ lat: 52.4, lon: 13.3 });
    expect(nextLastLocation(kept, { lat: -33.9, lon: 151.2 })).toEqual({ lat: -33.9, lon: 151.2 });
  });

  it('measures longitude across the antimeridian', () => {
    const kept = roundLocation({ lat: -17, lon: 179.97 });
    expect(kept).toEqual({ lat: -17, lon: 180 });
    expect(nextLastLocation(kept, { lat: -17, lon: -179.97 })).toBe(kept);
    expect(nextLastLocation(kept, { lat: -17, lon: -179.9 })).toEqual({ lat: -17, lon: -179.9 });
  });
});

describe('sameGeoPoint', () => {
  it('compares by value', () => {
    expect(sameGeoPoint({ lat: 1, lon: 2 }, { lat: 1, lon: 2 })).toBe(true);
    expect(sameGeoPoint(null, null)).toBe(true);
    expect(sameGeoPoint({ lat: 1, lon: 2 }, null)).toBe(false);
    expect(sameGeoPoint({ lat: 1, lon: 2 }, { lat: 1, lon: 2.1 })).toBe(false);
  });
});
