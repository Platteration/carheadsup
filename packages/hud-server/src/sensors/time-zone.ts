/**
 * The system time zone as an input: the local time's UTC offset (for the `nightHours` fallback)
 * and the zone's principal city (from the tz database's own tables, `zone-locations.ts`) as a
 * rough location for sun-based night mode — so a HUD without a light sensor dims at night even
 * before the phone has ever sent its location. Reported as `clock/zone` on start and whenever
 * the zone or its offset changes (daylight saving), checked every {@link TIME_ZONE_CHECK_MS}.
 */
import type { GeoPoint, HudConfig, TimeZoneInfo } from '@carheadsup/core';
import type { EventSource, SourceContext } from '../sources/types.ts';
import { ZONE_LINKS, ZONE_LOCATIONS } from './zone-locations.ts';

/** How often the zone and its offset are checked (daylight saving changes the offset). */
export const TIME_ZONE_CHECK_MS = 60_000;

/** Reads the system's time zone; injectable for tests. */
export interface TimeZoneProbe {
  /** The IANA name of the system time zone, or null when unknown. */
  name(): string | null;
  /** Local time − UTC at `epochMs`, minutes. */
  utcOffsetMin(epochMs: number): number;
}

/** The time zone Node runs in (the system's, or the `TZ` environment variable). */
export const SYSTEM_TIME_ZONE: TimeZoneProbe = {
  name: () => {
    try {
      const name = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return typeof name === 'string' && name !== '' && name !== 'Etc/Unknown' ? name : null;
    } catch {
      return null;
    }
  },
  utcOffsetMin: (epochMs) => -new Date(epochMs).getTimezoneOffset(),
};

/**
 * The principal location of the IANA zone `name` (following the tz database's links, so the names
 * ICU reports — Asia/Calcutta, Europe/Kiev — are found too), or null for zones without one (UTC,
 * Etc/GMT+5) and unknown names.
 */
export function zoneLocation(name: string | null): GeoPoint | null {
  if (name === null) return null;
  // `TZ=:Europe/Berlin` and the posix/ and right/ trees name the same zones.
  const bare = name.replace(/^:/, '').replace(/^(?:posix|right)\//, '');
  const own = Object.hasOwn(ZONE_LOCATIONS, bare) ? ZONE_LOCATIONS[bare] : undefined;
  const target = Object.hasOwn(ZONE_LINKS, bare) ? ZONE_LINKS[bare] : undefined;
  const linked =
    target !== undefined && Object.hasOwn(ZONE_LOCATIONS, target)
      ? ZONE_LOCATIONS[target]
      : undefined;
  const found = own ?? linked;
  return found === undefined ? null : { lat: found[0], lon: found[1] };
}

/** The `clock/zone` report for the system time zone at `epochMs`, or null when unusable. */
export function readTimeZone(probe: TimeZoneProbe, epochMs: number): TimeZoneInfo | null {
  const offset = probe.utcOffsetMin(epochMs);
  if (!Number.isFinite(offset)) return null;
  const name = probe.name();
  // `+ 0` turns the −0 of a UTC zone into 0.
  return { name, utcOffsetMin: offset + 0, location: zoneLocation(name) };
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

export class TimeZoneSource implements EventSource {
  readonly name = 'time-zone';
  private readonly probe: TimeZoneProbe;
  private config: HudConfig;
  private ctx: SourceContext | null = null;
  private timer: unknown = null;
  private last: TimeZoneInfo | null = null;

  constructor(config: HudConfig, probe: TimeZoneProbe = SYSTEM_TIME_ZONE) {
    this.config = config;
    this.probe = probe;
  }

  start(ctx: SourceContext): Promise<void> {
    this.ctx = ctx;
    this.check(true);
    return Promise.resolve();
  }

  stop(): Promise<void> {
    if (this.ctx !== null && this.timer !== null) this.ctx.timers.clearTimeout(this.timer);
    this.timer = null;
    this.ctx = null;
    return Promise.resolve();
  }

  updateConfig(config: HudConfig): void {
    this.config = config;
  }

  private check(first: boolean): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    this.timer = null;
    let zone: TimeZoneInfo | null = null;
    try {
      zone = readTimeZone(this.probe, ctx.now());
    } catch (err) {
      if (first) ctx.logger.warn(`Time zone: cannot read it: ${describe(err)}`);
    }
    if (zone !== null && !sameZone(zone, this.last)) {
      if (first || zone.name !== this.last?.name) this.describeZone(ctx, zone);
      this.last = zone;
      ctx.emit({ type: 'clock/zone', zone, at: ctx.now() });
    }
    this.timer = ctx.timers.setTimeout(() => this.check(false), TIME_ZONE_CHECK_MS);
  }

  private describeZone(ctx: SourceContext, zone: TimeZoneInfo): void {
    const name = zone.name ?? 'unknown';
    const offset = formatOffset(zone.utcOffsetMin);
    if (zone.location !== null) {
      const { lat, lon } = zone.location;
      ctx.logger.info(
        `Time zone: ${name} (${offset}); until the phone sends its location, night mode follows ` +
          `the sun at ${lat}, ${lon}`,
      );
      return;
    }
    const { lightSensor, fallbackLocation } = this.config.sensors;
    const message =
      `Time zone: ${name} (${offset}) has no location; without a light sensor or the phone's ` +
      'location, night mode goes by the clock (display.brightness.nightHours). Set the system ' +
      'time zone (sudo timedatectl set-timezone Region/City) or sensors.fallbackLocation';
    if (lightSensor === 'none' && fallbackLocation === null) ctx.logger.warn(message);
    else ctx.logger.info(`Time zone: ${name} (${offset})`);
  }
}

function sameZone(a: TimeZoneInfo, b: TimeZoneInfo | null): boolean {
  return (
    b !== null &&
    a.name === b.name &&
    a.utcOffsetMin === b.utcOffsetMin &&
    a.location?.lat === b.location?.lat &&
    a.location?.lon === b.location?.lon
  );
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
