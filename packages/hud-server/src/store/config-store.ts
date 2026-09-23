import { randomBytes } from 'node:crypto';
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
 * Saving is refused: the file could not be loaded at start-up, and replacing it would lose the
 * user's settings.
 */
export class ConfigUnavailableError extends Error {
  constructor(path: string, reason: string) {
    super(`${path} could not be loaded at start-up (${reason}); fix it and restart the HUD`);
    this.name = 'ConfigUnavailableError';
  }
}

/** The token fields: when one cannot be loaded, it must not silently become "no token". */
const TOKEN_FIELDS = ['server.apiToken', 'phone.pairingToken'] as const;

/** An unguessable token that nobody knows (fail closed). */
function lockedToken(): string {
  return randomBytes(24).toString('base64url');
}

/** `config` with the given token fields replaced by random ones. */
function lockTokens(config: HudConfig, fields: readonly string[]): HudConfig {
  const next = structuredClone(config);
  if (fields.includes('server.apiToken')) next.server.apiToken = lockedToken();
  if (fields.includes('phone.pairingToken')) next.phone.pairingToken = lockedToken();
  return next;
}

/**
 * `config.json` in the data directory (or wherever `--config` points).
 *
 * Loading is forgiving: a missing file is created from DEFAULT_CONFIG; invalid fields fall back
 * to defaults field by field (see `parseConfig`) and are logged. When the loaded config differs
 * from the file it is saved back normalised, after keeping the original as `<file>.bak` so a
 * hand edit is never silently lost.
 *
 * Loading fails closed where falling back would open the HUD up: a token field that is invalid
 * gets a random token that nobody knows instead of "none", and a file that is not valid JSON
 * (a hand edit with a typo) runs with the defaults but random tokens — other devices and the
 * phone are locked out, the HUD's own display keeps working. Such a file, and one that cannot
 * be read at all (EACCES, EIO…), is left as it is and saving is refused until a restart loads
 * it. Writes are atomic and serialised.
 */
export class ConfigStore {
  readonly path: string;
  readonly backupPath: string;
  private readonly logger: Logger;
  private readonly queue = new SerialQueue();
  /** Why the file could not be loaded (unreadable, not JSON), or null. Saving is refused. */
  private unreadable: string | null = null;

  constructor(path: string, logger: Logger) {
    this.path = path;
    this.backupPath = `${path}.bak`;
    this.logger = logger;
  }

  async load(): Promise<ConfigLoadResult> {
    this.unreadable = null;
    let read;
    try {
      read = await readJsonFile(this.path);
    } catch (err) {
      this.unreadable = describe(err);
      this.logger.error(
        `Config: cannot read ${this.path} (${this.unreadable}); running with the default settings and random access tokens (other devices and the phone are locked out; the HUD's own display works) and leaving the file as it is`,
      );
      return {
        config: lockTokens(parseConfig(DEFAULT_CONFIG).config, TOKEN_FIELDS),
        errors: [],
        created: false,
      };
    }

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

    if (read.kind === 'invalid') {
      // Its settings (and tokens) are unknown: run locked, and keep the file for the user to fix.
      this.unreadable = `not valid JSON: ${read.error}`;
      this.logger.error(
        `Config: ${this.path} is not valid JSON (${read.error}). Running with the default settings and random access tokens (other devices and the phone are locked out; the HUD's own display works) and leaving the file as it is. Fix it and restart the HUD.`,
      );
      return {
        config: lockTokens(parseConfig(DEFAULT_CONFIG).config, TOKEN_FIELDS),
        errors: [`(file): not valid JSON (${read.error})`],
        created: false,
      };
    }

    const parsed = parseConfig(read.value);
    const { errors } = parsed;
    for (const error of errors) this.logger.warn(`Config: ${this.path}: ${error}`);
    const badTokens = TOKEN_FIELDS.filter((field) =>
      errors.some((error) => error.startsWith(`${field}:`)),
    );
    const config = lockTokens(parsed.config, badTokens);
    for (const field of badTokens) {
      this.logger.error(
        `Config: ${field} in ${this.path} is not usable, so it was replaced by a random token rather than none (that would open the HUD to every device). Set a new one in the settings on the HUD itself or in the file.`,
      );
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

  /**
   * Atomically replace the file with `config`. Rejects when the write fails, and with
   * {@link ConfigUnavailableError} when the file could not be loaded at start-up (it would
   * replace the user's settings with the defaults).
   */
  save(config: HudConfig): Promise<void> {
    if (this.unreadable !== null) {
      return Promise.reject(new ConfigUnavailableError(this.path, this.unreadable));
    }
    const text = serializeConfig(config);
    return this.queue.run(() => writeFileAtomic(this.path, text));
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
