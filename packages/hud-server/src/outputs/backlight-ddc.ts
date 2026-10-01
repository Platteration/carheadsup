/**
 * Display brightness over DDC/CI, with `ddcutil`: the MCCS "Brightness" feature (VCP 0x10), which
 * an HDMI monitor — or the scaler of an LCD driver board — maps onto its backlight. That is the
 * way to dim the backlight of most HDMI panels, which have no Linux backlight device: without it
 * the LCD glows at full power at night and only the page's content is dimmed.
 *
 * DDC/CI is slow (a write takes tens to hundreds of milliseconds) and some monitors save every
 * change to EEPROM, so the level is written at most once a second and only when the brightness
 * moves by {@link DDC_MIN_CHANGE} or more. Opening checks that the display really applies a
 * change: it writes one step away from the current value and lets ddcutil read it back, so a
 * display that only pretends to support the feature is never trusted with the brightness (the
 * renderer then keeps dimming the page).
 */
import type { Clock, Timers } from '@carheadsup/obd';
import { monotonicView } from '../clock.ts';
import {
  CommandNotFoundError,
  defaultSpawn,
  runCommand,
  type SpawnFn,
} from '../sensors/process.ts';
import { errorMessage } from '../sensors/util.ts';
import { BACKLIGHT_GAMMA } from './backlight.ts';
import type { BacklightDriver, BacklightOpenResult, BacklightOutput } from './backlight.ts';

/** MCCS VCP feature code of the brightness (luminance) control. */
export const DDC_BRIGHTNESS_VCP = '10';
/** At most one write per second: DDC/CI is slow, and some monitors write EEPROM on each change. */
export const DDC_MIN_INTERVAL_MS = 1000;
/** Smallest brightness change (0–1) worth a write. */
export const DDC_MIN_CHANGE = 0.03;
/** `ddcutil detect` probes every I²C bus; give it time. */
export const DDC_DETECT_TIMEOUT_MS = 20_000;
export const DDC_COMMAND_TIMEOUT_MS = 5000;
/**
 * Looking for a display again (the sink asks every 10 s while it has none) runs ddcutil at most
 * this often: `ddcutil detect` probes every I²C bus. Without ddcutil installed, never again.
 */
export const DDC_REPROBE_MS = 60_000;
/** How to give the service access to the display's I²C bus. */
export const DDC_ACCESS_HINT =
  'The service user needs the i2c group and the i2c-dev kernel module ' +
  '(`echo i2c-dev | sudo tee /etc/modules-load.d/i2c-dev.conf`, then reboot)';

export interface DdcBacklightOptions {
  /** I²C bus of the display (`/dev/i2c-<bus>`); null = the first display ddcutil detects. */
  bus: number | null;
  now: Clock;
  timers: Timers;
  spawn?: SpawnFn;
  /**
   * Whether not finding ddcutil or a display is a problem (`--backlight ddc`) or merely means
   * there is none (auto-detection).
   */
  required: boolean;
}

/** The I²C buses of the displays `ddcutil detect --brief` reports as usable, in its order. */
export function parseDdcDetect(text: string): number[] {
  const buses: number[] = [];
  let valid = false;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) valid = /^Display\s+\d+/.test(line);
    const bus = /^\s+I2C bus:\s+\/dev\/i2c-(\d+)\s*$/.exec(line);
    if (valid && bus?.[1] !== undefined) buses.push(Number(bus[1]));
  }
  return buses;
}

/**
 * Current and maximum brightness from `ddcutil getvcp 10 --brief` ("VCP 10 C 50 100"), or from
 * its long form ("current value = 50, max value = 100"). Null when it is not there.
 */
export function parseVcpBrightness(text: string): { current: number; max: number } | null {
  const brief = /^VCP\s+10\s+C\s+(\d+)\s+(\d+)\s*$/im.exec(text);
  const long = /current value\s*=\s*(\d+),\s*max value\s*=\s*(\d+)/i.exec(text);
  const m = brief ?? long;
  if (m?.[1] === undefined || m[2] === undefined) return null;
  const current = Number(m[1]);
  const max = Number(m[2]);
  return max >= 1 && current <= max ? { current, max } : null;
}

/**
 * DDC/CI brightness level for a frame brightness (0–1): `max × brightness^γ`, rounded, never
 * below 1 — as with a sysfs backlight, since some driver boards switch the backlight off at 0
 * (the night minimum of 0.08 would round to 0, and the HUD, critical alerts included, would go
 * dark).
 */
export function ddcLevel(brightness: number, max: number, gamma = BACKLIGHT_GAMMA): number {
  const b = Number.isFinite(brightness) ? Math.min(1, Math.max(0, brightness)) : 1;
  return Math.min(max, Math.max(1, Math.round(max * b ** gamma)));
}

/** The first meaningful line of a command's output, for a log line. */
function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

export class DdcBacklightOutput implements BacklightOutput {
  readonly bus: number;
  readonly max: number;
  readonly minIntervalMs = DDC_MIN_INTERVAL_MS;
  readonly minChange = DDC_MIN_CHANGE;
  private readonly run: (args: readonly string[]) => Promise<string>;

