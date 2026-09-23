/**
 * Test doubles for the hardware-facing modules: a manual clock, a recording SourceContext and
 * logger, a scriptable I2C bus and a fake child process / spawn.
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { HudEvent } from '@carheadsup/core';
import type { Logger, Timers } from '@carheadsup/obd';
import type { I2cBus } from '../../src/sensors/i2c.ts';
import type { ChildProcessLike, SpawnFn } from '../../src/sensors/process.ts';
import type { SourceContext } from '../../src/sources/types.ts';

/** Resolve after queued microtasks and I/O callbacks have run. */
export const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Manual clock + timers: `advance` runs due timers in order, flushing promises between them. */
export class FakeClock implements Timers {
  current: number;
  private nextId = 1;
  private tasks: Array<{ id: number; at: number; cb: () => void }> = [];

  constructor(start = 1_700_000_000_000) {
    this.current = start;
  }

  readonly now = (): number => this.current;

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.tasks.push({ id, at: this.current + Math.max(0, ms), cb: callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks = this.tasks.filter((t) => t.id !== handle);
  }

  get pendingTimers(): number {
    return this.tasks.length;
  }

  /** Advance time; set `flushEach` false for long synchronous simulations (much faster). */
  async advance(ms: number, flushEach = true): Promise<void> {
    const target = this.current + ms;
    await flush();
    for (;;) {
      let next: { id: number; at: number; cb: () => void } | undefined;
      for (const task of this.tasks) {
        if (task.at > target) continue;
        if (next === undefined || task.at < next.at || (task.at === next.at && task.id < next.id)) {
          next = task;
        }
      }
      if (next === undefined) break;
      const due = next;
      this.tasks = this.tasks.filter((t) => t !== due);
      this.current = Math.max(this.current, due.at);
      due.cb();
      if (flushEach) await flush();
    }
    this.current = target;
    await flush();
  }
}

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export function memoryLogger(): Logger & {
  entries: LogEntry[];
  lines: (level?: LogEntry['level']) => string[];
} {
  const entries: LogEntry[] = [];
  const add =
    (level: LogEntry['level']) =>
    (...args: unknown[]) => {
      entries.push({ level, message: args.map(String).join(' ') });
    };
  return {
    entries,
    lines: (level) =>
      entries.filter((e) => level === undefined || e.level === level).map((e) => e.message),
    debug: add('debug'),
    info: add('info'),
    warn: add('warn'),
    error: add('error'),
  };
}

export function recordingContext(clock: FakeClock) {
  const events: HudEvent[] = [];
  const logger = memoryLogger();
  const ctx: SourceContext = {
    now: clock.now,
    timers: clock,
    logger,
    emit: (event) => events.push(event),
  };
  const ofType = <T extends HudEvent['type']>(type: T) =>
    events.filter((e): e is Extract<HudEvent, { type: T }> => e.type === type);
  return { ctx, events, logger, ofType };
}

// ---------------------------------------------------------------------------------------------
// I2C

export type BusOp =
  | { op: 'i2cWrite'; address: number; bytes: number[] }
  | { op: 'i2cRead'; address: number; length: number }
  | { op: 'readByte'; address: number; register: number }
  | { op: 'writeByte'; address: number; register: number; value: number }
  | { op: 'readWord'; address: number; register: number }
  | { op: 'writeWord'; address: number; register: number; value: number }
  | { op: 'readBlock'; address: number; register: number; length: number }
  | { op: 'close' };

/** Error like the kernel's for a device that does not acknowledge its address. */
export function nack(): Error {
  return Object.assign(new Error('Remote I/O error'), { code: 'EREMOTEIO' });
}

/**
 * An I2C bus whose devices are plain handler objects. Unknown addresses NACK. Every operation
 * is logged in `ops`; `failNext` makes the next operation throw.
 */
export class FakeI2cBus implements I2cBus {
  readonly ops: BusOp[] = [];
  closed = false;
  failNext: Error | null = null;
  /** Throw on every operation (a sensor that fell off the bus). */
  unplugged = false;
  readonly devices = new Map<
    number,
    Partial<{
      i2cWrite: (bytes: number[]) => void;
      i2cRead: (length: number) => number[];
      readByte: (register: number) => number;
      writeByte: (register: number, value: number) => void;
      readWord: (register: number) => number;
      writeWord: (register: number, value: number) => void;
      readBlock: (register: number, length: number) => number[];
    }>
  >();

