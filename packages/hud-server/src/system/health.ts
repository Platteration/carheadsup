/**
 * The HUD computer's own health: the SoC temperature and, on a Raspberry Pi, the firmware's
 * under-voltage and throttling flags. A Pi cooking on the dashboard, or a 12 V → 5 V converter
 * that sags while the engine cranks, shows up as slow starts, a low frame rate, random resets
 * and a corrupted SD card — with nothing pointing at the cause. So the server reads them every
 * few seconds, logs every change (a warning when it goes wrong), and reports them in /api/info.
 * A supply that hovers at the threshold flips the flags every few seconds; it is logged once,
 * and "fine again" only after {@link HEALTH_RECOVERY_READINGS} good readings in a row.
 *
 * Sources (each optional; a missing one reads as null):
 *  - `/sys/class/thermal/thermal_zone0/temp`: millidegrees Celsius;
 *  - the firmware's `get_throttled` (`/sys/devices/platform/soc/soc:firmware/get_throttled` on
 *    most Pis, found under `/sys/devices/platform` otherwise): hexadecimal flags, bit 0 under-
 *    voltage now, 1 frequency capped now, 2 throttled now, 3 soft temperature limit now, and bits
 *    16–19 the same "since boot";
 *  - the kernel's `rpi_volt` hardware monitor (`/sys/class/hwmon/hwmon*` named `rpi_volt`),
 *    `in0_lcrit_alarm`: under-voltage now, where `get_throttled` is not exposed.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApiSystemHealth } from '@carheadsup/core';
import type { Logger, Timers } from '@carheadsup/obd';

/** How often the health is read. */
export const HEALTH_INTERVAL_MS = 5000;
/** A SoC this hot is reported (the Pi throttles at 80–85 °C) … */
export const SOC_HOT_C = 80;
/** … until it is back below this. */
export const SOC_COOL_C = 75;
/**
 * Under-voltage or a slowed-down CPU counts as over once it has been gone for this many
 * readings in a row (30 s): until then a relapse is no news. Without it a flapping flag would put
 * two lines a few seconds apart in the log for a whole drive, each warning flushed to the card.
 */
export const HEALTH_RECOVERY_READINGS = 6;

const UNDER_VOLTAGE = 1 << 0;
const THROTTLED_NOW = (1 << 1) | (1 << 2) | (1 << 3);
const UNDER_VOLTAGE_SEEN = 1 << 16;
const THROTTLED_SEEN = (1 << 17) | (1 << 18) | (1 << 19);

const THERMAL = ['class', 'thermal', 'thermal_zone0', 'temp'];
const FIRMWARE_THROTTLED = ['devices', 'platform', 'soc', 'soc:firmware', 'get_throttled'];

/** The raw readings of one check; null where a source is missing or unreadable. */
export interface HealthReading {
  /** °C. */
  socTempC: number | null;
  /** The firmware's flags. */
  throttledFlags: number | null;
  /** The `rpi_volt` alarm. */
  voltAlarm: boolean | null;
}

/** Read a small sysfs file, or null when it is not there (or not readable). */
async function readSys(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf8')).trim();
  } catch {
    return null;
  }
}

