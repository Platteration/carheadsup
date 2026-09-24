import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isAuthId } from '@carheadsup/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadHudId } from '../../src/store/hud-id.ts';
import { MemoryLogger, makeTempDir } from '../helpers.ts';

let dir: string;
let cleanup: () => Promise<void>;
let logger: MemoryLogger;

beforeEach(async () => {
  ({ dir, cleanup } = await makeTempDir());
  logger = new MemoryLogger();
});

afterEach(async () => {
  await cleanup();
});

const ID = 'AAECAwQFBgcICQoLDA0ODw';

describe('loadHudId', () => {
  it('creates an id on first start and keeps it', async () => {
    const path = join(dir, 'hud-id');
    const first = await loadHudId(path, logger);
    expect(isAuthId(first)).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(`${first}\n`);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await loadHudId(path, logger)).toBe(first);
    expect(logger.text('warn')).toBe('');
    expect(logger.text('error')).toBe('');
  });

  it('reads an existing id, with or without a line break', async () => {
    const path = join(dir, 'hud-id');
    await writeFile(path, ID);
    expect(await loadHudId(path, logger)).toBe(ID);
    await writeFile(path, `  ${ID}\r\n`);
    expect(await loadHudId(path, logger)).toBe(ID);
  });

  it('replaces a corrupt id, keeps the old file aside and says what that means', async () => {
    const path = join(dir, 'hud-id');
    await writeFile(path, 'not an id|');
    const id = await loadHudId(path, logger, () => ID);
    expect(id).toBe(ID);
    expect(await readFile(path, 'utf8')).toBe(`${ID}\n`);
    expect(await readFile(`${path}.corrupt`, 'utf8')).toBe('not an id|');
    expect(logger.text('warn')).toMatch(/corrupt.*different HUD/s);
  });

  it('uses a temporary id, without overwriting, when the file cannot be read', async () => {
    const path = join(dir, 'hud-id');
    await mkdir(path); // EISDIR on read
    const id = await loadHudId(path, logger, () => ID);
    expect(id).toBe(ID);
    expect((await stat(path)).isDirectory()).toBe(true);
    expect(logger.text('error')).toMatch(/cannot read .*temporary id/);
  });

  it('still starts when the id cannot be saved', async () => {
    const path = join(dir, 'missing', 'hud-id');
    expect(await loadHudId(path, logger, () => ID)).toBe(ID);
    expect(logger.text('error')).toMatch(/cannot save/);
  });
});
