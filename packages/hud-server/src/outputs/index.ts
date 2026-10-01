import type { FrameSink, RuntimeDeps } from '../sources/types.ts';
import type { SpawnFn } from '../sensors/process.ts';
import {
  BacklightSink,
  FirstBacklightDriver,
  SysfsBacklightDriver,
  type BacklightDriver,
  type BacklightFs,
} from './backlight.ts';
import { DdcBacklightDriver } from './backlight-ddc.ts';
import { PwmBacklightDriver } from './backlight-pwm.ts';
import { parseBacklightSpec } from './backlight-spec.ts';

export { BacklightSink, backlightLevel, frameBacklightBrightness } from './backlight.ts';
export { parseBacklightSpec } from './backlight-spec.ts';
export type { BacklightSpec } from './backlight-spec.ts';

export interface FrameSinkOptions {
  /**
   * Which backlight to dim: a `--backlight` setting (see `backlight-spec.ts`: a sysfs device
   * directory, `sysfs`, `ddc[:<bus>]`, `pwm:<chip>/<channel>…`, `auto`); null = auto; false =
   * disabled.
   */
  backlight: string | null | false;
}

/** Hardware seams (tests point the sinks at temporary directories and fake processes). */
export interface FrameSinkIo {
  /** Directory scanned when auto-detecting a sysfs backlight (default /sys/class/backlight). */
  backlightRoot?: string;
  /** Where PWM chips are (default /sys/class/pwm). */
  pwmRoot?: string;
  fs?: BacklightFs;
  /** Runs ddcutil (default: child_process). */
  spawn?: SpawnFn;
}

/** Outputs driven by composed frames, e.g. mapping frame brightness onto the panel backlight. */
export function createFrameSinks(
  options: FrameSinkOptions,
  deps: RuntimeDeps,
  io: FrameSinkIo = {},
): FrameSink[] {
  const spec = parseBacklightSpec(options.backlight);
  if (typeof spec === 'string') {
    deps.logger.warn(`Backlight: ${spec}; backlight control is off`);
    return [];
  }
  const fs = io.fs !== undefined ? { fs: io.fs } : {};
  const sysfs = (directory: string | null): BacklightDriver =>
    new SysfsBacklightDriver({
      directory,
      ...(io.backlightRoot !== undefined ? { root: io.backlightRoot } : {}),
      ...fs,
    });
  const ddc = (bus: number | null, required: boolean): BacklightDriver =>
    new DdcBacklightDriver({
      bus,
      required,
      now: deps.now,
      timers: deps.timers,
      ...(io.spawn !== undefined ? { spawn: io.spawn } : {}),
    });
  let driver: BacklightDriver;
  switch (spec.kind) {
    case 'off':
      return [];
    case 'auto':
      driver = new FirstBacklightDriver([sysfs(null), ddc(null, false)]);
      break;
    case 'sysfs':
      driver = sysfs(spec.directory);
      break;
    case 'ddc':
      driver = ddc(spec.bus, true);
      break;
    case 'pwm':
      driver = new PwmBacklightDriver({
        chip: spec.chip,
        channel: spec.channel,
        frequencyHz: spec.frequencyHz,
        minDuty: spec.minDuty,
        inverted: spec.inverted,
        timers: deps.timers,
        ...(io.pwmRoot !== undefined ? { root: io.pwmRoot } : {}),
        ...fs,
      });
      break;
  }
  return [new BacklightSink({ driver }, deps)];
}
