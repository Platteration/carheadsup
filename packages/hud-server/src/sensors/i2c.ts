/**
 * I2C access for the light and gesture sensors, through the optional native `i2c-bus` package.
 * The package is loaded lazily with a dynamic import so that a HUD without it (or where its
 * native build failed) still runs; the sensor sources then log once and stay idle.
 */
import type { Clock, Logger, Timers } from '@carheadsup/obd';
import { errorMessage } from './util.ts';

/** The bus operations the sensor drivers need (a small subset of `i2c-bus`'s PromisifiedBus). */
export interface I2cBus {
  /** Plain I2C write of raw bytes, without a register address (e.g. BH1750 opcodes). */
  i2cWrite(address: number, bytes: readonly number[]): Promise<void>;
  /** Plain I2C read of `length` bytes. */
  i2cRead(address: number, length: number): Promise<Uint8Array>;
  /** SMBus "read byte data". */
  readByte(address: number, register: number): Promise<number>;
  /** SMBus "write byte data". */
  writeByte(address: number, register: number, value: number): Promise<void>;
  /** SMBus "read word data": low byte first, as the VEML7700 and TSL2591 store their data. */
  readWord(address: number, register: number): Promise<number>;
  /** SMBus "write word data": low byte first. */
  writeWord(address: number, register: number, value: number): Promise<void>;
  /** I2C block read of up to 32 bytes starting at `register`. */
  readBlock(address: number, register: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** Opens bus `/dev/i2c-<busNumber>`. */
export type I2cOpener = (busNumber: number) => Promise<I2cBus>;

/** The I2C driver package is not installed or could not be loaded; retrying will not help. */
export class I2cUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'I2cUnavailableError';
  }
}

/** Longest SMBus block transfer. */
export const I2C_BLOCK_MAX = 32;

interface ByteCount {
  bytesRead?: number;
  bytesWritten?: number;
}

/** Shape of `i2c-bus`'s PromisifiedBus (untyped package, so narrowed by hand). */
interface PromisifiedBusLike {
  i2cWrite(address: number, length: number, buffer: Buffer): Promise<ByteCount>;
  i2cRead(address: number, length: number, buffer: Buffer): Promise<ByteCount>;
  readByte(address: number, command: number): Promise<number>;
  writeByte(address: number, command: number, byte: number): Promise<void>;
  readWord(address: number, command: number): Promise<number>;
  writeWord(address: number, command: number, word: number): Promise<void>;
  readI2cBlock(
    address: number,
    command: number,
    length: number,
    buffer: Buffer,
  ): Promise<ByteCount>;
  close(): Promise<void>;
}

type OpenPromisified = (busNumber: number) => Promise<PromisifiedBusLike>;

let loading: Promise<OpenPromisified> | null = null;

function loadI2cBusModule(): Promise<OpenPromisified> {
  loading ??= (async () => {
    // A variable specifier keeps TypeScript from demanding type declarations for the package.
    const specifier = 'i2c-bus';
    let mod: unknown;
    try {
      mod = await import(specifier);
    } catch (err) {
      throw new I2cUnavailableError(
        `the optional 'i2c-bus' package is not available (${errorMessage(err)}); install it with "npm install i2c-bus"`,
      );
    }
    const candidates = [mod, (mod as { default?: unknown } | null)?.default];
    for (const candidate of candidates) {
      const open = (candidate as { openPromisified?: unknown } | null | undefined)?.openPromisified;
      if (typeof open === 'function') return open as OpenPromisified;
    }
    throw new I2cUnavailableError(`the 'i2c-bus' package has no openPromisified()`);
  })();
  // A failed load is permanent for this process; later callers get the same error.
  return loading;
}

function checkCount(actual: number | undefined, expected: number, what: string): void {
  if (actual !== undefined && actual !== expected) {
    throw new Error(`short I2C ${what}: ${actual} of ${expected} bytes`);
  }
}

function adapt(bus: PromisifiedBusLike): I2cBus {
  return {
    async i2cWrite(address, bytes) {
      const buffer = Buffer.from(bytes);
      const result = await bus.i2cWrite(address, buffer.length, buffer);
      checkCount(result.bytesWritten, buffer.length, 'write');
    },
    async i2cRead(address, length) {
      const buffer = Buffer.alloc(length);
      const result = await bus.i2cRead(address, length, buffer);
      checkCount(result.bytesRead, length, 'read');
      return new Uint8Array(buffer);
    },
    readByte: (address, register) => bus.readByte(address, register),
    writeByte: (address, register, value) => bus.writeByte(address, register, value),
    readWord: (address, register) => bus.readWord(address, register),
    writeWord: (address, register, value) => bus.writeWord(address, register, value),
    async readBlock(address, register, length) {
      const buffer = Buffer.alloc(length);
      const result = await bus.readI2cBlock(address, register, length, buffer);
      checkCount(result.bytesRead, length, 'block read');
      return new Uint8Array(buffer);
    },
    close: () => bus.close(),
  };
}

