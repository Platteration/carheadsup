import { chmod, readFile, rename, stat } from 'node:fs/promises';
import type { Logger } from '@carheadsup/obd';
import { PRIVATE_FILE_MODE, isNotFound, writeFileAtomic } from '../store/atomic.ts';
import { createHudCertificate, parseCertificateBundle } from './certificate.ts';
import type { CertificateBundle, HudCertificateOptions } from './certificate.ts';

/**
 * File in the data directory with the HUD's TLS private key and certificate (PEM, key first),
 * mode 0600. One file, written atomically, so a power cut never leaves a key without its
 * certificate.
 */
export const TLS_FILE = 'tls.pem';

const KEY_BLOCK = /-----BEGIN ((?:EC |RSA )?PRIVATE KEY)-----[\s\S]*?-----END \1-----/;
const CERT_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** What `tls.pem` holds: the key, then the certificate. */
export function serializeTlsIdentity(bundle: CertificateBundle): string {
  return `${bundle.keyPem.trimEnd()}\n${bundle.certPem.trimEnd()}\n`;
}

/** Parse `tls.pem` (a private key and a certificate for it, in any order); throws the reason. */
export function parseTlsIdentity(text: string): CertificateBundle {
  const key = KEY_BLOCK.exec(text)?.[0];
  const cert = CERT_BLOCK.exec(text)?.[0];
  if (key === undefined) throw new Error('no private key');
  if (cert === undefined) throw new Error('no certificate');
  return parseCertificateBundle(`${key}\n`, `${cert}\n`);
}

export interface TlsIdentityOptions extends Pick<HudCertificateOptions, 'hostName'> {
  /** Wall clock (the new certificate's validity starts a day before). */
  now: () => number;
  /** Makes a new key and certificate (tests); default `createHudCertificate`. */
  generate?: (options: HudCertificateOptions) => CertificateBundle;
}

/**
 * The HUD's TLS identity: a key and a self-signed certificate kept in `<data dir>/tls.pem`,
 * made on first start (see `createHudCertificate`). Paired phones pin the certificate, so it is
 * kept across restarts and never renewed.
 *
 * Never throws: a corrupt file (no key, no certificate, or a certificate for another key) is
 * moved aside (`tls.pem.corrupt`) and replaced by a new identity — paired phones then report
 * "HUD certificate changed" until they are paired again; an unreadable file is left alone and a
 * temporary identity is used for this run; a failed save is logged. A key file others may read
 * is made private (0600), and so is a corrupt one moved aside.
 */
export async function loadTlsIdentity(
  path: string,
  logger: Logger,
  options: TlsIdentityOptions,
): Promise<CertificateBundle> {
  const generate = (): CertificateBundle =>
    (options.generate ?? createHudCertificate)({ hostName: options.hostName, now: options.now() });
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (!isNotFound(err)) {
      logger.error(
        `TLS: cannot read ${path} (${describe(err)}); using a temporary certificate until it ` +
          'can be read again, so paired phones will not connect meanwhile',
      );
      return generate();
    }
    const identity = generate();
    if (await save(path, identity, logger)) logger.info(`TLS: created a certificate in ${path}`);
    return identity;
  }

  try {
    const identity = parseTlsIdentity(text);
    await makePrivate(path, logger);
    return identity;
  } catch (err) {
    logger.warn(
      `TLS: ${path} is corrupt (${describe(err)}); generating a new certificate. Phones paired ` +
        'with this HUD will report "HUD certificate changed" until they are paired again.',
    );
  }
  const corruptPath = `${path}.corrupt`;
  try {
    await rename(path, corruptPath);
    // It may still hold a usable private key (e.g. one copied in with the wrong certificate).
    await makePrivate(corruptPath, logger);
  } catch (err) {
    logger.warn(`TLS: cannot move the corrupt file aside: ${describe(err)}`);
  }
  const identity = generate();
  await save(path, identity, logger);
  return identity;
}

/** Take read access from others if the key file has it (e.g. copied in by hand). */
async function makePrivate(path: string, logger: Logger): Promise<void> {
  try {
    const { mode } = await stat(path);
    if ((mode & 0o077) === 0) return;
    await chmod(path, PRIVATE_FILE_MODE);
    logger.warn(`TLS: ${path} holds the private key; made it readable by the HUD's user only`);
  } catch (err) {
    logger.warn(`TLS: cannot check the permissions of ${path}: ${describe(err)}`);
  }
}

async function save(path: string, identity: CertificateBundle, logger: Logger): Promise<boolean> {
  try {
    await writeFileAtomic(path, serializeTlsIdentity(identity));
    return true;
  } catch (err) {
    logger.error(
      `TLS: cannot save ${path} (${describe(err)}); paired phones will see a different ` +
        'certificate after the next restart',
    );
    return false;
  }
}
