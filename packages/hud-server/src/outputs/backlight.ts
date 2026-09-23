/**
 * Display backlight driven by the composed frames: `frame.theme.brightness` (0–1, perceptual)
 * is written to a Linux sysfs backlight device (`<dir>/brightness`, scaled by
 * `<dir>/max_brightness`) through a ~2.2 gamma, since backlight PWM duty is linear in luminance.
 *
 *  - Blanked frames drive the backlight to its minimum; 0 is never written because some panels
 *    switch off completely (and take seconds to come back).
 *  - Writes happen only when the level moves by at least 1 % of the brightness range, and at
 *    most 10 times per second; the latest value always lands eventually.
 *  - A missing or unwritable device disables the sink with one log line. The backlight is left
 *    as it is on stop: restoring a daytime level at night would dazzle through the windshield.
 */
import { access, constants as fsConstants, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HudFrame } from '@carheadsup/core';
import { errorCode, errorMessage } from '../sensors/util.ts';
import type { FrameSink, RuntimeDeps } from '../sources/types.ts';

export const SYS_CLASS_BACKLIGHT = '/sys/class/backlight';
/** Gamma between perceived brightness and backlight duty. */
export const BACKLIGHT_GAMMA = 2.2;
/** Smallest change of frame brightness (0–1) worth a write. */
export const BACKLIGHT_MIN_CHANGE = 0.01;
/** Minimum interval between writes (10 Hz). */
export const BACKLIGHT_MIN_INTERVAL_MS = 100;

/** Filesystem access used by the sink (injectable for tests). */
export interface BacklightFs {
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  /** Resolves when `path` is writable by this process. */
  checkWritable(path: string): Promise<void>;
}

export const nodeBacklightFs: BacklightFs = {
  readdir: (path) => readdir(path),
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, data) => writeFile(path, data),
  checkWritable: (path) => access(path, fsConstants.W_OK),
};

/**
 * Raw backlight level for a frame brightness (0–1): `max × brightness^γ`, rounded, never below
 * 1. Non-finite input counts as full brightness (never risk a dark HUD over a bad value).
 */
export function backlightLevel(
  brightness: number,
  maxBrightness: number,
  gamma = BACKLIGHT_GAMMA,
): number {
  const max = Math.max(1, Math.floor(maxBrightness));
  const b = Number.isFinite(brightness) ? Math.min(1, Math.max(0, brightness)) : 1;
  return Math.min(max, Math.max(1, Math.round(max * b ** gamma)));
}

/** The brightness a frame asks the backlight for: 0 (the minimum level) while blanked. */
export function frameBacklightBrightness(frame: HudFrame): number | null {
  if (frame.blanked) return 0;
  const b = frame.theme?.brightness;
  return typeof b === 'number' && Number.isFinite(b) ? Math.min(1, Math.max(0, b)) : null;
}

export interface BacklightSinkOptions {
  /** Device directory; null = first writable device under `root`. */
  directory: string | null;
  /** Where devices are looked for when auto-detecting (default /sys/class/backlight). */
  root?: string;
  fs?: BacklightFs;
}

interface Device {
  directory: string;
  maxBrightness: number;
}

export class BacklightSink implements FrameSink {
  readonly name = 'backlight';
  private readonly deps: RuntimeDeps;
  private readonly fs: BacklightFs;
  private readonly ready: Promise<Device | null>;
  private device: Device | null = null;
  private disabled = false;
  private stopped = false;
  /** Latest requested brightness (0–1). */
  private wanted: number | null = null;
  /** Brightness behind the last written level. */
  private written: number | null = null;
  private writtenLevel: number | null = null;
  private lastWriteAt = -Infinity;
  private timer: unknown = null;
  private writing: Promise<void> | null = null;

  constructor(options: BacklightSinkOptions, deps: RuntimeDeps) {
    this.deps = deps;
    this.fs = options.fs ?? nodeBacklightFs;
    this.ready = this.open(options).then(
      (device) => {
        this.device = device;
        if (device === null) this.disabled = true;
        else this.flush();
        return device;
      },
      (err: unknown) => {
        this.disabled = true;
        deps.logger.warn(`Backlight: disabled (${errorMessage(err)})`);
        return null;
      },
    );
  }

  /** Resolves with the device in use, or null once the sink has disabled itself. */
  whenReady(): Promise<{ directory: string; maxBrightness: number } | null> {
    return this.ready;
  }

