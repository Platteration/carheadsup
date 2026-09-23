import type { FrameSink, RuntimeDeps } from '../sources/types.ts';

export interface FrameSinkOptions {
  /** sysfs backlight device directory, e.g. /sys/class/backlight/rpi_backlight; null = auto-detect; false = disabled. */
  backlight: string | null | false;
}

/** Outputs driven by composed frames, e.g. mapping frame brightness onto the panel backlight. */
export function createFrameSinks(options: FrameSinkOptions, deps: RuntimeDeps): FrameSink[] {
  throw new Error(
    `createFrameSinks(${String(options.backlight)}, ${typeof deps}) is not implemented yet`,
  );
}
