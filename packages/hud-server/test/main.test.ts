import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
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

function launch(args: string[], env: Record<string, string> = {}): Run {
  const child = spawn(process.execPath, [MAIN, ...args], {
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
    } finally {
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
