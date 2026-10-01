/**
 * Makes `emulator-can-chunked.jsonl`, the transcript the replay test keeps working: 20 s with the
 * built-in ELM327 emulator (CAN 11/500, an engine and a transmission ECU, trouble codes set,
 * the car pulling away), recorded as the HUD records a real adapter. The link delivers its
 * answers in pieces of at most 20 characters a few milliseconds apart, as Bluetooth adapters do,
 * so lines arrive split across chunks; at the end the link breaks.
 *
 *   node packages/obd/test/transcripts/record-emulator.ts > packages/obd/test/transcripts/emulator-can-chunked.jsonl
 *
 * Transcripts of real adapters are recorded on the HUD (`obd.recordTranscript`) instead; see
 * docs/development.md, "Field testing".
 */
import { DEFAULT_CONFIG } from '@carheadsup/core';
import { ManualClock } from '../../src/replay.ts';
import { ObdService } from '../../src/service.ts';
import { Elm327Emulator } from '../../src/sim/elm327-emulator.ts';
import { VehicleSimulator } from '../../src/sim/vehicle-sim.ts';
import { RecordingTransport, type TranscriptEntry } from '../../src/transcript.ts';
import { TransportEvents, type Transport } from '../../src/transport.ts';

/** Delivers the inner link's data in pieces of `size` characters, `gapMs` apart. */
class ChunkingTransport implements Transport {
  readonly description = 'serial /dev/rfcomm0 @ 38400';
  private readonly events = new TransportEvents();
  private readonly inner: Transport;
  private readonly clock: ManualClock;
  private queue: Promise<void> = Promise.resolve();

  constructor(inner: Transport, clock: ManualClock) {
    this.inner = inner;
    this.clock = clock;
    inner.onData((chunk) => {
      for (let i = 0; i < chunk.length; i += 20) {
        const piece = chunk.slice(i, i + 20);
        const delay = i === 0 ? 0 : 3;
        this.clock.setTimeout(() => this.events.emitData(piece), (i / 20) * delay);
      }
    });
    inner.onClose((err) => this.events.emitClose(err));
  }

  open(): Promise<void> {
    return this.inner.open();
  }

  write(data: string): Promise<void> {
    this.queue = this.inner.write(data);
    return this.queue;
  }

  onData(cb: (chunk: string) => void): () => void {
    return this.events.onData(cb);
  }

  onClose(cb: (err?: Error) => void): () => void {
    return this.events.onClose(cb);
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  /** Break the link, as a Bluetooth adapter going out of range does. */
  breakLink(): void {
    this.events.emitClose(new Error('Serial port closed'));
  }
}

async function main(): Promise<void> {
  const clock = new ManualClock(0);
  const sim = new VehicleSimulator({ mode: 'manual', engineTempC: 88 });
  sim.setDtcs({ stored: ['P0420', 'P0171'], pending: ['P0133'], permanent: ['P0420'] });
  const emulator = new Elm327Emulator(sim, { latencyMs: 30, timers: clock });
  const link = new ChunkingTransport(emulator, clock);
  const lines: string[] = [];
  const recorder = new RecordingTransport(link, {
    now: clock.now,
    wallNow: () => Date.UTC(2026, 9, 1, 7, 30),
    createSink: (header) => {
      lines.push(JSON.stringify(header));
      return {
        write: (entry: TranscriptEntry) => void lines.push(JSON.stringify(entry)),
        close: async () => undefined,
      };
    },
  });
  const service = new ObdService(
    { ...DEFAULT_CONFIG.obd, customPids: [], transport: 'serial' },
    {
      now: clock.now,
      setTimeout: (callback, ms) => clock.setTimeout(callback, ms),
      clearTimeout: (handle) => clock.clearTimeout(handle),
      createTransport: () => recorder,
    },
  );
  service.start();
  // Parked with the engine running for 6 s, then pulling away.
  for (let t = 0; t < 20_000; t += 50) {
    if (t === 6000) sim.setControls({ throttle: 0.5 });
    sim.step(50);
    await clock.advance(50);
  }
  link.breakLink();
  await clock.advance(10);
  await Promise.all([service.stop(), clock.advance(5000)]);
  process.stdout.write(`${lines.join('\n')}\n`);
}

void main();
