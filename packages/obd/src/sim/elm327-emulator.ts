/**
 * An ELM327 v1.5 emulator that implements {@link Transport}, so the real driver can talk to a
 * simulated car exactly as it would to an adapter on ISO 15765-4 CAN (11-bit, 500 kbaud):
 *
 *  - AT commands: Z, WS, D, E0/1, L0/1, S0/1, H0/1, SP/TP, AT0/1/2, ST, DP, DPN, RV, I, @1,
 *    SH, CRA, AR, CP, PC and a few harmless settings; unknown commands answer "?". STN (ST…)
 *    commands answer "?", like a plain ELM327.
 *  - Echo, linefeeds, spaces and headers behave as on the chip; responses end with "\r\r>".
 *    A bare CR repeats the last command; a character received while a request is being
 *    processed interrupts it ("STOPPED").
 *  - OBD requests: "SEARCHING..." on the first request in automatic mode, functional (7DF) or
 *    physical addressing (AT SH), the default 7E8–7EF receive filter (AT CRA widens it), and
 *    ISO-TP framing (single frame ≤ 7 bytes, else first + consecutive frames), printed with or
 *    without headers ("014" / "0: …" segments) exactly like the chip.
 *  - Fault injection for tests: lost responses, line noise, STOPPED, adapter reset, link loss.
 */
import type { CustomPidConfig } from '@carheadsup/core';
import { bytesToHex, hexByte, hexToBytes, isHex } from '../hex.ts';
import { getProtocol } from '../protocols.ts';
import { SYSTEM_TIMERS, type Timers } from '../runtime.ts';
import { TransportEvents, type Transport } from '../transport.ts';
import {
  SIM_TPMS_DIDS,
  SIM_TPMS_REQUEST_ID,
  createEngineEcu,
  createTpmsEcu,
  createTransmissionEcu,
  type EmulatedEcu,
} from './ecus.ts';
import type { VehicleSimulator, VehicleSnapshot } from './vehicle-sim.ts';

/**
 * Custom PIDs that read the simulated TPMS module (service 22 on 7C6/7CE). Use them as
 * `obd.customPids` in simulator mode so tyre pressures reach the HUD.
 */
export const SIM_TPMS_PIDS: readonly CustomPidConfig[] = Object.freeze(
  (
    [
      ['tirePressureFL', SIM_TPMS_DIDS.fl],
      ['tirePressureFR', SIM_TPMS_DIDS.fr],
      ['tirePressureRL', SIM_TPMS_DIDS.rl],
      ['tirePressureRR', SIM_TPMS_DIDS.rr],
    ] as const
  ).map(([signal, did]) =>
    Object.freeze({
      signal,
      mode: '22',
      pid: did.toString(16).toUpperCase().padStart(4, '0'),
      header: SIM_TPMS_REQUEST_ID.toString(16).toUpperCase(),
      formula: '((A*256)+B)/10',
      intervalMs: 10_000,
    }),
  ),
);

export type EmulatorFault =
  /** The next response is lost entirely (no prompt): the host must time out and resync. */
  | 'drop'
  /** The next response is line noise followed by a prompt. */
  | 'garbage'
  /** The next response is "STOPPED". */
  | 'stopped'
  /** The next response is "NO DATA". */
  | 'no-data'
  /** The adapter resets instead of answering (prints its banner, settings lost). */
  | 'reset'
  /** The link drops instead of answering. */
  | 'disconnect';

export interface EmulatorFaultOptions {
  /** Probability (0–1) that an OBD response is lost. */
  dropRate?: number;
  /** Probability (0–1) that an OBD response is replaced by line noise. */
  garbageRate?: number;
  /** Drop the link after this many commands. */
  disconnectAfterCommands?: number;
  /** Seed for the deterministic fault generator. Default 1. */
  seed?: number;
}

