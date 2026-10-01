import type { LogFileHandle, LogFs } from '../src/log-files.ts';

/** An in-memory file system that records writes and fsyncs, and fails on demand. */
export class MemoryFs implements LogFs {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  /** What the card holds: the content as of each file's last fsync. */
  readonly synced = new Map<string, string>();
  syncs = 0;
  /** When set, every call fails with this error code. */
  failWith: string | null = null;

  private check(): void {
    if (this.failWith !== null) {
      throw Object.assign(new Error(`${this.failWith}: simulated`), { code: this.failWith });
    }
  }

  async mkdir(path: string): Promise<unknown> {
    this.check();
    this.dirs.add(path);
    return undefined;
  }

  async open(path: string, flags: 'a' | 'w'): Promise<LogFileHandle> {
    this.check();
    if (flags === 'w' || !this.files.has(path)) this.files.set(path, '');
    let open = true;
    return {
      write: async (data: string) => {
        this.check();
        if (!open) throw new Error('closed');
        this.files.set(path, (this.files.get(path) ?? '') + data);
      },
      sync: async () => {
        this.check();
        this.syncs += 1;
        this.synced.set(path, this.files.get(path) ?? '');
      },
      close: async () => {
        open = false;
      },
    };
  }

  async stat(path: string): Promise<{ size: number }> {
    this.check();
    const content = this.files.get(path);
    if (content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { size: Buffer.byteLength(content) };
  }

  async rename(from: string, to: string): Promise<void> {
    this.check();
    const content = this.files.get(from);
    if (content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    this.files.set(to, content);
    this.files.delete(from);
  }

  async rm(path: string): Promise<void> {
    this.check();
    this.files.delete(path);
  }

  async readdir(dir: string): Promise<string[]> {
    this.check();
    return [...this.files.keys()]
      .filter((path) => path.startsWith(`${dir}/`))
      .map((path) => path.slice(dir.length + 1));
  }
}
