import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '@carheadsup/core';
import type { HudEvent, ObdConfig } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { ManualClock, describeEvent, replayTranscript } from '../src/replay.ts';
import { ObdService } from '../src/service.ts';
import { Elm327Emulator } from '../src/sim/elm327-emulator.ts';
import { VehicleSimulator } from '../src/sim/vehicle-sim.ts';
import {
  RecordingTransport,
  TRANSCRIPT_FORMAT,
  TranscriptTransport,
  normalizeCommand,
  parseTranscript,
} from '../src/transcript.ts';
import type { Transcript, TranscriptEntry, TranscriptHeader } from '../src/transcript.ts';
import { createTransport } from '../src/transport.ts';
import { FakeClock, ScriptedTransport, reply } from './helpers.ts';

const HEADER: TranscriptHeader = {
  format: TRANSCRIPT_FORMAT,
  version: 1,
  startedAt: 1_790_000_000_000,
  transport: 'serial /dev/rfcomm0 @ 38400',
};

/** A sink that keeps everything in memory. */
function memorySink() {
  const sessions: Array<{ header: TranscriptHeader; entries: TranscriptEntry[]; closed: boolean }> =
    [];
  return {
    sessions,
    createSink: (header: TranscriptHeader) => {
      const session = { header, entries: [] as TranscriptEntry[], closed: false };
      sessions.push(session);
      return {
        write: (entry: TranscriptEntry) => void session.entries.push(entry),
        close: async () => {
          session.closed = true;
        },
      };
    },
  };
}

const lines = (transcript: Transcript): string =>
  [transcript.header, ...transcript.entries].map((line) => JSON.stringify(line)).join('\n');

describe('RecordingTransport', () => {
  it('records what was written and every received chunk, unmerged, with times', async () => {
    let now = 1000;
    const inner = new ScriptedTransport((command) => (command === 'ATI' ? null : reply('OK')));
    const sink = memorySink();
    const recording = new RecordingTransport(inner, {
      createSink: sink.createSink,
      now: () => now,
      wallNow: () => HEADER.startedAt,
    });
    const received: string[] = [];
    recording.onData((chunk) => received.push(chunk));
    expect(recording.description).toBe('scripted adapter');
    await recording.open();
    expect(sink.sessions[0]?.header).toEqual({ ...HEADER, transport: 'scripted adapter' });
    now = 1012.34;
    await recording.write('ATE0\r');
    await Promise.resolve();
    now = 1050;
    inner.push('41 0D ');
    inner.push('32\r\r>');
    await recording.close();
    expect(received).toEqual(['OK\r\r>', '41 0D ', '32\r\r>']);
    expect(sink.sessions[0]).toEqual({
      header: { ...HEADER, transport: 'scripted adapter' },
      entries: [
        { t: 12.3, tx: 'ATE0\r' },
        { t: 12.3, rx: 'OK\r\r>' },
        { t: 50, rx: '41 0D ' },
        { t: 50, rx: '32\r\r>' },
        { t: 50, close: null },
      ],
      closed: true,
    });
  });

  it('records a link that breaks, and leaves no file for one that never opens', async () => {
    const inner = new ScriptedTransport(() => reply('OK'));
    const sink = memorySink();
    const recording = new RecordingTransport(inner, { createSink: sink.createSink, now: () => 0 });
    const closes: Array<string | undefined> = [];
    recording.onClose((err) => closes.push(err?.message));
    await recording.open();
    inner.drop(new Error('Serial port closed'));
    expect(closes).toEqual(['Serial port closed']);
    expect(sink.sessions[0]?.entries).toEqual([{ t: 0, close: 'Serial port closed' }]);
    expect(sink.sessions[0]?.closed).toBe(true);

    const dead = new ScriptedTransport(() => null);
    dead.open = async () => {
      throw new Error('ENOENT: /dev/rfcomm0');
    };
    const none = memorySink();
    await expect(
      new RecordingTransport(dead, { createSink: none.createSink }).open(),
    ).rejects.toThrow('ENOENT');
    expect(none.sessions).toEqual([]);
  });

  it('never lets a failing recording break the link', async () => {
    const inner = new ScriptedTransport(() => reply('OK'));
    const recording = new RecordingTransport(inner, {
      createSink: () => ({
        write: () => {
          throw new Error('disk full');
        },
        close: async () => undefined,
      }),
    });
    const received: string[] = [];
    recording.onData((chunk) => received.push(chunk));
    await recording.open();
    await recording.write('ATZ\r');
    await Promise.resolve();
    expect(received).toEqual(['OK\r\r>']);
    const throwing = new RecordingTransport(new ScriptedTransport(() => reply('OK')), {
      createSink: () => {
        throw new Error('cannot create');
      },
    });
    await throwing.open();
    await throwing.write('ATZ\r');
  });

  it('is what createTransport makes while obd.recordTranscript is on (and where to is known)', () => {
    const config: ObdConfig = { ...DEFAULT_CONFIG.obd, customPids: [], transport: 'tcp' };
    const recording = { createSink: memorySink().createSink };
    expect(createTransport({ ...config, recordTranscript: true }, { recording })).toBeInstanceOf(
      RecordingTransport,
    );
    expect(createTransport(config, { recording })).not.toBeInstanceOf(RecordingTransport);
    expect(createTransport({ ...config, recordTranscript: true })).not.toBeInstanceOf(
      RecordingTransport,
    );
  });
});

