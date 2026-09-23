import { randomBytes } from 'node:crypto';
import { copyFile, link, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Crash-safe file primitives for the data directory. The HUD loses power whenever the ignition
 * is switched off, so every write must leave either the old or the new file on disk — never a
 * torn one.
 */

/** Files in the data directory may hold secrets (API/pairing tokens) and driving history. */
export const PRIVATE_FILE_MODE = 0o600;
export const PRIVATE_DIR_MODE = 0o700;

export interface AtomicWriteOptions {
  /** File mode for newly created files. Default {@link PRIVATE_FILE_MODE}. */
  mode?: number;
  /**
   * Keep the file being replaced as this path (a hard link or a copy, put in place atomically, so
   * the backup is always a complete earlier version). Missing originals are fine.
   */
  backupPath?: string;
}

function isErrno(err: unknown, ...codes: string[]): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    typeof err.code === 'string' &&
    codes.includes(err.code)
  );
}

/** Whether `err` is a Node "no such file or directory" error. */
export function isNotFound(err: unknown): boolean {
  return isErrno(err, 'ENOENT');
}

/** fsync a directory so a rename inside it survives power loss (best effort where unsupported). */
async function syncDirectory(dir: string): Promise<void> {
  let handle;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch (err) {
    // Some filesystems/platforms cannot open or fsync directories; the rename is still atomic.
    if (!isErrno(err, 'EISDIR', 'EINVAL', 'EPERM', 'EACCES', 'ENOTSUP', 'EBADF')) throw err;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** A unique temporary name next to `path`. */
function tempPath(path: string): string {
  return join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`,
  );
}

/**
 * Make `backupPath` an exact earlier version of `path` while `path` itself stays in place (so a
 * power cut at any moment leaves the file there): a hard link, or a copy where links are not
 * possible, renamed over the old backup. Only if neither works is the file moved to the backup
 * path (it is then missing until the new version is renamed in, and readers use the backup).
 */
async function backUp(path: string, backupPath: string): Promise<void> {
  const tmp = tempPath(backupPath);
  try {
    try {
      await link(path, tmp);
    } catch (err) {
      if (isNotFound(err)) return;
      // No hard links here (FAT, protected_hardlinks for a file of another user…): copy.
      await copyFile(path, tmp);
      const handle = await open(tmp, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    await rename(tmp, backupPath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    if (isNotFound(err)) return;
    try {
      await rename(path, backupPath);
    } catch (moveErr) {
      if (!isNotFound(moveErr)) throw moveErr;
    }
  }
}

/**
 * Atomically replace `path` with `data`: write a temporary file in the same directory, fsync it,
 * rename it over the target (optionally keeping the old file as `backupPath` first) and fsync
 * the directory. At every moment `path` holds either the old or the new content. On failure the
 * temporary file is removed and the original is left untouched.
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const dir = dirname(path);
  const tmp = tempPath(path);
  let handle;
  try {
    handle = await open(tmp, 'wx', options.mode ?? PRIVATE_FILE_MODE);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (options.backupPath !== undefined) await backUp(path, options.backupPath);
    await rename(tmp, path);
  } catch (err) {
    await handle?.close().catch(() => {});
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  await syncDirectory(dir);
}

/**
 * Append `data` to `path` (created with `mode` if missing) and fsync it before resolving.
 * Appends are not atomic: after a power cut the last line may be torn, which readers of
 * line-oriented files must tolerate.
 */
export async function appendFileDurable(
  path: string,
  data: string,
  mode: number = PRIVATE_FILE_MODE,
): Promise<void> {
  const handle = await open(path, 'a', mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export type ReadTextResult = { kind: 'missing' } | { kind: 'ok'; text: string };

/** Read a UTF-8 file, reporting a missing file as `{ kind: 'missing' }` instead of throwing. */
export async function readTextFile(path: string): Promise<ReadTextResult> {
  try {
    return { kind: 'ok', text: await readFile(path, 'utf8') };
  } catch (err) {
    if (isNotFound(err)) return { kind: 'missing' };
    throw err;
  }
}

export type ReadJsonResult =
  | { kind: 'missing' }
  | { kind: 'ok'; value: unknown; text: string }
  | { kind: 'invalid'; error: string; text: string };

/** Read and parse a JSON file; a syntax error is reported, not thrown. */
export async function readJsonFile(path: string): Promise<ReadJsonResult> {
  const read = await readTextFile(path);
  if (read.kind === 'missing') return read;
  try {
    return { kind: 'ok', value: JSON.parse(read.text) as unknown, text: read.text };
  } catch (err) {
    return {
      kind: 'invalid',
      error: err instanceof Error ? err.message : String(err),
      text: read.text,
    };
  }
}

/** Create `dir` (and parents) if needed; new directories are private to the HUD's user. */
export async function ensureDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
}

/**
 * Serialises async operations: each queued task starts after the previous one settled, and a
 * failure does not poison the queue.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => {});
    return result;
  }

  /** Resolves once everything queued so far has settled. */
  async idle(): Promise<void> {
    await this.tail;
  }
}
