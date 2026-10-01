import { existsSync, readFileSync } from 'node:fs';
import { DEFAULT_CONFIG, type HudConfig } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import {
  TIME_ZONE_CHECK_MS,
  TimeZoneSource,
  readTimeZone,
  zoneLocation,
  type TimeZoneProbe,
} from '../../src/sensors/time-zone.ts';
import {
  ZONE_LINKS,
  ZONE_LOCATIONS,
  ZONE_TABLE_VERSION,
} from '../../src/sensors/zone-locations.ts';
import {
  buildZoneTable,
  parseIso6709,
  parseZiLinks,
  parseZiVersion,
  parseZoneTab,
} from '../../src/sensors/zone-tab.ts';
import { FakeClock, recordingContext } from './fakes.ts';

const ZONEINFO = '/usr/share/zoneinfo';

function probe(name: string | null, offset: number | (() => number)): TimeZoneProbe {
  return {
    name: () => name,
    utcOffsetMin: () => (typeof offset === 'function' ? offset() : offset),
  };
}

function config(sensors: Partial<HudConfig['sensors']> = {}): HudConfig {
  const c = structuredClone(DEFAULT_CONFIG) as HudConfig;
  c.sensors = { ...c.sensors, ...sensors };
  return c;
}

describe('zone table parsing', () => {
  it('parses ISO 6709 degrees-minutes and degrees-minutes-seconds', () => {
    expect(parseIso6709('+5230+01322')).toEqual([52.5, 13 + 22 / 60]);
    const [lat = 0, lon = 0] = parseIso6709('+404251-0740023') ?? [];
    expect(lat).toBeCloseTo(40 + 42 / 60 + 51 / 3600, 9);
    expect(lon).toBeCloseTo(-(74 + 0 / 60 + 23 / 3600), 9);
    expect(parseIso6709('-3352+15113')).toEqual([-(33 + 52 / 60), 151 + 13 / 60]);
    for (const bad of ['', '5230+01322', '+5230+0132', '+523000+01322', '+9130+01322', 'x']) {
      expect(parseIso6709(bad), bad).toBeNull();
    }
  });

  it('reads zone.tab rows, skipping comments and malformed lines', () => {
    const text = [
      '# tzdb timezone descriptions',
      'DE,DK\t+5230+01322\tEurope/Berlin\tmost of Germany',
      'NL\t+5222+00454\tEurope/Amsterdam',
      'XX\tnonsense\tNowhere/City',
      '',
      'GB\t+513030-0000731\tEurope/London',
    ].join('\n');
    const zones = parseZoneTab(text);
    expect([...zones.keys()]).toEqual(['Europe/Berlin', 'Europe/Amsterdam', 'Europe/London']);
  });

  it('reads the links and version of tzdata.zi', () => {
    const text =
      '# version 2099z\nZ Europe/Kyiv 2:2:4 -\nL Europe/Kyiv Europe/Kiev\nL Etc/UTC UTC\n';
    expect(parseZiVersion(text)).toBe('2099z');
    expect(parseZiLinks(text)).toEqual(
      new Map([
        ['Europe/Kiev', 'Europe/Kyiv'],
        ['UTC', 'Etc/UTC'],
      ]),
    );
  });

  it('merges the tables: zone1970 first, zone.tab additions, links (also chained) with a location', () => {
    const { locations, links } = buildZoneTable(
      new Map([['Europe/Brussels', [50.8333, 4.3333]]]),
      new Map([
        ['Europe/Brussels', [0, 0]],
        ['Europe/Amsterdam', [52.3667, 4.9]],
      ]),
      new Map([
        ['Europe/Old', 'Europe/Older'],
        ['Europe/Older', 'Europe/Brussels'],
        ['UTC', 'Etc/UTC'],
        ['Europe/Amsterdam', 'Europe/Brussels'],
      ]),
    );
    expect(locations).toEqual(
      new Map([
        ['Europe/Brussels', [50.83, 4.33]],
        ['Europe/Amsterdam', [52.37, 4.9]],
      ]),
    );
    expect(links).toEqual(
      new Map([
        ['Europe/Old', 'Europe/Brussels'],
        ['Europe/Older', 'Europe/Brussels'],
      ]),
    );
  });
});

