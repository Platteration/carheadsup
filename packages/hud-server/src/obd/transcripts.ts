/**
 * Transcript files of the raw OBD-II adapter traffic (`obd.recordTranscript`, `--record`): one
 * file per adapter session in `<data dir>/obd-transcripts`, `obd-<time>.jsonl` (format in
 * `@carheadsup/obd`'s `transcript.ts`), split into parts beyond 16 MiB, the oldest deleted beyond
 * 64 MiB in all. Lines are written to the card every 5 s, and when the session ends, so a power
 * cut loses a few seconds at most; a reader skips a torn last line.
 */
import { join } from 'node:path';
import type { TranscriptEntry, TranscriptHeader, TranscriptSink } from '@carheadsup/obd';
import type { Logger, Timers } from '@carheadsup/obd';
import { LOG_SYNC_INTERVAL_MS, NODE_LOG_FS } from '../log-files.ts';
import type { LogFileHandle, LogFs } from '../log-files.ts';

/** Directory of the transcripts, inside the data directory. */
export const TRANSCRIPT_DIR = 'obd-transcripts';
/** A session's file is continued in a new part beyond this size … */
export const MAX_TRANSCRIPT_FILE_BYTES = 16 * 1024 * 1024;
/** … and the oldest files are deleted while all of them take more than this. */
export const MAX_TRANSCRIPT_TOTAL_BYTES = 64 * 1024 * 1024;

export interface TranscriptFilesOptions {
  /** Where the files go: `<data dir>/obd-transcripts`. */
  dir: string;
  fs?: LogFs;
  timers: Timers;
  logger: Logger;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  syncIntervalMs?: number;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `obd-2026-10-01T07-30-00.000Z.jsonl`, then `….part2.jsonl` …: sorts by time (and a session's
 * parts after its first), no colons.
 */
export function transcriptFileName(startedAt: number, part = 1): string {
  const stamp = Number.isFinite(startedAt) ? new Date(startedAt).toISOString() : 'unknown-time';
  return `obd-${stamp.replace(/:/g, '-')}${part > 1 ? `.part${part}` : ''}.jsonl`;
}

/** Makes the transcript files of the adapter sessions (see the module comment). */
export class TranscriptFiles {
  readonly dir: string;
  private readonly options: TranscriptFilesOptions;
  readonly fs: LogFs;

  constructor(options: TranscriptFilesOptions) {
    this.options = options;
    this.dir = options.dir;
    this.fs = options.fs ?? NODE_LOG_FS;
  }

  /** The sink for a session that just opened (a `TranscriptSinkFactory`). */
  readonly createSink = (header: TranscriptHeader): TranscriptSink =>
    new TranscriptFile(this, this.options, header);

  /**
   * Delete the oldest transcripts (never `keep`, the file just started) until there is room for
   * it to grow to its full size within the total.
   */
  async prune(keep: string): Promise<void> {
    const limit =
      (this.options.maxTotalBytes ?? MAX_TRANSCRIPT_TOTAL_BYTES) -
      (this.options.maxFileBytes ?? MAX_TRANSCRIPT_FILE_BYTES);
    const names = (await this.fs.readdir(this.dir))
      .filter((name) => /^obd-.*\.jsonl$/.test(name))
      .sort();
    const sizes = await Promise.all(
      names.map(async (name) => {
        try {
          return (await this.fs.stat(join(this.dir, name))).size;
        } catch {
          return 0;
        }
      }),
    );
    let total = sizes.reduce((sum, size) => sum + size, 0);
    for (let i = 0; i < names.length && total > limit; i += 1) {
      const name = names[i];
      if (name === undefined || join(this.dir, name) === keep) continue;
      await this.fs.rm(join(this.dir, name), { force: true });
      total -= sizes[i] ?? 0;
    }
  }
}

/** One session's transcript: buffered, appended and fsync'd every few seconds, split by size. */
class TranscriptFile implements TranscriptSink {
  private readonly files: TranscriptFiles;
  private readonly options: TranscriptFilesOptions;
  private readonly header: TranscriptHeader;
  private part = 1;
  private path: string;
  private handle: LogFileHandle | null = null;
  private bytes = 0;
  private pending: string[] = [];
  private timer: unknown = null;
  private chain: Promise<void> = Promise.resolve();
  private failed = false;
  private closed = false;

  constructor(files: TranscriptFiles, options: TranscriptFilesOptions, header: TranscriptHeader) {
    this.files = files;
    this.options = options;
    this.header = header;
    this.path = join(files.dir, transcriptFileName(header.startedAt));
    this.pending.push(`${JSON.stringify(header)}\n`);
    options.logger.info(`OBD: recording the adapter traffic to ${this.path}`);
  }

  write(entry: TranscriptEntry): void {
    if (this.closed || this.failed) return;
    this.pending.push(`${JSON.stringify(entry)}\n`);
    this.timer ??= this.options.timers.setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.options.syncIntervalMs ?? LOG_SYNC_INTERVAL_MS);
  }

  close(): Promise<void> {
    if (this.closed) return this.chain;
    this.closed = true;
    if (this.timer !== null) this.options.timers.clearTimeout(this.timer);
    this.timer = null;
    this.flush();
    this.chain = this.chain.then(async () => {
      await this.closeHandle();
    });
    return this.chain;
  }

  private flush(): void {
    this.chain = this.chain.then(() => this.writePending());
  }

  private async writePending(): Promise<void> {
    if (this.failed || this.pending.length === 0) return;
    const text = this.pending.join('');
    this.pending = [];
    try {
      const limit = this.options.maxFileBytes ?? MAX_TRANSCRIPT_FILE_BYTES;
      if (this.handle !== null && this.bytes > 0 && this.bytes + Buffer.byteLength(text) > limit) {
        // Continue in a new part, which starts with the header too.
        await this.closeHandle();
        this.part += 1;
        this.path = join(this.files.dir, transcriptFileName(this.header.startedAt, this.part));
        const header = `${JSON.stringify({ ...this.header, part: this.part })}\n`;
        await this.openFile();
        await this.append(header);
      }
      if (this.handle === null) await this.openFile();
      await this.append(text);
      await this.handle?.sync();
    } catch (err) {
      this.failed = true;
      this.pending = [];
      this.options.logger.warn(
        `OBD: recording to ${this.path} failed (${describe(err)}); the rest of this session is not recorded`,
      );
      await this.closeHandle();
    }
  }

  private async openFile(): Promise<void> {
    const fs = this.files.fs;
    await fs.mkdir(this.files.dir, { recursive: true, mode: 0o700 });
    this.handle = await fs.open(this.path, 'a');
    this.bytes = 0;
    await this.files.prune(this.path).catch((err: unknown) => {
      this.options.logger.debug(`OBD: cleaning up old transcripts failed: ${describe(err)}`);
    });
  }

  private async append(text: string): Promise<void> {
    await this.handle?.write(text);
    this.bytes += Buffer.byteLength(text);
  }

  private async closeHandle(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    await handle?.close().catch(() => undefined);
  }
}
