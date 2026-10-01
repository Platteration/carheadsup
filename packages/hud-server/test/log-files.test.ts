import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DebugRing, LogFiles, RotatingLogFile } from '../src/log-files.ts';
import { createLogger } from '../src/logger.ts';
import type { LogLevel, LogSink } from '../src/logger.ts';
import { FakeClock, flush } from './sensors/fakes.ts';
import { TestSocket, makeTempDir, startTestServer, waitFor } from './helpers.ts';
import { MemoryFs } from './memory-fs.ts';

function setup(options: { maxBytes?: number; keep?: number; level?: LogLevel } = {}) {
  const fs = new MemoryFs();
  const clock = new FakeClock(0);
  const problems: string[] = [];
  const file = new RotatingLogFile({
    dir: '/data/logs',
    fs,
    timers: clock,
    onProblem: (message) => problems.push(message),
    ...options,
  });
  return { fs, clock, problems, file };
}

const line = (n: number, pad = 0) => `2026-10-01T07:30:00.000Z INFO  line ${n}${'.'.repeat(pad)}`;

describe('RotatingLogFile', () => {
  it('writes quiet lines every 5 s, flushed to the card', async () => {
    const { fs, clock, file } = setup();
    file.write(line(1), 'info');
    file.write(line(2), 'info');
    await flush();
    expect(fs.files.get('/data/logs/hud.log')).toBeUndefined();
    await clock.advance(4999);
    expect(fs.synced.get('/data/logs/hud.log')).toBeUndefined();
    await clock.advance(1);
    expect(fs.synced.get('/data/logs/hud.log')).toBe(`${line(1)}\n${line(2)}\n`);
    expect(fs.syncs).toBe(1);
    expect(fs.dirs.has('/data/logs')).toBe(true);
  });

  it('writes a warning or an error, and what came before it, at once', async () => {
    const { fs, file } = setup();
    file.write(line(1), 'info');
    file.write('2026-10-01T07:30:00.000Z WARN  bad news', 'warn');
    await file.flush();
    expect(fs.synced.get('/data/logs/hud.log')).toBe(
      `${line(1)}\n2026-10-01T07:30:00.000Z WARN  bad news\n`,
    );
    file.write('2026-10-01T07:30:00.000Z ERROR worse news', 'error');
    await file.flush();
    expect(fs.synced.get('/data/logs/hud.log')).toContain('worse news');
    expect(fs.syncs).toBe(2);
  });

  it('appends to the file of an earlier run', async () => {
    const { fs, file } = setup();
    fs.files.set('/data/logs/hud.log', 'from before\n');
    file.write(line(1), 'warn');
    await file.flush();
    expect(fs.files.get('/data/logs/hud.log')).toBe(`from before\n${line(1)}\n`);
  });

  it('rotates by size and keeps a fixed number of files', async () => {
    const { fs, file } = setup({ maxBytes: 1024, keep: 3 });
    // About 400 bytes a line: two fit in a file.
    for (let n = 1; n <= 9; n += 1) {
      file.write(line(n, 360), 'warn');
      await file.flush();
    }
    const names = [...fs.files.keys()].sort();
    expect(names).toEqual(['/data/logs/hud.log', '/data/logs/hud.log.1', '/data/logs/hud.log.2']);
    for (const content of fs.files.values()) expect(Buffer.byteLength(content)).toBeLessThan(1024);
    expect(fs.files.get('/data/logs/hud.log')).toContain('line 9.');
    expect(fs.files.get('/data/logs/hud.log.1')).toContain('line 7.');
    expect(fs.files.get('/data/logs/hud.log.2')).toContain('line 5.');
    // A file of an earlier run counts towards the size too.
    const again = setup({ maxBytes: 1024, keep: 3 });
    again.fs.files.set('/data/logs/hud.log', 'x'.repeat(900));
    again.file.write(line(1, 360), 'warn');
    await again.file.flush();
    expect(again.fs.files.get('/data/logs/hud.log.1')).toBe('x'.repeat(900));
    expect(again.fs.files.get('/data/logs/hud.log')).toContain('line 1.');
  });

  it('keeps the lines while the card cannot be written, says so once, and catches up', async () => {
    const { fs, clock, file, problems } = setup();
    fs.failWith = 'EROFS';
    file.write(line(1), 'warn');
    await file.flush();
    file.write(line(2), 'error');
    await file.flush();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/cannot write \/data\/logs\/hud\.log \(EROFS: simulated\)/);
    fs.failWith = null;
    file.write(line(3), 'info');
    await clock.advance(5000);
    expect(fs.synced.get('/data/logs/hud.log')).toBe(`${line(1)}\n${line(2)}\n${line(3)}\n`);
    expect(problems[1]).toMatch(/works again/);
  });

  it('flushes and closes, then takes no more lines', async () => {
    const { fs, file } = setup();
    file.write(line(1), 'info');
    await file.close();
    expect(fs.synced.get('/data/logs/hud.log')).toBe(`${line(1)}\n`);
    file.write(line(2), 'error');
    await file.flush();
    expect(fs.files.get('/data/logs/hud.log')).toBe(`${line(1)}\n`);
  });
});

