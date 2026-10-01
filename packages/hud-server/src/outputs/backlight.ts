/**
 * Display backlight driven by the composed frames: `frame.theme.brightness` (0–1, perceptual) is
 * written to the panel's backlight through a ~2.2 gamma, since backlight luminance is linear in
 * the PWM duty a backlight level sets. Where it goes is a {@link BacklightDriver}: a Linux sysfs
 * backlight device (this module: `<dir>/brightness`, scaled by `<dir>/max_brightness`), a monitor
 * over DDC/CI (`backlight-ddc.ts`) or a PWM channel wired to the panel's dimming input
 * (`backlight-pwm.ts`).
 *
 *  - Blanked frames drive the backlight to its minimum (sysfs and DDC/CI never write 0, and PWM
 *    keeps its minimum duty, because some panels switch off completely and take seconds to come
 *    back) — unless something breaks through the blank (a critical alert, a collision cue): that
 *    is lit as brightly as ever.
 *  - Writes happen only when the level moves by at least the driver's minimum change (sysfs: 1 %
 *    of the brightness range), and at most once per its minimum interval (sysfs: 10 times per
 *    second); the latest value always lands eventually.
 *  - A missing or unusable device is logged once and looked for again every
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

/** A backlight the sink writes to, as a {@link BacklightDriver} opened it. */
export interface BacklightOutput {
  /** What is driven, for the log, e.g. "/sys/class/backlight/rpi_backlight (max 255)". */
  readonly description: string;
  /** Minimum interval between writes, ms. */
  readonly minIntervalMs: number;
  /** Smallest change of brightness (0–1) worth a write; 0 and 1 are always written. */
  readonly minChange: number;
  /** The raw level for a brightness 0–1 (a write is skipped when it would not change). */
  level(brightness: number): number;
  /** Set the raw level. Rejects when the device fails (the sink then gives it up). */
  write(level: number): Promise<void>;
}

/** What a look for the device found. */
export type BacklightOpenResult =
  | { output: BacklightOutput }
  /** Nothing there to drive (logged once, as information). */
  | { absent: string }
  /**
   * Something there that cannot be used (yet): logged as a warning on the first look. `final`:
   * looking again cannot help until the HUD restarts (a tool that is not installed).
   */
  | { problem: string; final?: boolean };

/** Finds and opens one kind of backlight. */
export interface BacklightDriver {
  open(): Promise<BacklightOpenResult>;
}

export interface SysfsBacklightOptions {
  /** Device directory; null = first writable device under `root`. */
  directory: string | null;
  /** Where devices are looked for when auto-detecting (default /sys/class/backlight). */
  root?: string;
  fs?: BacklightFs;
}

/** A sysfs backlight device: the default kind (DSI displays, some HDMI panels). */
export class SysfsBacklightOutput implements BacklightOutput {
  readonly directory: string;
  readonly maxBrightness: number;
  readonly minIntervalMs = BACKLIGHT_MIN_INTERVAL_MS;
  readonly minChange = BACKLIGHT_MIN_CHANGE;
  private readonly fs: BacklightFs;

  constructor(directory: string, maxBrightness: number, fs: BacklightFs) {
    this.directory = directory;
    this.maxBrightness = maxBrightness;
    this.fs = fs;
  }

  get description(): string {
    return `${this.directory} (max ${this.maxBrightness})`;
  }

  level(brightness: number): number {
    return backlightLevel(brightness, this.maxBrightness);
  }

  write(level: number): Promise<void> {
    return this.fs.writeFile(join(this.directory, 'brightness'), String(level));
  }
}

/** Linux sysfs backlight devices (`/sys/class/backlight/*`). */
export class SysfsBacklightDriver implements BacklightDriver {
  private readonly options: SysfsBacklightOptions;
  private readonly fs: BacklightFs;

  constructor(options: SysfsBacklightOptions) {
    this.options = options;
    this.fs = options.fs ?? nodeBacklightFs;
  }

