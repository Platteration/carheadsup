/**
 * Transcripts of the raw conversation with an ELM327 adapter: record it in the car, replay it on
 * a laptop. A clone that misbehaves (an odd echo, a line split across chunks, `SEARCHING...`,
 * `BUFFER FULL`, frames of several ECUs interleaved) can then be turned into a regression test
 * instead of being guessed at from log lines.
 *
 * Format — JSON Lines, one object per line:
 *
 *   {"format":"carheadsup-obd-transcript","version":1,"startedAt":1790000000000,"transport":"serial /dev/rfcomm0 @ 38400"}
 *   {"t":0.4,"tx":"ATZ\r"}
 *   {"t":812.1,"rx":"\r\rELM327 v1.5\r\r>"}
 *   {"t":3011.9,"close":"Serial port closed"}
 *
 * `t` is milliseconds since the link opened; `tx` is what the HUD wrote, `rx` one chunk exactly as
 * it arrived (chunks are not merged: where the link splits a line matters), and `close` the end
 * of the link (the error, or null when the HUD closed it). Text is latin1, as on the wire (one
 * character per byte; the file itself is UTF-8, so read it as UTF-8).
 */
import type { Clock, Timers } from './runtime.ts';
import { TransportEvents, type Transport } from './transport.ts';

export const TRANSCRIPT_FORMAT = 'carheadsup-obd-transcript';
export const TRANSCRIPT_VERSION = 1;

/** The first line of a transcript. */
export interface TranscriptHeader {
  format: typeof TRANSCRIPT_FORMAT;
  version: typeof TRANSCRIPT_VERSION;
  /** Wall-clock epoch ms when the link opened. */
  startedAt: number;
  /** The link, e.g. "serial /dev/rfcomm0 @ 38400". */
  transport: string;
  /** 2, 3 … for the continuation of a long session split by size (absent in the first part). */
  part?: number;
}

/** One event on the link, `t` ms after it opened. */
export type TranscriptEntry =
  { t: number; tx: string } | { t: number; rx: string } | { t: number; close: string | null };

/** A transcript as read from a file. */
export interface Transcript {
  header: TranscriptHeader;
  entries: TranscriptEntry[];
}

/** Where one session's transcript goes (a file, in the HUD server). */
export interface TranscriptSink {
  write(entry: TranscriptEntry): void;
  /** Flush and finish. Never rejects. */
  close(): Promise<void>;
}

/** Makes the sink for a session that just opened. */
export type TranscriptSinkFactory = (header: TranscriptHeader) => TranscriptSink;

export interface RecordingOptions {
  createSink: TranscriptSinkFactory;
  /** Monotonic ms clock for `t`. Default `performance.now()`. */
  now?: Clock;
  /** Wall clock for `startedAt`. Default `Date.now`. */
  wallNow?: Clock;
}

/** Milliseconds with a tenth's precision (enough for timing, short in the file). */
const tenths = (ms: number): number => Math.round(ms * 10) / 10;

/**
 * A transport that records everything written to and received from `inner`. A sink is made once
 * the link has opened (a link that never opens leaves no file behind) and finished when it
 * closes. Recording never gets in the way of the link: a sink that fails just records nothing.
 */
export class RecordingTransport implements Transport {
  readonly description: string;
  private readonly inner: Transport;
  private readonly options: RecordingOptions;
  private readonly now: Clock;
  private readonly events = new TransportEvents();
  private sink: TranscriptSink | null = null;
  private openedAt = 0;
  private finishing: Promise<void> = Promise.resolve();

  constructor(inner: Transport, options: RecordingOptions) {
    this.inner = inner;
    this.options = options;
    this.description = inner.description;
    this.now = options.now ?? (() => performance.now());
    inner.onData((chunk) => {
      this.record({ t: this.elapsed(), rx: chunk });
      this.events.emitData(chunk);
    });
    inner.onClose((err) => {
      this.record({ t: this.elapsed(), close: err?.message ?? null });
      this.finish();
      this.events.emitClose(err);
    });
  }

  async open(): Promise<void> {
    await this.inner.open();
    this.openedAt = this.now();
    try {
      this.sink = this.options.createSink({
        format: TRANSCRIPT_FORMAT,
        version: TRANSCRIPT_VERSION,
        startedAt: (this.options.wallNow ?? Date.now)(),
        transport: this.inner.description,
      });
    } catch {
      this.sink = null;
    }
  }

