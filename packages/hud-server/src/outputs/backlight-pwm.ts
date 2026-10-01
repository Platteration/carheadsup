/**
 * A PWM channel wired to the dimming input of the panel's backlight driver (many LCD driver
 * boards and LED backlight drivers have one, marked PWM, BL_PWM, ADJ or DIM), through the Linux
 * PWM sysfs interface: `/sys/class/pwm/pwmchip<N>/pwm<M>`. On a Raspberry Pi the hardware PWM is
 * switched on with `dtoverlay=pwm` (GPIO 18 by default: `dtoverlay=pwm,pin=18,func=2`).
 *
 * The channel is exported if needed, its period set (25 kHz by default: above hearing, and fast
 * enough not to flicker) and enabled; then the frame brightness sets the duty cycle through the
 * same 2.2 gamma as a sysfs backlight, never below the minimum duty (many drivers switch the LEDs
 * off, or flicker, below a few per cent). Inverted inputs (full brightness at 0 % duty) are
 * handled in software, since not every PWM driver supports the `polarity` attribute. The
 * channel is left running as it is on stop, like any backlight.
 */
import { join } from 'node:path';
import type { Timers } from '@carheadsup/obd';
import { errorCode, errorMessage } from '../sensors/util.ts';
import {
  BACKLIGHT_GAMMA,
  BACKLIGHT_MIN_CHANGE,
  BACKLIGHT_MIN_INTERVAL_MS,
  nodeBacklightFs,
} from './backlight.ts';
import type {
  BacklightDriver,
  BacklightFs,
  BacklightOpenResult,
  BacklightOutput,
} from './backlight.ts';

export const SYS_CLASS_PWM = '/sys/class/pwm';
/** Default PWM frequency: inaudible and flicker-free for LED backlight drivers. */
export const PWM_DEFAULT_HZ = 25_000;
/** Default minimum duty cycle (0–1). */
export const PWM_DEFAULT_MIN_DUTY = 0.01;
/** After exporting a channel, udev needs a moment to make its files writable. */
export const PWM_EXPORT_WAIT_MS = 100;
export const PWM_EXPORT_TRIES = 20;
/** How to let the service drive the PWM (the rule deploy/install.sh installs). */
export const PWM_PERMISSION_HINT =
  'Allow writes with the udev rule deploy/udev/99-carheadsup-backlight.rules (group video may ' +
  'export and set PWM channels), then run ' +
  '`sudo udevadm trigger --subsystem-match=pwm --action=add`';

export interface PwmBacklightOptions {
  /** `pwmchip<chip>` under {@link SYS_CLASS_PWM}. */
  chip: number;
  /** Channel (`pwm<channel>`) of that chip. */
  channel: number;
  frequencyHz: number;
  /** Lowest duty cycle written (0–1), also while blanked. */
  minDuty: number;
  /** The input dims as the duty cycle rises (full brightness at 0 %). */
  inverted: boolean;
  timers: Timers;
  /** Default /sys/class/pwm (tests point it at a temporary directory). */
  root?: string;
  fs?: BacklightFs;
}

/** PWM period for a frequency, whole nanoseconds. */
export function pwmPeriodNs(frequencyHz: number): number {
  return Math.max(1, Math.round(1e9 / frequencyHz));
}

/**
 * Duty cycle (ns) for a frame brightness (0–1): `period × (min + (1 − min) × brightness^γ)`,
 * rounded. Non-finite input counts as full brightness (never risk a dark HUD over a bad value).
 */
export function pwmDutyNs(
  brightness: number,
  periodNs: number,
  minDuty: number,
  gamma = BACKLIGHT_GAMMA,
): number {
  const b = Number.isFinite(brightness) ? Math.min(1, Math.max(0, brightness)) : 1;
  const min = Math.min(1, Math.max(0, minDuty));
  return Math.min(periodNs, Math.max(0, Math.round(periodNs * (min + (1 - min) * b ** gamma))));
}

export class PwmBacklightOutput implements BacklightOutput {
  readonly directory: string;
  readonly periodNs: number;
  readonly minIntervalMs = BACKLIGHT_MIN_INTERVAL_MS;
  readonly minChange = BACKLIGHT_MIN_CHANGE;
  private readonly options: PwmBacklightOptions;
  private readonly fs: BacklightFs;

