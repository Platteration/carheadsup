import type { GeoPoint } from '../types/state.ts';
import { LAST_LOCATION_STEP_DEG } from '../types/state.ts';

/** A valid point (finite, latitude within ±90°, longitude within ±180°), or null. */
export function parseGeoPoint(value: unknown): GeoPoint | null {
  if (typeof value !== 'object' || value === null) return null;
  const { lat, lon } = value as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * `point` rounded to {@link LAST_LOCATION_STEP_DEG} (about 11 km): plenty for the sun (sunset moves
 * by about a minute per 20 km), and no more precise than a remembered location needs to be.
 */
export function roundLocation(point: GeoPoint): GeoPoint {
  const round = (deg: number): number => {
    const r = Math.round(deg / LAST_LOCATION_STEP_DEG) * LAST_LOCATION_STEP_DEG;
    // Strip binary noise (0.30000000000000004) and negative zero.
    return Number(r.toFixed(1)) + 0;
  };
  return { lat: round(point.lat), lon: round(point.lon) };
}

export function sameGeoPoint(a: GeoPoint | null, b: GeoPoint | null): boolean {
  if (a === b) return true;
  return a !== null && b !== null && a.lat === b.lat && a.lon === b.lon;
}
