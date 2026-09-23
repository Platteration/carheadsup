import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  CommandNotFoundError,
  ProcessSupervisor,
  defaultSpawn,
  findExecutable,
  forEachLine,
  runCommand,
  type SupervisorOptions,
} from '../../src/sensors/process.ts';
import { Backoff, OnceLogger, TokenBucket, cleanLabel, errorCode } from '../../src/sensors/util.ts';
import { FakeClock, fakeSpawn, flush, memoryLogger, respond, type FakeChild } from './fakes.ts';

describe('forEachLine', () => {
  it('splits chunks into lines, strips CR and holds partial lines', async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    forEachLine(stream, (l) => lines.push(l));
    stream.write('one\r\ntw');
    stream.write('o\nthree');
    await flush();
    expect(lines).toEqual(['one', 'two']);
    stream.write('\n');
    await flush();
    expect(lines).toEqual(['one', 'two', 'three']);
  });

  it('drops an endless line instead of growing without bound', async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    forEachLine(stream, (l) => lines.push(l));
    stream.write('x'.repeat(20_000));
    stream.write('\nok\n');
    await flush();
    expect(lines).toEqual(['', 'ok']);
  });
});

describe('runCommand', () => {
  it('collects output and the exit code', async () => {
    const clock = new FakeClock();
    const spawn = fakeSpawn((child) => respond(child, 'hello\n', 3, 'warning\n'));
    await expect(runCommand(spawn, clock, 'tool', ['--x'])).resolves.toEqual({
      code: 3,
      stdout: 'hello\n',
      stderr: 'warning\n',
    });
    expect(spawn.children[0]?.args).toEqual(['--x']);
  });

  it('rejects with CommandNotFoundError for a missing tool', async () => {
    const clock = new FakeClock();
    const spawn = fakeSpawn((child) => child.failToStart());
    await expect(runCommand(spawn, clock, 'nope', [])).rejects.toBeInstanceOf(CommandNotFoundError);
  });

  it('kills a hanging command after the timeout', async () => {
    const clock = new FakeClock();
    const spawn = fakeSpawn(() => {});
    const result = runCommand(spawn, clock, 'hang', [], 1000);
    const outcome = expect(result).rejects.toThrow(/did not finish within 1000 ms/);
    await clock.advance(1000);
    await outcome;
    expect(spawn.children[0]?.signals).toEqual(['SIGKILL']);
  });

  it('runs real processes through the default spawn', async () => {
    const clock = new FakeClock();
    const result = await runCommand(
      defaultSpawn,
      clock,
      process.execPath,
      ['-e', 'console.log("hi")'],
      10_000,
    );
    expect(result).toEqual({ code: 0, stdout: 'hi\n', stderr: '' });
    await expect(
      runCommand(defaultSpawn, clock, 'carheadsup-no-such-tool', []),
    ).rejects.toBeInstanceOf(CommandNotFoundError);
  });
});