  /** The configured directory, or the first usable device under the root. */
  async open(): Promise<BacklightOpenResult> {
    const { directory } = this.options;
    if (directory !== null) {
      const result = await this.probe(directory);
      return typeof result === 'string'
        ? { problem: `${directory} ${result}` }
        : { output: result };
    }
    const root = this.options.root ?? SYS_CLASS_BACKLIGHT;
    let entries: string[];
    try {
      entries = (await this.fs.readdir(root)).sort();
    } catch {
      entries = [];
    }
    const problems: string[] = [];
    for (const entry of entries) {
      const result = await this.probe(join(root, entry));
      if (typeof result !== 'string') return { output: result };
      problems.push(`${entry} ${result}`);
    }
    if (problems.length === 0) return { absent: 'no backlight device found' };
    return {
      problem: `no usable backlight device (${problems.join('; ')}). ${BACKLIGHT_PERMISSION_HINT}`,
    };
  }

  /** The device at `directory`, or why it cannot be used. */
  private async probe(directory: string): Promise<SysfsBacklightOutput | string> {
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
    return new SysfsBacklightOutput(directory, maxBrightness, this.fs);
  }
}

/**
 * Several kinds tried in order (`--backlight auto`: a sysfs device, else a monitor over DDC/CI):
 * the first that opens wins; otherwise the problems, or what is absent, are reported together.
 */
export class FirstBacklightDriver implements BacklightDriver {
  private readonly drivers: readonly BacklightDriver[];

  constructor(drivers: readonly BacklightDriver[]) {
    this.drivers = drivers;
  }

  async open(): Promise<BacklightOpenResult> {
    const problems: string[] = [];
    const absent: string[] = [];
    let final = true;
    for (const driver of this.drivers) {
      const result = await driver.open();
      if ('output' in result) return result;
      if ('problem' in result) {
        problems.push(result.problem);
        final &&= result.final === true;
      } else {
        absent.push(result.absent);
      }
    }
    if (problems.length === 0) return { absent: absent.join(', and ') };
    return final ? { problem: problems.join('; '), final } : { problem: problems.join('; ') };
  }
}

export type BacklightSinkOptions = SysfsBacklightOptions | { driver: BacklightDriver };

export class BacklightSink implements FrameSink {
  readonly name = 'backlight';
  private readonly deps: RuntimeDeps;
  private readonly driver: BacklightDriver;
  /** For the rate limit: a wall-clock step back must not hold writes back for its length. */
  private readonly clock: Clock;
  private readonly ready: Promise<BacklightOutput | null>;
  private device: BacklightOutput | null = null;
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
    this.driver = 'driver' in options ? options.driver : new SysfsBacklightDriver(options);
    this.clock = monotonicView(deps.now);
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
  whenReady(): Promise<BacklightOutput | null> {
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
  private use(device: BacklightOutput | null): void {
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
    const level = device.level(wanted);
    if (level === this.writtenLevel) return;
    const written = this.written;
    // Small drifts are skipped, but the ends of the range are always reached exactly.
    const atEnd = wanted === 0 || wanted === 1;
    if (written !== null && Math.abs(wanted - written) < device.minChange && !atEnd) return;
    const wait = this.lastWriteAt + device.minIntervalMs - this.clock();
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

  private async write(device: BacklightOutput, level: number, brightness: number): Promise<void> {
    try {
      await device.write(level);
      if (this.device !== device) return;
      this.written = brightness;
      this.writtenLevel = level;
    } catch (err) {
      if (this.device !== device) return;
      const message = `Backlight: writing ${device.description} failed (${errorCode(err) ?? errorMessage(err)}); backlight control stopped, looking for the device again every ${BACKLIGHT_REPROBE_MS / 1000} s`;
      if (this.writeFailedBefore) this.deps.logger.debug(message);
      else this.deps.logger.warn(message);
      this.writeFailedBefore = true;
      this.use(null);
    }
  }

  /**
   * Look for the device. The first look logs what it found or why nothing is usable; later looks
   * log only a success.
   */
  private async open(first: boolean): Promise<BacklightOutput | null> {
    const { logger } = this.deps;
    const result = await this.driver.open();
    if ('output' in result) {
      logger.info(`Backlight: controlling ${result.output.description}`);
      return result.output;
    }
    if ('absent' in result) {
      if (first) {
        logger.info(`Backlight: ${result.absent}; brightness is applied by the renderer only`);
      }
      return null;
    }
    const until =
      result.final === true
        ? 'until that is fixed and the HUD restarted'
        : `until it is usable (checked every ${BACKLIGHT_REPROBE_MS / 1000} s)`;
    const line = `Backlight: ${result.problem}; brightness is applied by the renderer ${until}`;
    if (first) logger.warn(line);
    else logger.debug(line);
    return null;
  }
}
