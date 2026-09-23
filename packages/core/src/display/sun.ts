import { notImplemented } from '../todo.ts';

/** Solar elevation angle in degrees (NOAA algorithm, ±0.5° is plenty), negative below the horizon. */
export function sunElevationDeg(lat: number, lon: number, epochMs: number): number {
  return notImplemented(`sunElevationDeg(${lat}, ${lon}, ${epochMs})`);
}