describe('findExecutable', () => {
  it('searches PATH for an executable file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'carheadsup-path-'));
    try {
      const tool = join(dir, 'mytool');
      await writeFile(tool, '#!/bin/sh\n');
      expect(findExecutable('mytool', dir)).toBeNull(); // not executable yet
      await chmod(tool, 0o755);
      expect(findExecutable('mytool', `/nonexistent:${dir}`)).toBe(tool);
      expect(findExecutable('other', dir)).toBeNull();
      expect(findExecutable('mytool', '')).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function supervise(overrides: Partial<SupervisorOptions> & { script: (child: FakeChild) => void }) {
  const clock = new FakeClock(0);
  const logger = memoryLogger();
  const spawn = fakeSpawn(overrides.script);
  const supervisor = new ProcessSupervisor({
    label: 'test',
    command: 'daemon',
    args: () => ['--flag'],
    spawn,
    timers: clock,
    now: clock.now,
    logger,
    ...overrides,
  });
  return { clock, logger, spawn, supervisor };
}

describe('ProcessSupervisor', () => {
  it('forwards stdout lines and stops the child with SIGTERM', async () => {
    const lines: string[] = [];
    const { clock, spawn, supervisor } = supervise({
      script: (child) => child.print('ready', 'event 1'),
      onStdoutLine: (l) => lines.push(l),
    });
    supervisor.start();
    await clock.advance(10);
    expect(lines).toEqual(['ready', 'event 1']);
    expect(supervisor.running).toBe(true);
    await supervisor.stop();
    expect(spawn.children[0]?.signals).toEqual(['SIGTERM']);
    expect(supervisor.running).toBe(false);
    expect(clock.pendingTimers).toBe(0);
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const { clock, spawn, supervisor } = supervise({
      script: (child) => {
        child.diesOnTerm = false;
      },
    });
    supervisor.start();
    await clock.advance(10);
    const stopped = supervisor.stop();
    await clock.advance(2000);
    await stopped;
    expect(spawn.children[0]?.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('restarts with exponential backoff and resets it after a stable run', async () => {
    let failFast = true;
    const { clock, spawn, logger, supervisor } = supervise({
      script: (child) => {
        if (failFast) {
          child.printErr('Daemon not running');
          child.exit(1);
        }
      },
    });
    supervisor.start();
    await clock.advance(10);
    expect(spawn.children).toHaveLength(1);
    await clock.advance(1000); // t = 1010: the first restart came at 1000
    expect(spawn.children).toHaveLength(2);
    await clock.advance(1989);
    expect(spawn.children).toHaveLength(2);
    await clock.advance(1);
    expect(spawn.children).toHaveLength(3);
    await clock.advance(4000);
    expect(spawn.children).toHaveLength(4);
    // One warning for the streak; the rest are debug.
    expect(logger.lines('warn')).toEqual([
      'test: daemon exited (code 1): Daemon not running; restarting',
    ]);
    expect(logger.lines('debug')).toHaveLength(3);

    // It now stays up for a minute, then dies: the delay is back to 1 s.
    failFast = false;
    await clock.advance(8000);
    expect(spawn.children).toHaveLength(5);
    await clock.advance(60_000);
    spawn.children[4]!.exit(0);
    await clock.advance(1000);
    expect(spawn.children).toHaveLength(6);
    await supervisor.stop();
    expect(clock.pendingTimers).toBe(0);
  });

  it('reports a missing executable once and gives up', async () => {
    let missing = 0;
    const { clock, spawn, supervisor } = supervise({
      script: (child) => child.failToStart(),
      onMissing: () => {
        missing += 1;
      },
    });
    supervisor.start();
    await clock.advance(60_000);
    expect(missing).toBe(1);
    expect(spawn.children).toHaveLength(1);
    expect(clock.pendingTimers).toBe(0);
    await supervisor.stop();
  });

  it('treats other spawn errors as failed runs and honours onExit "stop"', async () => {
    const decisions: number[] = [];
    const { clock, spawn, supervisor } = supervise({
      script: (child) => child.failToStart('EACCES'),
      onExit: (info) => {
        decisions.push(info.code ?? -1);
        return decisions.length < 2 ? 'restart' : 'stop';
      },
    });
    supervisor.start();
    await clock.advance(30_000);
    expect(spawn.children).toHaveLength(2);
    expect(decisions).toEqual([-1, -1]);
    expect(clock.pendingTimers).toBe(0);
    await supervisor.stop();
  });

  it('keeps a running child when it reports a non-fatal error (failed kill)', async () => {
    const { clock, spawn, logger, supervisor } = supervise({ script: () => {} });
    supervisor.start();
    await clock.advance(10);
    spawn.children[0]!.emit('error', Object.assign(new Error('kill EPERM'), { code: 'EPERM' }));
    await clock.advance(60_000);
    expect(spawn.children).toHaveLength(1);
    expect(supervisor.running).toBe(true);
    expect(logger.lines('warn')).toEqual(['test: kill EPERM']);
    await supervisor.stop();
  });

  it('is not restarted by the exit that stop() causes', async () => {
    const { clock, spawn, supervisor } = supervise({ script: () => {} });
    supervisor.start();
    await clock.advance(10);
    await supervisor.stop();
    await clock.advance(60_000);
    expect(spawn.children).toHaveLength(1);
  });
});

describe('util', () => {
  it('Backoff doubles up to the cap and resets', () => {
    const backoff = new Backoff(1000, 5000);
    expect([
      backoff.next(),
      backoff.next(),
      backoff.next(),
      backoff.next(),
      backoff.next(),
    ]).toEqual([1000, 2000, 4000, 5000, 5000]);
    expect(backoff.attempts).toBe(5);
    backoff.reset();
    expect(backoff.next()).toBe(1000);
  });

  it('TokenBucket allows bursts, refills over time and ignores clock jumps backwards', () => {
    let now = 0;
    const bucket = new TokenBucket(3, 2, () => now);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    now = 499;
    expect(bucket.take()).toBe(false);
    now = 500;
    expect(bucket.take()).toBe(true);
    now = -10_000;
    expect(bucket.take()).toBe(false);
    now = 10_000;
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('OnceLogger logs each key once until reset', () => {
    const logger = memoryLogger();
    const once = new OnceLogger(logger);
    once.warn('a', 'first');
    once.warn('a', 'again');
    once.info('b', 'other');
    expect(once.has('a')).toBe(true);
    once.reset('a');
    once.error('a', 'after reset');
    expect(logger.entries.map((e) => `${e.level}:${e.message}`)).toEqual([
      'warn:first',
      'info:other',
      'error:after reset',
    ]);
  });

  it('cleanLabel strips control characters, collapses whitespace and caps length', () => {
    expect(cleanLabel('  Maria\u0000\u001b[31m  Lopez \n', 100, 'x')).toBe('Maria [31m Lopez');
    expect(cleanLabel('', 100, 'fallback')).toBe('fallback');
    expect(cleanLabel(42, 100, 'fallback')).toBe('fallback');
    expect(cleanLabel('abcdef', 3, 'x')).toBe('abc');
    expect(cleanLabel('😀😀😀', 2, 'x')).toBe('😀😀');
  });

  it('errorCode reads Node error codes', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('ENOENT');
    expect(errorCode(new Error('x'))).toBeNull();
    expect(errorCode('ENOENT')).toBeNull();
  });
});
