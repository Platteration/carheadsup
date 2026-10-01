import { tripsToCsv } from '@carheadsup/core';
import type { TripRecord } from '@carheadsup/core';
import type { Logger } from '@carheadsup/obd';
import { SerialQueue, appendFileDurable, readTextFile, writeFileAtomic } from './atomic.ts';

/** Trips kept on disk; the oldest are dropped beyond this. */
export const DEFAULT_MAX_TRIPS = 5000;

/**
 * The trip log could not be read at start-up, so it is not rewritten (a deletion would replace
 * the trips that could not be read with the ones in memory).
 */
export class TripLogUnavailableError extends Error {
  constructor(path: string, reason: string) {
    super(
      `The trip log ${path} could not be read at start-up (${reason}); restart the HUD once it is readable`,
    );
    this.name = 'TripLogUnavailableError';
  }
}

const MAX_ID_LENGTH = 256;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isNullableNumber = (value: unknown): value is number | null =>
  value === null || isFiniteNumber(value);

const REQUIRED_NUMBERS = [
  'startedAt',
  'endedAt',
  'distanceKm',
  'durationS',
  'movingS',
  'idleS',
  'maxSpeedKph',
  'avgMovingSpeedKph',
] as const;
const NULLABLE_NUMBERS = [
  'fuelUsedL',
  'avgLPer100km',
  'cost',
  'startOdometerKm',
  'endOdometerKm',
] as const;

/** Structural check of a trip read from disk (or handed to `append`). */
export function isTripRecord(value: unknown): value is TripRecord {
  if (!isRecord(value)) return false;
  const { id, currency, seq } = value;
  if (typeof id !== 'string' || id === '' || id.length > MAX_ID_LENGTH) return false;
  if (typeof currency !== 'string' || currency.length > 16) return false;
  if (seq !== undefined && !(typeof seq === 'number' && Number.isSafeInteger(seq) && seq > 0)) {
    return false;
  }
  return (
    REQUIRED_NUMBERS.every((key) => isFiniteNumber(value[key])) &&
    NULLABLE_NUMBERS.every((key) => isNullableNumber(value[key]))
  );
}

/** Only the contract's fields, in contract order (drops anything extra read from disk). */
function pickTrip(trip: TripRecord): TripRecord {
  return {
    id: trip.id,
    ...(trip.seq === undefined ? {} : { seq: trip.seq }),
    startedAt: trip.startedAt,
    endedAt: trip.endedAt,
    distanceKm: trip.distanceKm,
    durationS: trip.durationS,
    movingS: trip.movingS,
    idleS: trip.idleS,
    fuelUsedL: trip.fuelUsedL,
    avgLPer100km: trip.avgLPer100km,
    maxSpeedKph: trip.maxSpeedKph,
    avgMovingSpeedKph: trip.avgMovingSpeedKph,
    cost: trip.cost,
    currency: trip.currency,
    startOdometerKm: trip.startOdometerKm,
    endOdometerKm: trip.endOdometerKm,
  };
}

