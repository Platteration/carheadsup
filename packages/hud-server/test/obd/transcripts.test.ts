import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { join } from 'node:path';
import {
  Elm327Emulator,
  TRANSCRIPT_FORMAT,
  VehicleSimulator,
  parseTranscript,
  replayTranscript,
} from '@carheadsup/obd';
import type { TranscriptHeader } from '@carheadsup/obd';
import { afterEach, describe, expect, it } from 'vitest';
import { createHudServer } from '../../src/app.ts';
import type { HudServer } from '../../src/app.ts';
import { TranscriptFiles, transcriptFileName } from '../../src/obd/transcripts.ts';
import { makeTempDir, testConfig, waitFor } from '../helpers.ts';
import { MemoryFs } from '../memory-fs.ts';
import { FakeClock, flush, memoryLogger } from '../sensors/fakes.ts';

const HEADER: TranscriptHeader = {
  format: TRANSCRIPT_FORMAT,
  version: 1,
  startedAt: Date.UTC(2026, 9, 1, 7, 30),
  transport: 'tcp 192.168.0.10:35000',
};
const DIR = '/data/obd-transcripts';
const FILE = `${DIR}/obd-2026-10-01T07-30-00.000Z.jsonl`;

function files(options: { maxFileBytes?: number; maxTotalBytes?: number } = {}) {
  const fs = new MemoryFs();
  const clock = new FakeClock(0);
  const logger = memoryLogger();
  const transcripts = new TranscriptFiles({ dir: DIR, fs, timers: clock, logger, ...options });
  return { fs, clock, logger, transcripts };
}

describe('TranscriptFiles', () => {
  it('names files by the time the session opened', () => {
    expect(transcriptFileName(HEADER.startedAt)).toBe('obd-2026-10-01T07-30-00.000Z.jsonl');
    expect(transcriptFileName(HEADER.startedAt, 3)).toBe(
      'obd-2026-10-01T07-30-00.000Z.part3.jsonl',
    );
  });

  it('writes the header and the entries every 5 s, flushed to the card, and on close', async () => {
    const { fs, clock, logger, transcripts } = files();
    const sink = transcripts.createSink(HEADER);
    expect(logger.lines('info')).toEqual([`OBD: recording the adapter traffic to ${FILE}`]);
    sink.write({ t: 0.5, tx: 'ATZ\r' });
    sink.write({ t: 800, rx: 'ELM327 v1.5\r\r>' });
    await flush();
    expect(fs.files.has(FILE)).toBe(false);
    await clock.advance(5000);
    expect(fs.synced.get(FILE)).toBe(
      `${JSON.stringify(HEADER)}\n{"t":0.5,"tx":"ATZ\\r"}\n{"t":800,"rx":"ELM327 v1.5\\r\\r>"}\n`,
    );
    sink.write({ t: 900, close: null });
    await sink.close();
    expect(parseTranscript(fs.synced.get(FILE) ?? '').entries).toHaveLength(3);
    // Nothing after the end.
    sink.write({ t: 950, tx: 'ATZ\r' });
    await clock.advance(5000);
    expect(parseTranscript(fs.files.get(FILE) ?? '').entries).toHaveLength(3);
  });

  it('continues a long session in parts that each start with the header', async () => {
    const { fs, clock, transcripts } = files({ maxFileBytes: 400 });
    const sink = transcripts.createSink(HEADER);
    for (let i = 0; i < 6; i += 1) {
      sink.write({ t: i, rx: 'x'.repeat(100) });
      await clock.advance(5000);
    }
    await sink.close();
    // Sorted by name: the first part, then the others in order.
    const names = [...fs.files.keys()].sort();
    expect(names).toEqual([
      FILE,
      `${DIR}/obd-2026-10-01T07-30-00.000Z.part2.jsonl`,
      `${DIR}/obd-2026-10-01T07-30-00.000Z.part3.jsonl`,
    ]);
    const parts = names.map((name) => parseTranscript(fs.files.get(name) ?? ''));
    expect(parts.map((part) => part.header)).toEqual([
      HEADER,
      { ...HEADER, part: 2 },
      { ...HEADER, part: 3 },
    ]);
    expect(parts.flatMap((part) => part.entries).map((entry) => entry.t)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    for (const name of names) {
      expect(Buffer.byteLength(fs.files.get(name) ?? '')).toBeLessThanOrEqual(400);
    }
  });

  it('deletes the oldest transcripts to leave room for a new one', async () => {
    const { fs, clock, transcripts } = files({ maxFileBytes: 500, maxTotalBytes: 1000 });
    for (const name of [
      'obd-2026-01-01T00-00-00.000Z.jsonl',
      'obd-2026-02-01T00-00-00.000Z.jsonl',
    ]) {
      fs.files.set(`${DIR}/${name}`, 'x'.repeat(450));
    }
    fs.files.set(`${DIR}/notes.txt`, 'x'.repeat(5000));
    const sink = transcripts.createSink(HEADER);
    sink.write({ t: 1, rx: 'y'.repeat(200) });
    await clock.advance(5000);
    await sink.close();
    expect([...fs.files.keys()].sort()).toEqual([
      `${DIR}/notes.txt`,
      `${DIR}/obd-2026-02-01T00-00-00.000Z.jsonl`,
      FILE,
    ]);
  });

  it('keeps line noise byte for byte (latin1 on the wire, UTF-8 in the file)', async () => {
    const temp = await makeTempDir();
    try {
      const clock = new FakeClock(0);
      const transcripts = new TranscriptFiles({
        dir: temp.dir,
        timers: clock,
        logger: memoryLogger(),
      });
      const sink = transcripts.createSink(HEADER);
      const noise = '\u00ff\u0080\u0000>\r';
      sink.write({ t: 1, rx: noise });
      await sink.close();
      const [name] = await readdir(temp.dir);
      const read = parseTranscript(await readFile(join(temp.dir, name ?? ''), 'utf8'));
      expect(read.entries).toEqual([{ t: 1, rx: noise }]);
    } finally {
      await temp.cleanup();
    }
  });

  it('gives up on a session it cannot write, saying so once', async () => {
    const { fs, clock, logger, transcripts } = files();
    fs.failWith = 'EROFS';
    const sink = transcripts.createSink(HEADER);
    sink.write({ t: 1, tx: 'ATZ\r' });
    await clock.advance(5000);
    sink.write({ t: 2, tx: 'ATZ\r' });
    await clock.advance(5000);
    await sink.close();
    expect(logger.lines('warn')).toEqual([
      `OBD: recording to ${FILE} failed (EROFS: simulated); the rest of this session is not recorded`,
    ]);
  });
});

/** A Wi-Fi ELM327 played by the emulator on a local TCP port. */
async function emulatedWifiAdapter(): Promise<{ server: Server; port: number; sockets: Socket[] }> {
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    const sim = new VehicleSimulator({ mode: 'manual', engineTempC: 85 });
    const emulator = new Elm327Emulator(sim, { latencyMs: 5 });
    void emulator.open();
    emulator.onData((chunk) => socket.write(chunk, 'latin1'));
    socket.on('data', (data) => void emulator.write(data.toString('latin1')));
    socket.on('error', () => undefined);
    socket.on('close', () => void emulator.close());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port, sockets };
}

