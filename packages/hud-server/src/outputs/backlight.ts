/**
 * Display backlight driven by the composed frames: `frame.theme.brightness` (0–1, perceptual)
 * is written to a Linux sysfs backlight device (`<dir>/brightness`, scaled by
 * `<dir>/max_brightness`) through a ~2.2 gamma, since backlight PWM duty is linear in luminance.
 *
 *  - Blanked frames drive the backlight to its minimum (0 is never written because some panels
 *    switch off completely and take seconds to come back) — unless something breaks through the
 *    blank (a critical alert, a collision cue): that is lit as brightly as ever.
 *  - Writes happen only when the level moves by at least 1 % of the brightness range, and at
 *    most 10 times per second; the latest value always lands eventually.
 *  - A missing or unwritable device is logged once and looked for again every
 *    {@link BACKLIGHT_REPROBE_MS} (the driver or the udev rule that grants write access may
 *    come up after the HUD at boot); a device whose writes start failing is given up and looked
 *    for again the same way. The backlight is left as it is on stop: restoring a daytime level at
 *    night would dazzle through the windshield.
 *  - While it drives a device the sink reports `drivesBrightness`, so the renderer does not dim
 *    the content on top of the backlight.
 */
import { access, constants as fsConstants, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HudFrame } from '@carheadsup/core';
import type { Clock } from '@carheadsup/obd';
import { monotonicView } from '../clock.ts';
import { errorCode, errorMessage } from '../sensors/util.ts';
import type { FrameSink, RuntimeDeps } from '../sources/types.ts';

export const SYS_CLASS_BACKLIGHT = '/sys/class/backlight';
/** Gamma between perceived brightness and backlight duty. */
export const BACKLIGHT_GAMMA = 2.2;
/** Smallest change of frame brightness (0–1) worth a write. */
export const BACKLIGHT_MIN_CHANGE = 0.01;
/** Minimum interval between writes (10 Hz). */
export const BACKLIGHT_MIN_INTERVAL_MS = 100;
/** While no usable device is found, look again this often. */
export const BACKLIGHT_REPROBE_MS = 10_000;
/** How to let the service write the backlight (the rule deploy/install.sh installs). */
export const BACKLIGHT_PERMISSION_HINT =
  'Allow writes with the udev rule deploy/udev/99-carheadsup-backlight.rules (group video may ' +
  'write brightness; the service user is in it), then run ' +
  '`sudo udevadm trigger --subsystem-match=backlight --action=add`';

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

/**
 * The brightness a frame asks the backlight for: 0 (the minimum level) while blanked with
 * nothing on screen. A critical alert or a collision cue breaks through the blank (see
 * `composeFrame`) and must stay readable, so it gets the frame's brightness.
 */