export interface Elm327EmulatorOptions {
  /** Delay before each response. Default 25 ms; 0 answers on the next microtask. */
  latencyMs?: number;
  /** Extra delay of ATZ. Default 20 × latency. */
  resetLatencyMs?: number;
  /** Extra delay of the automatic protocol search. Default 8 × latency. */
  searchLatencyMs?: number;
  /** `ATI` answer. Default "ELM327 v1.5". */
  version?: string;
  /** Emulate the transmission ECU (second responder). Default true. */
  transmissionEcu?: boolean;
  /** Whether the ECUs answer initially (ignition on); see {@link Elm327Emulator.setEcuOnline}. Default true. */
  ecuOnline?: boolean;
  faults?: EmulatorFaultOptions;
  timers?: Timers;
}

interface ElmSettings {
  echo: boolean;
  linefeeds: boolean;
  spaces: boolean;
  headers: boolean;
  /** AT SP setting: "0", "6", "A6" … */
  protocol: string;
  /** Protocol in use once connected to the bus, else null. */
  active: string | null;
  header: string;
  receiveFilter: string | null;
}

const DEFAULT_SETTINGS: Readonly<ElmSettings> = Object.freeze({
  echo: true,
  linefeeds: false,
  spaces: true,
  headers: false,
  protocol: '0',
  active: null,
  header: '7DF',
  receiveFilter: null,
});

const BUS_PROTOCOL = '6';
const DESCRIPTION = 'OBDII to RS232 Interpreter';
const LOG_LIMIT = 500;