  private check(address: number, op: BusOp): void {
    this.ops.push(op);
    if (this.closed) throw new Error('bus closed');
    if (this.failNext !== null) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    if (this.unplugged || !this.devices.has(address)) throw nack();
  }

  private device(address: number) {
    return this.devices.get(address) ?? {};
  }

  async i2cWrite(address: number, bytes: readonly number[]): Promise<void> {
    this.check(address, { op: 'i2cWrite', address, bytes: [...bytes] });
    this.device(address).i2cWrite?.([...bytes]);
  }

  async i2cRead(address: number, length: number): Promise<Uint8Array> {
    this.check(address, { op: 'i2cRead', address, length });
    return Uint8Array.from(
      this.device(address).i2cRead?.(length) ?? new Array<number>(length).fill(0),
    );
  }

  async readByte(address: number, register: number): Promise<number> {
    this.check(address, { op: 'readByte', address, register });
    return this.device(address).readByte?.(register) ?? 0;
  }

  async writeByte(address: number, register: number, value: number): Promise<void> {
    this.check(address, { op: 'writeByte', address, register, value });
    this.device(address).writeByte?.(register, value);
  }

  async readWord(address: number, register: number): Promise<number> {
    this.check(address, { op: 'readWord', address, register });
    return this.device(address).readWord?.(register) ?? 0;
  }

  async writeWord(address: number, register: number, value: number): Promise<void> {
    this.check(address, { op: 'writeWord', address, register, value });
    this.device(address).writeWord?.(register, value);
  }

  async readBlock(address: number, register: number, length: number): Promise<Uint8Array> {
    this.check(address, { op: 'readBlock', address, register, length });
    return Uint8Array.from(
      this.device(address).readBlock?.(register, length) ?? new Array<number>(length).fill(0),
    );
  }

  async close(): Promise<void> {
    this.ops.push({ op: 'close' });
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------------------------
// Child processes

/** A child process whose output and exit the test controls. */
export class FakeChild extends EventEmitter implements ChildProcessLike {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly signals: Array<NodeJS.Signals | number | undefined> = [];
  pid: number | undefined = 4242;
  exited = false;
  /** When false, SIGTERM is ignored (a hung process). */
  diesOnTerm = true;
  readonly command: string;
  readonly args: readonly string[];

  constructor(command: string, args: readonly string[]) {
    super();
    this.command = command;
    this.args = args;
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(signal);
    if (this.exited) return false;
    if (signal === 'SIGTERM' && !this.diesOnTerm) return true;
    setImmediate(() => this.exit(null, typeof signal === 'string' ? signal : 'SIGTERM'));
    return true;
  }

  /** Print lines on stdout. */
  print(...lines: string[]): void {
    this.stdout.write(lines.map((l) => `${l}\n`).join(''));
  }

  printErr(...lines: string[]): void {
    this.stderr.write(lines.map((l) => `${l}\n`).join(''));
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.emit('exit', code, signal);
  }

  /** Fail to start, like spawn() of a missing executable. */
  failToStart(code = 'ENOENT'): void {
    this.pid = undefined;
    this.exited = true;
    this.emit('error', Object.assign(new Error(`spawn ${this.command} ${code}`), { code }));
  }
}

/**
 * A spawn function backed by `script(child)`, which decides how each started process behaves
 * (print output, exit, fail with ENOENT …). All children are recorded.
 */
export function fakeSpawn(
  script: (child: FakeChild) => void = () => {},
): SpawnFn & { children: FakeChild[] } {
  const children: FakeChild[] = [];
  const spawn = (command: string, args: readonly string[]): ChildProcessLike => {
    const child = new FakeChild(command, args);
    children.push(child);
    setImmediate(() => script(child));
    return child;
  };
  return Object.assign(spawn, { children });
}

/** Script helper: a short-lived command that prints `stdout` and exits with `code`. */
export function respond(child: FakeChild, stdout: string, code = 0, stderr = ''): void {
  if (stdout.length > 0) child.stdout.write(stdout);
  if (stderr.length > 0) child.stderr.write(stderr);
  child.stdout.end();
  child.stderr.end();
  child.exit(code);
}