export function frameBacklightBrightness(frame: HudFrame): number | null {
  const breaksThrough =
    (frame.alerts?.length ?? 0) > 0 ||
    (frame.collision !== undefined && frame.collision !== 'none');
  if (frame.blanked && !breaksThrough) return 0;
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
  private readonly options: BacklightSinkOptions;
  /** For the rate limit: a wall-clock step back must not hold writes back for its length. */
  private readonly clock: Clock;
  private readonly fs: BacklightFs;
  private readonly ready: Promise<Device | null>;
  private device: Device | null = null;
  private stopped = false;
  /** Latest requested brightness (0–1). */
  private wanted: number | null = null;
  /** Brightness behind the last written level (of the current device). */
  private written: number | null = null;
  private writtenLevel: number | null = null;
  private lastWriteAt = -Infinity;
  private timer: unknown = null;
  private writing: Promise<void> | null = null;
  private reprobeTimer: unknown = null;
  private probing: Promise<void> | null = null;
  /** A write has failed before: later failures are logged quietly. */
  private writeFailedBefore = false;
  private readonly driveListeners = new Set<(drives: boolean) => void>();

  constructor(options: BacklightSinkOptions, deps: RuntimeDeps) {
    this.deps = deps;
    this.options = options;
    this.clock = monotonicView(deps.now);
    this.fs = options.fs ?? nodeBacklightFs;
    this.ready = this.open(true).then(
      (device) => {
        this.use(device);
        return device;
      },
      (err: unknown) => {
        deps.logger.warn(`Backlight: disabled (${errorMessage(err)})`);
        return null;
      },
    );
  }

  /** Whether the backlight follows the frames' brightness right now. */
  get drivesBrightness(): boolean {
    return this.device !== null && !this.stopped;
  }

  onDrivesBrightnessChange(listener: (drives: boolean) => void): () => void {
    this.driveListeners.add(listener);
    return () => {
      this.driveListeners.delete(listener);
    };
  }

  /**
   * Resolves with the device found by the first look, or null when there was none (the sink
   * then keeps looking every {@link BACKLIGHT_REPROBE_MS}).
   */
  whenReady(): Promise<{ directory: string; maxBrightness: number } | null> {
    return this.ready;
  }

  /** Resolves once no probe or write is in flight (a rate-limited write may still be scheduled). */
  async whenIdle(): Promise<void> {
    await this.ready;
    while (this.probing !== null || this.writing !== null) {
      await this.probing;
      await this.writing;
    }
  }

  onFrame(frame: HudFrame): void {
    if (this.stopped) return;
    const brightness = frameBacklightBrightness(frame);
    if (brightness === null) return;
    this.wanted = brightness;
    if (this.device !== null) this.flush();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) this.deps.timers.clearTimeout(this.timer);
    this.timer = null;
    if (this.reprobeTimer !== null) this.deps.timers.clearTimeout(this.reprobeTimer);
    this.reprobeTimer = null;
    await this.ready;
    await this.probing;
    await this.writing;
  }

  /** Start using `device` (or, with null, keep looking for one). */
  private use(device: Device | null): void {
    if (this.stopped) return;
    const changed = (device === null) !== (this.device === null);
    this.device = device;
    this.written = null;
    this.writtenLevel = null;
    if (device === null) this.scheduleReprobe();
    else this.flush();
    if (changed) this.notifyDrive();
  }

  private notifyDrive(): void {
    const drives = this.drivesBrightness;
    for (const listener of [...this.driveListeners]) {
      try {
        listener(drives);
      } catch (err) {
        this.deps.logger.warn(`Backlight: change listener failed (${errorMessage(err)})`);
      }
    }
  }

  private scheduleReprobe(): void {
    if (this.stopped || this.reprobeTimer !== null) return;
    this.reprobeTimer = this.deps.timers.setTimeout(() => {
      this.reprobeTimer = null;
      if (this.stopped || this.device !== null) return;
      this.probing = this.open(false)
        .then(
          (device) => this.use(device),
          (err: unknown) => {
            this.deps.logger.debug(
              `Backlight: looking for the device failed (${errorMessage(err)})`,
            );
            this.use(null);
          },
        )
        .finally(() => {
          this.probing = null;
        });
    }, BACKLIGHT_REPROBE_MS);
  }

  /** Write the wanted level now, later (rate limit) or not at all (change below threshold). */
  private flush(): void {
    const device = this.device;
    const wanted = this.wanted;
    if (device === null || wanted === null || this.stopped) return;
    if (this.writing !== null || this.timer !== null) return; // re-checked when those finish
    const level = backlightLevel(wanted, device.maxBrightness);
    if (level === this.writtenLevel) return;
    const written = this.written;
    // Small drifts are skipped, but the ends of the range are always reached exactly.
    const atEnd = wanted === 0 || wanted === 1;
    if (written !== null && Math.abs(wanted - written) < BACKLIGHT_MIN_CHANGE && !atEnd) return;
    const wait = this.lastWriteAt + BACKLIGHT_MIN_INTERVAL_MS - this.clock();
    if (wait > 0) {
      this.timer = this.deps.timers.setTimeout(() => {
        this.timer = null;
        this.flush();
      }, wait);
      return;
    }
    this.lastWriteAt = this.clock();
    this.writing = this.write(device, level, wanted).finally(() => {
      this.writing = null;
      this.flush();
    });
  }

  private async write(device: Device, level: number, brightness: number): Promise<void> {
    try {
      await this.fs.writeFile(join(device.directory, 'brightness'), String(level));
      if (this.device !== device) return;
      this.written = brightness;
      this.writtenLevel = level;
    } catch (err) {
      if (this.device !== device) return;
      const message = `Backlight: writing ${join(device.directory, 'brightness')} failed (${errorCode(err) ?? errorMessage(err)}); backlight control stopped, looking for the device again every ${BACKLIGHT_REPROBE_MS / 1000} s`;
      if (this.writeFailedBefore) this.deps.logger.debug(message);
      else this.deps.logger.warn(message);
      this.writeFailedBefore = true;
      this.use(null);
    }
  }

  /**
   * Find the device: the configured directory, or the first usable one under the root. The
   * first look logs what it found or why nothing is usable; later looks log only a success.
   */
  private async open(first: boolean): Promise<Device | null> {
    const { logger } = this.deps;
    const options = this.options;
    const quiet = (line: string): void => (first ? logger.warn(line) : logger.debug(line));
    if (options.directory !== null) {
      const problem = await this.probe(options.directory);
      if (typeof problem === 'string') {
        quiet(
          `Backlight: ${options.directory} ${problem}; brightness is applied by the renderer until it is usable (checked every ${BACKLIGHT_REPROBE_MS / 1000} s)`,
        );
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
      if (first) {
        logger.info(
          'Backlight: no backlight device found; brightness is applied by the renderer only',
        );
      }
    } else {
      quiet(`Backlight: no usable device (${problems.join('; ')}). ${BACKLIGHT_PERMISSION_HINT}`);
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