/** Default {@link I2cOpener}: `i2c-bus`, loaded on first use. */
export const openI2cBus: I2cOpener = async (busNumber) => {
  const open = await loadI2cBusModule();
  return adapt(await open(busNumber));
};

/** One I2C peripheral driven by an {@link I2cDeviceRunner}. */
export interface I2cDevice {
  /** For log lines, e.g. "BH1750 light sensor". */
  readonly label: string;
  /** Probe and configure the chip; throws when it is absent or misbehaves. */
  init(bus: I2cBus, now: number): Promise<void>;
  /** One poll cycle; returns the delay in ms until the next poll. Throws on bus errors. */
  poll(bus: I2cBus, now: number): Promise<number>;
  /** Best-effort power-down before the bus is closed. */
  shutdown(bus: I2cBus): Promise<void>;
}

export interface I2cDeviceRunnerOptions {
  busNumber: number;
  device: I2cDevice;
  open: I2cOpener;
  now: Clock;
  timers: Timers;
  logger: Logger;
  /** Delay before re-initialising after a failure (default 10 s). */
  retryMs?: number;
}

/**
 * Runs one I2C device: opens the bus, initialises the chip, polls it on its own schedule and
 * re-initialises it after errors (a loose connector in a car is normal). The first failure of a
 * streak is logged as a warning (retries only at debug level) and recovery is logged too. A
 * missing driver package leaves the device idle.
 */
export class I2cDeviceRunner {
  private readonly options: I2cDeviceRunnerOptions;
  private bus: I2cBus | null = null;
  private initialized = false;
  private timer: unknown = null;
  private running = false;
  private busy: Promise<void> = Promise.resolve();
  private failing = false;

  constructor(options: I2cDeviceRunnerOptions) {
    this.options = options;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0, () => this.connect());
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer !== null) this.options.timers.clearTimeout(this.timer);
    this.timer = null;
    await this.busy;
    const bus = this.bus;
    this.bus = null;
    if (bus === null) return;
    if (this.initialized) {
      try {
        await this.options.device.shutdown(bus);
      } catch {
        // best effort: the chip may be gone
      }
    }
    this.initialized = false;
    try {
      await bus.close();
    } catch {
      // ignore
    }
  }

  private schedule(ms: number, task: () => Promise<void>): void {
    if (!this.running) return;
    this.timer = this.options.timers.setTimeout(() => {
      this.timer = null;
      if (!this.running) return;
      this.busy = task().catch((err: unknown) => {
        this.options.logger.error(`${this.options.device.label}: ${errorMessage(err)}`);
      });
    }, ms);
  }

  private async connect(): Promise<void> {
    const { device, busNumber } = this.options;
    if (this.bus === null) {
      try {
        this.bus = await this.options.open(busNumber);
      } catch (err) {
        if (err instanceof I2cUnavailableError) {
          this.options.logger.warn(`${device.label}: disabled — ${err.message}`);
          this.running = false;
          return;
        }
        this.fail(`cannot open I2C bus ${busNumber}: ${errorMessage(err)}`);
        return;
      }
      if (!this.running) {
        await this.closeBus();
        return;
      }
    }
    try {
      await device.init(this.bus, this.options.now());
    } catch (err) {
      this.fail(`not responding on I2C bus ${busNumber}: ${errorMessage(err)}`);
      return;
    }
    this.initialized = true;
    if (this.failing) this.options.logger.info(`${device.label}: working again`);
    else this.options.logger.info(`${device.label}: ready on I2C bus ${busNumber}`);
    this.failing = false;
    this.schedule(0, () => this.poll());
  }

  private async poll(): Promise<void> {
    const bus = this.bus;
    if (bus === null) return;
    let delay: number;
    try {
      delay = await this.options.device.poll(bus, this.options.now());
    } catch (err) {
      this.initialized = false;
      this.fail(`read failed: ${errorMessage(err)}`);
      return;
    }
    this.schedule(Number.isFinite(delay) ? Math.max(0, delay) : 1000, () => this.poll());
  }

  /** Log the first failure of a streak (repeats go to debug) and retry later. */
  private fail(message: string): void {
    const retryMs = this.options.retryMs ?? 10_000;
    const line = `${this.options.device.label}: ${message}`;
    if (this.failing) {
      this.options.logger.debug(line);
    } else {
      this.failing = true;
      this.options.logger.warn(
        `${line}; retrying every ${Math.max(1, Math.round(retryMs / 1000))} s`,
      );
    }
    this.schedule(retryMs, () => this.connect());
  }

  private async closeBus(): Promise<void> {
    const bus = this.bus;
    this.bus = null;
    if (bus === null) return;
    try {
      await bus.close();
    } catch {
      // ignore
    }
  }
}