  write(data: string): Promise<void> {
    this.record({ t: this.elapsed(), tx: data });
    return this.inner.write(data);
  }

  onData(cb: (chunk: string) => void): () => void {
    return this.events.onData(cb);
  }

  onClose(cb: (err?: Error) => void): () => void {
    return this.events.onClose(cb);
  }

  async close(): Promise<void> {
    await this.inner.close();
    this.finish();
    await this.finishing;
  }

  private elapsed(): number {
    return tenths(Math.max(0, this.now() - this.openedAt));
  }

  private record(entry: TranscriptEntry): void {
    try {
      this.sink?.write(entry);
    } catch {
      // A broken recording must never break the link.
    }
  }

  private finish(): void {
    const sink = this.sink;
    this.sink = null;
    if (sink !== null) this.finishing = sink.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// Reading and replaying
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse a transcript file. A torn last line (the power went while it was written) is ignored;
 * any other malformed line throws, naming its number.
 */
export function parseTranscript(text: string): Transcript {
  const lines = text.split('\n');
  const first = lines[0]?.trim() ?? '';
  let header: unknown;
  try {
    header = JSON.parse(first);
  } catch {
    throw new Error('Not a transcript: the first line is not JSON');
  }
  if (!isRecord(header) || header['format'] !== TRANSCRIPT_FORMAT) {
    throw new Error(`Not a transcript: the first line is not a ${TRANSCRIPT_FORMAT} header`);
  }
  if (header['version'] !== TRANSCRIPT_VERSION) {
    throw new Error(`Unsupported transcript version ${String(header['version'])}`);
  }
  const entries: TranscriptEntry[] = [];
  const last = lines.length - 1;
  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i]?.trim() ?? '';
    if (raw === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      if (i === last || (i === last - 1 && (lines[last] ?? '').trim() === '')) break;
      throw new Error(`Line ${i + 1} of the transcript is not JSON`);
    }
    const t = isRecord(value) ? value['t'] : undefined;
    if (!isRecord(value) || typeof t !== 'number' || !Number.isFinite(t)) {
      throw new Error(`Line ${i + 1} of the transcript has no time`);
    }
    if (typeof value['tx'] === 'string') entries.push({ t, tx: value['tx'] });
    else if (typeof value['rx'] === 'string') entries.push({ t, rx: value['rx'] });
    else if ('close' in value) {
      const close = value['close'];
      entries.push({ t, close: typeof close === 'string' ? close : null });
    } else throw new Error(`Line ${i + 1} of the transcript is no tx, rx or close`);
  }
  return {
    header: {
      format: TRANSCRIPT_FORMAT,
      version: TRANSCRIPT_VERSION,
      startedAt: typeof header['startedAt'] === 'number' ? header['startedAt'] : 0,
      transport: typeof header['transport'] === 'string' ? header['transport'] : 'unknown',
      ...(typeof header['part'] === 'number' ? { part: header['part'] } : {}),
    },
    entries,
  };
}

/** A command as the adapter takes it: without the CR, spaces and letter case. */
export function normalizeCommand(command: string): string {
  return command.replace(/[\s\r\n]/g, '').toUpperCase();
}

interface Exchange {
  /** The answer's chunks, each with its delay after the command. */
  chunks: Array<{ delayMs: number; data: string }>;
}

/** How a replay went: commands answered from the transcript, again, or not at all. */
export interface ReplayStats {
  /** Answered with the next recorded answer to the same command. */
  answered: number;
  /** Asked more often than recorded: answered with the last recorded answer again. */
  repeated: number;
  /** Never recorded: answered `OK` (AT commands) or `NO DATA` (requests). */
  unknown: number;
  /** The distinct unknown commands, in order of appearance. */
  unknownCommands: string[];
}

export interface TranscriptTransportOptions {
  timers: Timers;
  /** Delay of the made-up answers to unknown commands. Default 20 ms. */
  unknownDelayMs?: number;
}