describe('parseTranscript', () => {
  const transcript: Transcript = {
    header: HEADER,
    entries: [
      { t: 0.5, tx: 'ATZ\r' },
      { t: 800, rx: 'ELM327 v1.5\r\r>' },
      { t: 900, close: 'gone' },
    ],
  };

  it('reads what the recorder writes', () => {
    expect(parseTranscript(`${lines(transcript)}\n`)).toEqual(transcript);
  });

  it('skips a torn last line (a power cut while writing)', () => {
    const text = `${lines(transcript)}\n{"t":950,"rx":"41 0`;
    expect(parseTranscript(text).entries).toHaveLength(3);
    expect(parseTranscript(`${text}\n`).entries).toHaveLength(3);
  });

  it('refuses what is no transcript', () => {
    expect(() => parseTranscript('hello')).toThrow(/first line is not JSON/);
    expect(() => parseTranscript('{"format":"other"}')).toThrow(/not a carheadsup-obd-transcript/);
    expect(() => parseTranscript(JSON.stringify({ ...HEADER, version: 9 }))).toThrow(
      /Unsupported transcript version 9/,
    );
    expect(() => parseTranscript(`${JSON.stringify(HEADER)}\nnot json\n{"t":1,"tx":"A"}`)).toThrow(
      'Line 2 of the transcript is not JSON',
    );
    expect(() => parseTranscript(`${JSON.stringify(HEADER)}\n{"tx":"A"}`)).toThrow(/no time/);
    expect(() => parseTranscript(`${JSON.stringify(HEADER)}\n{"t":1}`)).toThrow(/no tx, rx/);
  });
});

describe('TranscriptTransport', () => {
  const transcript: Transcript = {
    header: HEADER,
    entries: [
      { t: 0, rx: 'banner\r>' },
      { t: 10, tx: 'ATZ\r' },
      { t: 700, rx: 'ELM327 ' },
      { t: 710, rx: 'v1.5\r\r>' },
      { t: 720, tx: '03\r' },
      { t: 800, rx: '43 01 33\r\r>' },
      { t: 900, tx: '03\r' },
      { t: 950, rx: '43 04 20\r\r>' },
    ],
  };

  async function replay() {
    const clock = new FakeClock();
    const transport = new TranscriptTransport(transcript, { timers: clock });
    const received: Array<[number, string]> = [];
    transport.onData((chunk) => received.push([clock.now(), chunk]));
    await transport.open();
    return { clock, transport, received };
  }

  it('answers each command with its recorded chunks, at their delays', async () => {
    const { clock, transport, received } = await replay();
    await clock.advance(0);
    expect(received).toEqual([[0, 'banner\r>']]);
    await transport.write('AT Z\r');
    await clock.advance(1000);
    expect(received.slice(1)).toEqual([
      [690, 'ELM327 '],
      [700, 'v1.5\r\r>'],
    ]);
    expect(transport.description).toBe('transcript of serial /dev/rfcomm0 @ 38400');
  });

  it('answers a repeated command in recording order, then with its last answer again', async () => {
    const { clock, transport, received } = await replay();
    for (let i = 0; i < 3; i += 1) {
      await transport.write('03\r');
      await clock.advance(200);
    }
    expect(received.slice(1).map(([, chunk]) => chunk)).toEqual([
      '43 01 33\r\r>',
      '43 04 20\r\r>',
      '43 04 20\r\r>',
    ]);
    expect(transport.stats).toMatchObject({ answered: 2, repeated: 1, unknown: 0 });
  });

  it('makes up answers to commands it never saw, and counts them', async () => {
    const { clock, transport, received } = await replay();
    await transport.write('ATSP6\r');
    await transport.write('010D\r');
    await clock.advance(100);
    expect(received.slice(1).map(([, chunk]) => chunk)).toEqual(['OK\r\r>', 'NO DATA\r\r>']);
    expect(transport.stats).toEqual({
      answered: 0,
      repeated: 0,
      unknown: 2,
      unknownCommands: ['ATSP6', '010D'],
    });
  });

  it('breaks the link when the recorded one broke', async () => {
    const clock = new FakeClock();
    const transport = new TranscriptTransport(
      { header: HEADER, entries: [{ t: 500, close: 'Serial port closed' }] },
      { timers: clock },
    );
    const closes: Array<string | undefined> = [];
    transport.onClose((err) => closes.push(err?.message));
    await transport.open();
    await clock.advance(499);
    expect(closes).toEqual([]);
    await clock.advance(1);
    expect(closes).toEqual(['Serial port closed']);
    await expect(transport.write('ATZ\r')).rejects.toThrow('not open');
  });

  it('normalises commands the way the adapter reads them', () => {
    expect(normalizeCommand('at sp 6\r')).toBe('ATSP6');
  });
});