describe('the bundled zone table', () => {
  it('covers the zones and the names ICU reports', () => {
    expect(Object.keys(ZONE_LOCATIONS).length).toBeGreaterThan(300);
    expect(zoneLocation('Europe/Berlin')).toEqual({ lat: 52.5, lon: 13.37 });
    expect(zoneLocation('America/New_York')).toEqual({ lat: 40.71, lon: -74.01 });
    // ICU's names for these zones are tz database links.
    expect(zoneLocation('Asia/Calcutta')).toEqual(zoneLocation('Asia/Kolkata'));
    expect(zoneLocation('Asia/Calcutta')).not.toBeNull();
    expect(zoneLocation('Europe/Kiev')).toEqual(zoneLocation('Europe/Kyiv'));
    expect(zoneLocation('Asia/Saigon')).toEqual(zoneLocation('Asia/Ho_Chi_Minh'));
    expect(zoneLocation('US/Eastern')).toEqual(zoneLocation('America/New_York'));
    // Spellings of TZ that name the same zone.
    expect(zoneLocation(':Europe/Berlin')).toEqual(zoneLocation('Europe/Berlin'));
    expect(zoneLocation('posix/Europe/Berlin')).toEqual(zoneLocation('Europe/Berlin'));
  });

  it('has no location for zones without one, or for unknown names', () => {
    for (const name of ['UTC', 'Etc/UTC', 'Etc/GMT+5', 'CET', 'Mars/Olympus', '__proto__', null]) {
      expect(zoneLocation(name), String(name)).toBeNull();
    }
    expect(Object.values(ZONE_LINKS).every((target) => target in ZONE_LOCATIONS)).toBe(true);
  });

  it.skipIf(!existsSync(`${ZONEINFO}/zone1970.tab`))(
    "agrees with this machine's zone1970.tab and zone.tab",
    () => {
      const read = (file: string) => readFileSync(`${ZONEINFO}/${file}`, 'utf8');
      const zone1970 = parseZoneTab(read('zone1970.tab'));
      const zoneTab = parseZoneTab(read('zone.tab'));
      // Every zone of the system's tables is in the bundled one, at the same place (to 0.01°):
      // a newer tz database may add a zone, which only regenerating picks up.
      const missing: string[] = [];
      for (const table of [zone1970, zoneTab]) {
        for (const [name, [lat, lon]] of table) {
          const found = zoneLocation(name);
          if (found === null) {
            missing.push(name);
            continue;
          }
          expect(Math.abs(found.lat - lat), name).toBeLessThanOrEqual(0.005 + 1e-9);
          expect(Math.abs(found.lon - lon), name).toBeLessThanOrEqual(0.005 + 1e-9);
        }
      }
      const zi = existsSync(`${ZONEINFO}/tzdata.zi`) ? read('tzdata.zi') : '';
      if (parseZiVersion(zi) === ZONE_TABLE_VERSION) {
        expect(missing).toEqual([]);
        const built = buildZoneTable(zone1970, zoneTab, parseZiLinks(zi));
        expect(Object.fromEntries(built.locations)).toEqual(ZONE_LOCATIONS);
        expect(Object.fromEntries(built.links)).toEqual(ZONE_LINKS);
      } else {
        expect(missing.length).toBeLessThan(10);
      }
    },
  );
});

describe('readTimeZone', () => {
  it('reports the name, offset and location', () => {
    expect(readTimeZone(probe('Europe/Berlin', 120), 0)).toEqual({
      name: 'Europe/Berlin',
      utcOffsetMin: 120,
      location: { lat: 52.5, lon: 13.37 },
    });
    expect(readTimeZone(probe('UTC', -0), 0)).toEqual({
      name: 'UTC',
      utcOffsetMin: 0,
      location: null,
    });
    expect(Object.is(readTimeZone(probe('UTC', -0), 0)?.utcOffsetMin, -0)).toBe(false);
    expect(readTimeZone(probe(null, 330), 0)).toEqual({
      name: null,
      utcOffsetMin: 330,
      location: null,
    });
    expect(readTimeZone(probe('UTC', Number.NaN), 0)).toBeNull();
  });
});

describe('TimeZoneSource', () => {
  it('reports the zone on start, then only when it changes (daylight saving)', async () => {
    const clock = new FakeClock();
    let offset = 60;
    const source = new TimeZoneSource(
      config(),
      probe('Europe/Berlin', () => offset),
    );
    const { ctx, ofType, logger } = recordingContext(clock);
    await source.start(ctx);
    expect(ofType('clock/zone').map((e) => e.zone)).toEqual([
      { name: 'Europe/Berlin', utcOffsetMin: 60, location: { lat: 52.5, lon: 13.37 } },
    ]);
    expect(logger.lines('info').join('\n')).toContain('Time zone: Europe/Berlin (UTC+01:00)');
    await clock.advance(5 * TIME_ZONE_CHECK_MS, false);
    expect(ofType('clock/zone')).toHaveLength(1);
    offset = 120;
    await clock.advance(TIME_ZONE_CHECK_MS, false);
    expect(ofType('clock/zone').map((e) => e.zone.utcOffsetMin)).toEqual([60, 120]);
    // An offset change of the same zone is not logged again.
    expect(logger.lines('info')).toHaveLength(1);
    await source.stop();
    expect(clock.pendingTimers).toBe(0);
  });

  it('warns about a zone without a location when nothing else tells day from night', async () => {
    const clock = new FakeClock();
    const { ctx, ofType, logger } = recordingContext(clock);
    const source = new TimeZoneSource(config(), probe('Etc/UTC', 0));
    await source.start(ctx);
    expect(ofType('clock/zone').map((e) => e.zone)).toEqual([
      { name: 'Etc/UTC', utcOffsetMin: 0, location: null },
    ]);
    expect(logger.lines('warn').join('\n')).toContain('timedatectl set-timezone');
    await source.stop();

    for (const sensors of [
      { lightSensor: 'bh1750' as const },
      { fallbackLocation: { lat: 48.1, lon: 11.6 } },
    ]) {
      const quiet = recordingContext(clock);
      const other = new TimeZoneSource(config(sensors), probe('Etc/UTC', 0));
      await other.start(quiet.ctx);
      expect(quiet.logger.lines('warn')).toEqual([]);
      expect(quiet.logger.lines('info')).toEqual(['Time zone: Etc/UTC (UTC+00:00)']);
      await other.stop();
    }
  });

  it('keeps checking when the zone cannot be read', async () => {
    const clock = new FakeClock();
    const { ctx, ofType, logger } = recordingContext(clock);
    let broken = true;
    const source = new TimeZoneSource(config(), {
      name: () => 'Asia/Kolkata',
      utcOffsetMin: () => {
        if (broken) throw new Error('no tzdata');
        return 330;
      },
    });
    await source.start(ctx);
    expect(ofType('clock/zone')).toEqual([]);
    expect(logger.lines('warn')).toEqual(['Time zone: cannot read it: no tzdata']);
    broken = false;
    await clock.advance(TIME_ZONE_CHECK_MS, false);
    expect(ofType('clock/zone').map((e) => e.zone.utcOffsetMin)).toEqual([330]);
    await source.stop();
  });
});
