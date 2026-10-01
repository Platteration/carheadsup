import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ObdService, SILENT_LOGGER, SYSTEM_TIMERS, VehicleSimulator } from '@carheadsup/obd';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObdLink } from '../../src/obd/obd-link.ts';
import { OBD_CACHE_FILE, ObdProtocolFile } from '../../src/obd/protocol-cache.ts';
import { MemoryLogger, makeTempDir, testConfig } from '../helpers.ts';

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

describe('ObdProtocolFile', () => {
  it('starts empty, remembers protocols per link and survives a restart', async () => {
    const path = join(dir, OBD_CACHE_FILE);
    const cache = await ObdProtocolFile.load(path, logger);
    expect(cache.get('serial:/dev/rfcomm0')).toBeNull();
    cache.set('serial:/dev/rfcomm0', '6');
    cache.set('tcp:192.168.0.10:35000', '3');
    await cache.flushed();
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      protocols: { 'serial:/dev/rfcomm0': '6', 'tcp:192.168.0.10:35000': '3' },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const again = await ObdProtocolFile.load(path, logger);
    expect(again.get('serial:/dev/rfcomm0')).toBe('6');
    expect(again.get('tcp:192.168.0.10:35000')).toBe('3');
    expect(logger.text('warn')).toBe('');
  });

  it('writes only when something changed, never "0", and keeps a few links', async () => {
    const path = join(dir, OBD_CACHE_FILE);
    const cache = await ObdProtocolFile.load(path, logger);
    cache.set('simulator', '6');
    await cache.flushed();
    const written = (await stat(path)).mtimeMs;
    cache.set('simulator', '6');
    cache.set('simulator', '0');
    cache.set('simulator', 'garbage');
    await cache.flushed();
    expect((await stat(path)).mtimeMs).toBe(written);
    for (let i = 0; i < 12; i++) cache.set(`serial:/dev/ttyUSB${i}`, '6');
    await cache.flushed();
    const links = Object.keys(JSON.parse(await readFile(path, 'utf8')).protocols);
    expect(links).toHaveLength(8);
    expect(links.at(-1)).toBe('serial:/dev/ttyUSB11');
    expect(links).not.toContain('simulator');
  });

  it('treats a damaged or odd file as empty', async () => {
    const path = join(dir, OBD_CACHE_FILE);
    await writeFile(path, '{"protocols": ');
    expect((await ObdProtocolFile.load(path, logger)).get('simulator')).toBeNull();
    expect(logger.text('warn')).toContain('ignoring');
    await writeFile(path, JSON.stringify({ protocols: { a: '6', b: 'Z', c: 7, d: '0' } }));
    const cache = await ObdProtocolFile.load(path, logger);
    expect(['a', 'b', 'c', 'd'].map((link) => cache.get(link))).toEqual(['6', null, null, null]);
  });

  it('logs a failed save instead of throwing', async () => {
    const cache = await ObdProtocolFile.load(join(dir, 'missing', OBD_CACHE_FILE), logger);
    cache.set('simulator', '6');
    await cache.flushed();
    expect(logger.text('warn')).toContain('cannot save');
    expect(cache.get('simulator')).toBe('6');
  });

  it('is filled by the OBD link once the simulated vehicle connects', async () => {
    const path = join(dir, OBD_CACHE_FILE);
    const cache = await ObdProtocolFile.load(path, logger);
    const link = new ObdLink({
      config: testConfig({ obd: { transport: 'simulator' } }),
      simulator: new VehicleSimulator({ mode: 'manual' }),
      deps: { now: Date.now, timers: SYSTEM_TIMERS, logger: SILENT_LOGGER },
      onEvent: () => {},
      protocolCache: cache,
      factory: (config, deps) => new ObdService(config, { ...deps, emulator: { latencyMs: 0 } }),
    });
    link.start();
    for (let i = 0; i < 100 && cache.get('simulator') === null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await link.stop();
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ protocols: { simulator: '6' } });
  });
});