/** Deterministic PRNG (mulberry32) for probabilistic faults. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Elm327Emulator implements Transport {
  readonly description = 'ELM327 emulator (simulated vehicle)';
  readonly sim: VehicleSimulator;
  private readonly events = new TransportEvents();
  private readonly timers: Timers;
  private readonly latencyMs: number;
  private readonly resetLatencyMs: number;
  private readonly searchLatencyMs: number;
  private readonly version: string;
  private readonly ecus: EmulatedEcu[];
  private readonly faultOptions: EmulatorFaultOptions;
  private readonly random: () => number;
  private readonly faultQueue: EmulatorFault[] = [];
  private readonly log: string[] = [];

  private open_ = false;
  private settings: ElmSettings = { ...DEFAULT_SETTINGS };
  private input = '';
  private lastCommand = '';
  private busy: { cancel: () => void } | null = null;
  private commandCount = 0;
  private ecuOnline = true;

  constructor(sim: VehicleSimulator, options: Elm327EmulatorOptions = {}) {
    this.sim = sim;
    this.timers = options.timers ?? SYSTEM_TIMERS;
    this.latencyMs = Math.max(0, options.latencyMs ?? 25);
    this.resetLatencyMs = Math.max(0, options.resetLatencyMs ?? this.latencyMs * 20);
    this.searchLatencyMs = Math.max(0, options.searchLatencyMs ?? this.latencyMs * 8);
    this.version = options.version ?? 'ELM327 v1.5';
    this.faultOptions = options.faults ?? {};
    this.ecuOnline = options.ecuOnline ?? true;
    this.random = prng(this.faultOptions.seed ?? 1);
    this.ecus = [createEngineEcu(sim)];
    if (options.transmissionEcu ?? true) this.ecus.push(createTransmissionEcu());
    this.ecus.push(createTpmsEcu());
  }

  // -------------------------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------------------------

  get isOpen(): boolean {
    return this.open_;
  }

  async open(): Promise<void> {
    if (this.open_) throw new Error('Emulator already open');
    this.open_ = true;
    this.settings = { ...DEFAULT_SETTINGS };
    this.input = '';
    this.lastCommand = '';
    this.commandCount = 0;
  }

  async write(data: string): Promise<void> {
    if (!this.open_) throw new Error('Emulator is not open');
    for (const ch of data) {
      if (!this.open_) return;
      if (ch === '\n' || ch === '\0') continue;
      if (this.busy) {
        // Any character interrupts a request in progress; the character itself is discarded.
        this.busy.cancel();
        this.busy = null;
        this.emit(`STOPPED${this.eol}${this.eol}>`);
      } else if (ch === '\r') {
        const line = this.input;
        this.input = '';
        this.onLine(line);
      } else {
        this.input += ch;
      }
    }
  }

  onData(cb: (chunk: string) => void): () => void {
    return this.events.onData(cb);
  }

  onClose(cb: (err?: Error) => void): () => void {
    return this.events.onClose(cb);
  }

  async close(): Promise<void> {
    this.shutdown();
  }

  // -------------------------------------------------------------------------------------------
  // Test hooks
  // -------------------------------------------------------------------------------------------

  /** Make the next command misbehave (queued; one fault per command). */
  injectFault(fault: EmulatorFault, count = 1): void {
    for (let i = 0; i < count; i++) this.faultQueue.push(fault);
  }

  /** Simulate the ignition: when offline no ECU answers (NO DATA / UNABLE TO CONNECT). */
  setEcuOnline(online: boolean): void {
    this.ecuOnline = online;
  }

  /** Spontaneous adapter reset (supply dip): prints the banner unprompted, settings lost. */
  powerCycle(): void {
    if (!this.open_) return;
    this.busy?.cancel();
    this.busy = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.emit(`${this.eol}${this.eol}${this.version}${this.eol}${this.eol}>`);
  }

  /** The most recent commands received (normalised, newest last). */
  get commandLog(): readonly string[] {
    return this.log;
  }

  // -------------------------------------------------------------------------------------------
  // Command processing
  // -------------------------------------------------------------------------------------------

  private get eol(): string {
    return this.settings.linefeeds ? '\r\n' : '\r';
  }

  private onLine(raw: string): void {
    if (this.settings.echo) this.emit(`${raw}${this.eol}`);
    let command = raw.replace(/[\s\0]+/g, '').toUpperCase();
    if (command === '') command = this.lastCommand; // bare CR repeats the last command
    if (command === '') {
      this.emit('>');
      return;
    }
    this.lastCommand = command;
    this.commandCount += 1;
    this.log.push(command);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);

    const limit = this.faultOptions.disconnectAfterCommands;
    const fault =
      this.faultQueue.shift() ??
      (limit !== undefined && this.commandCount >= limit
        ? 'disconnect'
        : this.randomFault(command));
    if (fault) {
      this.applyFault(fault);
      return;
    }

    if (command.startsWith('AT')) {
      this.handleAt(command.slice(2));
    } else if (isHex(command)) {
      this.handleObd(command);
    } else {
      this.respond(['?']);
    }
  }

  private randomFault(command: string): EmulatorFault | null {
    if (command.startsWith('AT') || command.startsWith('ST')) return null;
    const drop = this.faultOptions.dropRate ?? 0;
    const garbage = this.faultOptions.garbageRate ?? 0;
    if (drop <= 0 && garbage <= 0) return null;
    const r = this.random();
    if (r < drop) return 'drop';
    if (r < drop + garbage) return 'garbage';
    return null;
  }

  private applyFault(fault: EmulatorFault): void {
    switch (fault) {
      case 'drop':
        return;
      case 'garbage': {
        const noise = Array.from({ length: 12 }, () =>
          '#%&@!~?*'.charAt(Math.floor(this.random() * 8)),
        );
        this.respond([noise.join(''), `7E8${this.sp}Z${this.sp}Q`]);
        return;
      }
      case 'stopped':
        this.respond(['STOPPED']);
        return;
      case 'no-data':
        this.respond(['NO DATA']);
        return;
      case 'reset':
        this.settings = { ...DEFAULT_SETTINGS };
        this.respond(['LV RESET', '', this.version]);
        return;
      case 'disconnect':
        this.shutdown(new Error('Emulated link loss'));
        return;
    }
  }

  private handleAt(body: string): void {
    const s = this.settings;
    const ok = (): void => this.respond(['OK']);

    if (body === 'Z' || body === 'WS') {
      this.settings = { ...DEFAULT_SETTINGS };
      const delay = body === 'Z' ? this.resetLatencyMs : 0;
      this.respondRaw(`${this.eol}${this.eol}${this.version}${this.eol}${this.eol}>`, delay);
      return;
    }
    if (body === 'D') {
      this.settings = { ...DEFAULT_SETTINGS, echo: s.echo, linefeeds: s.linefeeds };
      ok();
      return;
    }
    if (body === 'I') return this.respond([this.version]);
    if (body === '@1') return this.respond([DESCRIPTION]);

    const toggle = /^([ELSH])([01])$/.exec(body);
    if (toggle) {
      const on = toggle[2] === '1';
      if (toggle[1] === 'E') s.echo = on;
      else if (toggle[1] === 'L') s.linefeeds = on;
      else if (toggle[1] === 'S') s.spaces = on;
      else s.headers = on;
      ok();
      return;
    }
    // Accepted settings the emulation does not need to model.
    if (/^(M[01]|CAF[01]|V[01]|D[01]|AL|NL|AT[012]|ST[0-9A-F]{2}|LP|CP[0-9A-F]{2})$/.test(body)) {
      ok();
      return;
    }
    const protocol = /^(?:SP|TP)(A?[0-9A-C])$/.exec(body);
    if (protocol?.[1]) {
      s.protocol = protocol[1];
      s.active = null;
      ok();
      return;
    }
    if (body === 'PC') {
      s.active = null;
      ok();
      return;
    }
    if (body === 'DP') return this.respond([this.describeProtocol()]);
    if (body === 'DPN') {
      const auto = s.protocol === '0' || s.protocol.startsWith('A');
      const number = s.active ?? (auto ? '0' : s.protocol);
      return this.respond([auto ? `A${number}` : number]);
    }
    if (body === 'RV') {
      const volts = Math.max(0, this.sim.snapshot().batteryVoltage);
      return this.respond([`${volts.toFixed(1)}V`]);
    }
    // v1.5 accepts 3- and 6-digit headers (the 8-digit form arrived with v2.1).
    const header = /^SH([0-9A-F]{3}|[0-9A-F]{6})$/.exec(body);
    if (header?.[1]) {
      s.header = header[1];
      ok();
      return;
    }
    if (body === 'CRA' || body === 'AR') {
      s.receiveFilter = null;
      ok();
      return;
    }
    const filter = /^CRA([0-9A-FX]{3})$/.exec(body);
    if (filter?.[1]) {
      s.receiveFilter = filter[1];
      ok();
      return;
    }
    this.respond(['?']);
  }

  private describeProtocol(): string {
    const s = this.settings;
    const auto = s.protocol === '0' || s.protocol.startsWith('A');
    const id = s.active ?? (auto ? null : s.protocol);
    const name = id ? (getProtocol(id)?.name ?? 'Unknown') : null;
    if (auto) return name ? `AUTO, ${name}` : 'AUTO';
    return name ?? 'Unknown';
  }

  private handleObd(command: string): void {
    let hex = command;
    // An odd trailing digit is the "expected responses" count; it only shortens waiting.
    if (hex.length % 2 === 1) hex = hex.slice(0, -1);
    if (hex.length < 2 || hex.length > 16) return this.respond(['?']);
    const request = hexToBytes(hex);

    const s = this.settings;
    const prefix: string[] = [];
    let extraDelay = 0;
    if (s.active === null) {
      const auto = s.protocol === '0' || s.protocol.startsWith('A');
      if (auto) {
        prefix.push('SEARCHING...');
        extraDelay = this.searchLatencyMs;
        if (!this.ecuOnline) return this.respond([...prefix, 'UNABLE TO CONNECT'], extraDelay * 4);
        s.active = BUS_PROTOCOL;
      } else if (s.protocol === BUS_PROTOCOL) {
        s.active = BUS_PROTOCOL;
      } else {
        return this.respond([wrongProtocolAnswer(s.protocol)]);
      }
    }
    if (!this.ecuOnline) return this.respond([...prefix, 'NO DATA'], extraDelay);

    const snapshot = this.sim.snapshot();
    const lines = this.route(request, snapshot);
    this.respond([...prefix, ...(lines.length > 0 ? lines : ['NO DATA'])], extraDelay);
  }

  private route(request: Uint8Array, snapshot: VehicleSnapshot): string[] {
    const headerId = parseInt(this.settings.header.slice(-3), 16) & 0x7ff;
    const functional = headerId === 0x7df;
    const lines: string[] = [];
    for (const ecu of this.ecus) {
      if (!ecu.isPresent(snapshot)) continue;
      if (functional ? !ecu.functional : ecu.requestId !== headerId) continue;
      if (!this.accepts(ecu.responseId)) continue;
      const payload = ecu.handle(request, functional, snapshot);
      if (payload && payload.length > 0) lines.push(...this.formatMessage(ecu.responseId, payload));
    }
    return lines;
  }

  /** The adapter's receive filter: 7E8–7EF by default, or the AT CRA pattern. */
  private accepts(responseId: number): boolean {
    const filter = this.settings.receiveFilter;
    if (filter === null) return responseId >= 0x7e8 && responseId <= 0x7ef;
    const id = responseId.toString(16).toUpperCase().padStart(3, '0');
    return [...filter].every((ch, i) => ch === 'X' || ch === id.charAt(i));
  }

  private get sp(): string {
    return this.settings.spaces ? ' ' : '';
  }

  /** Print one ISO-TP message the way the ELM327 does (CAN auto-formatting on). */
  private formatMessage(responseId: number, payload: Uint8Array): string[] {
    const sp = this.sp;
    const bytes = (data: ArrayLike<number>): string => bytesToHex(data, sp);
    const id = responseId.toString(16).toUpperCase().padStart(3, '0');
    if (payload.length <= 7) {
      return [
        this.settings.headers
          ? `${id}${sp}${hexByte(payload.length)}${sp}${bytes(payload)}`
          : bytes(payload),
      ];
    }
    // First frame: PCI (1 + length) and 6 data bytes; consecutive frames: PCI and 7 bytes, the
    // last one padded (the adapter prints the whole CAN frame).
    const segments: number[][] = [[...payload.slice(0, 6)]];
    for (let offset = 6; offset < payload.length; offset += 7) {
      const chunk = [...payload.slice(offset, offset + 7)];
      while (chunk.length < 7) chunk.push(0x00);
      segments.push(chunk);
    }
    if (this.settings.headers) {
      return segments.map((segment, i) => {
        const pci =
          i === 0 ? [0x10 | (payload.length >> 8), payload.length & 0xff] : [0x20 | (i & 0x0f)];
        return `${id}${sp}${bytes([...pci, ...segment])}`;
      });
    }
    return [
      payload.length.toString(16).toUpperCase().padStart(3, '0'),
      ...segments.map(
        (segment, i) => `${(i & 0x0f).toString(16).toUpperCase()}:${sp}${bytes(segment)}`,
      ),
    ];
  }

  // -------------------------------------------------------------------------------------------
  // Output
  // -------------------------------------------------------------------------------------------

  private respond(lines: readonly string[], extraDelayMs = 0): void {
    const eol = this.eol;
    this.respondRaw(`${lines.map((line) => `${line}${eol}`).join('')}${eol}>`, extraDelayMs);
  }

  private respondRaw(text: string, extraDelayMs: number): void {
    const delay = this.latencyMs + extraDelayMs;
    let cancelled = false;
    const deliver = (): void => {
      if (cancelled) return;
      this.busy = null;
      this.emitNow(text);
    };
    if (delay <= 0) {
      this.busy = { cancel: () => (cancelled = true) };
      queueMicrotask(deliver);
      return;
    }
    const handle = this.timers.setTimeout(deliver, delay);
    this.busy = {
      cancel: () => {
        cancelled = true;
        this.timers.clearTimeout(handle);
      },
    };
  }

  /** Emit asynchronously so a write() never re-enters its caller. */
  private emit(text: string): void {
    queueMicrotask(() => this.emitNow(text));
  }

  private emitNow(text: string): void {
    if (this.open_) this.events.emitData(text);
  }

  private shutdown(err?: Error): void {
    if (!this.open_) return;
    this.busy?.cancel();
    this.busy = null;
    this.open_ = false;
    this.input = '';
    this.events.emitClose(err);
  }
}

/** What the chip reports when told to use a protocol the (CAN 11/500) car does not speak. */
function wrongProtocolAnswer(protocol: string): string {
  const id = protocol.startsWith('A') ? protocol.slice(1) : protocol;
  if (id === '3' || id === '4' || id === '5') return 'BUS INIT: ...ERROR';
  if (id === '8' || id === '9' || id === 'B' || id === 'C') return 'CAN ERROR';
  return 'NO DATA';
}