describe('DebugRing', () => {
  it('keeps the newest lines in order', () => {
    const ring = new DebugRing(3);
    expect(ring.snapshot()).toEqual([]);
    for (const text of ['a', 'b']) ring.write(text);
    expect(ring.snapshot()).toEqual(['a', 'b']);
    for (const text of ['c', 'd', 'e']) ring.write(text);
    expect(ring.snapshot()).toEqual(['c', 'd', 'e']);
  });
});

describe('createLogger with sinks', () => {
  it('gives every sink the levels it asks for, formatting only what someone takes', () => {
    const lines: Record<string, string[]> = { terminal: [], file: [], ring: [] };
    const sink = (name: string, level: LogLevel): LogSink => ({
      level,
      write: (text) => void lines[name]?.push(text),
    });
    let formatted = 0;
    const logger = createLogger({
      level: 'warn',
      write: (text) => void lines['terminal']?.push(text),
      now: () => 0,
      sinks: [sink('file', 'info'), sink('ring', 'debug')],
    });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(lines['terminal']).toEqual([
      '1970-01-01T00:00:00.000Z WARN  w',
      '1970-01-01T00:00:00.000Z ERROR e',
    ]);
    expect(lines['file']?.map((l) => l.slice(-1))).toEqual(['i', 'w', 'e']);
    expect(lines['ring']?.map((l) => l.slice(-1))).toEqual(['d', 'i', 'w', 'e']);

    const quiet = createLogger({ level: 'warn', write: () => undefined });
    quiet.debug({
      toString: () => {
        formatted += 1;
        return 'x';
      },
    });
    expect(formatted).toBe(0);
  });

  it('keeps writing to the others when one sink throws', () => {
    const seen: string[] = [];
    const logger = createLogger({
      write: () => {
        throw new Error('EPIPE');
      },
      sinks: [{ level: 'info', write: (text) => void seen.push(text) }],
    });
    logger.info('still here');
    expect(seen).toHaveLength(1);
  });
});

