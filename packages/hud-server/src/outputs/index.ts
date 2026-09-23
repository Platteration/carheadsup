import type { FrameSink, RuntimeDeps } from '../sources/types.ts';
import { BacklightSink, type BacklightFs } from './backlight.ts';

export { BacklightSink, backlightLevel, frameBacklightBrightness } from './backlight.ts';

export interface FrameSinkOptions {
  /** sysfs backlight device directory, e.g. /sys/class/backlight/rpi_backlight; null = auto-detect; false = disabled. */
  backlight: string | null | false;
}

/** Filesystem seams (tests point the sink at a temp directory). */
export interface FrameSinkIo {
  /** Directory scanned when auto-detecting (default /sys/class/backlight). */
  backlightRoot?: string;
  fs?: BacklightFs;
}

/** Outputs driven by composed frames, e.g. mapping frame brightness onto the panel backlight. */
export function createFrameSinks(
  options: FrameSinkOptions,
  deps: RuntimeDeps,
  io: FrameSinkIo = {},
): FrameSink[] {
  if (options.backlight === false) return [];
  return [
    new BacklightSink(
      {
        directory: options.backlight,
        ...(io.backlightRoot !== undefined ? { root: io.backlightRoot } : {}),
        ...(io.fs !== undefined ? { fs: io.fs } : {}),
      },
      deps,
    ),
  ];
}