describe('recording on the HUD', () => {
  let server: HudServer | null = null;
  let adapter: Awaited<ReturnType<typeof emulatedWifiAdapter>> | null = null;
  let temp: Awaited<ReturnType<typeof makeTempDir>> | null = null;
  afterEach(async () => {
    await server?.stop();
    server = null;
    for (const socket of adapter?.sockets ?? []) socket.destroy();
    adapter?.server.close();
    adapter = null;
    await temp?.cleanup();
    temp = null;
  });

  it('records a Wi-Fi adapter with --record, in a file that replays to the same values', async () => {
    adapter = await emulatedWifiAdapter();
    temp = await makeTempDir();
    const dataDir = temp.dir;
    await writeFile(
      join(dataDir, 'config.json'),
      JSON.stringify(
        testConfig({
          obd: { transport: 'tcp', tcpHost: '127.0.0.1', tcpPort: adapter.port },
          server: { mdns: false },
        }),
      ),
    );
    const hud = createHudServer({
      dataDir,
      port: 0,
      tlsPort: null,
      host: '127.0.0.1',
      record: true,
      sysRoot: null,
      createSensorSources: () => [],
      createFrameSinks: () => [],
      advertiseHud: () => null,
    });
    server = hud;
    await hud.start();
    await waitFor(() => hud.engine.state.vehicle.vin !== null, 15_000, 'the VIN over OBD');
    await hud.stop();
    server = null;

    const dir = join(dataDir, 'obd-transcripts');
    const names = await readdir(dir);
    expect(names).toHaveLength(1);
    const transcript = parseTranscript(await readFile(join(dir, names[0] ?? ''), 'utf8'));
    expect(transcript.header.transport).toBe(`tcp 127.0.0.1:${adapter.port}`);
    expect(transcript.entries[0]).toMatchObject({ tx: 'ATZ\r' });
    expect(transcript.entries.at(-1)).toMatchObject({ close: null });
    const replayed = await replayTranscript(transcript);
    expect(replayed.events.find((e) => e.type === 'obd/vin')).toMatchObject({
      vin: '1HGCM82633A004352',
    });
    expect(
      replayed.events.some(
        (e) => e.type === 'obd/samples' && e.samples.some((s) => s.signal === 'coolantTemp'),
      ),
    ).toBe(true);
  }, 30_000);
});