/**
 * Events without their times (a replay keeps the order, the times only to a rounding), and with
 * the replayed link named like the recorded one.
 */
const untimed = (events: readonly HudEvent[]) =>
  events.map(({ at: _at, ...rest }) =>
    rest.type === 'obd/link' && typeof rest.message === 'string'
      ? { ...rest, message: rest.message.replace('Opening transcript of ', 'Opening ') }
      : rest,
  );

describe('recording and replaying a session', () => {
  it('gives the same events as the drive it recorded', async () => {
    const clock = new ManualClock(0);
    const sim = new VehicleSimulator({ mode: 'manual', engineTempC: 90 });
    sim.setDtcs({ stored: ['P0300'] });
    const emulator = new Elm327Emulator(sim, { latencyMs: 25, timers: clock });
    const sink = memorySink();
    const recording = new RecordingTransport(emulator, {
      createSink: sink.createSink,
      now: clock.now,
      wallNow: () => HEADER.startedAt,
    });
    const live: HudEvent[] = [];
    const service = new ObdService(
      { ...DEFAULT_CONFIG.obd, customPids: [], transport: 'serial' },
      {
        now: clock.now,
        setTimeout: (callback, ms) => clock.setTimeout(callback, ms),
        clearTimeout: (handle) => clock.clearTimeout(handle),
        createTransport: () => recording,
      },
    );
    service.onEvent((event) => live.push(event));
    service.start();
    sim.setControls({ throttle: 0.4 });
    for (let t = 0; t < 8000; t += 50) {
      sim.step(50);
      await clock.advance(50);
    }
    await Promise.all([service.stop(), clock.advance(5000)]);
    const session = sink.sessions[0];
    if (session === undefined) throw new Error('nothing recorded');

    // Through the file format and back, as `npm run obd-replay` reads it.
    const text = lines({ header: session.header, entries: session.entries });
    const replayed = await replayTranscript(parseTranscript(text), { tailMs: 0 });
    const recorded = live.filter((event) => event.at <= replayed.durationMs);
    const replayedEvents = replayed.events.slice(0, recorded.length);
    expect(untimed(replayedEvents)).toEqual(untimed(recorded));
    expect(replayed.stats.unknown).toBe(0);
    expect(recorded.some((e) => e.type === 'obd/samples')).toBe(true);
  });
});

describe('the committed transcripts', () => {
  const file = (name: string) => fileURLToPath(new URL(`./transcripts/${name}`, import.meta.url));

  it('emulator-can-chunked.jsonl: answers split across chunks still decode', async () => {
    const transcript = parseTranscript(
      await readFile(file('emulator-can-chunked.jsonl'), 'latin1'),
    );
    // Some answers really are split mid-line.
    expect(
      transcript.entries.some((e) => 'rx' in e && !e.rx.endsWith('>') && !e.rx.endsWith('\r')),
    ).toBe(true);
    const { events } = await replayTranscript(transcript);
    const link = events.find((e) => e.type === 'obd/link' && e.state === 'connected');
    expect(link).toMatchObject({ adapter: 'ELM327 v1.5', protocol: 'ISO 15765-4 (CAN 11/500)' });
    expect(events.find((e) => e.type === 'obd/dtcs')).toMatchObject({
      milOn: true,
      stored: ['P0420', 'P0171'],
      pending: ['P0133'],
      permanent: ['P0420'],
    });
    expect(events.find((e) => e.type === 'obd/vin')).toMatchObject({ vin: '1HGCM82633A004352' });
    const values = (signal: string) =>
      events.flatMap((e) =>
        e.type === 'obd/samples'
          ? e.samples.filter((s) => s.signal === signal).map((s) => s.value)
          : [],
      );
    // Parked at idle, then pulling away to 81 km/h.
    expect(values('speed').length).toBeGreaterThan(100);
    expect(Math.min(...values('rpm'))).toBe(750);
    expect(Math.max(...values('speed'))).toBe(81);
    expect(values('coolantTemp')[0]).toBe(88);
    // The recorded link broke at the end.
    expect(events.some((e) => e.type === 'obd/link' && e.state === 'error')).toBe(true);
    expect(describeEvent(link ?? events[0]!)).toMatch(/connected \(ELM327 v1\.5/);
  });
});
