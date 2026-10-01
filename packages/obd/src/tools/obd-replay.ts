#!/usr/bin/env node
/**
 * `npm run obd-replay -- <transcript.jsonl> [options]`: replay a recorded OBD-II adapter session
 * (`obd.recordTranscript` / `--record` on the HUD) through the real driver, poller and service,
 * and print what the HUD would have received. See docs/development.md, "Field testing".
 */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { HudEvent } from '@carheadsup/core';
import { describeEvent, replayTranscript } from '../replay.ts';
import { parseTranscript } from '../transcript.ts';

const USAGE = `Usage: npm run obd-replay -- <transcript.jsonl> [options]

Replay a recorded OBD-II adapter session (<data dir>/obd-transcripts/obd-*.jsonl) through the
HUD's ELM327 driver and poller, and print the events the HUD would have received.

Options:
  --protocol <p>     obd.protocol the HUD ran with (default "0", automatic)
  --timeout <ms>     obd.timeoutMs (default 1000)
  --json             Print the events as JSON Lines instead of text
  --out <file>       Also write the events as JSON Lines to <file>
  --expect <file>    Compare with events written earlier by --out; exit 1 when they differ
  --debug            Print the driver's debug log (the commands and answers) to stderr
  -h, --help         Show this help
`;

const jsonLines = (events: readonly HudEvent[]): string =>
  events.map((event) => `${JSON.stringify(event)}\n`).join('');

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        protocol: { type: 'string' },
        timeout: { type: 'string' },
        json: { type: 'boolean' },
        out: { type: 'string' },
        expect: { type: 'string' },
        debug: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const file = positionals[0];
  if (file === undefined || positionals.length > 1) {
    process.stderr.write(USAGE);
    return 2;
  }
  const timeoutMs = values.timeout === undefined ? undefined : Number(values.timeout);
  if (timeoutMs !== undefined && !(Number.isInteger(timeoutMs) && timeoutMs >= 50)) {
    process.stderr.write('--timeout: expected a number of milliseconds (50 or more)\n');
    return 2;
  }

  const transcript = parseTranscript(await readFile(file, 'utf8'));
  const debug = (...args: unknown[]): void => {
    process.stderr.write(`${args.map(String).join(' ')}\n`);
  };
  const quiet = (): void => undefined;
  const result = await replayTranscript(transcript, {
    obd: {
      ...(values.protocol !== undefined ? { protocol: values.protocol } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    },
    logger: values.debug
      ? { debug, info: debug, warn: debug, error: debug }
      : { debug: quiet, info: quiet, warn: quiet, error: quiet },
  });

  const started = new Date(transcript.header.startedAt).toISOString();
  process.stderr.write(
    `Replayed ${transcript.entries.length} entries of ${transcript.header.transport}, recorded ${started}` +
      `${transcript.header.part !== undefined ? ` (part ${transcript.header.part})` : ''}\n`,
  );
  process.stdout.write(
    values.json ? jsonLines(result.events) : `${result.events.map(describeEvent).join('\n')}\n`,
  );
  const { answered, repeated, unknown, unknownCommands } = result.stats;
  process.stderr.write(
    `${answered} commands answered from the transcript, ${repeated} with an answer used before, ` +
      `${unknown} unknown${unknownCommands.length > 0 ? ` (${unknownCommands.slice(0, 10).join(', ')})` : ''}\n`,
  );
  if (values.out !== undefined) await writeFile(values.out, jsonLines(result.events));
  if (values.expect !== undefined) {
    const expected = (await readFile(values.expect, 'utf8')).split('\n').filter((l) => l !== '');
    const actual = jsonLines(result.events)
      .split('\n')
      .filter((l) => l !== '');
    const index = expected.findIndex((line, i) => line !== actual[i]);
    const first = index === -1 && expected.length !== actual.length ? expected.length : index;
    if (first !== -1) {
      process.stderr.write(
        `Differs from ${values.expect} at event ${first + 1}:\n` +
          `  expected ${expected[first] ?? '(nothing)'}\n  got      ${actual[first] ?? '(nothing)'}\n`,
      );
      return 1;
    }
    process.stderr.write(`Same events as ${values.expect}\n`);
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`obd-replay: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