async function list(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

/** Where the files of the health sources are under `sysRoot` (found once, at start). */
export interface HealthPaths {
  thermal: string;
  /** `get_throttled`, or null when the firmware exposes none. */
  throttled: string | null;
  /** `in0_lcrit_alarm` of the `rpi_volt` monitor, or null. */
  voltAlarm: string | null;
}

/** Find the health files under `sysRoot` (normally `/sys`). */
export async function findHealthPaths(sysRoot: string): Promise<HealthPaths> {
  let throttled: string | null = join(sysRoot, ...FIRMWARE_THROTTLED);
  if ((await readSys(throttled)) === null) {
    throttled = null;
    // Other models name the firmware node differently (e.g. `axi:firmware` under `axi`).
    const platform = join(sysRoot, 'devices', 'platform');
    search: for (const parent of await list(platform)) {
      for (const child of await list(join(platform, parent))) {
        if (!child.endsWith(':firmware')) continue;
        const candidate = join(platform, parent, child, 'get_throttled');
        if ((await readSys(candidate)) !== null) {
          throttled = candidate;
          break search;
        }
      }
    }
  }
  let voltAlarm: string | null = null;
  const hwmon = join(sysRoot, 'class', 'hwmon');
  for (const name of await list(hwmon)) {
    if ((await readSys(join(hwmon, name, 'name'))) === 'rpi_volt') {
      voltAlarm = join(hwmon, name, 'in0_lcrit_alarm');
      break;
    }
  }
  return { thermal: join(sysRoot, ...THERMAL), throttled, voltAlarm };
}

/** Take one reading from `paths`. */
export async function readHealth(paths: HealthPaths): Promise<HealthReading> {
  const [thermal, throttled, alarm] = await Promise.all([
    readSys(paths.thermal),
    paths.throttled === null ? null : readSys(paths.throttled),
    paths.voltAlarm === null ? null : readSys(paths.voltAlarm),
  ]);
  const milli = thermal === null || !/^-?\d+$/.test(thermal) ? null : Number(thermal);
  const flags =
    throttled === null || !/^(0x)?[0-9a-f]+$/i.test(throttled)
      ? null
      : Number.parseInt(throttled.replace(/^0x/i, ''), 16);
  return {
    socTempC: milli === null ? null : Math.round(milli / 100) / 10,
    throttledFlags: flags,
    voltAlarm: alarm === '1' ? true : alarm === '0' ? false : null,
  };
}

export interface SystemHealthOptions {
  /** Default `/sys`. */
  sysRoot?: string;
  intervalMs?: number;
  timers: Timers;
  logger: Logger;
}

/**
 * A condition that is logged when it starts and when it is over — which it is only after
 * `recoveryReadings` readings without it in a row. A reading of null (the source is gone)
 * changes nothing.
 */
class Alarm {
  private readonly recoveryReadings: number;
  private active = false;
  private clearReadings = 0;

  constructor(recoveryReadings: number) {
    this.recoveryReadings = Math.max(1, recoveryReadings);
  }

  /** 'raised' when the condition starts, 'cleared' when it is over, else null. */
  update(now: boolean | null): 'raised' | 'cleared' | null {
    if (now === true) {
      this.clearReadings = 0;
      if (this.active) return null;
      this.active = true;
      return 'raised';
    }
    if (now === false && this.active) {
      this.clearReadings += 1;
      if (this.clearReadings >= this.recoveryReadings) {
        this.active = false;
        this.clearReadings = 0;
        return 'cleared';
      }
    }
    return null;
  }
}

/** Reads the health every few seconds, logs the changes and keeps the latest for /api/info. */
export class SystemHealthMonitor {
  readonly name = 'system health';
  private readonly options: SystemHealthOptions;
  private paths: HealthPaths | null = null;
  private current: ApiSystemHealth | null = null;
  private timer: unknown = null;
  private stopped = false;
  private hot = false;
  private underVoltageSeen = false;
  private throttledSeen = false;
  private readonly supplyAlarm = new Alarm(HEALTH_RECOVERY_READINGS);
  private readonly speedAlarm = new Alarm(HEALTH_RECOVERY_READINGS);
  private first = true;

  constructor(options: SystemHealthOptions) {
    this.options = options;
  }

  /** The latest reading, or null when none of the sources exist here. */
  snapshot(): ApiSystemHealth | null {
    return this.current === null ? null : { ...this.current };
  }

  /** Find the sources, take a first reading and keep reading. */
  async start(): Promise<void> {
    this.paths = await findHealthPaths(this.options.sysRoot ?? '/sys');
    await this.check();
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) this.options.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Take a reading now (also on the timer). */
  async check(): Promise<void> {
    if (this.paths === null) return;
    let reading: HealthReading;
    try {
      reading = await readHealth(this.paths);
    } catch (err) {
      this.options.logger.debug(
        `System: reading the health failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    this.apply(reading);
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = this.options.timers.setTimeout(() => {
      this.timer = null;
      void this.check().finally(() => this.schedule());
    }, this.options.intervalMs ?? HEALTH_INTERVAL_MS);
  }

  private apply(reading: HealthReading): void {
    const { logger } = this.options;
    const flags = reading.throttledFlags;
    const underVoltage = flags !== null ? (flags & UNDER_VOLTAGE) !== 0 : reading.voltAlarm;
    const throttled = flags !== null ? (flags & THROTTLED_NOW) !== 0 : null;
    if (underVoltage === true) this.underVoltageSeen = true;
    if (throttled === true) this.throttledSeen = true;
    const next: ApiSystemHealth = {
      socTempC: reading.socTempC,
      underVoltage,
      underVoltageSeen:
        flags !== null
          ? (flags & UNDER_VOLTAGE_SEEN) !== 0 || this.underVoltageSeen
          : underVoltage === null
            ? null
            : this.underVoltageSeen,
      throttled,
      throttledSeen: flags !== null ? (flags & THROTTLED_SEEN) !== 0 || this.throttledSeen : null,
    };
    const nothing = next.socTempC === null && next.underVoltage === null && next.throttled === null;
    this.current = nothing ? null : next;
    if (nothing) return;

    const temp = next.socTempC === null ? '' : ` (SoC ${next.socTempC} °C)`;
    if (this.first) {
      this.first = false;
      logger.info(`System: ${describeHealth(next)}`);
      if (next.underVoltageSeen === true && next.underVoltage !== true) {
        logger.warn(
          'System: the firmware reports under-voltage since boot: the 5 V supply sagged (check the converter and its wiring)',
        );
      }
    }
    const supply = this.supplyAlarm.update(next.underVoltage);
    if (supply === 'raised') {
      logger.warn(
        "System: under-voltage: the Pi's 5 V supply sags — expect slowdowns, resets and SD card damage; check the converter and its wiring",
      );
    } else if (supply === 'cleared') {
      logger.info('System: the supply voltage is fine again');
    }
    const speed = this.speedAlarm.update(next.throttled);
    if (speed === 'raised') {
      logger.warn(`System: the CPU is slowed down (heat or supply)${temp}`);
    } else if (speed === 'cleared') {
      logger.info(`System: the CPU runs at full speed again${temp}`);
    }
    if (next.socTempC !== null) {
      if (!this.hot && next.socTempC >= SOC_HOT_C) {
        this.hot = true;
        logger.warn(
          `System: the SoC is at ${next.socTempC} °C — the Pi slows down from 80–85 °C; shade or cool it`,
        );
      } else if (this.hot && next.socTempC < SOC_COOL_C) {
        this.hot = false;
        logger.info(`System: the SoC has cooled down to ${next.socTempC} °C`);
      }
    }
  }
}

/** One line for the log: "SoC 54.2 °C, supply OK, full speed". */
export function describeHealth(health: ApiSystemHealth): string {
  const parts: string[] = [];
  if (health.socTempC !== null) parts.push(`SoC ${health.socTempC} °C`);
  if (health.underVoltage !== null) {
    parts.push(health.underVoltage ? 'under-voltage' : 'supply OK');
  }
  if (health.throttled !== null) parts.push(health.throttled ? 'slowed down' : 'full speed');
  return parts.join(', ');
}
