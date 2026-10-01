import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { HUD_VERSION } from '../src/meta.ts';
import { makeTempDir, testConfig, writeFakeRenderer } from './helpers.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));

interface Run {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

const children: ChildProcess[] = [];

function launch(args: string[], env: Record<string, string> = {}, nodeArgs: string[] = []): Run {
  const child = spawn(process.execPath, [...nodeArgs, MAIN, ...args], {
    env: { ...process.env, ...env, CARHEADSUP_DATA_DIR: env['CARHEADSUP_DATA_DIR'] ?? '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let text = '';
  child.stdout?.on('data', (chunk: Buffer) => (text += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (text += chunk.toString()));
  const exited = new Promise<number | null>((resolve) =>
    child.once('exit', (code) => resolve(code)),
  );
  return { child, output: () => text, exited };
}

async function waitForOutput(
  run: Run,
  pattern: RegExp,
  timeoutMs = 10_000,
): Promise<RegExpMatchArray> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const match = pattern.exec(run.output());
    if (match) return match;
    if (Date.now() > deadline || run.child.exitCode !== null) {
      throw new Error(`no ${pattern} in output:\n${run.output()}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

describe('carheadsup CLI', () => {
  it('prints help and the version', async () => {
    const help = launch(['--help']);
    expect(await help.exited).toBe(0);
    expect(help.output()).toContain('Usage: carheadsup');
    const version = launch(['--version']);
    expect(await version.exited).toBe(0);
    expect(version.output().trim()).toBe(`carheadsup ${HUD_VERSION}`);
  });

  it('exits with 2 on invalid arguments', async () => {
    const run = launch(['--port', 'eighty']);
    expect(await run.exited).toBe(2);
    expect(run.output()).toMatch(/--port: expected a port number/);
  });

  it('serves, prints its URLs and shuts down cleanly on SIGTERM', async () => {
    const temp = await makeTempDir();
    try {
      const renderer = join(temp.dir, 'dist');
      await writeFakeRenderer(renderer);
      // Real OBD service on its built-in simulator transport; no multicast from tests.
      await writeFile(
        join(temp.dir, 'config.json'),
        JSON.stringify(testConfig({ obd: { transport: 'simulator' }, server: { mdns: false } })),
      );
      const run = launch([
        '--data-dir',
        temp.dir,
        '--port',
        '0',
        '--host',
        '127.0.0.1',
        '--renderer-dir',
        renderer,
        '--backlight',
        'off',
      ]);
      const [, port] = await waitForOutput(
        run,
        /HUD: http:\/\/127\.0\.0\.1:(\d+)\/ +settings: \S+\/settings +dev console: \S+\/dev/,
      );
      const info = (await (await fetch(`http://127.0.0.1:${port}/api/info`)).json()) as {
        name: string;
      };
      expect(info.name).toBe('carheadsup');
      expect((await fetch(`http://127.0.0.1:${port}/settings`)).status).toBe(200);
      run.child.kill('SIGTERM');
      expect(await run.exited).toBe(0);
      expect(run.output()).toMatch(/Received SIGTERM/);
      expect(run.output()).toMatch(/HUD server stopped/);
      // Every log line is a single timestamped line.
      for (const line of run.output().trim().split('\n')) {
        expect(line).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z (DEBUG|INFO |WARN |ERROR) /);
      }
      // The log also went to a file in the data directory, flushed before the exit.
      const file = await readFile(join(temp.dir, 'logs', 'hud.log'), 'utf8');
      expect(file).toMatch(/INFO {2}HUD server .* listening on 127\.0\.0\.1:\d+/);
      expect(file.trimEnd().split('\n').at(-1)).toMatch(/HUD server stopped$/);
    } finally {
      await temp.cleanup();
    }
  }, 20_000);

  it('writes the recent debug log to a file when it crashes', async () => {
    const temp = await makeTempDir();
    try {
      await writeFile(
        join(temp.dir, 'config.json'),
        JSON.stringify(testConfig({ obd: { transport: 'simulator' }, server: { mdns: false } })),
      );
      // A bug that throws outside any handler, once the server runs.
      const crash = `data:text/javascript,setTimeout(() => { throw new Error('test crash'); }, 2500)`;
      const run = launch(
        ['--data-dir', temp.dir, '--port', '0', '--host', '127.0.0.1', '--backlight', 'off'],
        {},
        ['--import', crash],
      );
      expect(await run.exited).toBe(1);
      expect(run.output()).toMatch(/ERROR Fatal: uncaught exception: Error: test crash/);
      expect(run.output()).toMatch(/INFO {2}Log: wrote the recent debug log to \S+debug-/);
      const logs = await readdir(join(temp.dir, 'logs'));
      const dump = logs.find((name) => name.startsWith('debug-'));
      expect(dump).toBeDefined();
      const text = await readFile(join(temp.dir, 'logs', dump ?? ''), 'utf8');
      expect(text.split('\n')[0]).toBe('# carheadsup debug log: uncaught exception: test crash');
      // Debug lines are in it although the log level is info: the OBD traffic, for one.
      expect(text).toMatch(/DEBUG OBD → ATZ/);
      expect(text).toMatch(/ERROR Fatal: uncaught exception/);
      // And hud.log has the fatal line, written before the exit.
      expect(await readFile(join(temp.dir, 'logs', 'hud.log'), 'utf8')).toMatch(
        /ERROR Fatal: uncaught exception: Error: test crash/,
      );
    } finally {
      await temp.cleanup();
    }
  }, 20_000);

  it('explains a busy port in one line instead of a stack trace', async () => {
    const temp = await makeTempDir();
    const blocker = createServer();
    try {
      await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
      const port = (blocker.address() as AddressInfo).port;
      await writeFile(
        join(temp.dir, 'config.json'),
        JSON.stringify(testConfig({ obd: { transport: 'simulator' }, server: { mdns: false } })),
      );
      const run = launch([
        '--data-dir',
        temp.dir,
        '--port',
        String(port),
        '--host',
        '127.0.0.1',
        '--backlight',
        'off',
      ]);
      expect(await run.exited).toBe(1);
      const errors = run
        .output()
        .split('\n')
        .filter((line) => line.includes('ERROR'));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/Fatal: Cannot listen on 127\.0\.0\.1:\d+: .*EADDRINUSE/);
      expect(errors[0]).toMatch(new RegExp(`port ${port} is already in use`));
      // No stack frames.
      expect(run.output()).not.toMatch(/:\d+:\d+\)|app\.ts:\d+/);
    } finally {
      blocker.close();
      await temp.cleanup();
    }
  }, 20_000);

  it('exits with 1 when it cannot start', async () => {
    const temp = await makeTempDir();
    try {
      // The data directory path is a file: nothing can be stored there.
      const blocker = join(temp.dir, 'file');
      await writeFile(blocker, 'x');
      const run = launch([
        '--data-dir',
        join(blocker, 'data'),
        '--port',
        '0',
        '--host',
        '127.0.0.1',
      ]);
      expect(await run.exited).toBe(1);
      expect(run.output()).toMatch(/ERROR Fatal:/);
    } finally {
      await temp.cleanup();
    }
  }, 20_000);
});