  constructor(bus: number, max: number, run: (args: readonly string[]) => Promise<string>) {
    this.bus = bus;
    this.max = max;
    this.run = run;
  }

  get description(): string {
    return `the display on /dev/i2c-${this.bus} over DDC/CI (brightness 0–${this.max})`;
  }

  level(brightness: number): number {
    return ddcLevel(brightness, this.max);
  }

  async write(level: number): Promise<void> {
    await this.run([
      '--bus',
      String(this.bus),
      'setvcp',
      DDC_BRIGHTNESS_VCP,
      String(level),
      '--noverify',
    ]);
  }
}

/** A monitor or driver board that takes its brightness over DDC/CI. */
export class DdcBacklightDriver implements BacklightDriver {
  private readonly options: DdcBacklightOptions;
  private readonly spawn: SpawnFn;
  private readonly clock: Clock;
  /** The last unsuccessful look, repeated until it is due again (see {@link DDC_REPROBE_MS}). */
  private failed: { result: BacklightOpenResult; at: number; final: boolean } | null = null;

  constructor(options: DdcBacklightOptions) {
    this.options = options;
    this.spawn = options.spawn ?? defaultSpawn;
    this.clock = monotonicView(options.now);
  }

  async open(): Promise<BacklightOpenResult> {
    const failed = this.failed;
    if (failed !== null && (failed.final || this.clock() - failed.at < DDC_REPROBE_MS)) {
      return failed.result;
    }
    let notInstalled = false;
    const result = await this.look(() => {
      notInstalled = true;
    });
    this.failed = 'output' in result ? null : { result, at: this.clock(), final: notInstalled };
    return result;
  }

  private async look(onNotInstalled: () => void): Promise<BacklightOpenResult> {
    const { required } = this.options;
    const missing = (what: string, final = false): BacklightOpenResult =>
      required ? { problem: what, ...(final ? { final } : {}) } : { absent: what };
    try {
      let buses: number[];
      if (this.options.bus !== null) {
        buses = [this.options.bus];
      } else {
        const detected = await this.ddcutil(['detect', '--brief'], DDC_DETECT_TIMEOUT_MS);
        buses = parseDdcDetect(detected);
        if (buses.length === 0) return missing('no display answers DDC/CI (`ddcutil detect`)');
      }
      const problems: string[] = [];
      for (const bus of buses) {
        const result = await this.openBus(bus);
        if (typeof result !== 'string') return { output: result };
        problems.push(`/dev/i2c-${bus} ${result}`);
      }
      return { problem: problems.join('; ') };
    } catch (err) {
      if (err instanceof CommandNotFoundError) {
        onNotInstalled();
        return missing('ddcutil is not installed, so no display is dimmed over DDC/CI', true);
      }
      const detail = errorMessage(err);
      const access = /permission|EACCES|i2c-dev|\/dev\/i2c/i.test(detail)
        ? `. ${DDC_ACCESS_HINT}`
        : '';
      return { problem: `DDC/CI: ${detail}${access}` };
    }
  }

  /** The display on `bus` with a brightness control that applies changes, or why not. */
  private async openBus(bus: number): Promise<DdcBacklightOutput | string> {
    const read = async (): Promise<{ current: number; max: number } | string> => {
      let text: string;
      try {
        text = await this.ddcutil(['--bus', String(bus), 'getvcp', DDC_BRIGHTNESS_VCP, '--brief']);
      } catch (err) {
        if (err instanceof CommandNotFoundError) throw err;
        return `does not answer DDC/CI brightness (${errorMessage(err)})`;
      }
      return (
        parseVcpBrightness(text) ?? `reports no brightness (${firstLine(text) || 'no output'})`
      );
    };
    const before = await read();
    if (typeof before === 'string') return before;
    // One step away from the current value, read back by ddcutil (`setvcp` verifies by default).
    const probe = before.current < before.max ? before.current + 1 : before.current - 1;
    try {
      await this.ddcutil(['--bus', String(bus), 'setvcp', DDC_BRIGHTNESS_VCP, String(probe)]);
    } catch (err) {
      if (err instanceof CommandNotFoundError) throw err;
      return `does not apply DDC/CI brightness changes (${errorMessage(err)})`;
    }
    const after = await read();
    if (typeof after === 'string') return after;
    if (after.current !== probe) {
      return `does not apply DDC/CI brightness changes (wrote ${probe}, reads ${after.current})`;
    }
    return new DdcBacklightOutput(bus, before.max, (args) => this.ddcutil(args));
  }

  /** Run ddcutil; resolves with its output, rejects with its error message on failure. */
  private async ddcutil(
    args: readonly string[],
    timeoutMs = DDC_COMMAND_TIMEOUT_MS,
  ): Promise<string> {
    const result = await runCommand(this.spawn, this.options.timers, 'ddcutil', args, timeoutMs);
    if (result.code !== 0) {
      const why =
        firstLine(result.stderr) || firstLine(result.stdout) || `exit code ${String(result.code)}`;
      throw new Error(`ddcutil ${args.join(' ')}: ${why}`);
    }
    return result.stdout;
  }
}
