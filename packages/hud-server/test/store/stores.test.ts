import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  EMPTY_PERSISTED_STATE,
  GENERATED_TOKEN_ALPHABET,
  parseConfig,
  tripsToCsv,
} from '@carheadsup/core';
import type { PersistedState, TripRecord } from '@carheadsup/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SerialQueue, readJsonFile, writeFileAtomic } from '../../src/store/atomic.ts';
import {
  ConfigStore,
  ConfigUnavailableError,
  generatePairingToken,
  serializeConfig,
} from '../../src/store/config-store.ts';
import { PersistStore, parsePersistedState } from '../../src/store/persist-store.ts';
import { TripLogUnavailableError, TripStore, isTripRecord } from '../../src/store/trip-store.ts';
import { MemoryLogger, makeTempDir } from '../helpers.ts';

/** A generated token: 24 characters of the settings app's alphabet. */
const TOKEN_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]{24}$/;

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

function trip(n: number, overrides: Partial<TripRecord> = {}): TripRecord {
  const startedAt = 1_790_000_000_000 + n * 3_600_000;
  return {
    id: `trip-${n}`,
    startedAt,
    endedAt: startedAt + 1_200_000,
    distanceKm: 10 + n,
    durationS: 1200,
    movingS: 1000,
    idleS: 200,
    fuelUsedL: 0.8,
    avgLPer100km: 7.2,
    maxSpeedKph: 90,
    avgMovingSpeedKph: 36,
    cost: 1.44,
    currency: 'EUR',
    startOdometerKm: 1000 + n * 20,
    endOdometerKm: 1010 + n * 20,
    ...overrides,
  };
}

