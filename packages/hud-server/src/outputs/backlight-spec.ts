/**
 * The `--backlight` / `CARHEADSUP_BACKLIGHT` setting: which backlight the HUD dims.
 *
 *  - `auto` (default): the first usable Linux backlight device, else a display that takes its
 *    brightness over DDC/CI (when `ddcutil` is installed);
 *  - `sysfs` or `sysfs:<dir>` (or just `<dir>`, any path): a Linux backlight device;
 *  - `ddc` or `ddc:<bus>`: a monitor or driver board over DDC/CI (`/dev/i2c-<bus>`);
 *  - `pwm:<chip>/<channel>[,hz=<Hz>][,min=<%>][,inverted]`: a PWM channel wired to the panel's
 *    dimming input (`/sys/class/pwm/pwmchip<chip>/pwm<channel>`);
 *  - `off`: never touch the backlight (the page is dimmed instead).
 */
import { PWM_DEFAULT_HZ, PWM_DEFAULT_MIN_DUTY } from './backlight-pwm.ts';

export type BacklightSpec =
  | { kind: 'auto' }
  | { kind: 'off' }
  | { kind: 'sysfs'; directory: string | null }
  | { kind: 'ddc'; bus: number | null }
  | {
      kind: 'pwm';
      chip: number;
      channel: number;
      frequencyHz: number;
      /** 0–1. */
      minDuty: number;
      inverted: boolean;
    };

export const BACKLIGHT_SPEC_FORMS =
  'auto, off, sysfs[:<dir>], ddc[:<bus>] or pwm:<chip>/<channel>[,hz=<Hz>][,min=<%>][,inverted]';

const OFF_WORDS = new Set(['off', 'none', 'false', '0']);
const MAX_PWM_HZ = 1_000_000;
/** Above half the range a "minimum" is a mistake (or a percentage typed as a fraction ×100). */
const MAX_MIN_DUTY_PERCENT = 50;

function smallInt(text: string, max: number): number | null {
  return /^\d{1,7}$/.test(text) && Number(text) <= max ? Number(text) : null;
}

function parsePwm(rest: string): BacklightSpec | string {
  const [target = '', ...options] = rest.split(',').map((part) => part.trim());
  const m = /^(?:pwmchip)?(\d{1,4})\/(?:pwm)?(\d{1,4})$/i.exec(target);
  if (m?.[1] === undefined || m[2] === undefined) {
    return `expected pwm:<chip>/<channel>, e.g. pwm:0/0, got "pwm:${rest}"`;
  }
  const spec = {
    kind: 'pwm' as const,
    chip: Number(m[1]),
    channel: Number(m[2]),
    frequencyHz: PWM_DEFAULT_HZ,
    minDuty: PWM_DEFAULT_MIN_DUTY,
    inverted: false,
  };
  for (const option of options) {
    const [key = '', value = ''] = option.split('=').map((part) => part.trim().toLowerCase());
    if ((key === 'inverted' || key === 'invert') && value === '') {
      spec.inverted = true;
    } else if (key === 'hz' && smallInt(value, MAX_PWM_HZ) !== null && Number(value) >= 1) {
      spec.frequencyHz = Number(value);
    } else if (
      key === 'min' &&
      /^\d+(\.\d+)?%?$/.test(value) &&
      Number.parseFloat(value) <= MAX_MIN_DUTY_PERCENT
    ) {
      spec.minDuty = Number.parseFloat(value) / 100;
    } else {
      return (
        `unknown or invalid PWM option "${option}" ` +
        `(hz=1–${MAX_PWM_HZ}, min=0–${MAX_MIN_DUTY_PERCENT} %, inverted)`
      );
    }
  }
  return spec;
}

/**
 * Parse the setting: null (not set) is `auto`, false is `off`. Returns an error message for
 * anything else it does not understand.
 */
export function parseBacklightSpec(raw: string | null | false): BacklightSpec | string {
  if (raw === null) return { kind: 'auto' };
  if (raw === false) return { kind: 'off' };
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (OFF_WORDS.has(lower)) return { kind: 'off' };
  if (lower === 'auto' || value === '') return { kind: 'auto' };
  if (lower === 'sysfs') return { kind: 'sysfs', directory: null };
  if (lower.startsWith('sysfs:')) {
    const directory = value.slice('sysfs:'.length).trim();
    return directory === ''
      ? `expected sysfs:<directory>, got "${raw}"`
      : { kind: 'sysfs', directory };
  }
  if (lower === 'ddc') return { kind: 'ddc', bus: null };
  if (lower.startsWith('ddc:')) {
    const bus = /^(?:\/dev\/)?(?:i2c-)?(\d{1,4})$/.exec(lower.slice('ddc:'.length).trim());
    return bus?.[1] === undefined
      ? `expected ddc:<I²C bus number>, e.g. ddc:20, got "${raw}"`
      : { kind: 'ddc', bus: Number(bus[1]) };
  }
  if (lower.startsWith('pwm:')) return parsePwm(value.slice('pwm:'.length));
  // A bare path, as earlier versions took any value that was not a keyword.
  if (value.includes('/')) return { kind: 'sysfs', directory: value };
  return `expected ${BACKLIGHT_SPEC_FORMS}, got "${raw}"`;
}
