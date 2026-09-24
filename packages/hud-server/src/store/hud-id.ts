import { readFile, rename } from 'node:fs/promises';
import { isAuthId } from '@carheadsup/core';
import type { Logger } from '@carheadsup/obd';
import { randomAuthId } from '../phone/auth.ts';
import { isNotFound, writeFileAtomic } from './atomic.ts';

/** File in the data directory that holds the HUD's identity. */
export const HUD_ID_FILE = 'hud-id';

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The HUD's identity on the phone link (`challenge.hudId`, mDNS TXT `id`): 16 random bytes as
 * 22 base64url characters, made on first start and kept in `<data dir>/hud-id` (written
 * atomically, mode 0600), so that a paired phone recognises this HUD across restarts. It is not
 * a secret — the pairing token is — but a phone pins it and refuses a HUD with another one.
 *
 * Never throws: a corrupt file is moved aside (`hud-id.corrupt`) and replaced by a new id, which
 * paired phones will report as "a different HUD" until they are paired again; an unreadable file
 * is left alone and a temporary id is used for this run; a failed save is logged.
 */
export async function loadHudId(
  path: string,
  logger: Logger,
  generate: () => string = randomAuthId,
): Promise<string> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (!isNotFound(err)) {
      logger.error(
        `HUD id: cannot read ${path} (${describe(err)}); using a temporary id until it can be ` +
          'read again, so paired phones will not recognise this HUD meanwhile',
      );
      return generate();
    }
    const id = generate();
    if (await save(path, id, logger)) logger.info(`HUD id: created ${path}`);
    return id;
  }
  const stored = text.trim();
  if (isAuthId(stored)) return stored;

  logger.warn(
    `HUD id: ${path} is corrupt; generating a new id. Phones paired with this HUD will report ` +
      '"a different HUD is answering" until they forget it and pair again.',
  );
  try {
    await rename(path, `${path}.corrupt`);
  } catch (err) {
    logger.warn(`HUD id: cannot move the corrupt file aside: ${describe(err)}`);
  }
  const id = generate();
  await save(path, id, logger);
  return id;
}

async function save(path: string, id: string, logger: Logger): Promise<boolean> {
  try {
    await writeFileAtomic(path, `${id}\n`);
    return true;
  } catch (err) {
    logger.error(
      `HUD id: cannot save ${path} (${describe(err)}); paired phones will see a different HUD ` +
        'after the next restart',
    );
    return false;
  }
}