/** Newest first: by start time, then end time, then id (a total, deterministic order). */
function newestFirst(a: TripRecord, b: TripRecord): number {
  return (
    b.startedAt - a.startedAt || b.endedAt - a.endedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

/** Which trips the phone asks for (`trips-request`). */
export interface TripSyncQuery {
  /** Trips that ended after this epoch ms — only those without a sequence number with `sinceSeq`. */
  since: number;
  /** Trips whose sequence number is greater than this (a phone that knows them). */
  sinceSeq?: number;
}

export interface TripListQuery {
  /** Maximum number of trips to return. */
  limit: number;
  /** Only trips that started strictly before this epoch ms. */
  before?: number | null;
}

export interface TripStoreOptions {
  path: string;
  logger: Logger;
  /** Retention cap, default {@link DEFAULT_MAX_TRIPS}. */
  maxTrips?: number;
}

/**
 * Completed trips in `trips.jsonl` (one JSON TripRecord per line, append-only).
 *
 * All trips are held in memory (5 000 trips are ~2 MB), so listing never touches the disk.
 * Appends are fsynced; a line torn by a power cut is skipped on the next load (and the next
 * append starts on a fresh line). Deletions and retention trimming rewrite the file atomically.
 * A trip appended twice (same id) replaces the earlier copy. Disk operations are serialised.
 *
 * The trip log is not essential: when it cannot be read (EACCES, EIO…) the store starts empty
 * and keeps new trips in memory, appending them to the file when possible but never rewriting
 * it, so the unread trips are not lost.
 */
export class TripStore {
  readonly path: string;
  private readonly logger: Logger;
  private readonly maxTrips: number;
  private readonly queue = new SerialQueue();
  private readonly byId = new Map<string, TripRecord>();
  private sorted: TripRecord[] | null = [];
  /** The file does not end with a newline (torn last line), so the next append must add one. */
  private needsNewline = false;
  /** Why the file could not be read at load, or null: then it is never rewritten. */
  private unreadable: string | null = null;

  constructor(options: TripStoreOptions) {
    this.path = options.path;
    this.logger = options.logger;
    this.maxTrips = Math.max(1, Math.floor(options.maxTrips ?? DEFAULT_MAX_TRIPS));
  }

  /**
   * Read the file. Missing file = no trips; invalid lines are skipped and counted in a warning.
   * Never rejects: an unreadable file is logged and leaves the store empty (see the class).
   */
  async load(): Promise<void> {
    this.byId.clear();
    this.sorted = null;
    this.unreadable = null;
    let read;
    try {
      read = await readTextFile(this.path);
    } catch (err) {
      this.unreadable = describe(err);
      // Its end is unknown: start the next append on a fresh line (an empty line is skipped).
      this.needsNewline = true;
      this.logger.error(
        `Trips: cannot read ${this.path} (${this.unreadable}); starting with no trips and leaving the file as it is`,
      );
      return;
    }
    if (read.kind === 'missing') {
      this.needsNewline = false;
      return;
    }
    const text = read.text;
    this.needsNewline = text.length > 0 && !text.endsWith('\n');
    let skipped = 0;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      let value: unknown;
      try {
        value = JSON.parse(trimmed);
      } catch {
        skipped += 1;
        continue;
      }
      if (isTripRecord(value)) this.byId.set(value.id, pickTrip(value));
      else skipped += 1;
    }
    if (skipped > 0) {
      this.logger.warn(`Trips: skipped ${skipped} unreadable line(s) in ${this.path}`);
    }
    if (this.byId.size > this.maxTrips) {
      this.trimToCap();
      try {
        await this.queue.run(() => this.rewrite());
      } catch (err) {
        // The file keeps the older trips until a later rewrite succeeds; nothing is lost.
        this.logger.warn(`Trips: cannot rewrite ${this.path} after trimming: ${describe(err)}`);
      }
    }
  }

  get size(): number {
    return this.byId.size;
  }

  get(id: string): TripRecord | null {
    const trip = this.byId.get(id);
    return trip === undefined ? null : { ...trip };
  }

  /** Trips newest first, optionally only those started before `before`. */
  list(query: TripListQuery): TripRecord[] {
    const limit = Math.max(0, Math.floor(query.limit));
    const before = query.before ?? null;
    const out: TripRecord[] = [];
    for (const trip of this.ordered()) {
      if (out.length >= limit) break;
      if (before !== null && !(trip.startedAt < before)) continue;
      out.push({ ...trip });
    }
    return out;
  }

  /** Trips that ended strictly after `since`, newest first, at most `limit`. */
  endedAfter(since: number, limit: number): TripRecord[] {
    const out: TripRecord[] = [];
    for (const trip of this.ordered()) {
      if (out.length >= limit) break;
      if (trip.endedAt > since) out.push({ ...trip });
    }
    return out;
  }

  /**
   * What a phone asking for `query` is missing, at most `limit`: without `sinceSeq` (an older
   * app), the trips that ended after `since`, newest first. With it, the trips numbered after
   * `sinceSeq` and those recorded without a number (by older HUD versions) that ended after
   * `since`, oldest first — so one that gets `limit` trips asks again from the last of them, and
   * none is skipped however wrong the clock was when they were recorded.
   */
  missedBy(query: TripSyncQuery, limit: number): TripRecord[] {
    const { since, sinceSeq } = query;
    if (sinceSeq === undefined) return this.endedAfter(since, limit);
    const legacy: TripRecord[] = [];
    const numbered: TripRecord[] = [];
    for (const trip of this.ordered()) {
      if (trip.seq === undefined) {
        if (trip.endedAt > since) legacy.push(trip);
      } else if (trip.seq > sinceSeq) {
        numbered.push(trip);
      }
    }
    legacy.sort((a, b) => a.endedAt - b.endedAt);
    numbered.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    return [...legacy, ...numbered].slice(0, Math.max(0, Math.floor(limit))).map((t) => ({ ...t }));
  }

  /** The highest sequence number of any trip kept (0 when none has one). */
  get maxSeq(): number {
    let max = 0;
    for (const trip of this.byId.values()) max = Math.max(max, trip.seq ?? 0);
    return max;
  }

  /** Every trip as CSV (oldest first, like a logbook), via core's `tripsToCsv`. */
  csv(): string {
    return tripsToCsv([...this.ordered()].reverse());
  }

  /**
   * Store a completed trip. It is visible to `list` immediately; the returned promise settles
   * when it is on disk (rejecting if the write failed).
   */
  append(trip: TripRecord): Promise<void> {
    if (!isTripRecord(trip)) return Promise.reject(new Error('Not a valid trip record'));
    const record = pickTrip(trip);
    this.byId.set(record.id, record);
    this.sorted = null;
    if (this.byId.size > this.maxTrips) {
      this.trimToCap();
      if (this.unreadable === null) return this.queue.run(() => this.rewrite());
    }
    // A replaced id is appended too: on load the last copy of an id wins.
    return this.queue.run(async () => {
      const prefix = this.needsNewline ? '\n' : '';
      await appendFileDurable(this.path, `${prefix}${JSON.stringify(record)}\n`);
      this.needsNewline = false;
    });
  }

  /**
   * Delete a trip by id. Resolves false when there is no such trip; rejects if the write fails
   * (with {@link TripLogUnavailableError} when the file could not be read at start-up).
   */
  delete(id: string): Promise<boolean> {
    if (this.unreadable !== null) {
      return Promise.reject(new TripLogUnavailableError(this.path, this.unreadable));
    }
    return this.queue.run(async () => {
      const existing = this.byId.get(id);
      if (existing === undefined) return false;
      this.byId.delete(id);
      this.sorted = null;
      try {
        await this.rewrite();
      } catch (err) {
        // Keep memory consistent with the file that is still on disk.
        this.byId.set(id, existing);
        this.sorted = null;
        throw err;
      }
      return true;
    });
  }

  /** Resolves when all queued disk writes have settled. */
  flush(): Promise<void> {
    return this.queue.idle();
  }

  private ordered(): readonly TripRecord[] {
    this.sorted ??= [...this.byId.values()].sort(newestFirst);
    return this.sorted;
  }

  private trimToCap(): void {
    const keep = this.ordered().slice(0, this.maxTrips);
    const dropped = this.byId.size - keep.length;
    this.byId.clear();
    for (const trip of keep) this.byId.set(trip.id, trip);
    this.sorted = null;
    this.logger.info(`Trips: dropped the ${dropped} oldest trip(s) (keeping ${this.maxTrips})`);
  }

  private async rewrite(): Promise<void> {
    const lines = [...this.ordered()]
      .reverse()
      .map((trip) => `${JSON.stringify(trip)}\n`)
      .join('');
    await writeFileAtomic(this.path, lines);
    this.needsNewline = false;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
