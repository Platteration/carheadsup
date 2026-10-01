import type { Logger, ObdProtocolCache } from '@carheadsup/obd';
import { SerialQueue, readJsonFile, writeFileAtomic } from '../store/atomic.ts';

/** File in the data directory that remembers the vehicle's OBD protocol. */
export const OBD_CACHE_FILE = 'obd-cache.json';

/** ELM327 protocol numbers worth remembering (not "0", automatic). */
const PROTOCOL_ID_RE = /^[1-9A-C]$/;
/** Adapter links remembered at most (one per serial device / TCP address / the simulator). */
const MAX_LINKS = 8;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The OBD protocol each adapter link's vehicle spoke last time, kept in
 * `<data dir>/obd-cache.json` (`{"protocols": {"serial:/dev/rfcomm0": "6"}}`), so that after a
 * restart the adapter's search starts with it and — while the ignition is still off — the
 * vehicle can be tried with it alone, which answers in a fraction of a second instead of a
 * search of several (see `ObdService`). Kept out of `state.json`: it is only a hint, so a lost,
 * stale or damaged file just means a slower first connect. Never throws; problems are logged.
 */
export class ObdProtocolFile implements ObdProtocolCache {
  private readonly path: string;
  private readonly logger: Logger;
  private readonly protocols: Map<string, string>;
  private readonly writes = new SerialQueue();

  private constructor(path: string, logger: Logger, protocols: Map<string, string>) {
    this.path = path;
    this.logger = logger;
    this.protocols = protocols;
  }

  /** Read the file (a missing, unreadable or invalid one counts as empty). */
  static async load(path: string, logger: Logger): Promise<ObdProtocolFile> {
    const protocols = new Map<string, string>();
    try {
      const read = await readJsonFile(path);
      if (read.kind === 'invalid') {
        logger.warn(`OBD: ignoring ${path}: ${read.error}`);
      } else if (read.kind === 'ok') {
        const value = read.value as { protocols?: unknown } | null;
        const stored = typeof value === 'object' && value !== null ? value.protocols : null;
        if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
          for (const [link, id] of Object.entries(stored)) {
            if (typeof id === 'string' && PROTOCOL_ID_RE.test(id) && link.length <= 512) {
              protocols.set(link, id);
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`OBD: cannot read ${path}: ${describe(err)}`);
    }
    return new ObdProtocolFile(path, logger, new Map([...protocols].slice(-MAX_LINKS)));
  }

  get(connection: string): string | null {
    return this.protocols.get(connection) ?? null;
  }

  /** Remember a protocol; the file is rewritten (atomically) only when it changed. */
  set(connection: string, protocolId: string): void {
    if (!PROTOCOL_ID_RE.test(protocolId) || this.protocols.get(connection) === protocolId) return;
    this.protocols.delete(connection); // most recently used last
    this.protocols.set(connection, protocolId);
    while (this.protocols.size > MAX_LINKS) {
      const oldest = this.protocols.keys().next().value;
      if (oldest === undefined) break;
      this.protocols.delete(oldest);
    }
    const text = `${JSON.stringify({ protocols: Object.fromEntries(this.protocols) }, null, 2)}\n`;
    void this.writes.run(async () => {
      try {
        await writeFileAtomic(this.path, text);
      } catch (err) {
        this.logger.warn(`OBD: cannot save ${this.path}: ${describe(err)}`);
      }
    });
  }

  /** Resolves once the writes started so far have finished. */
  flushed(): Promise<void> {
    return this.writes.idle();
  }
}
