import { DEFAULT_CONFIG, parseConfig } from '@carheadsup/core';
import type { HudConfig } from '@carheadsup/core';
import type { Logger } from '@carheadsup/obd';
import { SerialQueue, readJsonFile, writeFileAtomic } from './atomic.ts';

/** How a config file is written: pretty-printed JSON with a trailing newline (hand-editable). */
export function serializeConfig(config: HudConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export interface ConfigLoadResult {
  config: HudConfig;
  /** Validation problems found in the file (the offending fields were reset to defaults). */
  errors: string[];
  /** The file did not exist and was created from the defaults. */
  created: boolean;
}

/**
 * `config.json` in the data directory (or wherever `--config` points).
 *
 * Loading is forgiving: a missing file is created from DEFAULT_CONFIG; unparseable JSON or
 * invalid fields fall back to defaults field by field (see `parseConfig`) and are logged. When
 * the loaded config differs from the file it is saved back normalised, after keeping the
 * original as `<file>.bak` so a hand edit is never silently lost. Writes are atomic and
 * serialised.
 */
export class ConfigStore {
  readonly path: string;
  readonly backupPath: string;
  private readonly logger: Logger;
  private readonly queue = new SerialQueue();

  constructor(path: string, logger: Logger) {
    this.path = path;
    this.backupPath = `${path}.bak`;
    this.logger = logger;
  }

  async load(): Promise<ConfigLoadResult> {
    const read = await readJsonFile(this.path);

    if (read.kind === 'missing') {
      const { config } = parseConfig(DEFAULT_CONFIG);
      try {
        await this.save(config);
        this.logger.info(`Config: created ${this.path} with default settings`);
      } catch (err) {
        this.logger.warn(`Config: cannot create ${this.path}: ${describe(err)}; using defaults`);
      }
      return { config, errors: [], created: true };
    }

    let config: HudConfig;
    let errors: string[];
    if (read.kind === 'invalid') {
      config = parseConfig(DEFAULT_CONFIG).config;
      errors = [`(file): not valid JSON (${read.error})`];
      this.logger.error(`Config: ${this.path} is not valid JSON (${read.error}); using defaults`);
    } else {
      ({ config, errors } = parseConfig(read.value));
      for (const error of errors) this.logger.warn(`Config: ${this.path}: ${error}`);
    }

    const normalized = serializeConfig(config);
    if (normalized !== read.text) {
      try {
        // Keep the original (the user's hand edit) before replacing it with the normalised form.
        await this.queue.run(async () => {
          await writeFileAtomic(this.path, normalized, { backupPath: this.backupPath });
        });
        if (errors.length > 0) {
          this.logger.warn(
            `Config: saved a corrected ${this.path}; the original was kept as ${this.backupPath}`,
          );
        }
      } catch (err) {
        this.logger.warn(`Config: cannot rewrite ${this.path}: ${describe(err)}`);
      }
    }
    return { config, errors, created: false };
  }

  /** Atomically replace the file with `config`. Rejects when the write fails. */
  save(config: HudConfig): Promise<void> {
    const text = serializeConfig(config);
    return this.queue.run(() => writeFileAtomic(this.path, text));
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
