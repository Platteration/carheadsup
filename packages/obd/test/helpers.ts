import { decodeMode01 } from '@carheadsup/core';
import type { SignalId } from '@carheadsup/core';
import type { DtcReport, RawAnswer } from '../src/elm327.ts';
import { ElmError } from '../src/errors.ts';
import type { Mode01Result } from '../src/payloads.ts';
import type { PollerDriver } from '../src/poller.ts';
import type { Timers } from '../src/runtime.ts';
import { supportedBitmap } from '../src/sim/ecus.ts';
import { TransportEvents, type Transport } from '../src/transport.ts';

/** Resolve after every queued microtask (and their follow-ups) has run. */
export const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Format lines the way an ELM327 does with echo off: CR-terminated, blank line, prompt. */
export const reply = (...lines: string[]): string => `${lines.map((l) => `${l}\r`).join('')}\r>`;

/**
 * A transport whose adapter is a function from command to raw reply text (with prompt), or
 * null for "no answer". Replies are delivered on a microtask.
 */
export class ScriptedTransport implements Transport {
  readonly description = 'scripted adapter';
  readonly commands: string[] = [];
  private readonly events = new TransportEvents();
  handler: (command: string) => string | null;
  opened = false;
  closed = false;

  constructor(handler: (command: string) => string | null) {
    this.handler = handler;
  }

  async open(): Promise<void> {
    this.opened = true;
  }

  async write(data: string): Promise<void> {
    if (this.closed) throw new Error('closed');
    for (const command of data.split('\r').filter((c) => c.length > 0)) {
      this.commands.push(command);
      const text = this.handler(command);
      if (text !== null) queueMicrotask(() => this.events.emitData(text));
    }
  }

  /** Push unsolicited text from the "adapter". */
  push(text: string): void {
    this.events.emitData(text);
  }

  /** Simulate the link dropping. */
  drop(err = new Error('link lost')): void {
    if (this.closed) return;
    this.closed = true;
    this.events.emitClose(err);
  }

  onData(cb: (chunk: string) => void): () => void {
    return this.events.onData(cb);
  }

  onClose(cb: (err?: Error) => void): () => void {
    return this.events.onClose(cb);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.events.emitClose();
  }
}

/**
 * A typical ELM327 v1.5 clone on a CAN 11/500 car: rejects AT@1 and STI with "?" and drops
 * spaces after ATS0. `obd` supplies OBD answers (lines as printed with headers on, without
 * prompt) keyed by command; `extra` overrides any command's answer.
 */
export function cloneAdapter(obd: Record<string, string[]>, extra: Record<string, string[]> = {}) {
  let spaces = true;
  const at: Record<string, () => string[]> = {
    ATZ: () => ['', 'ELM327 v1.5'],
    ATE0: () => ['OK'],
    ATL0: () => ['OK'],
    ATS0: () => {
      spaces = false;
      return ['OK'];
    },
    ATH1: () => ['OK'],
    ATAT1: () => ['OK'],
    ATI: () => ['ELM327 v1.5'],
    'AT@1': () => ['?'],
    STI: () => ['?'],
    ATDPN: () => ['A6'],
    ATDP: () => ['AUTO, ISO 15765-4 (CAN 11/500)'],
    ATRV: () => ['12.4V'],
  };
  // AT S0 removes the spaces between hex bytes, not from text messages like "NO DATA".
  const shape = (line: string): string =>
    !spaces && /^[0-9A-F ]+$/.test(line) ? line.replace(/ /g, '') : line;
  const transport = new ScriptedTransport((command) => {
    const extraAnswer = extra[command];
    if (extraAnswer) return reply(...extraAnswer.map(shape));
    const handler = at[command];
    if (handler) return reply(...handler());
    if (/^AT(SP|SH|CRA|AR|CP|ST)/.test(command)) return reply('OK');
    const answer = obd[command];
    if (answer) return reply(...answer.map(shape));
    if (/^[0-9A-F]+$/.test(command)) return reply('NO DATA');
    return reply('?');
  });
  return transport;
}

/** Manual clock + timers: `advance` runs due timers in order, flushing promises between them. */
export class FakeClock implements Timers {
  current = 0;
  private nextId = 1;
  private tasks: Array<{ id: number; at: number; cb: () => void }> = [];