/**
 * A transport that plays a recorded adapter back: every command is answered with the chunks
 * recorded after the same command — the next one not used yet, in recording order, so that
 * answers that changed during the drive (trouble codes, speed) come back in their order — at
 * the recorded delays, on the injected timers. A command asked more often than recorded gets
 * its last answer again; a command never recorded gets `OK` (AT commands) or `NO DATA`. That
 * keeps a replay going when the poller asks in a different order than it did in the car, and
 * {@link stats} tells how close the replay stayed to the recording. Chunks recorded before the
 * first command (an adapter's banner on connect) arrive after `open()`, and a link that broke in
 * the recording breaks at the same time after `open()` in the replay.
 */
export class TranscriptTransport implements Transport {
  readonly description: string;
  readonly stats: ReplayStats = { answered: 0, repeated: 0, unknown: 0, unknownCommands: [] };
  private readonly options: TranscriptTransportOptions;
  private readonly events = new TransportEvents();
  private readonly answers = new Map<string, { queue: Exchange[]; last: Exchange | null }>();
  private readonly greeting: Exchange = { chunks: [] };
  private readonly pending = new Set<unknown>();
  /** When and how the recorded link broke, if it did. */
  private readonly breaks: { t: number; message: string } | null = null;
  private open_ = false;

  constructor(transcript: Transcript, options: TranscriptTransportOptions) {
    this.options = options;
    this.description = `transcript of ${transcript.header.transport}`;
    let current: { exchange: Exchange; at: number } = { exchange: this.greeting, at: 0 };
    for (const entry of transcript.entries) {
      if ('tx' in entry) {
        const exchange: Exchange = { chunks: [] };
        for (const command of entry.tx.split('\r')) {
          if (command.trim() === '') continue;
          const key = normalizeCommand(command);
          let slot = this.answers.get(key);
          if (slot === undefined) {
            slot = { queue: [], last: null };
            this.answers.set(key, slot);
          }
          slot.queue.push(exchange);
        }
        current = { exchange, at: entry.t };
      } else if ('rx' in entry) {
        current.exchange.chunks.push({
          delayMs: Math.max(0, entry.t - current.at),
          data: entry.rx,
        });
      } else if (entry.close !== null) {
        this.breaks = { t: entry.t, message: entry.close };
      }
    }
  }

  async open(): Promise<void> {
    this.open_ = true;
    this.play(this.greeting);
    const breaks = this.breaks;
    if (breaks !== null) {
      const handle = this.options.timers.setTimeout(() => {
        this.pending.delete(handle);
        if (!this.open_) return;
        this.stop();
        this.events.emitClose(new Error(breaks.message));
      }, breaks.t);
      this.pending.add(handle);
    }
  }

  async write(data: string): Promise<void> {
    if (!this.open_) throw new Error(`${this.description} is not open`);
    for (const command of data.split('\r')) {
      if (command.trim() === '') continue;
      this.play(this.answerTo(command));
    }
  }

  onData(cb: (chunk: string) => void): () => void {
    return this.events.onData(cb);
  }

  onClose(cb: (err?: Error) => void): () => void {
    return this.events.onClose(cb);
  }

  async close(): Promise<void> {
    if (!this.open_) return;
    this.stop();
    this.events.emitClose();
  }

  private stop(): void {
    this.open_ = false;
    for (const handle of this.pending) this.options.timers.clearTimeout(handle);
    this.pending.clear();
  }

  private answerTo(command: string): Exchange {
    const key = normalizeCommand(command);
    const slot = this.answers.get(key);
    const next = slot?.queue.shift();
    if (slot !== undefined && next !== undefined) {
      slot.last = next;
      this.stats.answered += 1;
      return next;
    }
    if (slot?.last != null) {
      this.stats.repeated += 1;
      return slot.last;
    }
    this.stats.unknown += 1;
    if (!this.stats.unknownCommands.includes(key)) this.stats.unknownCommands.push(key);
    const text = key.startsWith('AT') || key.startsWith('ST') ? 'OK' : 'NO DATA';
    return { chunks: [{ delayMs: this.options.unknownDelayMs ?? 20, data: `${text}\r\r>` }] };
  }

  private play(exchange: Exchange): void {
    for (const { delayMs, data } of exchange.chunks) {
      const handle = this.options.timers.setTimeout(() => {
        this.pending.delete(handle);
        if (this.open_) this.events.emitData(data);
      }, delayMs);
      this.pending.add(handle);
    }
  }
}