  constructor(directory: string, periodNs: number, options: PwmBacklightOptions, fs: BacklightFs) {
    this.directory = directory;
    this.periodNs = periodNs;
    this.options = options;
    this.fs = fs;
  }

  get description(): string {
    const { chip, channel, frequencyHz, minDuty, inverted } = this.options;
    const how = [`${frequencyHz} Hz`, `min ${Math.round(minDuty * 1000) / 10} %`];
    if (inverted) how.push('inverted');
    return `PWM channel ${channel} of pwmchip${chip} (${how.join(', ')})`;
  }

  /** The duty cycle in ns as the panel sees it (before any inversion). */
  level(brightness: number): number {
    return pwmDutyNs(brightness, this.periodNs, this.options.minDuty);
  }

  write(level: number): Promise<void> {
    const duty = this.options.inverted ? this.periodNs - level : level;
    return this.fs.writeFile(join(this.directory, 'duty_cycle'), String(duty));
  }
}

/** A PWM channel driving the panel's dimming input. */
export class PwmBacklightDriver implements BacklightDriver {
  private readonly options: PwmBacklightOptions;
  private readonly fs: BacklightFs;

  constructor(options: PwmBacklightOptions) {
    this.options = options;
    this.fs = options.fs ?? nodeBacklightFs;
  }

  async open(): Promise<BacklightOpenResult> {
    const { chip, channel } = this.options;
    const chipDir = join(this.options.root ?? SYS_CLASS_PWM, `pwmchip${chip}`);
    const channelDir = join(chipDir, `pwm${channel}`);
    const why = (err: unknown): string => errorCode(err) ?? errorMessage(err);

    let channels: number;
    try {
      channels = Number.parseInt((await this.fs.readFile(join(chipDir, 'npwm'))).trim(), 10);
    } catch (err) {
      return {
        problem:
          `${chipDir} is not there (${why(err)}); switch the PWM on, e.g. ` +
          '`dtoverlay=pwm,pin=18,func=2` in /boot/firmware/config.txt, and reboot',
      };
    }
    if (!(channel < channels)) {
      return { problem: `pwmchip${chip} has ${channels} channel(s), no channel ${channel}` };
    }

    const dutyPath = join(channelDir, 'duty_cycle');
    if (!(await this.writable(dutyPath))) {
      try {
        await this.fs.writeFile(join(chipDir, 'export'), String(channel));
      } catch (err) {
        // EBUSY: exported already (by someone else, or a moment ago).
        if (errorCode(err) !== 'EBUSY') {
          return {
            problem:
              `cannot export channel ${channel} of pwmchip${chip} (${why(err)}). ` +
              PWM_PERMISSION_HINT,
          };
        }
      }
      let tries = 0;
      while (!(await this.writable(dutyPath))) {
        if (++tries >= PWM_EXPORT_TRIES) {
          return { problem: `${dutyPath} is not writable. ${PWM_PERMISSION_HINT}` };
        }
        await new Promise<void>((resolve) => {
          this.options.timers.setTimeout(resolve, PWM_EXPORT_WAIT_MS);
        });
      }
    }

    const periodNs = pwmPeriodNs(this.options.frequencyHz);
    const output = new PwmBacklightOutput(channelDir, periodNs, this.options, this.fs);
    try {
      // The duty cycle may never exceed the period: start from the minimum when it would.
      const duty = Number.parseInt((await this.fs.readFile(dutyPath)).trim(), 10);
      if (!(duty <= periodNs)) await output.write(output.level(0));
      await this.fs.writeFile(join(channelDir, 'period'), String(periodNs));
      await this.fs.writeFile(join(channelDir, 'enable'), '1');
    } catch (err) {
      return { problem: `setting up ${channelDir} failed (${why(err)})` };
    }
    return { output };
  }

  private async writable(path: string): Promise<boolean> {
    try {
      await this.fs.checkWritable(path);
      return true;
    } catch {
      return false;
    }
  }
}