  /** Resolves once no write is in flight (a rate-limited write may still be scheduled). */
  async whenIdle(): Promise<void> {
    await this.ready;
    while (this.writing !== null) await this.writing;
  }

  onFrame(frame: HudFrame): void {
    if (this.disabled || this.stopped) return;
    const brightness = frameBacklightBrightness(frame);
    if (brightness === null) return;
    this.wanted = brightness;
    if (this.device !== null) this.flush();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) this.deps.timers.clearTimeout(this.timer);
    this.timer = null;
    await this.ready;
    await this.writing;
  }

  /** Write the wanted level now, later (rate limit) or not at all (change below threshold). */
  private flush(): void {
    const device = this.device;
    const wanted = this.wanted;
    if (device === null || wanted === null || this.stopped || this.disabled) return;
    if (this.writing !== null || this.timer !== null) return; // re-checked when those finish
    const level = backlightLevel(wanted, device.maxBrightness);
    if (level === this.writtenLevel) return;
    const written = this.written;
    // Small drifts are skipped, but the ends of the range are always reached exactly.
    const atEnd = wanted === 0 || wanted === 1;
    if (written !== null && Math.abs(wanted - written) < BACKLIGHT_MIN_CHANGE && !atEnd) return;
    const wait = this.lastWriteAt + BACKLIGHT_MIN_INTERVAL_MS - this.deps.now();
    if (wait > 0) {
      this.timer = this.deps.timers.setTimeout(() => {
        this.timer = null;
        this.flush();
      }, wait);
      return;
    }
    this.lastWriteAt = this.deps.now();
    this.writing = this.write(device, level, wanted).finally(() => {
      this.writing = null;
      this.flush();
    });
  }

  private async write(device: Device, level: number, brightness: number): Promise<void> {
    try {
      await this.fs.writeFile(join(device.directory, 'brightness'), String(level));
      this.written = brightness;
      this.writtenLevel = level;
    } catch (err) {
      this.disabled = true;
      this.deps.logger.warn(
        `Backlight: writing ${join(device.directory, 'brightness')} failed (${errorCode(err) ?? errorMessage(err)}); backlight control disabled`,
      );
    }
  }

  private async open(options: BacklightSinkOptions): Promise<Device | null> {
    const { logger } = this.deps;
    if (options.directory !== null) {
      const problem = await this.probe(options.directory);
      if (typeof problem === 'string') {
        logger.warn(`Backlight: ${options.directory} ${problem}; backlight control disabled`);
        return null;
      }
      logger.info(`Backlight: controlling ${options.directory} (max ${problem.maxBrightness})`);
      return problem;
    }
    const root = options.root ?? SYS_CLASS_BACKLIGHT;
    let entries: string[];
    try {
      entries = (await this.fs.readdir(root)).sort();
    } catch {
      entries = [];
    }
    const problems: string[] = [];
    for (const entry of entries) {
      const directory = join(root, entry);
      const result = await this.probe(directory);
      if (typeof result !== 'string') {
        logger.info(`Backlight: controlling ${directory} (max ${result.maxBrightness})`);
        return result;
      }
      problems.push(`${entry} ${result}`);
    }
    if (problems.length === 0) {
      logger.info(
        'Backlight: no backlight device found; brightness is applied by the renderer only',
      );
    } else {
      logger.warn(
        `Backlight: no usable device (${problems.join('; ')}). Allow writes with a udev rule, e.g. ` +
          `SUBSYSTEM=="backlight", RUN+="/bin/chmod 0666 /sys/class/backlight/%k/brightness"`,
      );
    }
    return null;
  }

  /** The device at `directory`, or why it cannot be used. */
  private async probe(directory: string): Promise<Device | string> {
    let maxText: string;
    try {
      maxText = await this.fs.readFile(join(directory, 'max_brightness'));
    } catch (err) {
      return `has no readable max_brightness (${errorCode(err) ?? errorMessage(err)})`;
    }
    const maxBrightness = Number.parseInt(maxText.trim(), 10);
    if (!Number.isFinite(maxBrightness) || maxBrightness < 1) {
      return `reports an invalid max_brightness "${maxText.trim().slice(0, 20)}"`;
    }
    try {
      await this.fs.checkWritable(join(directory, 'brightness'));
    } catch (err) {
      return `brightness is not writable (${errorCode(err) ?? errorMessage(err)})`;
    }
    return { directory, maxBrightness };
  }
}
