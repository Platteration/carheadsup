/**
 * Replay a recorded adapter session (see `transcript.ts`) through the real driver, poller and
 * service, on a manual clock — no adapter, no waiting: an hour of recording replays in seconds.
 * Used by `npm run obd-replay` and by the tests that keep fixed clones fixed.
 */
import { DEFAULT_CONFIG } from '@carheadsup/core';
import type { HudEvent, ObdConfig } from '@carheadsup/core';
import { SILENT_LOGGER, type Logger, type Timers } from './runtime.ts';
import { ObdService } from './service.ts';
import { TranscriptTransport, type ReplayStats, type Transcript } from './transcript.ts';
import type { Transport } from './transport.ts';

/** Timers on a clock that only moves when told to ({@link ManualClock.advance}). */
export class ManualClock implements Timers {
  current: number;
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
    this.tasks = this.tasks.filter((task) => task.id !== handle);
  }

  /** Move the clock on by `ms`, running the timers due on the way (and the promises they settle). */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    await settle();
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
      this.tasks = this.tasks.filter((task) => task !== due);
      this.current = Math.max(this.current, due.at);
      due.cb();
      await settle();
    }
    this.current = target;
    await settle();
  }
}

/** Let every queued promise callback run. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** An adapter that is gone: what the service finds after the recorded session ended. */
class EndedTransport implements Transport {
  readonly description = 'the end of the transcript';

  async open(): Promise<void> {
    throw new Error('The transcript has ended');
  }

  async write(): Promise<void> {
    throw new Error('The transcript has ended');
  }

  onData(): () => void {
    return () => undefined;
  }

  onClose(): () => void {
    return () => undefined;
  }

  async close(): Promise<void> {}
}

export interface ReplayOptions {
  /**
   * The OBD settings the HUD ran with (protocol, timeouts, custom PIDs); default the defaults.
   * The transport kind is ignored.
   */
  obd?: Partial<ObdConfig>;
  /** How long to go on after the last recorded entry. Default 3000 ms. */
  tailMs?: number;
  /** Clock step of the replay loop. Default 50 ms. */
  stepMs?: number;
  logger?: Logger;
}

export interface ReplayResult {
  /** What the HUD would have received, `at` in ms since the replay started. */
  events: HudEvent[];
  stats: ReplayStats;
  /** Length of the replay, ms. */
  durationMs: number;
}

/** Replay `transcript` and collect the events the OBD service produces. */
export async function replayTranscript(
  transcript: Transcript,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const clock = new ManualClock(0);
  const transport = new TranscriptTransport(transcript, { timers: clock });
  let used = false;
  const config: ObdConfig = {
    ...DEFAULT_CONFIG.obd,
    customPids: [...DEFAULT_CONFIG.obd.customPids],
    ...options.obd,
    transport: 'serial',
    recordTranscript: false,
  };
  const service = new ObdService(config, {
    now: clock.now,
    setTimeout: (callback, ms) => clock.setTimeout(callback, ms),
    clearTimeout: (handle) => clock.clearTimeout(handle),
    logger: options.logger ?? SILENT_LOGGER,
    // The recorded session once; afterwards the adapter is gone.
    createTransport: () => {
      if (used) return new EndedTransport();
      used = true;
      return transport;
    },
  });
  const events: HudEvent[] = [];
  service.onEvent((event) => events.push(event));
  const last = transcript.entries.at(-1)?.t ?? 0;
  const durationMs = Math.ceil(last + (options.tailMs ?? 3000));
  const step = Math.max(1, options.stepMs ?? 50);
  service.start();
  for (let elapsed = 0; elapsed < durationMs; elapsed += step) await clock.advance(step);
  await Promise.all([service.stop(), clock.advance(30_000)]);
  return { events, stats: transport.stats, durationMs };
}

/** One line per event, for people: "  12.345 s  obd/samples  speed=42 rpm=1820". */
export function describeEvent(event: HudEvent): string {
  const at = `${(event.at / 1000).toFixed(3).padStart(9)} s`;
  switch (event.type) {
    case 'obd/link':
      return `${at}  link     ${event.state}${event.message ? ` — ${event.message}` : ''}${
        event.adapter ? ` (${event.adapter}${event.protocol ? `, ${event.protocol}` : ''})` : ''
      }`;
    case 'obd/samples':
      return `${at}  samples  ${event.samples.map((s) => `${s.signal}=${s.value}`).join(' ')}`;
    case 'obd/supported':
      return `${at}  supports ${event.signals.join(' ')}`;
    case 'obd/dtcs':
      return `${at}  codes    MIL ${event.milOn ? 'on' : 'off'}; stored ${
        event.stored.join(' ') || '—'
      }; pending ${event.pending.join(' ') || '—'}; permanent ${event.permanent.join(' ') || '—'}`;
    case 'obd/vin':
      return `${at}  VIN      ${event.vin}`;
    default:
      return `${at}  ${event.type}`;
  }
}