describe('LogFiles', () => {
  function files(options: { now?: () => number } = {}) {
    const fs = new MemoryFs();
    const clock = new FakeClock(Date.UTC(2026, 9, 1, 7, 30));
    const problems: string[] = [];
    const logs = new LogFiles({
      dir: '/data/logs',
      fs,
      timers: clock,
      now: options.now ?? clock.now,
      ringLines: 3,
      dumpsKept: 2,
      onProblem: (message) => problems.push(message),
    });
    const logger = createLogger({ level: 'error', write: () => undefined, sinks: logs.sinks });
    return { fs, clock, problems, logs, logger };
  }

  it('writes the recent lines at every level to a debug log of its own when asked', async () => {
    const { fs, logs, logger } = files();
    logger.debug('OBD → 010D');
    logger.debug('OBD ← 41 0D 32');
    logger.info('started');
    logger.warn('OBD: connection to the adapter lost');
    const path = await logs.dumpDebug('OBD link lost:\nreset');
    expect(path).toBe('/data/logs/debug-2026-10-01T07-30-00.000Z.log');
    const text = fs.synced.get(path ?? '') ?? '';
    const dumped = text.split('\n');
    expect(dumped[0]).toBe('# carheadsup debug log: OBD link lost: | reset');
    // The ring holds the last three lines.
    expect(dumped.slice(1, -1).map((l) => l.replace(/^\S+ \S+ +/, ''))).toEqual([
      'OBD ← 41 0D 32',
      'started',
      'OBD: connection to the adapter lost',
    ]);
    // hud.log has info and above only.
    await logs.close();
    expect(fs.synced.get('/data/logs/hud.log')).not.toContain('OBD →');
    expect(fs.synced.get('/data/logs/hud.log')).toContain('started');
  });

  it('writes at most one debug log a minute, and keeps the newest few', async () => {
    let now = Date.UTC(2026, 9, 1, 7, 30);
    const { fs, logs } = files({ now: () => now });
    expect(await logs.dumpDebug('first')).not.toBeNull();
    now += 30_000;
    expect(await logs.dumpDebug('too soon')).toBeNull();
    for (let i = 0; i < 3; i += 1) {
      now += 60_000;
      expect(await logs.dumpDebug(`later ${i}`)).not.toBeNull();
    }
    const dumps = (await fs.readdir('/data/logs')).filter((n) => n.startsWith('debug-')).sort();
    expect(dumps).toEqual([
      'debug-2026-10-01T07-32-30.000Z.log',
      'debug-2026-10-01T07-33-30.000Z.log',
    ]);
  });

  it('never deletes the debug log it just wrote, even when the clock went back', async () => {
    // A Pi without a real-time clock starts each boot at an old time (the read-only root
    // forgets the last one, and the ignition cuts the power before it is saved): the dumps of an
    // earlier drive can carry later times than the one written now.
    const { fs, logs } = files();
    for (const name of [
      'debug-2026-12-01T00-00-00.000Z.log',
      'debug-2026-12-02T00-00-00.000Z.log',
    ]) {
      fs.files.set(`/data/logs/${name}`, 'from an earlier drive\n');
    }
    const path = await logs.dumpDebug('OBD link lost');
    expect(path).toBe('/data/logs/debug-2026-10-01T07-30-00.000Z.log');
    // Two kept in all: the one just written, and the newest-named of the others.
    expect((await fs.readdir('/data/logs')).filter((n) => n.startsWith('debug-')).sort()).toEqual([
      'debug-2026-10-01T07-30-00.000Z.log',
      'debug-2026-12-02T00-00-00.000Z.log',
    ]);
  });

  it('reports a debug log it cannot write, without throwing', async () => {
    const { fs, logs, problems } = files();
    fs.failWith = 'ENOSPC';
    expect(await logs.dumpDebug('full card')).toBeNull();
    expect(problems.join('\n')).toMatch(/cannot write the debug log .*ENOSPC/);
  });

  it('works on the real file system', async () => {
    const temp = await makeTempDir();
    try {
      const dir = join(temp.dir, 'logs');
      const logs = new LogFiles({ dir, timers: new FakeClock(0), now: () => 0 });
      const logger = createLogger({ level: 'error', write: () => undefined, sinks: logs.sinks });
      logger.info('hello');
      logger.debug('details');
      const dump = await logs.dumpDebug('test');
      await logs.close();
      expect(await readFile(join(dir, 'hud.log'), 'utf8')).toMatch(/INFO {2}hello\n$/);
      expect(await readFile(dump ?? '', 'utf8')).toMatch(/details/);
      expect((await readdir(dir)).sort()).toEqual([
        'debug-1970-01-01T00-00-00.000Z.log',
        'hud.log',
      ]);
    } finally {
      await temp.cleanup();
    }
  });
});

describe('the server', () => {
  it('asks for a debug log when a working OBD link breaks, not when it never came up', async () => {
    const reasons: string[] = [];
    const t = await startTestServer({ dumpDebugLog: (reason) => reasons.push(reason) });
    try {
      const link = (state: 'connecting' | 'connected' | 'error', message: string | null = null) =>
        t.obd.emit({ type: 'obd/link', state, adapter: null, protocol: null, message, at: 0 });
      link('connecting');
      link('error', 'Cannot open /dev/rfcomm0');
      link('connecting');
      link('connected');
      link('error', 'Connection to the adapter lost: Serial port closed');
      await waitFor(() => reasons.length > 0, 1000, 'the dump request');
      expect(reasons).toEqual([
        'OBD link lost: Connection to the adapter lost: Serial port closed',
      ]);
    } finally {
      await t.stop();
    }
  });

  it("asks for a debug log when the HUD's own display reports a page error", async () => {
    const reasons: string[] = [];
    const t = await startTestServer({ dumpDebugLog: (reason) => reasons.push(reason) });
    const socket = new TestSocket(`${t.wsBase}/ws/hud`);
    try {
      await socket.opened;
      socket.send({ t: 'client-error', message: 'x is undefined', stack: null });
      await waitFor(() => reasons.length > 0, 2000, 'the dump request');
      expect(reasons).toEqual(["page error on the HUD's display: x is undefined"]);
    } finally {
      socket.close();
      await t.stop();
    }
  });
});
