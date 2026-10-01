/**
 * Parsers for the tz database's own tables (`zone1970.tab`, `zone.tab`, `tzdata.zi`), which the
 * zone-location table (`zone-locations.ts`) is generated from — see
 * `tools/generate-zone-locations.ts`.
 */

/** A zone's principal location, degrees (latitude north, longitude east). */
export type LatLon = readonly [lat: number, lon: number];

/**
 * Parse ISO 6709 sign-degrees-minutes[-seconds] coordinates as `zone.tab` writes them:
 * `±DDMM±DDDMM` or `±DDMMSS±DDDMMSS`. Null when malformed or out of range.
 */
export function parseIso6709(text: string): LatLon | null {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/.exec(text);
  if (m === null) return null;
  const part = (sign: string, d: string, mm: string, ss: string | undefined): number =>
    (sign === '-' ? -1 : 1) * (Number(d) + Number(mm) / 60 + Number(ss ?? '0') / 3600);
  // Both or neither carry seconds.
  if ((m[4] === undefined) !== (m[8] === undefined)) return null;
  const lat = part(m[1] ?? '+', m[2] ?? '', m[3] ?? '', m[4]);
  const lon = part(m[5] ?? '+', m[6] ?? '', m[7] ?? '', m[8]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lat, lon];
}

/**
 * The zones and principal locations of a `zone1970.tab` or `zone.tab` (tab-separated: country
 * codes, coordinates, zone name, comments; `#` starts a comment line).
 */
export function parseZoneTab(text: string): Map<string, LatLon> {
  const zones = new Map<string, LatLon>();
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const [, coordinates, name] = line.split('\t');
    if (coordinates === undefined || name === undefined || name === '') continue;
    const location = parseIso6709(coordinates);
    if (location !== null && !zones.has(name)) zones.set(name, location);
  }
  return zones;
}

/** The links (`L target name`) of a compiled `tzdata.zi`: link name → target. */
export function parseZiLinks(text: string): Map<string, string> {
  const links = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^L\s+(\S+)\s+(\S+)\s*$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) links.set(m[2], m[1]);
  }
  return links;
}

/** The tz database version a `tzdata.zi` was compiled from (its `# version` line), or null. */
export function parseZiVersion(text: string): string | null {
  return /^# version (\S+)$/m.exec(text)?.[1] ?? null;
}

/**
 * Merge the tables: `zone1970.tab` first (canonical zones), then `zone.tab` for the names it adds
 * (e.g. Europe/Amsterdam with Amsterdam's own location), then every link whose target — after
 * following links — has a location (e.g. Asia/Calcutta → Asia/Kolkata, the name ICU reports).
 * Locations are rounded to 0.01° (about 1 km).
 */
export function buildZoneTable(
  zone1970: Map<string, LatLon>,
  zoneTab: Map<string, LatLon>,
  links: Map<string, string>,
): { locations: Map<string, LatLon>; links: Map<string, string> } {
  const locations = new Map<string, LatLon>();
  const round = (v: number): number => Math.round(v * 100) / 100 + 0;
  for (const table of [zone1970, zoneTab]) {
    for (const [name, [lat, lon]] of table) {
      if (!locations.has(name)) locations.set(name, [round(lat), round(lon)]);
    }
  }
  const resolved = new Map<string, string>();
  for (const name of links.keys()) {
    if (locations.has(name)) continue;
    let target = links.get(name);
    for (let hops = 0; target !== undefined && !locations.has(target) && hops < 8; hops++) {
      target = links.get(target);
    }
    if (target !== undefined && locations.has(target)) resolved.set(name, target);
  }
  return { locations, links: resolved };
}