  constructor(start = 0) {
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

  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    await flush();
    for (;;) {
      const next = this.tasks
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.tasks = this.tasks.filter((t) => t !== next);
      this.current = Math.max(this.current, next.at);
      next.cb();
      await flush();
    }
    this.current = target;
    await flush();
  }
}

export interface FakeDriverCall {
  at: number;
  kind: 'mode01' | 'dtcs' | 'vin' | 'voltage' | 'raw';
  pids?: number[];
}

/**
 * A scriptable {@link PollerDriver}: PIDs answer with fixed data bytes, per ECU; individual
 * PIDs can be made silent; the whole vehicle can go silent; errors can be queued.
 */
export class FakeDriver implements PollerDriver {
  readonly calls: FakeDriverCall[] = [];
  /** Data bytes per PID, per ECU id. */
  ecus = new Map<string, Map<number, number[]>>();
  /** PIDs that answer NO DATA although "supported". */
  readonly noData = new Set<number>();
  silent = false;
  /** Errors thrown by the next calls, in order. */
  readonly errors: Error[] = [];
  multiPid = true;
  dtcs: DtcReport = { milOn: false, stored: [], pending: [], permanent: [] };
  vin: string | null = 'WP0ZZZ99ZTS392124';
  voltage: number | null = 12.6;
  raws = new Map<string, number[] | 'negative'>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  addEcu(ecu: string, pids: Record<number, number[]>): this {
    this.ecus.set(ecu, new Map(Object.entries(pids).map(([pid, data]) => [Number(pid), data])));
    return this;
  }

  private takeError(): void {
    const err = this.errors.shift();
    if (err) throw err;
  }

  async queryMode01(pids: readonly number[]): Promise<Mode01Result> {
    this.calls.push({ at: this.now(), kind: 'mode01', pids: [...pids] });
    this.takeError();
    const answers: Mode01Result['answers'] = new Map();
    const values: Partial<Record<SignalId, number>> = {};
    if (this.silent) return { answers, values };
    const asked = this.multiPid ? pids : pids.slice(0, 1);
    for (const [ecu, table] of [...this.ecus].sort(([a], [b]) => (a < b ? -1 : 1))) {
      for (const pid of asked) {
        let data: number[] | undefined;
        if (pid % 0x20 === 0) {
          const chain = [...table.keys()];
          if (pid === 0 || chain.some((p) => p > pid)) data = supportedBitmap(pid, chain);
        } else if (!this.noData.has(pid)) {
          data = table.get(pid);
        }
        if (!data) continue;
        const bytes = Uint8Array.from(data);
        const list = answers.get(pid) ?? [];
        list.push({ ecu, data: bytes });
        answers.set(pid, list);
        for (const [signal, value] of Object.entries(decodeMode01(pid, bytes) ?? {})) {
          const id = signal as SignalId;
          if (values[id] === undefined) values[id] = value;
        }
      }
    }
    return { answers, values };
  }

  async readDtcs(): Promise<DtcReport> {
    this.calls.push({ at: this.now(), kind: 'dtcs' });
    this.takeError();
    return this.dtcs;
  }

  async readVin(): Promise<string | null> {
    this.calls.push({ at: this.now(), kind: 'vin' });
    this.takeError();
    return this.vin;
  }

  async readVoltage(): Promise<number | null> {
    this.calls.push({ at: this.now(), kind: 'voltage' });
    this.takeError();
    return this.voltage;
  }

  async raw(mode: string, pid: string, header?: string | null): Promise<RawAnswer[]> {
    this.calls.push({ at: this.now(), kind: 'raw' });
    this.takeError();
    const data = this.raws.get(`${header ?? ''}:${mode}${pid}`);
    if (data === 'negative') {
      throw new ElmError('NEGATIVE_RESPONSE', 'request out of range', { nrc: 0x31 });
    }
    return data ? [{ ecu: header ?? null, data: Uint8Array.from(data) }] : [];
  }

  /** mode 01 calls that included `pid`. */
  pollsOf(pid: number): FakeDriverCall[] {
    return this.calls.filter((c) => c.kind === 'mode01' && c.pids?.includes(pid));
  }
}
