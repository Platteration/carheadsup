import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileAtomic } from '../../src/store/atomic.ts';
import { ConfigStore } from '../../src/store/config-store.ts';
import { MemoryLogger, makeTempDir } from '../helpers.ts';

/**
 * A power cut (or an I/O error) right before a temporary file is renamed into place, emulated
 * by failing that rename.
 */
const cut = vi.hoisted(() => ({ target: null as string | null }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string): Promise<void> => {
      if (cut.target !== null && to === cut.target && from.endsWith('.tmp')) {
        throw Object.assign(new Error('EIO: power cut'), { code: 'EIO' });
      }
      await actual.rename(from, to);
    },
  };
});

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await makeTempDir());
});

afterEach(async () => {
  cut.target = null;
  await cleanup();
});

describe('writeFileAtomic with a backup', () => {
  it('never lets the file disappear while replacing it', async () => {
    const path = join(dir, 'state.json');
    await writeFile(path, 'one');
    await writeFileAtomic(path, 'two', { backupPath: `${path}.bak` });
    cut.target = path;
    await expect(writeFileAtomic(path, 'three', { backupPath: `${path}.bak` })).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe('two');
    expect(await readFile(`${path}.bak`, 'utf8')).toBe('two');
    expect((await readdir(dir)).sort()).toEqual(['state.json', 'state.json.bak']);
    cut.target = null;
    await writeFileAtomic(path, 'four', { backupPath: `${path}.bak` });
    expect(await readFile(path, 'utf8')).toBe('four');
    expect(await readFile(`${path}.bak`, 'utf8')).toBe('two');
  });
});

describe('ConfigStore', () => {
  it('keeps the settings when the normalising rewrite at start-up is cut short', async () => {
    const path = join(dir, 'config.json');
    // A hand-edited file (valid, but not in normalised form): rewritten, with a backup, on load.
    await writeFile(path, JSON.stringify({ vehicle: { name: 'Golf' } }));
    cut.target = path;
    const first = await new ConfigStore(path, new MemoryLogger()).load();
    expect(first.config.vehicle.name).toBe('Golf');
    cut.target = null;
    // Next boot: the user's settings are still there (not "created with default settings").
    const logger = new MemoryLogger();
    const second = await new ConfigStore(path, logger).load();
    expect(second.created).toBe(false);
    expect(second.config.vehicle.name).toBe('Golf');
    expect(logger.text()).not.toMatch(/default settings/);
  });
});