describe('writeFileAtomic', () => {
  it('replaces the file, leaves no temp files and keeps the old one as backup', async () => {
    const path = join(dir, 'x.json');
    await writeFileAtomic(path, 'one');
    await writeFileAtomic(path, 'two', { backupPath: `${path}.bak` });
    expect(await readFile(path, 'utf8')).toBe('two');
    expect(await readFile(`${path}.bak`, 'utf8')).toBe('one');
    expect((await readdir(dir)).sort()).toEqual(['x.json', 'x.json.bak']);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('removes its temp file and keeps the target when the final rename fails', async () => {
    const target = join(dir, 'target');
    await mkdir(join(target, 'child'), { recursive: true });
    await expect(writeFileAtomic(target, 'x')).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['target']);
    expect(await readdir(target)).toEqual(['child']);
  });

  it('rejects when the directory does not exist', async () => {
    await expect(writeFileAtomic(join(dir, 'missing-dir', 'f'), 'x')).rejects.toThrow();
  });

  it('serialises queued tasks and survives failures', async () => {
    const queue = new SerialQueue();
    const order: number[] = [];
    const first = queue.run(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    const failing = queue.run(async () => {
      order.push(2);
      throw new Error('nope');
    });
    const third = queue.run(async () => {
      order.push(3);
      return 'ok';
    });
    await first;
    await expect(failing).rejects.toThrow('nope');
    expect(await third).toBe('ok');
    expect(order).toEqual([1, 2, 3]);
  });

  it('reports missing and invalid JSON files without throwing', async () => {
    expect(await readJsonFile(join(dir, 'none.json'))).toEqual({ kind: 'missing' });
    await writeFile(join(dir, 'bad.json'), '{ nope');
    expect(await readJsonFile(join(dir, 'bad.json'))).toMatchObject({ kind: 'invalid' });
  });
});

describe('ConfigStore', () => {
  it('creates the file from the defaults when missing, with a random pairing token', async () => {
    const store = new ConfigStore(join(dir, 'config.json'), logger);
    const result = await store.load();
    expect(result.created).toBe(true);
    expect(result.errors).toEqual([]);
    const defaults = parseConfig(DEFAULT_CONFIG).config;
    const token = result.config.phone.pairingToken;
    expect(token).toMatch(TOKEN_PATTERN);
    expect(result.config).toEqual({
      ...defaults,
      phone: { ...defaults.phone, pairingToken: token },
    });
    expect(await readFile(join(dir, 'config.json'), 'utf8')).toBe(serializeConfig(result.config));
    expect(logger.text('info')).toMatch(/random pairing code/);
    // The defaults themselves stay open: only a new file gets a token.
    expect(DEFAULT_CONFIG.phone.pairingToken).toBe('');
    // Another new HUD gets another token; the file keeps its own across restarts.
    const other = await new ConfigStore(join(dir, 'other.json'), logger).load();
    expect(other.config.phone.pairingToken).toMatch(TOKEN_PATTERN);
    expect(other.config.phone.pairingToken).not.toBe(token);
    expect((await store.load()).config.phone.pairingToken).toBe(token);
  });

  it('leaves an existing config without a pairing token open', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, serializeConfig(parseConfig(DEFAULT_CONFIG).config));
    const result = await new ConfigStore(path, logger).load();
    expect(result.created).toBe(false);
    expect(result.config.phone.pairingToken).toBe('');
    expect(await readFile(path, 'utf8')).toBe(serializeConfig(parseConfig(DEFAULT_CONFIG).config));
  });

  it('makes pairing tokens of 24 letters and digits without look-alikes', () => {
    const tokens = Array.from({ length: 200 }, () => generatePairingToken());
    for (const token of tokens) expect(token).toMatch(TOKEN_PATTERN);
    expect(new Set(tokens).size).toBe(tokens.length);
    const used = new Set(tokens.join(''));
    // Every character of the alphabet turns up (200 × 24 draws from 56), and nothing else.
    expect([...used].sort().join('')).toBe([...GENERATED_TOKEN_ALPHABET].sort().join(''));
    // Valid for the config schema (and the settings app's token rules).
    const { errors } = parseConfig({ phone: { pairingToken: tokens[0] } });
    expect(errors).toEqual([]);
  });

  it('loads a valid file without rewriting it', async () => {
    const config = parseConfig(DEFAULT_CONFIG).config;
    config.vehicle.name = 'Golf';
    const path = join(dir, 'config.json');
    await writeFile(path, serializeConfig(config));
    const before = await stat(path);
    const result = await new ConfigStore(path, logger).load();
    expect(result.config.vehicle.name).toBe('Golf');
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
    expect(await readdir(dir)).toEqual(['config.json']);
  });

  it('repairs invalid fields, logs them and keeps the original as .bak', async () => {
    const path = join(dir, 'config.json');
    const original = JSON.stringify({
      vehicle: { name: 'Mine', redlineRpm: 'fast' },
      server: { frameRate: 500 },
    });
    await writeFile(path, original);
    const result = await new ConfigStore(path, logger).load();
    expect(result.config.vehicle.name).toBe('Mine');
    expect(result.config.vehicle.redlineRpm).toBe(DEFAULT_CONFIG.vehicle.redlineRpm);
    expect(result.config.server.frameRate).toBe(DEFAULT_CONFIG.server.frameRate);
    expect(result.errors.join('\n')).toMatch(/vehicle\.redlineRpm/);
    expect(result.errors.join('\n')).toMatch(/server\.frameRate/);
    expect(logger.text('warn')).toMatch(/vehicle\.redlineRpm/);
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(original);
    expect(await readFile(path, 'utf8')).toBe(serializeConfig(result.config));
  });

  it('runs locked with the defaults on unparseable JSON, never touching the file', async () => {
    const path = join(dir, 'config.json');
    const broken = '{ "server": { "apiToken": "s3cret" }, "vehicle": ';
    await writeFile(path, broken);
    const store = new ConfigStore(path, logger);
    const result = await store.load();
    const defaults = parseConfig(DEFAULT_CONFIG).config;
    expect({ ...result.config, server: defaults.server, phone: defaults.phone }).toEqual(defaults);
    // Fail closed: its tokens are unknown, so they are random rather than "none" (open).
    expect(result.config.server.apiToken).toMatch(/^[\w-]{32}$/);
    expect(result.config.phone.pairingToken).toMatch(/^[\w-]{32}$/);
    expect(result.config.server.apiToken).not.toBe(result.config.phone.pairingToken);
    expect(result.errors[0]).toMatch(/not valid JSON/);
    expect(logger.text('error')).toMatch(/not valid JSON.*leaving the file as it is/);
    // The hand edit stays where it is, to be fixed; nothing replaces it meanwhile.
    await expect(store.save(defaults)).rejects.toThrow(ConfigUnavailableError);
    expect(await readFile(path, 'utf8')).toBe(broken);
    expect(await readdir(dir)).toEqual(['config.json']);
  });

  it('replaces an unusable token with a random one instead of none', async () => {
    const path = join(dir, 'config.json');
    const config = parseConfig(DEFAULT_CONFIG).config;
    const raw = JSON.parse(serializeConfig(config)) as Record<string, Record<string, unknown>>;
    raw['server']!['apiToken'] = 'pässwort';
    raw['phone']!['pairingToken'] = 'x'.repeat(300);
    await writeFile(path, JSON.stringify(raw));
    const result = await new ConfigStore(path, logger).load();
    expect(result.config.server.apiToken).toMatch(/^[\w-]{32}$/);
    expect(result.config.phone.pairingToken).toMatch(/^[\w-]{32}$/);
    expect(logger.text('error')).toMatch(/server\.apiToken .*random token/);
    expect(logger.text('error')).toMatch(/phone\.pairingToken .*random token/);
    // A valid token is kept as it is.
    raw['server']!['apiToken'] = 'fine token';
    raw['phone']!['pairingToken'] = 'schlüssel';
    await writeFile(path, JSON.stringify(raw));
    const again = await new ConfigStore(path, logger).load();
    expect(again.config.server.apiToken).toBe('fine token');
    expect(again.config.phone.pairingToken).toBe('schlüssel');
  });

  it('keeps a pairing token an older version stored that breaks the rule, and says so', async () => {
    const path = join(dir, 'config.json');
    const config = parseConfig(DEFAULT_CONFIG).config;
    const raw = JSON.parse(serializeConfig(config)) as Record<string, Record<string, unknown>>;
    raw['phone']!['pairingToken'] = 'mein Schlüssel';
    const text = `${JSON.stringify(raw, null, 2)}\n`;
    await writeFile(path, text);
    const result = await new ConfigStore(path, logger).load();
    // Not reset, not locked: phones paired with it prove exactly this token.
    expect(result.config.phone.pairingToken).toBe('mein Schlüssel');
    expect(result.keptPairingToken).toBe(true);
    expect(result.errors).toEqual([]);
    expect(logger.text('error')).toBe('');
    expect(logger.text('warn')).toMatch(
      /phone\.pairingToken in .* breaks the pairing-code rule \(no spaces: .*\); older versions allowed such codes\. It is kept as it is/,
    );
    // Nothing to correct: the file stays as it is.
    expect(await readFile(path, 'utf8')).toBe(text);
    expect(await readdir(dir)).toEqual(['config.json']);
    // A token that keeps the rule is not reported.
    const fresh = await new ConfigStore(join(dir, 'other.json'), new MemoryLogger()).load();
    expect(fresh.keptPairingToken).toBeFalsy();
  });

  it('keeps such a token typed into the file by hand alike, without blaming an older version', async () => {
    // A file this version wrote, with a code that keeps the rule …
    const path = join(dir, 'config.json');
    const first = await new ConfigStore(path, logger).load();
    expect(first.keptPairingToken).toBeFalsy();
    // … edited by hand after the upgrade: the file cannot tell it from an old one.
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, Record<string, unknown>>;
    raw['phone']!['pairingToken'] = 'my new phrase';
    await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`);
    const handEdited = new MemoryLogger();
    const result = await new ConfigStore(path, handEdited).load();
    expect(result.config.phone.pairingToken).toBe('my new phrase');
    expect(result.keptPairingToken).toBe(true);
    expect(result.errors).toEqual([]);
    const warning = handEdited.text('warn');
    expect(warning).not.toMatch(/saved by an older version/);
    expect(warning).toMatch(/breaks the pairing-code rule \(no spaces: /);
    // It says what this means and what to do.
    expect(warning).toMatch(/no phone can pair with it anew/);
    expect(warning).toMatch(/Generate a new pairing code in the settings app/);
  });

  it('saves atomically', async () => {
    const path = join(dir, 'config.json');
    const store = new ConfigStore(path, logger);
    const { config } = await store.load();
    config.units.system = 'imperial';
    await store.save(config);
    const reread = await new ConfigStore(path, logger).load();
    expect(reread.config.units.system).toBe('imperial');
  });

  it('uses the defaults but never overwrites a file it cannot read', async () => {
    const path = join(dir, 'config.json');
    await mkdir(join(path, 'keep'), { recursive: true }); // EISDIR, like EACCES or EIO
    const store = new ConfigStore(path, logger);
    const result = await store.load();
    expect(result.config.vehicle).toEqual(parseConfig(DEFAULT_CONFIG).config.vehicle);
    expect(result.config.server.apiToken).not.toBe(''); // locked, not open
    expect(logger.text('error')).toMatch(/cannot read/);
    await expect(store.save(result.config)).rejects.toThrow(/could not be loaded/);
    expect(await readdir(path)).toEqual(['keep']);
  });

  it('keeps running with defaults when the file cannot be created', async () => {
    const store = new ConfigStore(join(dir, 'no', 'such', 'dir', 'config.json'), logger);
    const result = await store.load();
    expect(result.created).toBe(true);
    expect(logger.text('warn')).toMatch(/cannot create/);
  });
});

describe('PersistStore', () => {
  const sample: PersistedState = {
    odometerKm: 48213.4,
    learnedGearRatios: [110, 60, 40],
    avgLPer100km: 6.8,
    maintenanceRecords: [{ itemId: 'oil', odometerKm: 45000, at: 1_780_000_000_000 }],
  };

  it('round-trips the state and keeps the previous file as backup', async () => {
    const store = new PersistStore(join(dir, 'state.json'), logger);
    expect(await store.load()).toEqual(EMPTY_PERSISTED_STATE);
    await store.save(sample);
    await store.save({ ...sample, odometerKm: 48300 });
    expect(await store.load()).toEqual({ ...sample, odometerKm: 48300 });
    const backup = JSON.parse(
      await readFile(join(dir, 'state.json.bak'), 'utf8'),
    ) as PersistedState;
    expect(backup.odometerKm).toBe(48213.4);
  });

  it('keeps the trip in progress as it is (the core validates it on restore)', async () => {
    const store = new PersistStore(join(dir, 'state.json'), logger);
    const activeTrip = { startedAt: 1, lastActivityAt: 2, distanceKm: 3 };
    await store.save({ ...sample, activeTrip });
    expect(await store.load()).toEqual({ ...sample, activeTrip });
    await store.save({ ...sample, activeTrip: null });
    expect(await store.load()).toEqual(sample);
    expect(parsePersistedState({ activeTrip: 'nonsense' })?.state).not.toHaveProperty('activeTrip');
  });

  it('round-trips the gear-numbering anchor and drops an invalid one', async () => {
    const store = new PersistStore(join(dir, 'state.json'), logger);
    const gearAnchor = { transmission: 'automatic' as const, secondGearRpmPerKph: 71.4 };
    await store.save({ ...sample, gearAnchor });
    expect(await store.load()).toEqual({ ...sample, gearAnchor });
    expect(parsePersistedState({ gearAnchor: null })?.errors).toEqual([]);
    expect(
      parsePersistedState({ gearAnchor: { transmission: 'automatic', secondGearRpmPerKph: 0 } }),
    ).toEqual({ state: EMPTY_PERSISTED_STATE, errors: ['gearAnchor: invalid'] });
  });

  it('round-trips the odometer calibration and repairs a damaged one', async () => {
    const store = new PersistStore(join(dir, 'state.json'), logger);
    const odometerCalibration = { confirmedKm: 48_000, rawKmSince: 213.4, scale: 1.015 };
    await store.save({ ...sample, odometerCalibration });
    expect(await store.load()).toEqual({ ...sample, odometerCalibration });
    expect(
      parsePersistedState({ odometerCalibration: { confirmedKm: 'x', rawKmSince: 5, scale: 9 } })
        ?.state.odometerCalibration,
    ).toEqual({ confirmedKm: null, rawKmSince: 5, scale: 1 });
    expect(parsePersistedState({ odometerCalibration: 7 })?.errors).toEqual([
      'odometerCalibration: invalid',
    ]);
    expect(parsePersistedState({ odometerCalibration: null })?.errors).toEqual([]);
  });

  it('round-trips the phone’s last location and drops an invalid one', async () => {
    const store = new PersistStore(join(dir, 'state.json'), logger);
    const lastLocation = { lat: 52.5, lon: 13.4 };
    await store.save({ ...sample, lastLocation });
    expect(await store.load()).toEqual({ ...sample, lastLocation });
    expect(parsePersistedState({ lastLocation: null })?.errors).toEqual([]);
    expect(parsePersistedState({ lastLocation: { lat: 91, lon: 0 } })).toEqual({
      state: EMPTY_PERSISTED_STATE,
      errors: ['lastLocation: invalid'],
    });
    expect(parsePersistedState({ lastLocation: 'Berlin' })?.errors).toEqual([
      'lastLocation: invalid',
    ]);
  });

  it('recovers from a corrupt file via the backup and moves the corrupt one aside', async () => {
    const store = new PersistStore(join(dir, 'state.json'), logger);
    await store.save(sample);
    await store.save({ ...sample, odometerKm: 48300 });
    await writeFile(join(dir, 'state.json'), '{"odometerKm": 483'); // torn write
    expect(await store.load()).toEqual(sample);
    expect(await readFile(join(dir, 'state.json.corrupt'), 'utf8')).toBe('{"odometerKm": 483');
    expect(logger.text('warn')).toMatch(/corrupt/);
  });

  it('uses the backup when the main file is missing (power cut between renames)', async () => {
    await writeFile(join(dir, 'state.json.bak'), JSON.stringify(sample));
    expect(await new PersistStore(join(dir, 'state.json'), logger).load()).toEqual(sample);
  });

  it('falls back to the empty state when both copies are unusable', async () => {
    await writeFile(join(dir, 'state.json'), '[]');
    await writeFile(join(dir, 'state.json.bak'), 'garbage');
    const state = await new PersistStore(join(dir, 'state.json'), logger).load();
    expect(state).toEqual(EMPTY_PERSISTED_STATE);
    expect(logger.text('warn')).toMatch(/empty state/);
  });

  it('repairs invalid fields individually', () => {
    expect(
      parsePersistedState({
        odometerKm: -5,
        learnedGearRatios: [100, 'x'],
        avgLPer100km: 7,
        maintenanceRecords: [
          { itemId: 'oil', odometerKm: 100, at: 5 },
          { itemId: '', at: 5 },
          { itemId: 'tyres', at: 'yesterday' },
          { itemId: 'brakes', at: 7 },
        ],
      }),
    ).toEqual({
      state: {
        odometerKm: null,
        learnedGearRatios: null,
        avgLPer100km: 7,
        maintenanceRecords: [
          { itemId: 'oil', odometerKm: 100, at: 5 },
          { itemId: 'brakes', odometerKm: null, at: 7 },
        ],
      },
      errors: [
        'odometerKm: invalid',
        'learnedGearRatios: invalid',
        'maintenanceRecords[1]: invalid',
        'maintenanceRecords[2]: invalid',
      ],
    });
    expect(parsePersistedState('nope')).toBeNull();
    expect(parsePersistedState({})).toEqual({ state: EMPTY_PERSISTED_STATE, errors: [] });
  });

  it('round-trips the trip sequence number and the wall time of the write', async () => {
    const store = new PersistStore(join(dir, 'state.json'), logger);
    await store.save({ ...sample, tripSeq: 42, lastWallMs: 1_790_000_000_000 });
    expect(await store.load()).toEqual({ ...sample, tripSeq: 42, lastWallMs: 1_790_000_000_000 });
    expect(parsePersistedState({ tripSeq: 0, lastWallMs: null })).toEqual({
      state: { ...EMPTY_PERSISTED_STATE, tripSeq: 0 },
      errors: [],
    });
    expect(parsePersistedState({ tripSeq: 1.5, lastWallMs: 'noon' })).toEqual({
      state: EMPTY_PERSISTED_STATE,
      errors: ['tripSeq: invalid', 'lastWallMs: invalid'],
    });
    expect(parsePersistedState({ tripSeq: -1, lastWallMs: 9e15 })?.errors).toEqual([
      'tripSeq: invalid',
      'lastWallMs: invalid',
    ]);
  });
});

describe('TripStore', () => {
  async function store(maxTrips?: number): Promise<TripStore> {
    const s = new TripStore({
      path: join(dir, 'trips.jsonl'),
      logger,
      ...(maxTrips !== undefined ? { maxTrips } : {}),
    });
    await s.load();
    return s;
  }

  it('appends, lists newest first and pages with before', async () => {
    const s = await store();
    for (const n of [3, 1, 4, 2, 5]) await s.append(trip(n));
    expect(s.list({ limit: 50 }).map((t) => t.id)).toEqual([
      'trip-5',
      'trip-4',
      'trip-3',
      'trip-2',
      'trip-1',
    ]);
    const page1 = s.list({ limit: 2 });
    expect(page1.map((t) => t.id)).toEqual(['trip-5', 'trip-4']);
    const page2 = s.list({ limit: 2, before: page1.at(-1)?.startedAt ?? 0 });
    expect(page2.map((t) => t.id)).toEqual(['trip-3', 'trip-2']);
    expect(s.list({ limit: 0 })).toEqual([]);

    const reloaded = await store();
    expect(reloaded.size).toBe(5);
    expect(reloaded.list({ limit: 1 })[0]).toEqual(trip(5));
  });

  it('writes one JSON line per trip', async () => {
    const s = await store();
    await s.append(trip(1));
    await s.append(trip(2));
    const lines = (await readFile(join(dir, 'trips.jsonl'), 'utf8')).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('');
    expect(JSON.parse(lines[0] ?? '')).toEqual(trip(1));
  });

  it('returns trips that ended after a time (phone sync)', async () => {
    const s = await store();
    for (const n of [1, 2, 3]) await s.append(trip(n));
    const since = trip(2).endedAt;
    expect(s.endedAfter(since - 1, 100).map((t) => t.id)).toEqual(['trip-3', 'trip-2']);
    expect(s.endedAfter(since, 100).map((t) => t.id)).toEqual(['trip-3']);
    expect(s.endedAfter(0, 1).map((t) => t.id)).toEqual(['trip-3']);
  });

  it('gives a phone what it is missing by sequence number, and older trips by end time', async () => {
    const s = await store();
    // Two trips from before sequence numbers, then three numbered ones recorded with a clock
    // that went back: their end times say nothing about their order.
    await s.append(trip(1));
    await s.append(trip(2));
    for (const [n, seq] of [
      [3, 1],
      [4, 2],
      [5, 3],
    ] as const) {
      await s.append(trip(n, { seq, startedAt: trip(1).startedAt, endedAt: trip(6 - n).endedAt }));
    }
    expect(s.maxSeq).toBe(3);
    // An older app: by end time, newest first, as before.
    expect(s.missedBy({ since: trip(1).endedAt }, 100).map((t) => t.id)).toEqual(
      s.endedAfter(trip(1).endedAt, 100).map((t) => t.id),
    );
    // A phone that has trip 1 and the first numbered one: the rest, oldest first.
    expect(s.missedBy({ since: trip(1).endedAt, sinceSeq: 1 }, 100).map((t) => t.id)).toEqual([
      'trip-2',
      'trip-4',
      'trip-5',
    ]);
    expect(s.missedBy({ since: 0, sinceSeq: 0 }, 2).map((t) => t.id)).toEqual(['trip-1', 'trip-2']);
    expect(s.missedBy({ since: 1e15, sinceSeq: 3 }, 100)).toEqual([]);
    expect((await store()).get('trip-5')?.seq).toBe(3);
  });

  it('keeps a sequence number only when it is a positive whole number', () => {
    expect(isTripRecord(trip(1, { seq: 7 }))).toBe(true);
    for (const seq of [0, -1, 1.5, Number.NaN, '7']) {
      expect(isTripRecord({ ...trip(1), seq })).toBe(false);
    }
  });

  it('deletes by id with an atomic rewrite', async () => {
    const s = await store();
    for (const n of [1, 2, 3]) await s.append(trip(n));
    expect(await s.delete('trip-2')).toBe(true);
    expect(await s.delete('trip-2')).toBe(false);
    expect(await s.delete('nope')).toBe(false);
    expect((await store()).list({ limit: 10 }).map((t) => t.id)).toEqual(['trip-3', 'trip-1']);
  });

  it('skips torn and invalid lines and starts the next append on a new line', async () => {
    const good = JSON.stringify(trip(1));
    await writeFile(
      join(dir, 'trips.jsonl'),
      `${good}\nnot json\n${JSON.stringify({ id: 'x' })}\n${JSON.stringify(trip(2)).slice(0, 40)}`,
    );
    const s = await store();
    expect(s.list({ limit: 10 }).map((t) => t.id)).toEqual(['trip-1']);
    expect(logger.text('warn')).toMatch(/skipped 3 unreadable/);
    await s.append(trip(3));
    const reloaded = await store();
    expect(reloaded.list({ limit: 10 }).map((t) => t.id)).toEqual(['trip-3', 'trip-1']);
  });

  it('replaces a trip appended twice', async () => {
    const s = await store();
    await s.append(trip(1));
    await s.append(trip(1, { distanceKm: 99 }));
    expect(s.size).toBe(1);
    expect((await store()).get('trip-1')?.distanceKm).toBe(99);
  });

  it('enforces the retention cap by dropping the oldest trips', async () => {
    const s = await store(3);
    for (const n of [1, 2, 3, 4, 5]) await s.append(trip(n));
    expect(s.list({ limit: 10 }).map((t) => t.id)).toEqual(['trip-5', 'trip-4', 'trip-3']);
    const reloaded = await store(3);
    expect(reloaded.list({ limit: 10 }).map((t) => t.id)).toEqual(['trip-5', 'trip-4', 'trip-3']);
    // An over-full file (e.g. after lowering the cap) is trimmed on load.
    const smaller = await store(2);
    expect(smaller.size).toBe(2);
  });

  it('rejects malformed trips and strips unknown fields', async () => {
    const s = await store();
    await expect(s.append({ id: 'x' } as unknown as TripRecord)).rejects.toThrow(
      'Not a valid trip',
    );
    await s.append({ ...trip(1), extra: 'field' } as TripRecord);
    expect(Object.keys(s.get('trip-1') ?? {})).not.toContain('extra');
    expect(isTripRecord(trip(1))).toBe(true);
    expect(isTripRecord({ ...trip(1), fuelUsedL: 'x' })).toBe(false);
    expect(isTripRecord({ ...trip(1), startedAt: Number.NaN })).toBe(false);
  });

  it('exports CSV oldest first using the core formatter', async () => {
    const s = await store();
    for (const n of [2, 1]) await s.append(trip(n));
    expect(s.csv()).toBe(tripsToCsv([trip(1), trip(2)]));
  });

  it('starts empty when the file cannot be read, and refuses to rewrite it', async () => {
    const path = join(dir, 'trips.jsonl');
    await mkdir(join(path, 'keep'), { recursive: true }); // EISDIR, like EACCES or EIO
    const s = new TripStore({ path, logger, maxTrips: 1 });
    await s.load();
    expect(s.size).toBe(0);
    expect(logger.text('error')).toMatch(/cannot read/);
    await expect(s.delete('trip-1')).rejects.toBeInstanceOf(TripLogUnavailableError);
    // New trips are kept in memory; the appends fail here (a directory) but never rewrite.
    await expect(s.append(trip(1))).rejects.toThrow();
    await expect(s.append(trip(2))).rejects.toThrow();
    expect(s.list({ limit: 10 }).map((t) => t.id)).toEqual(['trip-2']);
    expect(await readdir(path)).toEqual(['keep']);
  });

  it('loads an empty store when the file is missing', async () => {
    const s = await store();
    expect(s.size).toBe(0);
    expect(s.csv()).toBe(tripsToCsv([]));
  });
});
