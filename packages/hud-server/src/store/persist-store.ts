import { rename } from 'node:fs/promises';
import { EMPTY_PERSISTED_STATE, parseGearAnchor } from '@carheadsup/core';
import type { MaintenanceRecord, PersistedState, PersistedStateWithTrip } from '@carheadsup/core';
import type { Logger } from '@carheadsup/obd';
import { SerialQueue, isNotFound, readJsonFile, writeFileAtomic } from './atomic.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Largest odometer / consumption values accepted from disk (anything beyond is corruption). */
const MAX_ODOMETER_KM = 10_000_000;
const MAX_L_PER_100KM = 1000;
const MAX_GEARS = 12;

/**
 * Validate data read from `state.json` field by field. Returns null when it is not a JSON object
 * at all (treated as corruption); otherwise invalid fields fall back to their empty values and
 * are listed in `errors`, and invalid maintenance records are dropped individually. The trip in
 * progress (`activeTrip`) is passed on as it is when present; the core validates it on restore.
 */
export function parsePersistedState(
  value: unknown,
): { state: PersistedStateWithTrip; errors: string[] } | null {
  if (!isRecord(value)) return null;
  const errors: string[] = [];
  const state: Omit<PersistedState, 'activeTrip'> & { activeTrip?: unknown } = {
    odometerKm: null,
    learnedGearRatios: null,
    avgLPer100km: null,
    maintenanceRecords: [],
  };
  if (isRecord(value['activeTrip'])) state.activeTrip = value['activeTrip'];

  const odometer = value['odometerKm'];
  if (finiteNonNegative(odometer) && odometer <= MAX_ODOMETER_KM) state.odometerKm = odometer;
  else if (odometer !== null && odometer !== undefined) errors.push('odometerKm: invalid');

  const ratios = value['learnedGearRatios'];
  if (
    Array.isArray(ratios) &&
    ratios.length > 0 &&
    ratios.length <= MAX_GEARS &&
    ratios.every((r) => typeof r === 'number' && Number.isFinite(r) && r > 0)
  ) {
    state.learnedGearRatios = ratios.map(Number);
  } else if (ratios !== null && ratios !== undefined) {
    errors.push('learnedGearRatios: invalid');
  }

  const anchor = value['gearAnchor'];
  const parsedAnchor = parseGearAnchor(anchor);
  if (parsedAnchor !== null) state.gearAnchor = parsedAnchor;
  else if (anchor !== null && anchor !== undefined) errors.push('gearAnchor: invalid');

  const avg = value['avgLPer100km'];
  if (finiteNonNegative(avg) && avg <= MAX_L_PER_100KM) state.avgLPer100km = avg;
  else if (avg !== null && avg !== undefined) errors.push('avgLPer100km: invalid');

  const records = value['maintenanceRecords'];
  if (Array.isArray(records)) {
    records.forEach((record: unknown, index) => {
      const parsed = parseMaintenanceRecord(record);
      if (parsed) state.maintenanceRecords.push(parsed);
      else errors.push(`maintenanceRecords[${index}]: invalid`);
    });
  } else if (records !== undefined) {
    errors.push('maintenanceRecords: invalid');
  }
  return { state, errors };
}

function parseMaintenanceRecord(value: unknown): MaintenanceRecord | null {
  if (!isRecord(value)) return null;
  const { itemId, odometerKm, at } = value;
  if (typeof itemId !== 'string' || itemId === '' || itemId.length > 256) return null;
  if (!(typeof at === 'number' && Number.isFinite(at))) return null;
  if (odometerKm === null || odometerKm === undefined) return { itemId, odometerKm: null, at };
  if (!finiteNonNegative(odometerKm) || odometerKm > MAX_ODOMETER_KM) return null;
  return { itemId, odometerKm, at };
}

function emptyState(): PersistedState {
  return { ...EMPTY_PERSISTED_STATE, maintenanceRecords: [] };
}

/**
 * `state.json`: the odometer, learned gear ratios and their numbering anchor, long-run
 * consumption, service records (dated on the wall clock) and the trip in progress (with
 * wall-clock times).
 *
 * Every save keeps the previous file as `state.json.bak` before the new one takes its place
 * (both steps atomic, see `writeFileAtomic`), so there is always a complete earlier copy.
 * Loading is corruption tolerant: an unreadable main file is moved aside to
 * `state.json.corrupt` and the backup is used; with neither, the HUD starts from
 * EMPTY_PERSISTED_STATE.
 */
export class PersistStore {
  readonly path: string;
  readonly backupPath: string;
  readonly corruptPath: string;
  private readonly logger: Logger;
  private readonly queue = new SerialQueue();

  constructor(path: string, logger: Logger) {
    this.path = path;
    this.backupPath = `${path}.bak`;
    this.corruptPath = `${path}.corrupt`;
    this.logger = logger;
  }

  async load(): Promise<PersistedStateWithTrip> {
    const main = await this.tryLoad(this.path);
    if (main.kind === 'ok') return main.state;
    if (main.kind === 'corrupt') {
      this.logger.warn(`State: ${this.path} is corrupt (${main.error}); trying the backup`);
      try {
        await rename(this.path, this.corruptPath);
      } catch (err) {
        if (!isNotFound(err)) {
          this.logger.warn(`State: cannot move the corrupt file aside: ${describe(err)}`);
        }
      }
    }
    const backup = await this.tryLoad(this.backupPath);
    if (backup.kind === 'ok') {
      this.logger.warn(`State: restored from ${this.backupPath}`);
      return backup.state;
    }
    if (backup.kind === 'corrupt') {
      this.logger.warn(`State: backup ${this.backupPath} is corrupt too (${backup.error})`);
    }
    if (main.kind === 'corrupt' || backup.kind === 'corrupt') {
      this.logger.warn('State: starting with an empty state (odometer and service records lost)');
    }
    return emptyState();
  }

  /** Atomically write `state` (the previous file becomes the backup). Serialised. */
  save(state: PersistedStateWithTrip): Promise<void> {
    const text = `${JSON.stringify(state, null, 2)}\n`;
    return this.queue.run(() => writeFileAtomic(this.path, text, { backupPath: this.backupPath }));
  }

  private async tryLoad(
    path: string,
  ): Promise<
    | { kind: 'ok'; state: PersistedStateWithTrip }
    | { kind: 'missing' }
    | { kind: 'corrupt'; error: string }
  > {
    let read;
    try {
      read = await readJsonFile(path);
    } catch (err) {
      return { kind: 'corrupt', error: describe(err) };
    }
    if (read.kind === 'missing') return read;
    if (read.kind === 'invalid') return { kind: 'corrupt', error: read.error };
    const parsed = parsePersistedState(read.value);
    if (parsed === null) return { kind: 'corrupt', error: 'not a JSON object' };
    for (const error of parsed.errors) this.logger.warn(`State: ${path}: ${error}; reset`);
    return { kind: 'ok', state: parsed.state };
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
